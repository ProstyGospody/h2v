package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

type XrayAdapter interface {
	WaitReady(ctx context.Context, timeout time.Duration) error
	Health(ctx context.Context) error
	AddUser(ctx context.Context, user *domain.User) error
	RemoveUser(ctx context.Context, username string) error
	ListUsers(ctx context.Context) ([]string, error)
	QueryStats(ctx context.Context) (map[string]domain.TrafficDelta, error)
}

type HysteriaAdapter interface {
	Health(ctx context.Context) error
	GetTraffic(ctx context.Context, reset bool) (map[string]domain.TrafficDelta, error)
	Kick(ctx context.Context, usernames []string) error
}

type SystemctlAdapter interface {
	Restart(ctx context.Context, service string) error
	Reload(ctx context.Context, service string) error
}

type Services struct {
	Auth         *AuthService
	Users        *UserService
	Subscription *SubscriptionService
	Settings     *SettingsService
	Configs      *ConfigService
	Stats        *StatsService
	Admins       *AdminService
	Audit        *AuditService
}

type CreateUserRequest struct {
	Username     string
	TrafficLimit int64
	ExpiresAt    *time.Time
	Note         string
}

type UpdateUserRequest struct {
	Username     *string
	TrafficLimit *int64
	TrafficUsed  *int64
	ExpiresAt    *time.Time
	Status       *domain.UserStatus
	Note         *string
}

type CreateAdminRequest struct {
	Username string
	Password string
	Role     string
}

type UpdateAdminRequest struct {
	Password string
	TOTP     *string
}

type AuditActor struct {
	AdminID   *uuid.UUID
	IP        string
	UserAgent string
}

func recordAudit(ctx context.Context, repository *repo.Repository, actor AuditActor, action, targetType, targetID string, metadata any) {
	if repository == nil {
		return
	}
	var raw []byte
	if metadata == nil {
		raw = []byte("{}")
	} else {
		encoded, err := jsonMarshal(metadata)
		if err == nil {
			raw = encoded
		} else {
			raw = []byte("{}")
		}
	}
	_ = repository.AddAudit(ctx, domain.AuditEntry{
		AdminID:    actor.AdminID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Metadata:   raw,
		IP:         actor.IP,
		UserAgent:  actor.UserAgent,
	})
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

type ServiceDeps struct {
	Config    config.Config
	Repo      *repo.Repository
	Xray      XrayAdapter
	Hysteria  HysteriaAdapter
	Systemctl SystemctlAdapter
	Cache     SubscriptionCache
	Logger    *slog.Logger
	Version   string
	StartedAt time.Time
}

type SubscriptionCache interface {
	LoadAll(ctx context.Context) error
	Refresh(ctx context.Context) error
	Set(user *domain.User)
	Delete(user *domain.User)
	GetByPassword(password string) (*domain.User, bool)
	GetByToken(token string) (*domain.User, bool)
	Size() int64
}

func New(deps ServiceDeps) *Services {
	settings := NewSettingsService(deps.Config, deps.Repo, deps.Logger)
	subscription := NewSubscriptionService(deps.Config, deps.Repo, settings, deps.Cache)

	return &Services{
		Auth:         NewAuthService(deps.Config, deps.Repo, deps.Logger),
		Users:        NewUserService(deps.Config, deps.Repo, deps.Xray, deps.Hysteria, deps.Cache, subscription, deps.Logger),
		Subscription: subscription,
		Settings:     settings,
		Configs:      NewConfigService(deps.Config, deps.Repo, settings, deps.Systemctl, deps.Xray, deps.Hysteria, deps.Logger),
		Stats:        NewStatsService(deps.Repo, deps.Xray, deps.Hysteria, deps.Cache, deps.Version, deps.StartedAt),
		Admins:       NewAdminService(deps.Repo, deps.Logger),
		Audit:        NewAuditService(deps.Repo),
	}
}
