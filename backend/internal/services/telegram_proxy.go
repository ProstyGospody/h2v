package services

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

const (
	telegramEnvHost      = "TELEGRAM_PROXY_PUBLIC_HOST"
	telegramEnvPort      = "TELEGRAM_PROXY_PORT"
	telegramEnvStatsPort = "TELEGRAM_PROXY_STATS_PORT"
	telegramEnvSecret    = "TELEGRAM_PROXY_SECRET"
	telegramEnvWorkers   = "TELEGRAM_PROXY_WORKERS"
)

var mtprotoSecretPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type TelegramProxyService struct {
	cfg       config.Config
	systemctl SystemctlAdapter
}

type TelegramProxyInfo struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	StatsPort int    `json:"stats_port"`
	Secret    string `json:"secret"`
	Workers   int    `json:"workers"`
	Link      string `json:"link"`
	TGLink    string `json:"tg_link"`
	Status    string `json:"status"`
}

type TelegramProxyUpdate struct {
	Host    *string `json:"host"`
	Port    *int    `json:"port"`
	Secret  *string `json:"secret"`
	Workers *int    `json:"workers"`
}

func NewTelegramProxyService(cfg config.Config, systemctl SystemctlAdapter) *TelegramProxyService {
	return &TelegramProxyService{cfg: cfg, systemctl: systemctl}
}

func (s *TelegramProxyService) Get(ctx context.Context) (*TelegramProxyInfo, error) {
	values := s.currentValues()
	info := s.infoFromValues(values)
	info.Status = s.status(ctx)
	return info, nil
}

func (s *TelegramProxyService) Update(ctx context.Context, req TelegramProxyUpdate) (*TelegramProxyInfo, error) {
	current := s.currentValues()
	next := cloneStringMap(current)

	if req.Host != nil {
		host, ok := normalizeTelegramHost(*req.Host)
		if !ok {
			return nil, domain.NewError(400, "invalid_telegram_proxy", "Telegram proxy host must be a valid hostname or IP address", nil)
		}
		next[telegramEnvHost] = host
	}
	if req.Port != nil {
		if !validRuntimePort(*req.Port) {
			return nil, domain.NewError(400, "invalid_telegram_proxy", "Telegram proxy port must be between 1 and 65535", nil)
		}
		currentPort, _ := strconv.Atoi(current[telegramEnvPort])
		if *req.Port != currentPort {
			if probe := ProbePort("tcp", *req.Port); !probe.Available {
				return nil, domain.NewError(400, "port_unavailable", fmt.Sprintf("Telegram proxy port %d/tcp is already in use", *req.Port), nil)
			}
		}
		next[telegramEnvPort] = strconv.Itoa(*req.Port)
	}
	if req.Secret != nil {
		secret, err := normalizeTelegramSecret(*req.Secret)
		if err != nil {
			return nil, err
		}
		next[telegramEnvSecret] = secret
	}
	if req.Workers != nil {
		if *req.Workers < 1 || *req.Workers > 32 {
			return nil, domain.NewError(400, "invalid_telegram_proxy", "Telegram proxy workers must be between 1 and 32", nil)
		}
		next[telegramEnvWorkers] = strconv.Itoa(*req.Workers)
	}

	if next[telegramEnvSecret] == "" {
		secret, err := generateMTProtoSecret()
		if err != nil {
			return nil, err
		}
		next[telegramEnvSecret] = secret
	}

	if err := updateEnvFile(s.envFile(), telegramEnvValues(next)); err != nil {
		return nil, domain.NewError(500, "telegram_proxy_update_failed", "Unable to update Telegram proxy environment", err)
	}
	if err := s.restart(ctx); err != nil {
		return nil, domain.NewError(500, "telegram_proxy_restart_failed", "Telegram proxy settings were saved, but service restart failed: "+err.Error(), err)
	}
	return s.Get(ctx)
}

func (s *TelegramProxyService) RegenerateSecret(ctx context.Context) (*TelegramProxyInfo, error) {
	secret, err := generateMTProtoSecret()
	if err != nil {
		return nil, err
	}
	return s.Update(ctx, TelegramProxyUpdate{Secret: &secret})
}

func (s *TelegramProxyService) currentValues() map[string]string {
	values := readSimpleEnvFile(s.envFile())
	setDefault(values, telegramEnvHost, s.cfg.Telegram.Host)
	setDefault(values, telegramEnvPort, strconv.Itoa(s.cfg.Telegram.Port))
	setDefault(values, telegramEnvStatsPort, strconv.Itoa(s.cfg.Telegram.StatsPort))
	setDefault(values, telegramEnvSecret, s.cfg.Telegram.Secret)
	setDefault(values, telegramEnvWorkers, strconv.Itoa(s.cfg.Telegram.Workers))
	return values
}

func (s *TelegramProxyService) infoFromValues(values map[string]string) *TelegramProxyInfo {
	host, ok := normalizeTelegramHost(values[telegramEnvHost])
	if !ok {
		host = normalizeFallbackHost(s.cfg.Panel.Domain, s.cfg.Subscription.URLPrefix)
	}
	port, _ := strconv.Atoi(values[telegramEnvPort])
	if !validRuntimePort(port) {
		port = 8445
	}
	statsPort, _ := strconv.Atoi(values[telegramEnvStatsPort])
	if !validRuntimePort(statsPort) {
		statsPort = 8888
	}
	workers, _ := strconv.Atoi(values[telegramEnvWorkers])
	if workers < 1 {
		workers = 1
	}
	secret, _ := normalizeTelegramSecret(values[telegramEnvSecret])

	linkSecret := secret
	if linkSecret != "" {
		linkSecret = "dd" + linkSecret
	}

	query := url.Values{}
	query.Set("server", host)
	query.Set("port", strconv.Itoa(port))
	query.Set("secret", linkSecret)

	return &TelegramProxyInfo{
		Host:      host,
		Port:      port,
		StatsPort: statsPort,
		Secret:    secret,
		Workers:   workers,
		Link:      "https://t.me/proxy?" + query.Encode(),
		TGLink:    "tg://proxy?" + query.Encode(),
	}
}

func (s *TelegramProxyService) restart(ctx context.Context) error {
	if s.systemctl == nil {
		return nil
	}
	restartCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return s.systemctl.Restart(restartCtx, "telegram-proxy")
}

func (s *TelegramProxyService) status(ctx context.Context) string {
	deadline, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(deadline, "systemctl", "is-active", "telegram-proxy.service")
	out, err := cmd.CombinedOutput()
	status := strings.TrimSpace(string(out))
	if status != "" {
		return status
	}
	if err != nil {
		return "unknown"
	}
	return "unknown"
}

func (s *TelegramProxyService) envFile() string {
	if s.cfg.Telegram.EnvFile != "" {
		return s.cfg.Telegram.EnvFile
	}
	return config.EnvFilePath()
}

func generateMTProtoSecret() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", domain.NewError(500, "secret_generation_failed", "Unable to generate Telegram proxy secret", err)
	}
	return hex.EncodeToString(raw[:]), nil
}

func normalizeTelegramSecret(value string) (string, error) {
	secret := strings.ToLower(strings.TrimSpace(value))
	if len(secret) == 34 && strings.HasPrefix(secret, "dd") {
		secret = strings.TrimPrefix(secret, "dd")
	}
	if !mtprotoSecretPattern.MatchString(secret) {
		return "", domain.NewError(400, "invalid_telegram_proxy", "Telegram proxy secret must be 32 hexadecimal characters", nil)
	}
	return secret, nil
}

func normalizeTelegramHost(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Hostname() != "" {
		value = parsed.Hostname()
	} else if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
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

func normalizeFallbackHost(domain, prefix string) string {
	if host, ok := normalizeTelegramHost(domain); ok && host != "panel.example.com" {
		return host
	}
	if parsed, err := url.Parse(prefix); err == nil {
		if host, ok := normalizeTelegramHost(parsed.Hostname()); ok {
			return host
		}
	}
	return "panel.example.com"
}

func readSimpleEnvFile(path string) map[string]string {
	values := map[string]string{}
	file, err := os.Open(path)
	if err != nil {
		return values
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		values[strings.TrimSpace(parts[0])] = strings.Trim(strings.TrimSpace(parts[1]), `"'`)
	}
	return values
}

func updateEnvFile(path string, values map[string]string) error {
	content, _ := os.ReadFile(path)
	lines := strings.Split(string(content), "\n")
	seen := map[string]bool{}

	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || !strings.Contains(trimmed, "=") {
			continue
		}
		key := strings.TrimSpace(strings.SplitN(trimmed, "=", 2)[0])
		if value, ok := values[key]; ok {
			lines[index] = key + "=" + value
			seen[key] = true
		}
	}

	if len(lines) == 1 && lines[0] == "" {
		lines = nil
	}
	missing := make([]string, 0, len(values))
	for _, key := range []string{telegramEnvHost, telegramEnvPort, telegramEnvStatsPort, telegramEnvSecret, telegramEnvWorkers} {
		if !seen[key] {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		lines = append(lines, "", "# === Telegram MTProxy ===")
	}
	for _, key := range missing {
		lines = append(lines, key+"="+values[key])
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".env-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func telegramEnvValues(values map[string]string) map[string]string {
	return map[string]string{
		telegramEnvHost:      values[telegramEnvHost],
		telegramEnvPort:      values[telegramEnvPort],
		telegramEnvStatsPort: values[telegramEnvStatsPort],
		telegramEnvSecret:    values[telegramEnvSecret],
		telegramEnvWorkers:   values[telegramEnvWorkers],
	}
}

func cloneStringMap(values map[string]string) map[string]string {
	next := make(map[string]string, len(values))
	for key, value := range values {
		next[key] = value
	}
	return next
}

func setDefault(values map[string]string, key, value string) {
	if strings.TrimSpace(values[key]) == "" {
		values[key] = value
	}
}
