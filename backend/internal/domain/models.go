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
	TOTPSecret   *string    `json:"totp_secret,omitempty"`
	Role         string     `json:"role"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type Setting struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type ConfigHistory struct {
	ID        int64      `json:"id"`
	Core      string     `json:"core"`
	Content   string     `json:"content"`
	AppliedBy *uuid.UUID `json:"applied_by,omitempty"`
	AppliedAt time.Time  `json:"applied_at"`
	Note      string     `json:"note"`
}

type AuditEntry struct {
	ID         int64           `json:"id"`
	AdminID    *uuid.UUID      `json:"admin_id,omitempty"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Metadata   json.RawMessage `json:"metadata"`
	IP         string          `json:"ip"`
	UserAgent  string          `json:"user_agent"`
	CreatedAt  time.Time       `json:"created_at"`
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
	ActiveUsers    int64        `json:"active_users"`
	ExpiredUsers   int64        `json:"expired_users"`
	LimitedUsers   int64        `json:"limited_users"`
	DisabledUsers  int64        `json:"disabled_users"`
	TodayTraffic   int64        `json:"today_traffic"`
	XrayStatus     string       `json:"xray_status"`
	HysteriaStatus string       `json:"hysteria_status"`
	OnlineUsers    []OnlineUser `json:"online_users"`
}

type SubscriptionLinks struct {
	Subscription string        `json:"subscription"`
	VLESS        string        `json:"vless"`
	Hysteria2    string        `json:"hysteria2"`
	QR           QRCollection  `json:"qr"`
	Usage        UsageSnapshot `json:"usage"`
	Username     string        `json:"username"`
}

type QRCollection struct {
	Subscription string `json:"subscription"`
	VLESS        string `json:"vless"`
	Hysteria2    string `json:"hysteria2"`
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
	Username string `json:"username"`
	Role     string `json:"role"`
	Kind     string `json:"kind"`
}

