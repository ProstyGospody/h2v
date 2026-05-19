package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type UserStatus string

const (
	StatusActive   UserStatus = "active"
	StatusDisabled UserStatus = "disabled"
	StatusExpired  UserStatus = "expired"
	StatusLimited  UserStatus = "limited"
)

type User struct {
	ID           uuid.UUID  `json:"id"`
	Username     string     `json:"username"`
	VlessUUID    uuid.UUID  `json:"vless_uuid"`
	Hy2Password  string     `json:"-"`
	SubToken     string     `json:"-"`
	TrafficLimit int64      `json:"traffic_limit"`
	TrafficUsed  int64      `json:"traffic_used"`
	ExpiresAt    *time.Time `json:"expires_at"`
	Status       UserStatus `json:"status"`
	Note         string     `json:"note"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type ActiveClientEntry struct {
	Username  string
	VlessUUID uuid.UUID
}

func (u User) CanConnect() bool {
	if u.Status != StatusActive {
		return false
	}
	if u.IsExpired() {
		return false
	}
	if u.IsOverLimit() {
		return false
	}
	return true
}

func (u User) IsExpired() bool {
	return u.ExpiresAt != nil && u.ExpiresAt.Before(time.Now())
}

func (u User) IsOverLimit() bool {
	return u.TrafficLimit > 0 && u.TrafficUsed >= u.TrafficLimit
}

type Admin struct {
	ID           uuid.UUID  `json:"id"`
	Username     string     `json:"username"`
	PasswordHash string     `json:"-"`
	Role         string     `json:"role"`
	Icon         string     `json:"icon"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type AdminSession struct {
	ID               uuid.UUID
	AdminID          uuid.UUID
	RefreshTokenHash string
	CreatedAt        time.Time
	LastUsedAt       time.Time
	ExpiresAt        time.Time
	RevokedAt        *time.Time
}

type Setting struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type TrafficPoint struct {
	RecordedAt time.Time `json:"recorded_at"`
	Uplink     int64     `json:"uplink"`
	Downlink   int64     `json:"downlink"`
}

type TrafficDelta struct {
	Uplink   int64
	Downlink int64
}

type OnlineUser struct {
	Username   string    `json:"username"`
	RecordedAt time.Time `json:"recorded_at"`
	Bytes      int64     `json:"bytes"`
}

type OverviewStats struct {
	ExpiredUsers                 int64        `json:"expired_users"`
	LimitedUsers                 int64        `json:"limited_users"`
	DisabledUsers                int64        `json:"disabled_users"`
	TodayTraffic                 int64        `json:"today_traffic"`
	CPUUsagePercent              float64      `json:"cpu_usage_percent"`
	MemoryUsagePercent           float64      `json:"memory_usage_percent"`
	NetworkRxBytesPerSecond      int64        `json:"network_rx_bytes_per_second"`
	NetworkTxBytesPerSecond      int64        `json:"network_tx_bytes_per_second"`
	XrayStatus                   string       `json:"xray_status"`
	HysteriaStatus               string       `json:"hysteria_status"`
	UptimeSeconds                int64        `json:"uptime_seconds"`
	OnlineUsers                  []OnlineUser `json:"online_users"`
}

type SubscriptionLinks struct {
	Subscription string        `json:"subscription"`
	Portal       string        `json:"portal,omitempty"`
	VLESS        string        `json:"vless"`
	Hysteria2    string        `json:"hysteria2"`
	Usage        UsageSnapshot `json:"usage"`
	Username     string        `json:"username"`
}

type UsageSnapshot struct {
	TrafficLimit int64      `json:"traffic_limit"`
	TrafficUsed  int64      `json:"traffic_used"`
	ExpiresAt    *time.Time `json:"expires_at"`
	Status       UserStatus `json:"status"`
}

type HealthReport struct {
	Status        string            `json:"status"`
	Components    map[string]string `json:"components"`
	Version       string            `json:"version"`
	UptimeSeconds int64             `json:"uptime_seconds"`
}

type ServerInfo struct {
	City        string           `json:"city,omitempty"`
	Country     string           `json:"country,omitempty"`
	CountryCode string           `json:"country_code,omitempty"`
	Protocols   []ServerProtocol `json:"protocols"`
}

type ServerProtocol struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Transport string `json:"transport"`
	Port      int    `json:"port"`
	Logo      string `json:"logo"`
	Enabled   bool   `json:"enabled"`
}

type UserFilters struct {
	Page            int
	PerPage         int
	Search          string
	Status          string
	HasTrafficLimit bool
	NearExpiryDays  int
}

type Claims struct {
	AdminID  string `json:"admin_id"`
	SessionID string `json:"session_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Kind     string `json:"kind"`
}
