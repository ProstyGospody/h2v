package services

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"regexp"
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

type RealityKeyPair struct {
	PrivateKey string `json:"private_key"`
	PublicKey  string `json:"public_key"`
}

var (
	bandwidthPattern = regexp.MustCompile(`(?i)^\d+(?:\.\d+)?\s*(g|gbps|m|mbps)$`)
	shortIDPattern   = regexp.MustCompile(`^[0-9a-fA-F]{0,16}$`)
)

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
	normalized, err := normalizeSettingsUpdate(values)
	if err != nil {
		return err
	}
	if err := s.validateUpdate(ctx, normalized); err != nil {
		return err
	}
	return s.repo.UpsertSettings(ctx, normalized)
}

func (s *SettingsService) GenerateRealityKeyPair() (*RealityKeyPair, error) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &RealityKeyPair{
		PrivateKey: base64.RawURLEncoding.EncodeToString(key.Bytes()),
		PublicKey:  base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
	}, nil
}

func (s *SettingsService) validateUpdate(ctx context.Context, values map[string]json.RawMessage) error {
	runtime := DefaultRuntime(s.cfg)
	current, err := s.GetAll(ctx)
	if err == nil {
		applyRuntimeValues(&runtime, current)
	}

	applyRuntimeValues(&runtime, values)

	if runtime.PanelDomain != "" && runtime.PanelDomain != "panel.example.com" && runtime.VlessPort == 443 {
		return domain.NewError(400, "port_conflict", "VLESS port 443 conflicts with Caddy panel HTTPS; use a different VLESS port", nil)
	}
	if touchesAny(values, "hy2.obfs_enabled", "hy2.obfs_password") && runtime.Hy2ObfsEnabled && runtime.Hy2ObfsPassword == "" {
		return domain.NewError(400, "invalid_setting", "Hysteria obfs password is required when obfuscation is enabled", nil)
	}
	if touchesAny(values, "reality.private_key", "reality.public_key") && (runtime.RealityPrivateKey == "" || runtime.RealityPublicKey == "") {
		return domain.NewError(400, "invalid_setting", "Reality private and public keys must be saved together", nil)
	}
	return nil
}

func (s *SettingsService) Runtime(ctx context.Context) (RuntimeSettings, error) {
	runtime := DefaultRuntime(s.cfg)

	values, err := s.GetAll(ctx)
	if err != nil {
		s.logger.Warn("settings lookup failed, falling back to env defaults", "err", err)
	} else {
		applyRuntimeValues(&runtime, values)
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
		VlessPort:          cfg.Xray.VlessPort,
		Hy2Domain:          cfg.Hysteria.Domain,
		Hy2Port:            cfg.Hysteria.Port,
		Hy2ObfsEnabled:     cfg.Hysteria.ObfsEnabled,
		Hy2ObfsPassword:    cfg.Hysteria.ObfsPassword,
		Hy2BandwidthUp:     cfg.Hysteria.BandwidthUp,
		Hy2BandwidthDown:   cfg.Hysteria.BandwidthDown,
		Hy2MasqueradeURL:   cfg.Hysteria.MasqueradeURL,
		Hy2TrafficSecret:   cfg.Hysteria.TrafficSecret,
		Hy2CertPath:        cfg.Hysteria.CertPath,
		Hy2KeyPath:         cfg.Hysteria.KeyPath,
		Clients:            nil,
	}
}

func applyRuntimeValues(runtime *RuntimeSettings, values map[string]json.RawMessage) {
	runtime.PanelDomain = stringOr(values, "panel.domain", runtime.PanelDomain)
	runtime.RealitySNI = stringOr(values, "reality.sni", runtime.RealitySNI)
	runtime.RealityDest = stringOr(values, "reality.dest", runtime.RealityDest)
	runtime.RealityPrivateKey = stringOr(values, "reality.private_key", runtime.RealityPrivateKey)
	runtime.RealityPublicKey = stringOr(values, "reality.public_key", runtime.RealityPublicKey)
	runtime.RealityShortIDs = stringsOr(values, "reality.short_ids", runtime.RealityShortIDs)
	runtime.VlessPort = intOr(values, "vless.port", runtime.VlessPort)
	runtime.SubURLPrefix = stringOr(values, "subscription.url_prefix", runtime.SubURLPrefix)
	runtime.Hy2Domain = stringOr(values, "hy2.domain", runtime.Hy2Domain)
	runtime.Hy2Port = intOr(values, "hy2.port", runtime.Hy2Port)
	runtime.Hy2ObfsEnabled = boolOr(values, "hy2.obfs_enabled", runtime.Hy2ObfsEnabled)
	runtime.Hy2ObfsPassword = stringOr(values, "hy2.obfs_password", runtime.Hy2ObfsPassword)
	runtime.Hy2BandwidthUp = stringOr(values, "hy2.bandwidth_up", runtime.Hy2BandwidthUp)
	runtime.Hy2BandwidthDown = stringOr(values, "hy2.bandwidth_down", runtime.Hy2BandwidthDown)
	runtime.Hy2MasqueradeURL = stringOr(values, "hy2.masquerade_url", runtime.Hy2MasqueradeURL)
	runtime.Hy2TrafficSecret = stringOr(values, "hy2.traffic_secret", runtime.Hy2TrafficSecret)
}

func normalizeSettingsUpdate(values map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	normalized := make(map[string]json.RawMessage, len(values))
	for key, raw := range values {
		value, err := normalizeSettingValue(key, raw)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		normalized[key] = encoded
	}
	return normalized, nil
}

func normalizeSettingValue(key string, raw json.RawMessage) (any, error) {
	switch key {
	case "vless.port", "hy2.port":
		var value int
		if err := json.Unmarshal(raw, &value); err != nil || !validRuntimePort(value) {
			return nil, invalidSetting(key, "must be an integer between 1 and 65535")
		}
		return value, nil
	case "hy2.obfs_enabled":
		var value bool
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, invalidSetting(key, "must be a boolean")
		}
		return value, nil
	case "reality.short_ids":
		var values []string
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil, invalidSetting(key, "must be a string array")
		}
		values = normalizeShortIDs(values)
		for _, value := range values {
			if !validRealityShortID(value) {
				return nil, invalidSetting(key, "must contain empty or even-length hex values up to 16 characters")
			}
		}
		return values, nil
	case "panel.domain", "hy2.domain", "reality.sni", "reality.dest", "reality.private_key", "reality.public_key",
		"subscription.url_prefix", "hy2.obfs_password", "hy2.bandwidth_up", "hy2.bandwidth_down",
		"hy2.masquerade_url", "hy2.traffic_secret":
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, invalidSetting(key, "must be a string")
		}
		return normalizeStringSetting(key, value)
	default:
		return nil, invalidSetting(key, "is not editable")
	}
}

func normalizeStringSetting(key, value string) (string, error) {
	value = strings.TrimSpace(value)
	switch key {
	case "panel.domain", "hy2.domain", "reality.sni":
		if value == "" {
			return "", invalidSetting(key, "cannot be empty")
		}
	case "reality.dest":
		if !validHostPort(value) {
			return "", invalidSetting(key, "must be a host:port value")
		}
	case "subscription.url_prefix":
		value = strings.TrimRight(value, "/")
		if !validHTTPURL(value) {
			return "", invalidSetting(key, "must be a valid http or https URL")
		}
	case "hy2.masquerade_url":
		if !validHTTPURL(value) {
			return "", invalidSetting(key, "must be a valid http or https URL")
		}
	case "hy2.bandwidth_up", "hy2.bandwidth_down":
		value = strings.ToLower(value)
		if !bandwidthPattern.MatchString(value) {
			return "", invalidSetting(key, "must use mbps or gbps")
		}
	case "reality.private_key", "reality.public_key":
		if value == "" {
			return "", invalidSetting(key, "cannot be empty")
		}
	}
	return value, nil
}

func invalidSetting(key, reason string) error {
	return domain.NewError(400, "invalid_setting", fmt.Sprintf("%s %s", key, reason), nil)
}

func validRuntimePort(value int) bool {
	return value >= 1 && value <= 65535
}

func validHTTPURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func validHostPort(value string) bool {
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" || port == "" {
		return false
	}
	portNumber, err := strconv.Atoi(port)
	return err == nil && validRuntimePort(portNumber)
}

func validRealityShortID(value string) bool {
	return len(value)%2 == 0 && shortIDPattern.MatchString(value)
}

func touchesAny(values map[string]json.RawMessage, keys ...string) bool {
	for _, key := range keys {
		if _, ok := values[key]; ok {
			return true
		}
	}
	return false
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

// normalizeShortIDs keeps Reality shortIds valid per Xray docs: empty string
// (to allow clients with no shortId) plus hex strings 2..16 chars (even length).
// Duplicates are dropped and order is preserved; "" is always present exactly
// once when any empty value is supplied.
func normalizeShortIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		trimmed := strings.TrimSpace(raw)
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
