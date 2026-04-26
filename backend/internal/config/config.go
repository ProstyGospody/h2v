package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Panel        PanelConfig
	DB           DBConfig
	Xray         XrayConfig
	Hysteria     HysteriaConfig
	Subscription SubscriptionConfig
	Backup       BackupConfig
}

type PanelConfig struct {
	Domain           string
	Host             string
	Port             int
	JWTSecret        string
	JWTAccessTTL     time.Duration
	JWTRefreshTTL    time.Duration
	RootDir          string
	FrontendDir      string
	TemplatesDir     string
	DisableSystemctl bool
}

type DBConfig struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password string
	SSLMode  string
}

type XrayConfig struct {
	Binary         string
	APIAddr        string
	ConfigPath     string
	VlessPort      int
	RealityDest    string
	RealitySNI     string
	RealityPrivKey string
	RealityPubKey  string
	RealityShortIDs []string
}

type HysteriaConfig struct {
	ConfigPath     string
	TrafficURL     string
	TrafficSecret  string
	Domain         string
	Port           int
	ObfsEnabled    bool
	ObfsPassword   string
	BandwidthUp    string
	BandwidthDown  string
	MasqueradeURL  string
	CertPath       string
	KeyPath        string
}

type SubscriptionConfig struct {
	URLPrefix           string
	UpdateIntervalHours int
}

type BackupConfig struct {
	Dir           string
	RetentionDays int
}

func Load() Config {
	envFile := firstNonEmpty(os.Getenv("PANEL_ENV_FILE"), filepath.Join("/opt/mypanel", ".env"), ".env")
	loadEnvFile(envFile)

	rootDir := getenv("PANEL_ROOT_DIR", ".")
	templatesDir := getenv("PANEL_TEMPLATES_DIR", filepath.Join(rootDir, "templates"))
	frontendDir := getenv("PANEL_FRONTEND_DIR", filepath.Join(rootDir, "frontend"))

	return Config{
		Panel: PanelConfig{
			Domain:           getenv("PANEL_DOMAIN", "panel.example.com"),
			Host:             getenv("PANEL_HOST", "127.0.0.1"),
			Port:             getenvInt("PANEL_PORT", 8000),
			JWTSecret:        getenv("PANEL_JWT_SECRET", "dev-secret-change-me"),
			JWTAccessTTL:     getenvDuration("PANEL_JWT_ACCESS_TTL", 15*time.Minute),
			JWTRefreshTTL:    getenvDuration("PANEL_JWT_REFRESH_TTL", 720*time.Hour),
			RootDir:          rootDir,
			FrontendDir:      frontendDir,
			TemplatesDir:     templatesDir,
			DisableSystemctl: getenvBool("PANEL_DISABLE_SYSTEMCTL", false),
		},
		DB: DBConfig{
			Host:     getenv("DB_HOST", "127.0.0.1"),
			Port:     getenvInt("DB_PORT", 5432),
			Name:     getenv("DB_NAME", "mypanel"),
			User:     getenv("DB_USER", "panel"),
			Password: getenv("DB_PASSWORD", ""),
			SSLMode:  getenv("DB_SSLMODE", "disable"),
		},
		Xray: XrayConfig{
			Binary:          getenv("XRAY_BINARY", "/usr/local/bin/xray"),
			APIAddr:         getenv("XRAY_API_ADDR", "127.0.0.1:10085"),
			ConfigPath:      getenv("XRAY_CONFIG_PATH", filepath.Join(rootDir, "configs", "xray", "config.json")),
			VlessPort:       getenvInt("VLESS_PORT", 8444),
			RealityDest:     getenv("REALITY_DEST", "www.cloudflare.com:443"),
			RealitySNI:      getenv("REALITY_SNI", "www.cloudflare.com"),
			RealityPrivKey:  getenv("REALITY_PRIVATE_KEY", ""),
			RealityPubKey:   getenv("REALITY_PUBLIC_KEY", ""),
			RealityShortIDs: splitCSV(getenv("REALITY_SHORT_IDS", ",a1b2c3d4e5f60718")),
		},
		Hysteria: HysteriaConfig{
			ConfigPath:    getenv("HY2_CONFIG_PATH", filepath.Join(rootDir, "configs", "hysteria", "config.json")),
			TrafficURL:    getenv("HY2_TRAFFIC_URL", "http://127.0.0.1:7653"),
			TrafficSecret: getenv("HY2_TRAFFIC_SECRET", ""),
			Domain:        getenv("HY2_DOMAIN", getenv("PANEL_DOMAIN", "panel.example.com")),
			Port:          getenvInt("HY2_PORT", 8443),
			ObfsEnabled:   getenvBool("HY2_OBFS_ENABLED", false),
			ObfsPassword:  getenv("HY2_OBFS_PASSWORD", ""),
			BandwidthUp:   getenv("HY2_BANDWIDTH_UP", "1 gbps"),
			BandwidthDown: getenv("HY2_BANDWIDTH_DOWN", "1 gbps"),
			MasqueradeURL: getenv("HY2_MASQUERADE_URL", "https://www.bing.com"),
			CertPath:      getenv("HY2_CERT_PATH", ""),
			KeyPath:       getenv("HY2_KEY_PATH", ""),
		},
		Subscription: SubscriptionConfig{
			URLPrefix:           getenv("SUB_URL_PREFIX", "https://panel.example.com"),
			UpdateIntervalHours: getenvInt("SUB_UPDATE_INTERVAL_HOURS", 24),
		},
		Backup: BackupConfig{
			Dir:           getenv("BACKUP_DIR", filepath.Join(rootDir, "data", "backups")),
			RetentionDays: getenvInt("BACKUP_RETENTION_DAYS", 14),
		},
	}
}

func Address(host string, port int) string {
	return host + ":" + strconv.Itoa(port)
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
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
		key := strings.TrimSpace(parts[0])
		val := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if _, ok := os.LookupEnv(key); ok {
			continue
		}
		_ = os.Setenv(key, val)
	}
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	raw := getenv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func getenvBool(key string, fallback bool) bool {
	raw := getenv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return value
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	raw := getenv(key, "")
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return value
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, strings.TrimSpace(part))
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
