package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

var templateFuncs = template.FuncMap{
	"json": func(v any) (string, error) {
		b, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(b), nil
	},
}

type ConfigService struct {
	cfg       config.Config
	settings  *SettingsService
	systemctl SystemctlAdapter
	xray      XrayAdapter
	hysteria  HysteriaAdapter
	logger    *slog.Logger

	reconcileMu sync.Mutex
}

func NewConfigService(cfg config.Config, settings *SettingsService, systemctl SystemctlAdapter, xray XrayAdapter, hysteria HysteriaAdapter, logger *slog.Logger) *ConfigService {
	return &ConfigService{
		cfg:       cfg,
		settings:  settings,
		systemctl: systemctl,
		xray:      xray,
		hysteria:  hysteria,
		logger:    logger,
	}
}

func (s *ConfigService) Get(ctx context.Context, core string) ([]byte, error) {
	path, err := s.pathForCore(core)
	if err != nil {
		return nil, err
	}

	content, err := os.ReadFile(path)
	if err == nil {
		return content, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	rendered, err := s.Render(ctx, core)
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(path, rendered, 0o640); err != nil {
		return nil, err
	}
	return rendered, nil
}

func (s *ConfigService) Render(ctx context.Context, core string, overrides ...map[string]json.RawMessage) ([]byte, error) {
	runtime, err := s.runtime(ctx, overrides...)
	if err != nil {
		return nil, err
	}
	return s.RenderWithRuntime(core, runtime)
}

// ReconcileXray regenerates the Xray config from the current runtime (which
// includes the active client list from the database) and restarts the kernel
// so the new client UUIDs take effect.
func (s *ConfigService) ReconcileXray(ctx context.Context, overrides ...map[string]json.RawMessage) error {
	return s.ReconcileCore(ctx, "xray", overrides...)
}

func (s *ConfigService) ReconcileHysteria(ctx context.Context, overrides ...map[string]json.RawMessage) error {
	return s.ReconcileCore(ctx, "hysteria", overrides...)
}

func (s *ConfigService) ReconcileCore(ctx context.Context, core string, overrides ...map[string]json.RawMessage) error {
	s.reconcileMu.Lock()
	defer s.reconcileMu.Unlock()

	content, err := s.Render(ctx, core, overrides...)
	if err != nil {
		return err
	}
	path, err := s.pathForCore(core)
	if err != nil {
		return err
	}
	if current, err := os.ReadFile(path); err == nil && bytes.Equal(current, content) {
		if err := s.health(ctx, core); err == nil {
			return nil
		}
	}
	if err := writeFileAtomic(path, content, 0o640); err != nil {
		return err
	}
	if err := s.systemctl.Restart(ctx, core); err != nil {
		return err
	}
	return s.waitHealthy(ctx, core)
}

func (s *ConfigService) runtime(ctx context.Context, overrides ...map[string]json.RawMessage) (RuntimeSettings, error) {
	if s.settings == nil {
		return RuntimeSettings{}, domain.NewError(500, "settings_unavailable", "Settings service is not available", nil)
	}
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return RuntimeSettings{}, err
	}
	for _, values := range overrides {
		if len(values) == 0 {
			continue
		}
		normalized, err := normalizeSettingsUpdate(values)
		if err != nil {
			return RuntimeSettings{}, err
		}
		applyRuntimeValues(&runtime, normalized)
	}
	runtime.RealityServerNames = dedupeNonEmpty(append([]string{runtime.RealitySNI}, runtime.RealityServerNames...))
	runtime.RealityShortIDs = normalizeShortIDs(runtime.RealityShortIDs)
	return runtime, nil
}

func (s *ConfigService) RestartService(ctx context.Context, service string) error {
	if service != "panel" && service != "xray" && service != "hysteria" && service != "caddy" {
		return domain.NewError(400, "invalid_service", "Service must be panel, xray, hysteria or caddy", nil)
	}
	return s.systemctl.Restart(ctx, service)
}

func (s *ConfigService) health(ctx context.Context, core string) error {
	switch core {
	case "xray":
		return s.xray.Health(ctx)
	case "hysteria":
		return s.hysteria.Health(ctx)
	default:
		return domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func (s *ConfigService) RenderWithRuntime(core string, runtime RuntimeSettings) ([]byte, error) {
	name, err := templateName(core)
	if err != nil {
		return nil, err
	}
	templatePath := filepath.Join(s.cfg.Panel.TemplatesDir, name)
	tmpl, err := template.New(filepath.Base(templatePath)).Funcs(templateFuncs).ParseFiles(templatePath)
	if err != nil {
		return nil, err
	}

	var out bytes.Buffer
	if err := tmpl.Execute(&out, runtime); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *ConfigService) Validate(ctx context.Context, core string, content []byte) error {
	switch core {
	case "xray":
		var payload map[string]any
		if err := json.Unmarshal(content, &payload); err != nil {
			return domain.NewError(400, "invalid_config", "Configuration contains JSON errors", err)
		}
		if err := s.validateXrayInboundPorts(content); err != nil {
			return err
		}
		if _, err := os.Stat(s.cfg.Xray.Binary); err == nil {
			testContent, err := prepareXrayConfigForTest(payload)
			if err != nil {
				return err
			}
			tmp, err := os.CreateTemp("", "xray-*.json")
			if err != nil {
				return err
			}
			defer os.Remove(tmp.Name())
			if _, err := tmp.Write(testContent); err != nil {
				return err
			}
			_ = tmp.Close()
			if err := s.runXrayConfigTest(ctx, tmp.Name()); err != nil {
				return err
			}
		}
		return nil
	case "hysteria":
		var payload map[string]any
		if err := json.Unmarshal(content, &payload); err != nil {
			return domain.NewError(400, "invalid_config", "Configuration contains JSON errors", err)
		}
		if _, ok := payload["listen"]; !ok {
			return domain.NewError(400, "invalid_config", "listen is required", nil)
		}
		return nil
	default:
		return domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func (s *ConfigService) validateXrayInboundPorts(content []byte) error {
	nextPorts, err := xrayInboundPorts(content)
	if err != nil {
		return err
	}
	currentPorts := map[int]bool{}
	if current, err := os.ReadFile(s.cfg.Xray.ConfigPath); err == nil {
		if ports, err := xrayInboundPorts(current); err == nil {
			for _, port := range ports {
				currentPorts[port] = true
			}
		}
	}

	seen := map[int]bool{}
	for _, port := range nextPorts {
		if seen[port] {
			return domain.NewError(400, "port_conflict", fmt.Sprintf("Xray configuration uses TCP port %d more than once", port), nil)
		}
		seen[port] = true
		if currentPorts[port] {
			continue
		}
		result := ProbePort("tcp", port)
		if !result.Available {
			reason := strings.TrimSpace(result.Reason)
			if reason == "" {
				reason = "port is not available"
			}
			return domain.NewError(400, "port_unavailable", fmt.Sprintf("Xray inbound port %d/tcp is not available: %s", port, reason), nil)
		}
	}
	return nil
}

func xrayInboundPorts(content []byte) ([]int, error) {
	var payload struct {
		Inbounds []struct {
			Port any `json:"port"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, domain.NewError(400, "invalid_config", "Configuration contains JSON errors", err)
	}
	ports := make([]int, 0, len(payload.Inbounds))
	for _, inbound := range payload.Inbounds {
		if inbound.Port == nil {
			continue
		}
		port, ok := jsonNumberAsPort(inbound.Port)
		if !ok {
			return nil, domain.NewError(400, "invalid_config", "Xray inbound port must be an integer between 1 and 65535", nil)
		}
		ports = append(ports, port)
	}
	return ports, nil
}

func jsonNumberAsPort(value any) (int, bool) {
	switch v := value.(type) {
	case float64:
		port := int(v)
		return port, float64(port) == v && validRuntimePort(port)
	case int:
		return v, validRuntimePort(v)
	default:
		return 0, false
	}
}

func prepareXrayConfigForTest(payload map[string]any) ([]byte, error) {
	inbounds, ok := payload["inbounds"].([]any)
	if !ok {
		return json.Marshal(payload)
	}
	ports, err := reserveTCPPorts(len(inbounds))
	if err != nil {
		return nil, err
	}
	for index, inbound := range inbounds {
		item, ok := inbound.(map[string]any)
		if !ok {
			continue
		}
		if _, ok := item["port"]; ok {
			item["listen"] = "127.0.0.1"
			item["port"] = ports[index]
		}
	}
	return json.Marshal(payload)
}

func reserveTCPPorts(count int) ([]int, error) {
	if count <= 0 {
		return nil, nil
	}
	listeners := make([]net.Listener, 0, count)
	defer func() {
		for _, listener := range listeners {
			_ = listener.Close()
		}
	}()
	ports := make([]int, 0, count)
	for len(ports) < count {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, domain.NewError(500, "port_probe_failed", "Unable to reserve temporary ports for Xray validation", err)
		}
		listeners = append(listeners, listener)
		ports = append(ports, listener.Addr().(*net.TCPAddr).Port)
	}
	return ports, nil
}

func (s *ConfigService) runXrayConfigTest(ctx context.Context, path string) error {
	commands := [][]string{
		{"test", "-c", path},
		{"run", "-test", "-c", path},
	}
	for index, args := range commands {
		deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
		cmd := exec.CommandContext(deadline, s.cfg.Xray.Binary, args...)
		if s.cfg.Xray.GeodataDir != "" {
			cmd.Env = append(os.Environ(), "XRAY_LOCATION_ASSET="+s.cfg.Xray.GeodataDir)
		}
		out, err := cmd.CombinedOutput()
		timedOut := deadline.Err() == context.DeadlineExceeded
		cancel()
		if err == nil {
			return nil
		}
		if timedOut {
			return domain.NewError(400, "invalid_config", "Xray configuration test timed out", err)
		}
		if index == 0 && xrayTestCommandUnsupported(out) {
			continue
		}
		return domain.NewError(
			400,
			"invalid_config",
			"Xray configuration test failed: "+compactCommandOutput(out),
			fmt.Errorf("%s", out),
		)
	}
	return nil
}

func xrayTestCommandUnsupported(out []byte) bool {
	message := strings.ToLower(string(out))
	return strings.Contains(message, "unknown command") ||
		strings.Contains(message, "unknown subcommand") ||
		strings.Contains(message, "flag provided but not defined")
}

func compactCommandOutput(out []byte) string {
	message := strings.Join(strings.Fields(string(out)), " ")
	if message == "" {
		return "xray returned a non-zero exit code"
	}
	if len(message) > 360 {
		return message[:360] + "..."
	}
	return message
}

func (s *ConfigService) Apply(ctx context.Context, core string, content []byte) error {
	if err := s.Validate(ctx, core, content); err != nil {
		return err
	}
	path, err := s.pathForCore(core)
	if err != nil {
		return err
	}

	bak := path + ".bak"
	if current, err := os.ReadFile(path); err == nil {
		if err := os.WriteFile(bak, current, 0o640); err != nil {
			return err
		}
	}

	if err := writeFileAtomic(path, content, 0o640); err != nil {
		return err
	}

	if err := s.systemctl.Restart(ctx, core); err != nil {
		_ = restoreFile(bak, path)
		_ = s.systemctl.Restart(ctx, core)
		return err
	}
	if err := s.waitHealthy(ctx, core); err != nil {
		_ = restoreFile(bak, path)
		_ = s.systemctl.Restart(ctx, core)
		return err
	}

	return nil
}

func (s *ConfigService) waitHealthy(ctx context.Context, core string) error {
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		err := s.health(deadline, core)
		if err == nil {
			return nil
		}
		select {
		case <-deadline.Done():
			return deadline.Err()
		case <-ticker.C:
		}
	}
}

func (s *ConfigService) pathForCore(core string) (string, error) {
	switch core {
	case "xray":
		return s.cfg.Xray.ConfigPath, nil
	case "hysteria":
		return s.cfg.Hysteria.ConfigPath, nil
	default:
		return "", domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func templateName(core string) (string, error) {
	switch core {
	case "xray":
		return "xray.config.json.tmpl", nil
	case "hysteria":
		return "hysteria.config.json.tmpl", nil
	default:
		return "", domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func writeFileAtomic(path string, content []byte, mode os.FileMode) error {
	if err := ensureParentDir(path); err != nil {
		return err
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "cfg-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func ensureParentDir(path string) error {
	return os.MkdirAll(filepath.Dir(path), 0o755)
}

func restoreFile(src, dst string) error {
	content, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, content, 0o640)
}
