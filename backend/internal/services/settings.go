package services

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

type SettingsService struct {
	cfg    config.Config
	repo   *repo.Repository
	logger *slog.Logger
}

func NewSettingsService(cfg config.Config, repository *repo.Repository, logger *slog.Logger) *SettingsService {
	return &SettingsService{cfg: cfg, repo: repository, logger: logger}
}

func (s *SettingsService) Bootstrap(ctx context.Context) error {
	return s.repo.BootstrapSettings(ctx, s.cfg)
}

func (s *SettingsService) GetAll(ctx context.Context) (map[string]json.RawMessage, error) {
	items, err := s.repo.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(items))
	for _, item := range items {
		result[item.Key] = item.Value
	}
	return result, nil
}

func (s *SettingsService) List(ctx context.Context) ([]domain.Setting, error) {
	return s.repo.ListSettings(ctx)
}

func (s *SettingsService) Update(ctx context.Context, values map[string]json.RawMessage, actor AuditActor) error {
	if err := s.repo.UpsertSettings(ctx, values); err != nil {
		return err
	}
	recordAudit(ctx, s.repo, actor, "settings.update", "settings", "", values)
	return nil
}

func (s *SettingsService) Runtime(ctx context.Context) (RuntimeSettings, error) {
	values, err := s.GetAll(ctx)
	if err != nil {
		s.logger.Warn("settings lookup failed, falling back to env defaults", "err", err)
		return DefaultRuntime(s.cfg), nil
	}

	return RuntimeSettings{
		PanelDomain:       stringOr(values, "panel.domain", s.cfg.Panel.Domain),
		PanelPort:         s.cfg.Panel.Port,
		SubURLPrefix:      s.cfg.Subscription.URLPrefix,
		RealitySNI:        stringOr(values, "reality.sni", s.cfg.Xray.RealitySNI),
		RealityDest:       stringOr(values, "reality.dest", s.cfg.Xray.RealityDest),
		RealityPublicKey:  stringOr(values, "reality.public_key", s.cfg.Xray.RealityPubKey),
		RealityPrivateKey: s.cfg.Xray.RealityPrivKey,
		RealityShortIDs:   stringsOr(values, "reality.short_ids", s.cfg.Xray.RealityShortIDs),
		VlessPort:         intOr(values, "vless.port", s.cfg.Xray.VlessPort),
		Hy2Domain:         stringOr(values, "hy2.domain", s.cfg.Hysteria.Domain),
		Hy2Port:           intOr(values, "hy2.port", s.cfg.Hysteria.Port),
		Hy2ObfsEnabled:    boolOr(values, "hy2.obfs_enabled", s.cfg.Hysteria.ObfsEnabled),
		Hy2ObfsPassword:   s.cfg.Hysteria.ObfsPassword,
		Hy2BandwidthUp:    stringOr(values, "hy2.bandwidth_up", s.cfg.Hysteria.BandwidthUp),
		Hy2BandwidthDown:  stringOr(values, "hy2.bandwidth_down", s.cfg.Hysteria.BandwidthDown),
		Hy2MasqueradeURL:  stringOr(values, "hy2.masquerade_url", s.cfg.Hysteria.MasqueradeURL),
		Hy2TrafficSecret:  s.cfg.Hysteria.TrafficSecret,
		Hy2CertPath:       s.cfg.Hysteria.CertPath,
		Hy2KeyPath:        s.cfg.Hysteria.KeyPath,
	}, nil
}

func DefaultRuntime(cfg config.Config) RuntimeSettings {
	return RuntimeSettings{
		PanelDomain:       cfg.Panel.Domain,
		PanelPort:         cfg.Panel.Port,
		SubURLPrefix:      cfg.Subscription.URLPrefix,
		RealitySNI:        cfg.Xray.RealitySNI,
		RealityDest:       cfg.Xray.RealityDest,
		RealityPublicKey:  cfg.Xray.RealityPubKey,
		RealityPrivateKey: cfg.Xray.RealityPrivKey,
		RealityShortIDs:   cfg.Xray.RealityShortIDs,
		VlessPort:         cfg.Xray.VlessPort,
		Hy2Domain:         cfg.Hysteria.Domain,
		Hy2Port:           cfg.Hysteria.Port,
		Hy2ObfsEnabled:    cfg.Hysteria.ObfsEnabled,
		Hy2ObfsPassword:   cfg.Hysteria.ObfsPassword,
		Hy2BandwidthUp:    cfg.Hysteria.BandwidthUp,
		Hy2BandwidthDown:  cfg.Hysteria.BandwidthDown,
		Hy2MasqueradeURL:  cfg.Hysteria.MasqueradeURL,
		Hy2TrafficSecret:  cfg.Hysteria.TrafficSecret,
		Hy2CertPath:       cfg.Hysteria.CertPath,
		Hy2KeyPath:        cfg.Hysteria.KeyPath,
	}
}

func stringOr(values map[string]json.RawMessage, key, fallback string) string {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	var result string
	if err := json.Unmarshal(raw, &result); err != nil || result == "" {
		return fallback
	}
	return result
}

func intOr(values map[string]json.RawMessage, key string, fallback int) int {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	var result int
	if err := json.Unmarshal(raw, &result); err != nil {
		return fallback
	}
	return result
}

func boolOr(values map[string]json.RawMessage, key string, fallback bool) bool {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	var result bool
	if err := json.Unmarshal(raw, &result); err != nil {
		return fallback
	}
	return result
}

func stringsOr(values map[string]json.RawMessage, key string, fallback []string) []string {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	var result []string
	if err := json.Unmarshal(raw, &result); err != nil || len(result) == 0 {
		return fallback
	}
	return result
}
