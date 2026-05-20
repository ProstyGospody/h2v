package services

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
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
	bandwidthPattern  = regexp.MustCompile(`(?i)^\d+(?:\.\d+)?\s*(bps|kbps|mbps|gbps|tbps|k|m|g|t)$`)
	shortIDPattern    = regexp.MustCompile(`^[0-9a-fA-F]{0,16}$`)
	countryCodePattern = regexp.MustCompile(`^[a-z]{2}$`)
	geositeTagPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9_@.!-]{0,63}$`)

	defaultXraySniffingDestOverride = []string{"http", "tls"}
	allowedXraySniffingDestOverride = map[string]struct{}{
		"http": {},
		"tls":  {},
		"quic": {},
	}
	allowedRealityFingerprints = map[string]struct{}{
		"chrome":     {},
		"firefox":    {},
		"safari":     {},
		"ios":        {},
		"android":    {},
		"edge":       {},
		"random":     {},
		"randomized": {},
	}
	allowedGeoCountryCodes = map[string]struct{}{
		"ru": {},
		"cn": {},
		"ir": {},
	}
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
	items, err := s.repo.ListSettings(ctx)
	if err != nil {
		return nil, err
	}
	return withoutInstallerManagedSettings(items), nil
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

func (s *SettingsService) Restore(ctx context.Context, values map[string]json.RawMessage) error {
	if len(values) == 0 {
		return nil
	}
	return s.repo.UpsertSettings(ctx, values)
}

func (s *SettingsService) ConfigOverride(ctx context.Context, core string) (json.RawMessage, bool, error) {
	key, err := configOverrideSettingKey(core)
	if err != nil {
		return nil, false, err
	}
	values, err := s.GetAll(ctx)
	if err != nil {
		return nil, false, err
	}
	raw, ok := values[key]
	if !ok || emptyJSONPatch(raw) {
		return nil, false, nil
	}
	return raw, true, nil
}

func (s *SettingsService) SaveConfigOverride(ctx context.Context, core string, patch json.RawMessage) error {
	key, err := configOverrideSettingKey(core)
	if err != nil {
		return err
	}
	if len(patch) == 0 {
		patch = json.RawMessage(`{}`)
	}
	return s.Update(ctx, map[string]json.RawMessage{key: patch})
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

func validateRealityKeyPair(privateKey, publicKey string) error {
	privateBytes, err := decodeRealityKey(privateKey)
	if err != nil {
		return domain.NewError(400, "invalid_setting", "Reality private key must be a base64url-encoded X25519 key", err)
	}
	publicBytes, err := decodeRealityKey(publicKey)
	if err != nil {
		return domain.NewError(400, "invalid_setting", "Reality public key must be a base64url-encoded X25519 key", err)
	}
	private, err := ecdh.X25519().NewPrivateKey(privateBytes)
	if err != nil {
		return domain.NewError(400, "invalid_setting", "Reality private key is not a valid X25519 key", err)
	}
	if !bytesEqual(private.PublicKey().Bytes(), publicBytes) {
		return domain.NewError(400, "invalid_setting", "Reality public key does not match private key", nil)
	}
	return nil
}

func decodeRealityKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(value)
	}
	if err != nil {
		return nil, err
	}
	if len(decoded) != 32 {
		return nil, fmt.Errorf("decoded key has %d bytes, want 32", len(decoded))
	}
	return decoded, nil
}

func bytesEqual(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var diff byte
	for i := range left {
		diff |= left[i] ^ right[i]
	}
	return diff == 0
}

func (s *SettingsService) validateUpdate(ctx context.Context, values map[string]json.RawMessage) error {
	runtime := DefaultRuntime(s.cfg)
	current, err := s.GetAll(ctx)
	if err == nil {
		applyStoredRuntimeValues(&runtime, current)
	}

	currentRuntime := runtime
	applyRuntimeValues(&runtime, values)

	if runtime.H2VPort < 1024 {
		return domain.NewError(400, "port_conflict", "h2v internal port must be 1024 or higher", nil)
	}
	if runtime.H2VPublicPort == 80 || (runtime.H2VPublicPort < 1024 && runtime.H2VPublicPort != 443) {
		return domain.NewError(400, "port_conflict", "h2v public port must be 443 or 1024 or higher", nil)
	}
	if runtime.H2VPort == runtime.VlessPort {
		return domain.NewError(400, "port_conflict", "h2v internal port conflicts with VLESS port; use different TCP ports", nil)
	}
	if runtime.H2VDomain != "" && runtime.H2VDomain != "h2v.example.com" {
		if runtime.H2VPublicPort == runtime.H2VPort {
			return domain.NewError(400, "port_conflict", "h2v public port conflicts with the internal h2v listener; use different TCP ports", nil)
		}
		if runtime.H2VPublicPort == runtime.VlessPort {
			return domain.NewError(400, "port_conflict", "h2v public port conflicts with VLESS port; use different TCP ports", nil)
		}
	}
	if err := validatePortAvailability(currentRuntime, runtime, values); err != nil {
		return err
	}
	if touchesAny(values, "hy2.obfs_enabled", "hy2.obfs_password") && runtime.Hy2ObfsEnabled && runtime.Hy2ObfsPassword == "" {
		return domain.NewError(400, "invalid_setting", "Hysteria obfs password is required when obfuscation is enabled", nil)
	}
	if touchesAny(values, "reality.private_key", "reality.public_key") && (runtime.RealityPrivateKey == "" || runtime.RealityPublicKey == "") {
		return domain.NewError(400, "invalid_setting", "Reality private and public keys must be saved together", nil)
	}
	if touchesAny(values, "reality.private_key", "reality.public_key") {
		if err := validateRealityKeyPair(runtime.RealityPrivateKey, runtime.RealityPublicKey); err != nil {
			return err
		}
	}
	return nil
}

func (s *SettingsService) Runtime(ctx context.Context) (RuntimeSettings, error) {
	runtime := DefaultRuntime(s.cfg)

	values, err := s.GetAll(ctx)
	if err != nil {
		s.logger.Warn("settings lookup failed, falling back to env defaults", "err", err)
	} else {
		applyStoredRuntimeValues(&runtime, values)
	}

	normalizeRuntimeDerivedValues(&runtime)

	if s.repo != nil {
		clients, err := s.repo.ListActiveClientEntries(ctx)
		if err != nil {
			s.logger.Warn("active client lookup failed; rendering xray config without clients", "err", err)
		} else {
			runtime.Clients = make([]ClientEntry, 0, len(clients))
			for _, client := range clients {
				runtime.Clients = append(runtime.Clients, ClientEntry{
					UUID:  client.VlessUUID.String(),
					Email: client.Username,
				})
			}
		}
	}

	return runtime, nil
}

func DefaultRuntime(cfg config.Config) RuntimeSettings {
	xrayAPIListen, xrayAPIPort := splitListenHostPort(cfg.Xray.APIAddr, "127.0.0.1", 10085)
	return RuntimeSettings{
		H2VDomain:               cfg.H2V.Domain,
		PublicServerIP:            cfg.H2V.PublicIP,
		H2VPort:                 cfg.H2V.Port,
		H2VPublicPort:           cfg.H2V.PublicPort,
		SubURLPrefix:              cfg.Subscription.URLPrefix,
		RealitySNI:                cfg.Xray.RealitySNI,
		RealityDest:               cfg.Xray.RealityDest,
		RealityPublicKey:          cfg.Xray.RealityPubKey,
		RealityPrivateKey:         cfg.Xray.RealityPrivKey,
		RealityFingerprint:        normalizeRealityFingerprintOrDefault(cfg.Xray.RealityFingerprint),
		RealityServerNames:        []string{cfg.Xray.RealitySNI},
		RealityShortIDs:           normalizeShortIDs(cfg.Xray.RealityShortIDs),
		VlessPort:                 cfg.Xray.VlessPort,
		XrayAPIListen:             xrayAPIListen,
		XrayAPIPort:               xrayAPIPort,
		VlessUDPEnabled:           cfg.Xray.VlessUDPEnabled,
		VlessXUDPEnabled:          cfg.Xray.VlessXUDPEnabled,
		XraySniffingEnabled:       cfg.Xray.SniffingEnabled,
		XraySniffingDestOverride:  normalizeSniffingDestOverrideOrDefault(cfg.Xray.SniffingDestOverride),
		Hy2Domain:                 cfg.Hysteria.Domain,
		Hy2Port:                   cfg.Hysteria.Port,
		Hy2ObfsEnabled:            cfg.Hysteria.ObfsEnabled,
		Hy2ObfsPassword:           cfg.Hysteria.ObfsPassword,
		Hy2BandwidthUp:            cfg.Hysteria.BandwidthUp,
		Hy2BandwidthDown:          cfg.Hysteria.BandwidthDown,
		Hy2MasqueradeURL:          cfg.Hysteria.MasqueradeURL,
		Hy2TrafficSecret:          cfg.Hysteria.TrafficSecret,
		Hy2TrafficListen:          trafficListenFromURL(cfg.Hysteria.TrafficURL, "127.0.0.1:7653"),
		Hy2CertPath:               cfg.Hysteria.CertPath,
		Hy2KeyPath:                cfg.Hysteria.KeyPath,
		GeoIPPath:                 filepath.Join(cfg.Xray.GeodataDir, "geoip.dat"),
		GeositePath:               filepath.Join(cfg.Xray.GeodataDir, "geosite.dat"),
		GeoBlockedCountries:       normalizeCountryCodesOrDefault(cfg.Geo.BlockedCountries),
		GeoBlockedGeositeTags:     normalizeGeositeTagsOrDefault(cfg.Geo.BlockedGeositeTags),
		GeoUpdateIntervalHours:    normalizeGeoUpdateIntervalHours(cfg.Geo.UpdateIntervalHours),
		Clients:                   nil,
		FallbackClient: ClientEntry{
			UUID:  inactiveXrayClientUUID(cfg),
			Email: "__h2v_no_active_users__",
		},
	}
}

func normalizeRuntimeDerivedValues(runtime *RuntimeSettings) {
	runtime.RealityServerNames = currentRealityServerNames(runtime.RealitySNI)
	runtime.RealityShortIDs = normalizeShortIDs(runtime.RealityShortIDs)
	runtime.RealityFingerprint = normalizeRealityFingerprintOrDefault(runtime.RealityFingerprint)
	runtime.XraySniffingDestOverride = normalizeSniffingDestOverrideOrDefault(runtime.XraySniffingDestOverride)
	runtime.GeoBlockedCountries = normalizeCountryCodesOrDefault(runtime.GeoBlockedCountries)
	runtime.GeoBlockedGeositeTags = geositeTagsForCountryCodes(runtime.GeoBlockedCountries)
	runtime.GeoUpdateIntervalHours = normalizeGeoUpdateIntervalHours(runtime.GeoUpdateIntervalHours)
}

func inactiveXrayClientUUID(cfg config.Config) string {
	seed := cfg.H2V.JWTSecret + "\x00" + cfg.Xray.RealityPrivKey + "\x00" + cfg.Xray.RealityPubKey
	sum := sha256.Sum256([]byte("h2v inactive xray client\x00" + seed))
	id, err := uuid.FromBytes(sum[:16])
	if err != nil {
		return uuid.NewHash(sha256.New(), uuid.Nil, []byte(seed), 5).String()
	}
	id[6] = (id[6] & 0x0f) | 0x50
	id[8] = (id[8] & 0x3f) | 0x80
	return id.String()
}

func applyRuntimeValues(runtime *RuntimeSettings, values map[string]json.RawMessage) {
	runtime.RealitySNI = stringOr(values, "reality.sni", runtime.RealitySNI)
	runtime.RealityDest = stringOr(values, "reality.dest", runtime.RealityDest)
	runtime.RealityPrivateKey = stringOr(values, "reality.private_key", runtime.RealityPrivateKey)
	runtime.RealityPublicKey = stringOr(values, "reality.public_key", runtime.RealityPublicKey)
	runtime.RealityFingerprint = stringOr(values, "reality.fingerprint", runtime.RealityFingerprint)
	runtime.RealityShortIDs = stringsOr(values, "reality.short_ids", runtime.RealityShortIDs)
	runtime.VlessPort = intOr(values, "vless.port", runtime.VlessPort)
	runtime.VlessUDPEnabled = boolOr(values, "vless.udp_enabled", runtime.VlessUDPEnabled)
	runtime.VlessXUDPEnabled = boolOr(values, "vless.xudp_enabled", runtime.VlessXUDPEnabled)
	runtime.XraySniffingEnabled = boolOr(values, "xray.sniffing_enabled", runtime.XraySniffingEnabled)
	runtime.XraySniffingDestOverride = stringListOr(values, "xray.sniffing_dest_override", runtime.XraySniffingDestOverride)
	runtime.Hy2Domain = stringOr(values, "hy2.domain", runtime.Hy2Domain)
	runtime.Hy2Port = intOr(values, "hy2.port", runtime.Hy2Port)
	runtime.Hy2ObfsEnabled = boolOr(values, "hy2.obfs_enabled", runtime.Hy2ObfsEnabled)
	runtime.Hy2ObfsPassword = stringOr(values, "hy2.obfs_password", runtime.Hy2ObfsPassword)
	runtime.Hy2BandwidthUp = stringOr(values, "hy2.bandwidth_up", runtime.Hy2BandwidthUp)
	runtime.Hy2BandwidthDown = stringOr(values, "hy2.bandwidth_down", runtime.Hy2BandwidthDown)
	runtime.Hy2MasqueradeURL = stringOr(values, "hy2.masquerade_url", runtime.Hy2MasqueradeURL)
	runtime.Hy2TrafficSecret = stringOr(values, "hy2.traffic_secret", runtime.Hy2TrafficSecret)
	runtime.GeoBlockedCountries = stringListAllowEmptyOr(values, "geo.blocked_countries", runtime.GeoBlockedCountries)
	runtime.GeoBlockedGeositeTags = stringListAllowEmptyOr(values, "geo.blocked_geosite_tags", runtime.GeoBlockedGeositeTags)
	runtime.GeoUpdateIntervalHours = intOr(values, "geo.update_interval_hours", runtime.GeoUpdateIntervalHours)
	runtime.RealityFingerprint = normalizeRealityFingerprintOrDefault(runtime.RealityFingerprint)
	runtime.XraySniffingDestOverride = normalizeSniffingDestOverrideOrDefault(runtime.XraySniffingDestOverride)
	runtime.GeoBlockedCountries = normalizeCountryCodesOrDefault(runtime.GeoBlockedCountries)
	runtime.GeoBlockedGeositeTags = geositeTagsForCountryCodes(runtime.GeoBlockedCountries)
	runtime.GeoUpdateIntervalHours = normalizeGeoUpdateIntervalHours(runtime.GeoUpdateIntervalHours)
}

func applyStoredRuntimeValues(runtime *RuntimeSettings, values map[string]json.RawMessage) {
	filtered := make(map[string]json.RawMessage, len(values))
	for key, value := range values {
		if installerManagedSetting(key) {
			continue
		}
		filtered[key] = value
	}
	applyRuntimeValues(runtime, filtered)
}

func withoutInstallerManagedSettings(items []domain.Setting) []domain.Setting {
	filtered := items[:0]
	for _, item := range items {
		if !installerManagedSetting(item.Key) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func installerManagedSetting(key string) bool {
	switch key {
	case "h2v.domain", "h2v.port", "h2v.public_port", "subscription.url_prefix":
		return true
	default:
		return false
	}
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
	case "config.override.xray", "config.override.hysteria":
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, invalidSetting(key, "must be a valid JSON object")
		}
		if _, ok := value.(map[string]any); !ok {
			return nil, invalidSetting(key, "must be a JSON object")
		}
		return value, nil
	case "vless.port", "hy2.port":
		var value int
		if err := json.Unmarshal(raw, &value); err != nil || !validRuntimePort(value) {
			return nil, invalidSetting(key, "must be an integer between 1 and 65535")
		}
		return value, nil
	case "geo.update_interval_hours":
		var value int
		if err := json.Unmarshal(raw, &value); err != nil || value < 1 || value > 720 {
			return nil, invalidSetting(key, "must be an integer between 1 and 720 hours")
		}
		return value, nil
	case "hy2.obfs_enabled", "vless.udp_enabled", "vless.xudp_enabled", "xray.sniffing_enabled":
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
	case "xray.sniffing_dest_override":
		values, err := decodeStringList(raw)
		if err != nil {
			return nil, invalidSetting(key, "must be a string array or comma-separated string")
		}
		values, err = normalizeSniffingDestOverride(values)
		if err != nil {
			return nil, invalidSetting(key, err.Error())
		}
		return values, nil
	case "geo.blocked_countries":
		values, err := decodeStringList(raw)
		if err != nil {
			return nil, invalidSetting(key, "must be a string array or comma-separated string")
		}
		values, err = normalizeCountryCodes(values)
		if err != nil {
			return nil, invalidSetting(key, err.Error())
		}
		return values, nil
	case "geo.blocked_geosite_tags":
		values, err := decodeStringList(raw)
		if err != nil {
			return nil, invalidSetting(key, "must be a string array or comma-separated string")
		}
		values, err = normalizeGeositeTags(values)
		if err != nil {
			return nil, invalidSetting(key, err.Error())
		}
		return values, nil
	case "hy2.domain", "reality.sni", "reality.dest", "reality.private_key", "reality.public_key",
		"reality.fingerprint", "hy2.obfs_password", "hy2.bandwidth_up", "hy2.bandwidth_down",
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
	case "hy2.domain", "reality.sni":
		if value == "" {
			return "", invalidSetting(key, "cannot be empty")
		}
		hostname, ok := normalizeHostnameOnly(value)
		if !ok {
			return "", invalidSetting(key, "must be a hostname without a path")
		}
		value = hostname
	case "reality.dest":
		if !validHostPort(value) {
			return "", invalidSetting(key, "must be a host:port value")
		}
	case "hy2.masquerade_url":
		if !validHTTPURL(value) {
			return "", invalidSetting(key, "must be a valid http or https URL")
		}
	case "hy2.bandwidth_up", "hy2.bandwidth_down":
		value = strings.ToLower(value)
		if !bandwidthPattern.MatchString(value) {
			return "", invalidSetting(key, "must use bps, kbps, mbps, gbps, or tbps")
		}
	case "reality.private_key", "reality.public_key":
		if value == "" {
			return "", invalidSetting(key, "cannot be empty")
		}
	case "hy2.traffic_secret":
		if value == "" {
			return "", invalidSetting(key, "cannot be empty")
		}
	case "reality.fingerprint":
		fingerprint, ok := normalizeRealityFingerprint(value)
		if !ok {
			return "", invalidSetting(key, "must be one of chrome, firefox, safari, ios, android, edge, random, randomized")
		}
		value = fingerprint
	}
	return value, nil
}

func validatePortAvailability(current, next RuntimeSettings, values map[string]json.RawMessage) error {
	checks := []struct {
		current  int
		key      string
		label    string
		next     int
		protocol string
	}{
		{current: current.VlessPort, key: "vless.port", label: "VLESS port", next: next.VlessPort, protocol: "tcp"},
		{current: current.Hy2Port, key: "hy2.port", label: "Hysteria port", next: next.Hy2Port, protocol: "udp"},
	}

	for _, check := range checks {
		if _, ok := values[check.key]; !ok || check.current == check.next {
			continue
		}
		result := ProbePort(check.protocol, check.next)
		if !result.Available {
			return domain.NewError(
				400,
				"port_unavailable",
				fmt.Sprintf("%s %d/%s is already in use", check.label, check.next, check.protocol),
				nil,
			)
		}
	}
	return nil
}

func invalidSetting(key, reason string) error {
	return domain.NewError(400, "invalid_setting", fmt.Sprintf("%s %s", key, reason), nil)
}

func configOverrideSettingKey(core string) (string, error) {
	switch core {
	case "xray", "hysteria":
		return "config.override." + core, nil
	default:
		return "", domain.NewError(400, "invalid_core", "Core must be xray or hysteria", nil)
	}
}

func emptyJSONPatch(raw json.RawMessage) bool {
	var patch map[string]any
	return len(raw) == 0 || (json.Unmarshal(raw, &patch) == nil && len(patch) == 0)
}

func validRuntimePort(value int) bool {
	return value >= 1 && value <= 65535
}

func validHTTPURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func normalizeHostnameOnly(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}

	if parsed, err := url.Parse(value); err == nil && parsed.Hostname() != "" {
		return cleanHostname(parsed.Hostname())
	}

	if host, _, err := net.SplitHostPort(value); err == nil {
		return cleanHostname(host)
	}

	if strings.ContainsAny(value, "/?#") {
		if parsed, err := url.Parse("https://" + value); err == nil && parsed.Hostname() != "" {
			return cleanHostname(parsed.Hostname())
		}
		return "", false
	}

	return cleanHostname(value)
}

func cleanHostname(value string) (string, bool) {
	value = strings.Trim(strings.TrimSpace(value), "[]")
	value = strings.TrimSuffix(value, ".")
	if value == "" || strings.ContainsAny(value, "/?#") {
		return "", false
	}
	if strings.Contains(value, ":") && net.ParseIP(value) == nil {
		return "", false
	}
	return strings.ToLower(value), true
}

func validHostPort(value string) bool {
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" || port == "" {
		return false
	}
	portNumber, err := strconv.Atoi(port)
	return err == nil && validRuntimePort(portNumber)
}

func splitListenHostPort(value, fallbackHost string, fallbackPort int) (string, int) {
	host, port, err := net.SplitHostPort(strings.TrimSpace(value))
	if err != nil {
		return fallbackHost, fallbackPort
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || !validRuntimePort(portNumber) {
		return fallbackHost, fallbackPort
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		host = fallbackHost
	}
	return host, portNumber
}

func trafficListenFromURL(raw, fallback string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return fallback
	}
	host := parsed.Host
	if _, _, err := net.SplitHostPort(host); err != nil {
		return fallback
	}
	return host
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

func stringListOr(values map[string]json.RawMessage, key string, fallback []string) []string {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	result, err := decodeStringList(raw)
	if err != nil || len(result) == 0 {
		return fallback
	}
	return result
}

func stringListAllowEmptyOr(values map[string]json.RawMessage, key string, fallback []string) []string {
	raw, ok := values[key]
	if !ok {
		return fallback
	}
	result, err := decodeStringList(raw)
	if err != nil {
		return fallback
	}
	return result
}

func decodeStringList(raw json.RawMessage) ([]string, error) {
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values, nil
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return strings.Split(value, ","), nil
}

func normalizeCountryCodes(values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			value := strings.ToLower(strings.TrimSpace(part))
			if value == "" {
				continue
			}
			if !countryCodePattern.MatchString(value) {
				return nil, fmt.Errorf("must contain ISO 3166-1 alpha-2 country codes")
			}
			if _, ok := allowedGeoCountryCodes[value]; !ok {
				return nil, fmt.Errorf("must contain only ru, cn, or ir")
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	return out, nil
}

func normalizeCountryCodesOrDefault(values []string) []string {
	normalized, err := normalizeCountryCodes(values)
	if err != nil {
		return nil
	}
	return normalized
}

func normalizeGeositeTags(values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			value := strings.ToLower(strings.TrimSpace(part))
			if value == "" {
				continue
			}
			if !geositeTagPattern.MatchString(value) {
				return nil, fmt.Errorf("must contain valid geosite tags")
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	return out, nil
}

func normalizeGeositeTagsOrDefault(values []string) []string {
	normalized, err := normalizeGeositeTags(values)
	if err != nil {
		return nil
	}
	return normalized
}

func geositeTagsForCountryCodes(countries []string) []string {
	for _, country := range countries {
		if country == "ru" {
			return []string{"category-ru"}
		}
	}
	return nil
}

func normalizeGeoUpdateIntervalHours(value int) int {
	if value < 1 || value > 720 {
		return 24
	}
	return value
}

func normalizeRealityFingerprint(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", false
	}
	_, ok := allowedRealityFingerprints[value]
	return value, ok
}

func normalizeRealityFingerprintOrDefault(value string) string {
	if fingerprint, ok := normalizeRealityFingerprint(value); ok {
		return fingerprint
	}
	return "chrome"
}

func normalizeSniffingDestOverride(values []string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			value := strings.ToLower(strings.TrimSpace(part))
			if value == "" {
				continue
			}
			if _, ok := allowedXraySniffingDestOverride[value]; !ok {
				return nil, fmt.Errorf("must contain only http, tls, or quic")
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("must contain at least one of http, tls, or quic")
	}
	return out, nil
}

func normalizeSniffingDestOverrideOrDefault(values []string) []string {
	normalized, err := normalizeSniffingDestOverride(values)
	if err != nil {
		return append([]string(nil), defaultXraySniffingDestOverride...)
	}
	return normalized
}

func currentRealityServerNames(sni string) []string {
	sni = strings.TrimSpace(sni)
	if sni == "" {
		return nil
	}
	return []string{sni}
}

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
