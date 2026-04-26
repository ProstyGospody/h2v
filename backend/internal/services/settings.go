package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"

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

func (s *SettingsService) Update(ctx context.Context, values map[string]json.RawMessage) error {
	if err := s.validateUpdate(ctx, values); err != nil {
		return err
	}
	return s.repo.UpsertSettings(ctx, values)
}

func (s *SettingsService) validateUpdate(ctx context.Context, values map[string]json.RawMessage) error {
	runtime := DefaultRuntime(s.cfg)
	current, err := s.GetAll(ctx)
	if err == nil {
		runtime.PanelDomain = stringOr(current, "panel.domain", runtime.PanelDomain)
		runtime.VlessPort = intOr(current, "vless.port", runtime.VlessPort)
	}

	runtime.PanelDomain = stringOr(values, "panel.domain", runtime.PanelDomain)
	runtime.VlessPort = intOr(values, "vless.port", runtime.VlessPort)

	if runtime.PanelDomain != "" && runtime.PanelDomain != "panel.example.com" && runtime.VlessPort == 443 {
		return domain.NewError(400, "port_conflict", "VLESS port 443 conflicts with Caddy panel HTTPS; use a different VLESS port", nil)
	}
	return nil
}

func (s *SettingsService) Runtime(ctx context.Context) (RuntimeSettings, error) {
	runtime := DefaultRuntime(s.cfg)

	values, err := s.GetAll(ctx)
	if err != nil {
		s.logger.Warn("settings lookup failed, falling back to env defaults", "err", err)
	} else {
		runtime.PanelDomain = stringOr(values, "panel.domain", runtime.PanelDomain)
		runtime.RealitySNI = stringOr(values, "reality.sni", runtime.RealitySNI)
		runtime.RealityDest = stringOr(values, "reality.dest", runtime.RealityDest)
		runtime.RealityPublicKey = stringOr(values, "reality.public_key", runtime.RealityPublicKey)
		runtime.RealityShortIDs = stringsOr(values, "reality.short_ids", runtime.RealityShortIDs)
		runtime.VlessPort = intOr(values, "vless.port", runtime.VlessPort)
		runtime.Hy2Domain = stringOr(values, "hy2.domain", runtime.Hy2Domain)
		runtime.Hy2Port = intOr(values, "hy2.port", runtime.Hy2Port)
		runtime.Hy2ObfsEnabled = boolOr(values, "hy2.obfs_enabled", runtime.Hy2ObfsEnabled)
		runtime.Hy2BandwidthUp = stringOr(values, "hy2.bandwidth_up", runtime.Hy2BandwidthUp)
		runtime.Hy2BandwidthDown = stringOr(values, "hy2.bandwidth_down", runtime.Hy2BandwidthDown)
		runtime.Hy2MasqueradeURL = stringOr(values, "hy2.masquerade_url", runtime.Hy2MasqueradeURL)
	}

	runtime.RealityServerNames = dedupeNonEmpty(append([]string{runtime.RealitySNI}, runtime.RealityServerNames...))
	runtime.RealityShortIDs = normalizeShortIDs(runtime.RealityShortIDs)

	if s.repo != nil {
		users, err := s.repo.ListActiveUsers(ctx)
		if err != nil {
			s.logger.Warn("active users lookup failed; rendering xray config without clients", "err", err)
		} else {
			runtime.Clients = make([]ClientEntry, 0, len(users))
			for _, user := range users {
				runtime.Clients = append(runtime.Clients, ClientEntry{
					UUID:  user.VlessUUID.String(),
					Email: user.Username,
				})
			}
		}
	}

	return runtime, nil
}

func DefaultRuntime(cfg config.Config) RuntimeSettings {
	xrayAPIHost, xrayAPIPort := splitHostPortOrDefault(cfg.Xray.APIAddr, "127.0.0.1", 10085)
	return RuntimeSettings{
		PanelDomain:        cfg.Panel.Domain,
		PanelPort:          cfg.Panel.Port,
		SubURLPrefix:       cfg.Subscription.URLPrefix,
		RealitySNI:         cfg.Xray.RealitySNI,
		RealityDest:        cfg.Xray.RealityDest,
		RealityPublicKey:   cfg.Xray.RealityPubKey,
		RealityPrivateKey:  cfg.Xray.RealityPrivKey,
		RealityServerNames: []string{cfg.Xray.RealitySNI},
		RealityShortIDs:    normalizeShortIDs(cfg.Xray.RealityShortIDs),
		XrayAPIHost:         xrayAPIHost,
		XrayAPIPort:         xrayAPIPort,
		VlessPort:          cfg.Xray.VlessPort,
		Hy2Domain:          cfg.Hysteria.Domain,
		Hy2Port:            cfg.Hysteria.Port,
		Hy2ObfsEnabled:     cfg.Hysteria.ObfsEnabled,
		Hy2ObfsPassword:    cfg.Hysteria.ObfsPassword,
		Hy2BandwidthUp:     cfg.Hysteria.BandwidthUp,
		Hy2BandwidthDown:   cfg.Hysteria.BandwidthDown,
		Hy2MasqueradeURL:   cfg.Hysteria.MasqueradeURL,
		Hy2TrafficListen:   listenAddressFromURL(cfg.Hysteria.TrafficURL, "127.0.0.1:7653"),
		Hy2TrafficSecret:   cfg.Hysteria.TrafficSecret,
		Hy2CertPath:        cfg.Hysteria.CertPath,
		Hy2KeyPath:         cfg.Hysteria.KeyPath,
		Clients:            nil,
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

func dedupeNonEmpty(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func splitHostPortOrDefault(addr, fallbackHost string, fallbackPort int) (string, int) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fallbackHost, fallbackPort
	}
	host, portRaw, err := net.SplitHostPort(addr)
	if err == nil {
		port, err := strconv.Atoi(portRaw)
		if err == nil && port > 0 {
			if host == "" {
				host = fallbackHost
			}
			return host, port
		}
	}
	if !strings.Contains(addr, ":") {
		return addr, fallbackPort
	}
	return fallbackHost, fallbackPort
}

func listenAddressFromURL(raw, fallback string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	parsed, err := url.Parse(raw)
	if err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return raw
}

// normalizeShortIDs keeps Reality shortIds valid per Xray docs: empty string
// (to allow clients with no shortId) plus hex strings 2..16 chars (even length).
// Duplicates are dropped and order is preserved; "" is always present exactly
// once when any empty value is supplied.
func normalizeShortIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		trimmed := raw
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	if len(out) == 0 {
		return []string{""}
	}
	return out
}
