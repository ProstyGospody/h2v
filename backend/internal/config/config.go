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
	H2V          H2VConfig
	DB           DBConfig
	Xray         XrayConfig
	Hysteria     HysteriaConfig
	Subscription SubscriptionConfig
	Backup       BackupConfig
	Traffic      TrafficConfig
	Tasks        TaskConfig
}

type H2VConfig struct {
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

	rootDir := getenv("H2V_ROOT_DIR", ".")
	templatesDir := getenv("H2V_TEMPLATES_DIR", filepath.Join(rootDir, "templates"))
	frontendDir := getenv("H2V_FRONTEND_DIR", filepath.Join(rootDir, "frontend"))

	return Config{
		H2V: H2VConfig{
			Domain:           getenv("H2V_DOMAIN", "h2v.example.com"),
			PublicIP:         getenv("PUBLIC_SERVER_IP", ""),
			Host:             getenv("H2V_HOST", "127.0.0.1"),
			Port:             getenvInt("H2V_PORT", 8000),
			PublicPort:       getenvInt("H2V_PUBLIC_PORT", 443),
			JWTSecret:        getenv("H2V_JWT_SECRET", "dev-secret-change-me"),
			JWTAccessTTL:     getenvDuration("H2V_JWT_ACCESS_TTL", 15*time.Minute),
			JWTRefreshTTL:    getenvDuration("H2V_JWT_REFRESH_TTL", 720*time.Hour),
			RootDir:          rootDir,
			FrontendDir:      frontendDir,
			TemplatesDir:     templatesDir,
			DisableSystemctl: getenvBool("H2V_DISABLE_SYSTEMCTL", false),
			AllowInsecure:    getenvBool("H2V_ALLOW_INSECURE_DEFAULTS", false),
		},
		DB: DBConfig{
			Host:     getenv("DB_HOST", "127.0.0.1"),
			Port:     getenvInt("DB_PORT", 5432),
			Name:     getenv("DB_NAME", "h2v"),
			User:     getenv("DB_USER", "h2v"),
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
			RealityShortIDs:      splitCSV(getenv("REALITY_SHORT_IDS", "")),
			RealityFingerprint:   getenv("REALITY_FINGERPRINT", "chrome"),
			SniffingEnabled:      getenvBool("XRAY_SNIFFING_ENABLED", true),
			SniffingDestOverride: splitCSV(getenv("XRAY_SNIFFING_DEST_OVERRIDE", "http,tls")),
		},
		Hysteria: HysteriaConfig{
			ConfigPath:    getenv("HY2_CONFIG_PATH", filepath.Join(rootDir, "configs", "hysteria", "config.json")),
			TrafficURL:    getenv("HY2_TRAFFIC_URL", "http://127.0.0.1:7653"),
			TrafficSecret: getenv("HY2_TRAFFIC_SECRET", ""),
			Domain:        getenv("HY2_DOMAIN", getenv("H2V_DOMAIN", "h2v.example.com")),
			Port:          getenvInt("HY2_PORT", 8443),
			ObfsEnabled:   getenvBool("HY2_OBFS_ENABLED", true),
			ObfsPassword:  getenv("HY2_OBFS_PASSWORD", ""),
			BandwidthUp:   getenv("HY2_BANDWIDTH_UP", "1 gbps"),
			BandwidthDown: getenv("HY2_BANDWIDTH_DOWN", "1 gbps"),
			MasqueradeURL: getenv("HY2_MASQUERADE_URL", "https://www.google.com"),
			CertPath:      getenv("HY2_CERT_PATH", ""),
			KeyPath:       getenv("HY2_KEY_PATH", ""),
		},
		Subscription: SubscriptionConfig{
			URLPrefix:           getenv("SUB_URL_PREFIX", "https://h2v.example.com"),
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
			CollectorInterval:     getenvPositiveDuration("H2V_COLLECTOR_INTERVAL", 10*time.Second),
			EnforcerInterval:      getenvPositiveDuration("H2V_ENFORCER_INTERVAL", 30*time.Second),
			CoreReconcileInterval: getenvPositiveDuration("H2V_CORE_RECONCILE_INTERVAL", 60*time.Second),
			CacheRefreshInterval:  getenvPositiveDuration("H2V_CACHE_REFRESH_INTERVAL", 5*time.Minute),
		},
	}
}

func (c Config) ValidateServe() error {
	if c.H2V.AllowInsecure {
		return nil
	}

	var issues []string
	if c.H2V.JWTSecret == "" || c.H2V.JWTSecret == "dev-secret-change-me" || len(c.H2V.JWTSecret) < 32 {
		issues = append(issues, "H2V_JWT_SECRET must be a random value at least 32 characters long")
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
	return firstNonEmpty(os.Getenv("H2V_ENV_FILE"), filepath.Join("/opt/h2v", ".env"), ".env")
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
