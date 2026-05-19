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
	"reflect"
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

type ConfigSnapshot struct {
	Content        []byte
	ManagedContent []byte
	HasOverride    bool
}

var coreRestartTimeout = 15 * time.Second

const (
	arrayPatchOpKey    = "__h2v_array_patch"
	arrayPatchAppendOp = "append"
)

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
	snapshot, err := s.GetSnapshot(ctx, core, false)
	if err != nil {
		return nil, err
	}
	return snapshot.Content, nil
}

func (s *ConfigService) GetSnapshot(ctx context.Context, core string, includeManaged bool) (*ConfigSnapshot, error) {
	path, err := s.pathForCore(core)
	if err != nil {
		return nil, err
	}

	_, hasOverride, err := s.configOverride(ctx, core)
	if err != nil {
		return nil, err
	}

	content, err := os.ReadFile(path)
	if err == nil {
		if !includeManaged {
			return &ConfigSnapshot{Content: content, HasOverride: hasOverride}, nil
		}
		managed, err := s.RenderManaged(ctx, core)
		if err != nil {
			return nil, err
		}
		return &ConfigSnapshot{Content: content, ManagedContent: managed, HasOverride: hasOverride || !bytes.Equal(content, managed)}, nil
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
	if !includeManaged {
		return &ConfigSnapshot{Content: rendered, HasOverride: hasOverride}, nil
	}
	managed, err := s.RenderManaged(ctx, core)
	if err != nil {
		return nil, err
	}
	return &ConfigSnapshot{Content: rendered, ManagedContent: managed, HasOverride: hasOverride}, nil
}

func (s *ConfigService) Render(ctx context.Context, core string, overrides ...map[string]json.RawMessage) ([]byte, error) {
	managed, err := s.RenderManaged(ctx, core, overrides...)
	if err != nil {
		return nil, err
	}
	return s.applyConfigOverride(ctx, core, managed)
}

func (s *ConfigService) RenderManaged(ctx context.Context, core string, overrides ...map[string]json.RawMessage) ([]byte, error) {
	runtime, err := s.runtime(ctx, overrides...)
	if err != nil {
		return nil, err
	}
	return s.RenderWithRuntime(core, runtime)
}

func (s *ConfigService) ReconcileXray(ctx context.Context, overrides ...map[string]json.RawMessage) error {
	return s.ReconcileCore(ctx, "xray", overrides...)
}

func (s *ConfigService) ReconcileHysteria(ctx context.Context, overrides ...map[string]json.RawMessage) error {
	return s.ReconcileCore(ctx, "hysteria", overrides...)
}

func (s *ConfigService) PersistXray(ctx context.Context, overrides ...map[string]json.RawMessage) error {
	return s.PersistCoreConfig(ctx, "xray", overrides...)
}

func (s *ConfigService) PersistCoreConfig(ctx context.Context, core string, overrides ...map[string]json.RawMessage) error {
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
		return nil
	}
	if err := s.Validate(ctx, core, content); err != nil {
		return err
	}
	return writeFileAtomic(path, content, 0o640)
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
	current, readCurrentErr := os.ReadFile(path)
	hasCurrent := readCurrentErr == nil
	if hasCurrent && bytes.Equal(current, content) {
		if err := s.health(ctx, core); err == nil {
			return nil
		}
	}
	if err := s.Validate(ctx, core, content); err != nil {
		return err
	}
	if err := writeFileAtomic(path, content, 0o640); err != nil {
		return err
	}
	if err := s.restartCore(ctx, core); err != nil {
		s.rollbackCoreConfig(core, path, current, hasCurrent)
		return err
	}
	if err := s.waitHealthy(ctx, core); err != nil {
		s.rollbackCoreConfig(core, path, current, hasCurrent)
		return err
	}
	return nil
}

func (s *ConfigService) rollbackCoreConfig(core, path string, previous []byte, ok bool) {
	if !ok {
		return
	}
	if err := writeFileAtomic(path, previous, 0o640); err != nil {
		if s.logger != nil {
			s.logger.Error("core config rollback failed", "core", core, "path", path, "err", err)
		}
		return
	}
	if err := s.restartCore(context.Background(), core); err != nil {
		if s.logger != nil {
			s.logger.Error("core restart after rollback failed", "core", core, "err", err)
		}
	}
}

func (s *ConfigService) restartCore(ctx context.Context, core string) error {
	if s.systemctl == nil {
		return nil
	}
	deadline, cancel := context.WithTimeout(ctx, coreRestartTimeout)
	defer cancel()
	return s.systemctl.Restart(deadline, core)
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
	normalizeRuntimeDerivedValues(&runtime)
	return runtime, nil
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
	templatePath := filepath.Join(s.cfg.H2V.TemplatesDir, name)
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
		return validateHysteriaConfigPayload(payload)
	default:
		return domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func validateHysteriaConfigPayload(payload map[string]any) error {
	listen, _ := payload["listen"].(string)
	if strings.TrimSpace(listen) == "" {
		return domain.NewError(400, "invalid_config", "listen is required", nil)
	}
	if !validHysteriaListen(listen) {
		return domain.NewError(400, "invalid_config", "listen must include a valid UDP port", nil)
	}

	tlsBlock, ok := payload["tls"].(map[string]any)
	if !ok {
		return domain.NewError(400, "invalid_config", "tls block is required", nil)
	}
	if strings.TrimSpace(stringMapValue(tlsBlock, "cert")) == "" || strings.TrimSpace(stringMapValue(tlsBlock, "key")) == "" {
		return domain.NewError(400, "invalid_config", "tls cert and key are required", nil)
	}

	auth, ok := payload["auth"].(map[string]any)
	if !ok || stringMapValue(auth, "type") != "http" {
		return domain.NewError(400, "invalid_config", "auth.type must be http", nil)
	}
	authHTTP, ok := auth["http"].(map[string]any)
	if !ok || !validHTTPURL(stringMapValue(authHTTP, "url")) {
		return domain.NewError(400, "invalid_config", "auth.http.url must be a valid http or https URL", nil)
	}

	trafficStats, ok := payload["trafficStats"].(map[string]any)
	if !ok {
		return domain.NewError(400, "invalid_config", "trafficStats block is required", nil)
	}
	if !validHysteriaListen(stringMapValue(trafficStats, "listen")) {
		return domain.NewError(400, "invalid_config", "trafficStats.listen must include a valid port", nil)
	}
	if strings.TrimSpace(stringMapValue(trafficStats, "secret")) == "" {
		return domain.NewError(400, "invalid_config", "trafficStats.secret is required", nil)
	}

	bandwidth, ok := payload["bandwidth"].(map[string]any)
	if !ok {
		return domain.NewError(400, "invalid_config", "bandwidth block is required", nil)
	}
	if !bandwidthPattern.MatchString(stringMapValue(bandwidth, "up")) || !bandwidthPattern.MatchString(stringMapValue(bandwidth, "down")) {
		return domain.NewError(400, "invalid_config", "bandwidth up and down must use bps, kbps, mbps, gbps, or tbps", nil)
	}

	acl, ok := payload["acl"].(map[string]any)
	if !ok || strings.TrimSpace(stringMapValue(acl, "geoip")) == "" || strings.TrimSpace(stringMapValue(acl, "geosite")) == "" {
		return domain.NewError(400, "invalid_config", "acl.geoip and acl.geosite are required", nil)
	}

	if obfs, ok := payload["obfs"].(map[string]any); ok {
		if stringMapValue(obfs, "type") != "salamander" {
			return domain.NewError(400, "invalid_config", "obfs.type must be salamander", nil)
		}
		salamander, ok := obfs["salamander"].(map[string]any)
		if !ok || strings.TrimSpace(stringMapValue(salamander, "password")) == "" {
			return domain.NewError(400, "invalid_config", "obfs.salamander.password is required", nil)
		}
	} else if _, ok := payload["masquerade"].(map[string]any); !ok {
		return domain.NewError(400, "invalid_config", "masquerade is required when obfs is disabled", nil)
	}

	return nil
}

func validHysteriaListen(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, ":") {
		return validRuntimePortString(strings.TrimPrefix(value, ":"))
	}
	_, port, err := net.SplitHostPort(value)
	return err == nil && validRuntimePortString(port)
}

func validRuntimePortString(value string) bool {
	port, ok := jsonNumberAsPort(json.Number(value))
	return ok && validRuntimePort(port)
}

func stringMapValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
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
	case json.Number:
		port, err := v.Int64()
		return int(port), err == nil && validRuntimePort(int(port))
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
	managed, err := s.RenderManaged(ctx, core)
	if err != nil {
		return err
	}
	patch, err := configOverridePatch(managed, content)
	if err != nil {
		return err
	}
	previousOverride, hadPreviousOverride, err := s.configOverride(ctx, core)
	if err != nil {
		return err
	}

	bak := path + ".bak"
	if current, err := os.ReadFile(path); err == nil {
		if err := os.WriteFile(bak, current, 0o640); err != nil {
			return err
		}
	}

	if err := s.saveConfigOverride(ctx, core, patch); err != nil {
		return err
	}
	if err := writeFileAtomic(path, content, 0o640); err != nil {
		s.restoreConfigOverride(core, previousOverride, hadPreviousOverride)
		return err
	}

	if err := s.restartCore(ctx, core); err != nil {
		s.restoreConfigOverride(core, previousOverride, hadPreviousOverride)
		_ = restoreFile(bak, path)
		_ = s.restartCore(context.Background(), core)
		return err
	}
	if err := s.waitHealthy(ctx, core); err != nil {
		s.restoreConfigOverride(core, previousOverride, hadPreviousOverride)
		_ = restoreFile(bak, path)
		_ = s.restartCore(context.Background(), core)
		return err
	}

	return nil
}

func (s *ConfigService) ResetOverride(ctx context.Context, core string) error {
	managed, err := s.RenderManaged(ctx, core)
	if err != nil {
		return err
	}
	return s.Apply(ctx, core, managed)
}

func (s *ConfigService) configOverride(ctx context.Context, core string) (json.RawMessage, bool, error) {
	if s.settings == nil {
		return nil, false, nil
	}
	return s.settings.ConfigOverride(ctx, core)
}

func (s *ConfigService) saveConfigOverride(ctx context.Context, core string, patch json.RawMessage) error {
	if s.settings == nil {
		return domain.NewError(500, "settings_unavailable", "Settings service is not available", nil)
	}
	return s.settings.SaveConfigOverride(ctx, core, patch)
}

func (s *ConfigService) restoreConfigOverride(core string, previous json.RawMessage, hadPrevious bool) {
	if s.settings == nil {
		return
	}
	if !hadPrevious {
		previous = json.RawMessage(`{}`)
	}
	if err := s.settings.SaveConfigOverride(context.Background(), core, previous); err != nil && s.logger != nil {
		s.logger.Error("config override rollback failed", "core", core, "err", err)
	}
}

func (s *ConfigService) applyConfigOverride(ctx context.Context, core string, managed []byte) ([]byte, error) {
	patch, ok, err := s.configOverride(ctx, core)
	if err != nil || !ok {
		return managed, err
	}
	return applyConfigOverridePatch(managed, patch)
}

func configOverridePatch(managed, content []byte) (json.RawMessage, error) {
	var base any
	if err := json.Unmarshal(managed, &base); err != nil {
		return nil, domain.NewError(500, "invalid_config", "Generated configuration contains JSON errors", err)
	}
	var next any
	if err := json.Unmarshal(content, &next); err != nil {
		return nil, domain.NewError(400, "invalid_config", "Configuration contains JSON errors", err)
	}
	patch, err := createConfigOverridePatch(base, next, nil)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(patch)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func applyConfigOverridePatch(managed, patch []byte) ([]byte, error) {
	var base any
	if err := json.Unmarshal(managed, &base); err != nil {
		return nil, domain.NewError(500, "invalid_config", "Generated configuration contains JSON errors", err)
	}
	var override any
	if err := json.Unmarshal(patch, &override); err != nil {
		return nil, domain.NewError(400, "invalid_config", "Stored configuration override contains JSON errors", err)
	}
	if emptyMergePatch(override) {
		return managed, nil
	}
	merged := applyJSONMergePatch(base, override)
	encoded, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(encoded, '\n'), nil
}

func createConfigOverridePatch(base, next any, path []string) (any, error) {
	if reflect.DeepEqual(base, next) {
		return map[string]any{}, nil
	}
	baseObject, baseOK := base.(map[string]any)
	nextObject, nextOK := next.(map[string]any)
	if !baseOK || !nextOK {
		if baseArray, ok := base.([]any); ok {
			nextArray, ok := next.([]any)
			if !ok {
				return nil, configOverrideArrayError(path)
			}
			return createArrayOverridePatch(path, baseArray, nextArray)
		}
		if _, ok := next.([]any); ok {
			return nil, configOverrideArrayError(path)
		}
		return next, nil
	}

	patch := map[string]any{}
	for key := range baseObject {
		if _, ok := nextObject[key]; !ok {
			patch[key] = nil
		}
	}
	for key, nextValue := range nextObject {
		baseValue, ok := baseObject[key]
		if !ok {
			patch[key] = nextValue
			continue
		}
		childPatch, err := createConfigOverridePatch(baseValue, nextValue, append(path, key))
		if err != nil {
			return nil, err
		}
		if !emptyMergePatch(childPatch) {
			patch[key] = childPatch
		}
	}
	return patch, nil
}

func createArrayOverridePatch(path []string, base, next []any) (any, error) {
	if !allowAppendArrayOverride(path) {
		return nil, configOverrideArrayError(path)
	}
	for _, baseItem := range base {
		if !jsonArrayContains(next, baseItem) {
			return nil, domain.NewError(400, "managed_config_array", "Managed configuration array items cannot be removed or changed at "+strings.Join(path, "."), nil)
		}
	}
	additions := make([]any, 0)
	for _, nextItem := range next {
		if jsonArrayContains(base, nextItem) {
			continue
		}
		additions = append(additions, cloneJSONValue(nextItem))
	}
	if len(additions) == 0 {
		return map[string]any{}, nil
	}
	return map[string]any{
		arrayPatchOpKey: arrayPatchAppendOp,
		"items":         additions,
	}, nil
}

func allowAppendArrayOverride(path []string) bool {
	joined := strings.Join(path, ".")
	return joined == "routing.rules"
}

func configOverrideArrayError(path []string) error {
	location := strings.Join(path, ".")
	if location == "" {
		location = "<root>"
	}
	return domain.NewError(400, "managed_config_array", "Managed configuration arrays cannot be overridden at "+location, nil)
}

func jsonArrayContains(values []any, target any) bool {
	for _, value := range values {
		if reflect.DeepEqual(value, target) {
			return true
		}
	}
	return false
}

func applyJSONMergePatch(base, patch any) any {
	return applyJSONMergePatchAt(base, patch, nil)
}

func applyJSONMergePatchAt(base, patch any, path []string) any {
	patchObject, ok := patch.(map[string]any)
	if !ok {
		if patchArray, ok := patch.([]any); ok {
			return applyLegacyArrayPatch(base, patchArray, path)
		}
		return cloneJSONValue(patch)
	}
	if op, ok := patchObject[arrayPatchOpKey].(string); ok && op == arrayPatchAppendOp {
		return applyArrayAppendPatch(base, patchObject)
	}
	baseObject, _ := base.(map[string]any)
	result := map[string]any{}
	for key, value := range baseObject {
		result[key] = cloneJSONValue(value)
	}
	for key, patchValue := range patchObject {
		if patchValue == nil {
			delete(result, key)
			continue
		}
		result[key] = applyJSONMergePatchAt(result[key], patchValue, append(path, key))
	}
	return result
}

func applyLegacyArrayPatch(base any, patch []any, path []string) any {
	baseArray, ok := base.([]any)
	if !ok {
		return cloneJSONValue(patch)
	}
	if allowAppendArrayOverride(path) {
		result := make([]any, 0, len(baseArray)+len(patch))
		for _, item := range baseArray {
			result = append(result, cloneJSONValue(item))
		}
		for _, item := range patch {
			if jsonArrayContains(result, item) {
				continue
			}
			result = append(result, cloneJSONValue(item))
		}
		return result
	}
	return cloneJSONValue(baseArray)
}

func applyArrayAppendPatch(base any, patch map[string]any) any {
	baseArray, _ := base.([]any)
	result := make([]any, 0, len(baseArray))
	for _, item := range baseArray {
		result = append(result, cloneJSONValue(item))
	}
	items, _ := patch["items"].([]any)
	for _, item := range items {
		if jsonArrayContains(result, item) {
			continue
		}
		result = append(result, cloneJSONValue(item))
	}
	return result
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[key] = cloneJSONValue(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = cloneJSONValue(item)
		}
		return out
	default:
		return typed
	}
}

func emptyMergePatch(value any) bool {
	object, ok := value.(map[string]any)
	return ok && len(object) == 0
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
