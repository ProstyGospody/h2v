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

type telegramDaemonConfig struct {
	Enabled      bool   `json:"enabled"`
	Listen       string `json:"listen"`
	PublicHost   string `json:"public_host"`
	PublicPort   int    `json:"public_port"`
	Secret       string `json:"secret"`
	MaskDomain   string `json:"mask_domain"`
	FallbackAddr string `json:"fallback_addr"`
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
	daemonEnabled := runtime.TelegramEnabled && validTelegramSecret(runtime.TelegramSecret)
	content, err := json.MarshalIndent(telegramDaemonConfig{
		Enabled:      daemonEnabled,
		Listen:       net.JoinHostPort("0.0.0.0", strconv.Itoa(runtime.TelegramPort)),
		PublicHost:   runtime.TelegramHost,
		PublicPort:   runtime.TelegramPort,
		Secret:       runtime.TelegramSecret,
		MaskDomain:   runtime.TelegramMaskDomain,
		FallbackAddr: runtime.TelegramFallback,
	}, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	if err := writeTelegramFileAtomic(s.cfg.Telegram.ConfigPath, content, 0o640); err != nil {
		return err
	}
	if s.systemctl != nil {
		restartCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
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
	host := strings.TrimSpace(runtime.TelegramHost)
	maskDomain := strings.TrimSpace(runtime.TelegramMaskDomain)
	secret := strings.TrimSpace(strings.ToLower(runtime.TelegramSecret))
	if host == "" || maskDomain == "" || !validRuntimePort(runtime.TelegramPort) || !validTelegramSecret(secret) {
		return ""
	}
	query := url.Values{}
	query.Set("server", host)
	query.Set("port", strconv.Itoa(runtime.TelegramPort))
	query.Set("secret", "ee"+secret+hex.EncodeToString([]byte(maskDomain)))
	return "https://t.me/proxy?" + query.Encode()
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
