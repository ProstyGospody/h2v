package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

const serverInfoCacheTTL = 6 * time.Hour

type ServerInfoService struct {
	cfg      config.Config
	settings *SettingsService
	logger   *slog.Logger
	client   *http.Client
	mu       sync.Mutex
	cache    map[string]cachedServerGeo
}

type cachedServerGeo struct {
	expiresAt time.Time
	value     serverGeo
}

type serverGeo struct {
	IP          string
	City        string
	Country     string
	CountryCode string
}

func NewServerInfoService(cfg config.Config, settings *SettingsService, logger *slog.Logger) *ServerInfoService {
	if logger == nil {
		logger = slog.Default()
	}
	return &ServerInfoService{
		cfg:      cfg,
		settings: settings,
		logger:   logger,
		client:   &http.Client{Timeout: 4 * time.Second},
		cache:    map[string]cachedServerGeo{},
	}
}

func (s *ServerInfoService) Info(ctx context.Context, hostHint string) (*domain.ServerInfo, error) {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		s.logger.Warn("server info settings lookup failed, using defaults", "err", err)
		runtime = DefaultRuntime(s.cfg)
	}

	lookupTarget := firstNonEmpty(runtime.PublicServerIP, hostHint, publicHostFromURL(runtime.SubURLPrefix), runtime.PanelDomain)
	geo, err := s.location(ctx, lookupTarget)
	if err != nil {
		s.logger.Debug("server geo lookup failed", "target", lookupTarget, "err", err)
		geo = serverGeo{IP: publicIPString(lookupTarget)}
	}

	countryCode := strings.ToUpper(strings.TrimSpace(geo.CountryCode))
	return &domain.ServerInfo{
		City:        geo.City,
		Country:     geo.Country,
		CountryCode: countryCode,
		Protocols:   publicServerProtocols(runtime),
	}, nil
}

func (s *ServerInfoService) location(ctx context.Context, target string) (serverGeo, error) {
	cacheKey := strings.ToLower(strings.TrimSpace(target))
	if cacheKey == "" {
		cacheKey = "__server_public_ip__"
	}

	now := time.Now()
	s.mu.Lock()
	if cached, ok := s.cache[cacheKey]; ok && now.Before(cached.expiresAt) {
		s.mu.Unlock()
		return cached.value, nil
	}
	s.mu.Unlock()

	lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	geo, err := s.lookupLocation(lookupCtx, target)
	if err != nil {
		return serverGeo{}, err
	}

	s.mu.Lock()
	s.cache[cacheKey] = cachedServerGeo{expiresAt: now.Add(serverInfoCacheTTL), value: geo}
	s.mu.Unlock()
	return geo, nil
}

func (s *ServerInfoService) lookupLocation(ctx context.Context, target string) (serverGeo, error) {
	ip := publicIPString(target)
	if ip == "" && target != "" {
		resolved, err := resolvePublicIP(ctx, target)
		if err == nil {
			ip = resolved
		}
	}

	if geo, err := s.lookupIPAPI(ctx, ip); err == nil {
		return geo, nil
	}
	if geo, err := s.lookupIPWhoIs(ctx, ip); err == nil {
		return geo, nil
	}
	return serverGeo{IP: ip}, fmt.Errorf("geo providers unavailable")
}

func (s *ServerInfoService) lookupIPAPI(ctx context.Context, ip string) (serverGeo, error) {
	endpoint := "https://ipapi.co/json/"
	if ip != "" {
		endpoint = "https://ipapi.co/" + url.PathEscape(ip) + "/json/"
	}
	var payload struct {
		IP          string `json:"ip"`
		City        string `json:"city"`
		CountryName string `json:"country_name"`
		CountryCode string `json:"country_code"`
		Error       bool   `json:"error"`
		Reason      string `json:"reason"`
	}
	if err := s.getJSON(ctx, endpoint, &payload); err != nil {
		return serverGeo{}, err
	}
	if payload.Error {
		return serverGeo{}, fmt.Errorf("ipapi error: %s", payload.Reason)
	}
	return normalizeServerGeo(serverGeo{
		IP:          firstNonEmpty(payload.IP, ip),
		City:        payload.City,
		Country:     payload.CountryName,
		CountryCode: payload.CountryCode,
	}), nil
}

func (s *ServerInfoService) lookupIPWhoIs(ctx context.Context, ip string) (serverGeo, error) {
	endpoint := "https://ipwho.is/"
	if ip != "" {
		endpoint = "https://ipwho.is/" + url.PathEscape(ip)
	}
	var payload struct {
		Success     bool   `json:"success"`
		IP          string `json:"ip"`
		City        string `json:"city"`
		Country     string `json:"country"`
		CountryCode string `json:"country_code"`
		Message     string `json:"message"`
	}
	if err := s.getJSON(ctx, endpoint, &payload); err != nil {
		return serverGeo{}, err
	}
	if !payload.Success {
		return serverGeo{}, fmt.Errorf("ipwho.is error: %s", payload.Message)
	}
	return normalizeServerGeo(serverGeo{
		IP:          firstNonEmpty(payload.IP, ip),
		City:        payload.City,
		Country:     payload.Country,
		CountryCode: payload.CountryCode,
	}), nil
}

func (s *ServerInfoService) getJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "h2v-panel server-info")

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("geo lookup status %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(target)
}

func publicServerProtocols(runtime RuntimeSettings) []domain.ServerProtocol {
	protocols := []domain.ServerProtocol{
		{
			ID:        "vless",
			Label:     "VLESS",
			Detail:    "Reality",
			Transport: "TCP",
			Port:      runtime.VlessPort,
			Logo:      "xray",
			Enabled:   true,
		},
		{
			ID:        "hysteria2",
			Label:     "Hysteria 2",
			Detail:    hysteriaProtocolDetail(runtime),
			Transport: "UDP",
			Port:      runtime.Hy2Port,
			Logo:      "hysteria",
			Enabled:   true,
		},
	}
	return protocols
}

func hysteriaProtocolDetail(runtime RuntimeSettings) string {
	if runtime.Hy2ObfsEnabled {
		return "Obfs"
	}
	return "UDP"
}

func publicHostFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(parsed.Host)
	if err == nil {
		return host
	}
	return parsed.Host
}

func publicIPString(value string) string {
	host := publicHost(value)
	ip := net.ParseIP(host)
	if ip == nil || !isPublicIP(ip) {
		return ""
	}
	return ip.String()
}

func publicHost(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		value = parsed.Host
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(value, "[]")
}

func resolvePublicIP(ctx context.Context, host string) (string, error) {
	host = publicHost(host)
	if host == "" {
		return "", fmt.Errorf("empty host")
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return "", err
	}
	for _, addr := range addrs {
		if isPublicIP(addr.IP) {
			return addr.IP.String(), nil
		}
	}
	return "", fmt.Errorf("no public ip for host %q", host)
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsUnspecified() && !ip.IsMulticast() && !ip.IsLinkLocalUnicast()
}

func normalizeServerGeo(geo serverGeo) serverGeo {
	geo.IP = strings.TrimSpace(geo.IP)
	geo.City = strings.TrimSpace(geo.City)
	geo.Country = strings.TrimSpace(geo.Country)
	geo.CountryCode = strings.ToUpper(strings.TrimSpace(geo.CountryCode))
	return geo
}
