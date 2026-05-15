package config

import (
	"bufio"
	"errors"
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
	Telegram     TelegramProxyConfig
	Subscription SubscriptionConfig
	Backup       BackupConfig
	Traffic      TrafficConfig
	Tasks        TaskConfig
}

type PanelConfig struct {
	Domain           string
	PublicIP         string
	Host             string
	Port             int
	PublicPort       int
	JWTSecret        string
	JWTAccessTTL     time.Duration
	JWTRefreshTTL    time.Duration
	RootDir          string
	FrontendDir      string
	TemplatesDir     string
	DisableSystemctl bool
	AllowInsecure    bool
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
	Binary                  string
	APIAddr                 string
	ConfigPath              string
	GeodataDir              string
	GeoIPURL                string
	GeositeURL              string
	VlessPort               int
	VlessUDPEnabled         bool
	VlessXUDPEnabled        bool
	RealityDest             string
	RealitySNI              string
	RealityPrivKey          string
	RealityPubKey           string
	RealityShortIDs         []string
	RealityFingerprint      string
	SniffingEnabled         bool
	SniffingDestOverride    []string
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

type TelegramProxyConfig struct {
	ConfigPath   string
	Enabled      bool
	Host         string
	Port         int
	Secret       string
	MaskDomain   string
	FallbackAddr string
}

type SubscriptionConfig struct {
	URLPrefix           string
	UpdateIntervalHours int
}

type BackupConfig struct {
	Dir           string
	RetentionDays int
}

type TrafficConfig struct {
	RetentionDays int
}

type TaskConfig struct {
	CollectorInterval     time.Duration
	EnforcerInterval      time.Duration
	CoreReconcileInterval time.Duration
	CacheRefreshInterval  time.Duration
}

func Load() Config {
	loadEnvFile(EnvFilePath())

	rootDir := getenv("PANEL_ROOT_DIR", ".")
	templatesDir := getenv("PANEL_TEMPLATES_DIR", filepath.Join(rootDir, "templates"))
	frontendDir := getenv("PANEL_FRONTEND_DIR", filepath.Join(rootDir, "frontend"))

	return Config{
		Panel: PanelConfig{
			Domain:           getenv("PANEL_DOMAIN", "panel.example.com"),
			PublicIP:         getenv("PUBLIC_SERVER_IP", ""),
			Host:             getenv("PANEL_HOST", "127.0.0.1"),
			Port:             getenvInt("PANEL_PORT", 8000),
			PublicPort:       getenvInt("PANEL_PUBLIC_PORT", 443),
			JWTSecret:        getenv("PANEL_JWT_SECRET", "dev-secret-change-me"),
			JWTAccessTTL:     getenvDuration("PANEL_JWT_ACCESS_TTL", 15*time.Minute),
			JWTRefreshTTL:    getenvDuration("PANEL_JWT_REFRESH_TTL", 720*time.Hour),
			RootDir:          rootDir,
			FrontendDir:      frontendDir,
			TemplatesDir:     templatesDir,
			DisableSystemctl: getenvBool("PANEL_DISABLE_SYSTEMCTL", false),
			AllowInsecure:    getenvBool("PANEL_ALLOW_INSECURE_DEFAULTS", false),
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
			Binary:               getenv("XRAY_BINARY", "/usr/local/bin/xray"),
			APIAddr:              getenv("XRAY_API_ADDR", "127.0.0.1:10085"),
			ConfigPath:           getenv("XRAY_CONFIG_PATH", filepath.Join(rootDir, "configs", "xray", "config.json")),
			GeodataDir:           getenv("XRAY_GEODATA_DIR", filepath.Join(rootDir, "data", "geodata")),
			GeoIPURL:             getenv("XRAY_GEOIP_URL", "https://github.com/v2fly/geoip/releases/latest/download/geoip.dat"),
			GeositeURL:           getenv("XRAY_GEOSITE_URL", "https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat"),
			VlessPort:            getenvInt("VLESS_PORT", 8444),
			VlessUDPEnabled:      getenvBool("VLESS_UDP_ENABLED", false),
			VlessXUDPEnabled:     getenvBool("VLESS_XUDP_ENABLED", false),
			RealityDest:          getenv("REALITY_DEST", "www.google.com:443"),
			RealitySNI:           getenv("REALITY_SNI", "www.google.com"),
			RealityPrivKey:       getenv("REALITY_PRIVATE_KEY", ""),
			RealityPubKey:        getenv("REALITY_PUBLIC_KEY", ""),
			RealityShortIDs:      splitCSV(getenv("REALITY_SHORT_IDS", "a1b2c3d4e5f60718")),
			RealityFingerprint:   getenv("REALITY_FINGERPRINT", "chrome"),
			SniffingEnabled:      getenvBool("XRAY_SNIFFING_ENABLED", true),
			SniffingDestOverride: splitCSV(getenv("XRAY_SNIFFING_DEST_OVERRIDE", "http,tls")),
		},
		Hysteria: HysteriaConfig{
			ConfigPath:    getenv("HY2_CONFIG_PATH", filepath.Join(rootDir, "configs", "hysteria", "config.json")),
			TrafficURL:    getenv("HY2_TRAFFIC_URL", "http://127.0.0.1:7653"),
			TrafficSecret: getenv("HY2_TRAFFIC_SECRET", ""),
			Domain:        getenv("HY2_DOMAIN", getenv("PANEL_DOMAIN", "panel.example.com")),
			Port:          getenvInt("HY2_PORT", 8443),
			ObfsEnabled:   getenvBool("HY2_OBFS_ENABLED", true),
			ObfsPassword:  getenv("HY2_OBFS_PASSWORD", ""),
			BandwidthUp:   getenv("HY2_BANDWIDTH_UP", "1 gbps"),
			BandwidthDown: getenv("HY2_BANDWIDTH_DOWN", "1 gbps"),
			MasqueradeURL: getenv("HY2_MASQUERADE_URL", "https://www.google.com"),
			CertPath:      getenv("HY2_CERT_PATH", ""),
			KeyPath:       getenv("HY2_KEY_PATH", ""),
		},
		Telegram: TelegramProxyConfig{
			ConfigPath:   getenv("TELEGRAM_PROXY_CONFIG_PATH", filepath.Join(rootDir, "configs", "telegram", "telemt.toml")),
			Enabled:      getenvBool("TELEGRAM_PROXY_ENABLED", true),
			Host:         getenv("TELEGRAM_PROXY_PUBLIC_HOST", getenv("PANEL_DOMAIN", "panel.example.com")),
			Port:         getenvInt("TELEGRAM_PROXY_PORT", 9443),
			Secret:       getenv("TELEGRAM_PROXY_SECRET", ""),
			MaskDomain:   getenv("TELEGRAM_PROXY_MASK_DOMAIN", "www.google.com"),
			FallbackAddr: getenv("TELEGRAM_PROXY_FALLBACK_ADDR", "www.google.com:443"),
		},
		Subscription: SubscriptionConfig{
			URLPrefix:           getenv("SUB_URL_PREFIX", "https://panel.example.com"),
			UpdateIntervalHours: getenvInt("SUB_UPDATE_INTERVAL_HOURS", 24),
		},
		Backup: BackupConfig{
			Dir:           getenv("BACKUP_DIR", filepath.Join(rootDir, "data", "backups")),
			RetentionDays: getenvInt("BACKUP_RETENTION_DAYS", 14),
		},
		Traffic: TrafficConfig{
			RetentionDays: getenvInt("TRAFFIC_RETENTION_DAYS", 180),
		},
		Tasks: TaskConfig{
			CollectorInterval:     getenvPositiveDuration("PANEL_COLLECTOR_INTERVAL", 10*time.Second),
			EnforcerInterval:      getenvPositiveDuration("PANEL_ENFORCER_INTERVAL", 30*time.Second),
			CoreReconcileInterval: getenvPositiveDuration("PANEL_CORE_RECONCILE_INTERVAL", 60*time.Second),
			CacheRefreshInterval:  getenvPositiveDuration("PANEL_CACHE_REFRESH_INTERVAL", 5*time.Minute),
		},
	}
}

func (c Config) ValidateServe() error {
	if c.Panel.AllowInsecure {
		return nil
	}

	var issues []string
	if c.Panel.JWTSecret == "" || c.Panel.JWTSecret == "dev-secret-change-me" || len(c.Panel.JWTSecret) < 32 {
		issues = append(issues, "PANEL_JWT_SECRET must be a random value at least 32 characters long")
	}
	if c.DB.Password == "" {
		issues = append(issues, "DB_PASSWORD must not be empty")
	}
	if c.Xray.RealityPrivKey == "" || c.Xray.RealityPubKey == "" {
		issues = append(issues, "REALITY_PRIVATE_KEY and REALITY_PUBLIC_KEY must be configured")
	}
	if c.Hysteria.TrafficSecret == "" {
		issues = append(issues, "HY2_TRAFFIC_SECRET must not be empty")
	}
	if c.Hysteria.ObfsEnabled && c.Hysteria.ObfsPassword == "" {
		issues = append(issues, "HY2_OBFS_PASSWORD must not be empty when HY2_OBFS_ENABLED=true")
	}
	if len(issues) > 0 {
		return errors.New("unsafe serve configuration: " + strings.Join(issues, "; "))
	}
	return nil
}

func EnvFilePath() string {
	return firstNonEmpty(os.Getenv("PANEL_ENV_FILE"), filepath.Join("/opt/mypanel", ".env"), ".env")
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

func getenvPositiveDuration(key string, fallback time.Duration) time.Duration {
	value := getenvDuration(key, fallback)
	if value <= 0 {
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
