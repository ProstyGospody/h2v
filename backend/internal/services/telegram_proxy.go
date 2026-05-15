package services

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

type TelegramProxyService struct {
	cfg       config.Config
	settings  *SettingsService
	systemctl SystemctlAdapter
}

type TelegramProxyInfo struct {
	Enabled      bool   `json:"enabled"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	Secret       string `json:"secret"`
	MaskDomain   string `json:"mask_domain"`
	FallbackAddr string `json:"fallback_addr"`
	Link         string `json:"link"`
}

func NewTelegramProxyService(cfg config.Config, settings *SettingsService, systemctl SystemctlAdapter) *TelegramProxyService {
	return &TelegramProxyService{cfg: cfg, settings: settings, systemctl: systemctl}
}

func (s *TelegramProxyService) Info(ctx context.Context) (*TelegramProxyInfo, error) {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return nil, err
	}
	return telegramProxyInfo(runtime), nil
}

func (s *TelegramProxyService) Update(ctx context.Context, values map[string]json.RawMessage) (*TelegramProxyInfo, error) {
	normalized, err := normalizeSettingsUpdate(values)
	if err != nil {
		return nil, err
	}
	for key := range normalized {
		if !strings.HasPrefix(key, "telegram.") {
			return nil, domain.NewError(400, "invalid_setting", "Only Telegram proxy settings can be updated here", nil)
		}
	}
	if err := s.settings.Update(ctx, normalized); err != nil {
		return nil, err
	}
	if err := s.Reconcile(ctx); err != nil {
		return nil, err
	}
	return s.Info(ctx)
}

func (s *TelegramProxyService) RegenerateSecret(ctx context.Context) (*TelegramProxyInfo, error) {
	secret, err := s.settings.GenerateTelegramSecret()
	if err != nil {
		return nil, err
	}
	value, _ := json.Marshal(secret.Secret)
	if err := s.settings.Update(ctx, map[string]json.RawMessage{"telegram.secret": json.RawMessage(value)}); err != nil {
		return nil, err
	}
	if err := s.Reconcile(ctx); err != nil {
		return nil, err
	}
	return s.Info(ctx)
}

func (s *TelegramProxyService) Reconcile(ctx context.Context) error {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return err
	}
	serviceEnabled := telegramServiceEnabled(runtime)
	content := []byte(renderTelemtConfig(runtime, s.cfg.Panel.RootDir))
	if err := writeTelegramFileAtomic(s.cfg.Telegram.ConfigPath, content, 0o640); err != nil {
		return err
	}
	if s.systemctl != nil {
		restartCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if !serviceEnabled {
			if err := s.systemctl.Stop(restartCtx, "h2v-telegram"); err != nil {
				return domain.NewError(500, "telegram_stop_failed", "Telegram proxy service stop failed", err)
			}
			return nil
		}
		if err := s.systemctl.Restart(restartCtx, "h2v-telegram"); err != nil {
			return domain.NewError(500, "telegram_restart_failed", "Telegram proxy service restart failed", err)
		}
	}
	return nil
}

func telegramProxyInfo(runtime RuntimeSettings) *TelegramProxyInfo {
	return &TelegramProxyInfo{
		Enabled:      runtime.TelegramEnabled,
		Host:         runtime.TelegramHost,
		Port:         runtime.TelegramPort,
		Secret:       runtime.TelegramSecret,
		MaskDomain:   runtime.TelegramMaskDomain,
		FallbackAddr: runtime.TelegramFallback,
		Link:         buildTelegramProxyLink(runtime),
	}
}

func buildTelegramProxyLink(runtime RuntimeSettings) string {
	if !runtime.TelegramEnabled {
		return ""
	}
	host := telegramPublicHost(runtime)
	maskDomain := strings.TrimSpace(runtime.TelegramMaskDomain)
	secret := strings.TrimSpace(strings.ToLower(runtime.TelegramSecret))
	if host == "" || maskDomain == "" || !validRuntimePort(runtime.TelegramPort) || !validTelegramSecret(secret) {
		return ""
	}
	query := url.Values{}
	query.Set("server", host)
	query.Set("port", strconv.Itoa(runtime.TelegramPort))
	query.Set("secret", "ee"+secret+hex.EncodeToString([]byte(maskDomain)))
	return "tg://proxy?" + query.Encode()
}

func telegramServiceEnabled(runtime RuntimeSettings) bool {
	return runtime.TelegramEnabled &&
		telegramPublicHost(runtime) != "" &&
		strings.TrimSpace(runtime.TelegramMaskDomain) != "" &&
		validRuntimePort(runtime.TelegramPort) &&
		validTelegramSecret(strings.TrimSpace(strings.ToLower(runtime.TelegramSecret)))
}

func telegramPublicHost(runtime RuntimeSettings) string {
	if host := publicEndpointHost(runtime.PublicServerIP, ""); host != "" {
		return host
	}
	return strings.TrimSpace(runtime.TelegramHost)
}

func renderTelemtConfig(runtime RuntimeSettings, rootDir string) string {
	port := runtime.TelegramPort
	if !validRuntimePort(port) {
		port = 9443
	}
	host := telegramPublicHost(runtime)
	if host == "" {
		host = "panel.example.com"
	}
	maskDomain := strings.TrimSpace(runtime.TelegramMaskDomain)
	if maskDomain == "" {
		maskDomain = "www.google.com"
	}
	secret := strings.TrimSpace(strings.ToLower(runtime.TelegramSecret))
	if !validTelegramSecret(secret) {
		secret = "00000000000000000000000000000000"
	}
	fallbackHost, fallbackPort := telegramFallbackTarget(runtime.TelegramFallback, maskDomain)
	dataDir := filepath.ToSlash(filepath.Join(rootDir, "data", "telegram"))
	tlsFrontDir := filepath.ToSlash(filepath.Join(dataDir, "tlsfront"))

	var b strings.Builder
	b.WriteString("# Generated by h2v. Edit Telegram Proxy settings in the panel.\n")
	b.WriteString("[general]\n")
	b.WriteString("use_middle_proxy = true\n")
	b.WriteString("log_level = \"normal\"\n\n")
	b.WriteString("[general.modes]\n")
	b.WriteString("classic = false\n")
	b.WriteString("secure = false\n")
	b.WriteString("tls = true\n\n")
	b.WriteString("[general.links]\n")
	b.WriteString("show = \"*\"\n")
	b.WriteString("public_host = " + strconv.Quote(host) + "\n")
	b.WriteString(fmt.Sprintf("public_port = %d\n\n", port))
	b.WriteString("[server]\n")
	b.WriteString(fmt.Sprintf("port = %d\n", port))
	b.WriteString("\n")
	b.WriteString("[server.api]\n")
	b.WriteString("enabled = true\n")
	b.WriteString("listen = \"127.0.0.1:9091\"\n")
	b.WriteString("whitelist = [\"127.0.0.1/32\", \"::1/128\"]\n")
	b.WriteString("minimal_runtime_enabled = false\n")
	b.WriteString("minimal_runtime_cache_ttl_ms = 1000\n\n")
	b.WriteString("[[server.listeners]]\n")
	b.WriteString("ip = \"0.0.0.0\"\n\n")
	b.WriteString("[censorship]\n")
	b.WriteString("tls_domain = " + strconv.Quote(maskDomain) + "\n")
	b.WriteString("mask = true\n")
	b.WriteString("mask_host = " + strconv.Quote(fallbackHost) + "\n")
	b.WriteString(fmt.Sprintf("mask_port = %d\n", fallbackPort))
	b.WriteString("tls_emulation = true\n")
	b.WriteString("tls_front_dir = " + strconv.Quote(tlsFrontDir) + "\n\n")
	b.WriteString("[access.users]\n")
	b.WriteString("h2v = " + strconv.Quote(secret) + "\n")
	return b.String()
}

func telegramFallbackTarget(value string, defaultHost string) (string, int) {
	host, portValue, err := net.SplitHostPort(strings.TrimSpace(value))
	if err != nil || host == "" {
		return defaultHost, 443
	}
	port, err := strconv.Atoi(portValue)
	if err != nil || !validRuntimePort(port) {
		return defaultHost, 443
	}
	return host, port
}

func writeTelegramFileAtomic(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "telegram-*.tmp")
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
	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, content) {
		return nil
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("replace telegram config: %w", err)
	}
	return nil
}
