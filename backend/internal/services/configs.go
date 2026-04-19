package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"text/template"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
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
	repo      *repo.Repository
	settings  *SettingsService
	systemctl SystemctlAdapter
	xray      XrayAdapter
	hysteria  HysteriaAdapter
	logger    *slog.Logger
}

func NewConfigService(cfg config.Config, repository *repo.Repository, settings *SettingsService, systemctl SystemctlAdapter, xray XrayAdapter, hysteria HysteriaAdapter, logger *slog.Logger) *ConfigService {
	return &ConfigService{
		cfg:       cfg,
		repo:      repository,
		settings:  settings,
		systemctl: systemctl,
		xray:      xray,
		hysteria:  hysteria,
		logger:    logger,
	}
}

func (s *ConfigService) Get(core string) ([]byte, error) {
	return os.ReadFile(s.pathForCore(core))
}

func (s *ConfigService) Render(ctx context.Context, core string) ([]byte, error) {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return nil, err
	}
	return s.RenderWithRuntime(core, runtime)
}

func (s *ConfigService) RenderWithRuntime(core string, runtime RuntimeSettings) ([]byte, error) {
	templatePath := filepath.Join(s.cfg.Panel.TemplatesDir, templateName(core))
	tmpl, err := template.New(filepath.Base(templatePath)).Funcs(templateFuncs).ParseFiles(templatePath)
	if err != nil {
		return nil, err
	}

	var data any
	switch core {
	case "xray":
		data = runtime
	case "hysteria":
		data = runtime
	default:
		return nil, domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}

	var out bytes.Buffer
	if err := tmpl.Execute(&out, data); err != nil {
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
		if _, err := os.Stat(s.cfg.Xray.Binary); err == nil {
			tmp, err := os.CreateTemp("", "xray-*.json")
			if err != nil {
				return err
			}
			defer os.Remove(tmp.Name())
			if _, err := tmp.Write(content); err != nil {
				return err
			}
			_ = tmp.Close()
			cmd := exec.CommandContext(ctx, s.cfg.Xray.Binary, "test", "-c", tmp.Name())
			if out, err := cmd.CombinedOutput(); err != nil {
				return domain.NewError(400, "invalid_config", "Xray configuration test failed", fmt.Errorf("%s", out))
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

func (s *ConfigService) Apply(ctx context.Context, core string, content []byte, actor AuditActor) error {
	if err := s.Validate(ctx, core, content); err != nil {
		return err
	}
	path := s.pathForCore(core)
	bak := path + ".bak"
	if current, err := os.ReadFile(path); err == nil {
		if err := os.WriteFile(bak, current, 0o640); err != nil {
			return err
		}
	}
	if err := writeFileAtomic(path, content, 0o640); err != nil {
		return err
	}
	if err := s.repo.SaveConfigHistory(ctx, core, string(content), actor.AdminID, "manual apply"); err != nil {
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
	recordAudit(ctx, s.repo, actor, "config.apply", "config", core, map[string]any{"core": core})
	return nil
}

func (s *ConfigService) History(ctx context.Context, core string) ([]domain.ConfigHistory, error) {
	return s.repo.ListConfigHistory(ctx, core, 20)
}

func (s *ConfigService) Restore(ctx context.Context, id int64, actor AuditActor) error {
	entry, err := s.repo.GetConfigHistory(ctx, id)
	if err != nil {
		return err
	}
	return s.Apply(ctx, entry.Core, []byte(entry.Content), actor)
}

func (s *ConfigService) waitHealthy(ctx context.Context, core string) error {
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		var err error
		switch core {
		case "xray":
			err = s.xray.Health(deadline)
		case "hysteria":
			err = s.hysteria.Health(deadline)
		}
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

func (s *ConfigService) pathForCore(core string) string {
	switch core {
	case "xray":
		return s.cfg.Xray.ConfigPath
	case "hysteria":
		return s.cfg.Hysteria.ConfigPath
	default:
		return ""
	}
}

func templateName(core string) string {
	switch core {
	case "xray":
		return "xray.config.json.tmpl"
	default:
		return "hysteria.config.json.tmpl"
	}
}

func writeFileAtomic(path string, content []byte, mode os.FileMode) error {
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

func restoreFile(src, dst string) error {
	content, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, content, 0o640)
}
