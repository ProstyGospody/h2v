package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

type XrayAdapter interface {
	WaitReady(ctx context.Context, timeout time.Duration) error
	Health(ctx context.Context) error
	AddUser(ctx context.Context, user *domain.User) error
	RemoveUser(ctx context.Context, username string) error
	QueryStats(ctx context.Context) (map[string]domain.TrafficDelta, error)
	ResetStats(ctx context.Context) error
}

type HysteriaAdapter interface {
	Health(ctx context.Context) error
	GetTraffic(ctx context.Context, reset bool) (map[string]domain.TrafficDelta, error)
	Kick(ctx context.Context, usernames []string) error
}

type SystemctlAdapter interface {
	Restart(ctx context.Context, service string) error
}

type Services struct {
	Auth         *AuthService
	Users        *UserService
	Subscription *SubscriptionService
	Settings     *SettingsService
	Telegram     *TelegramProxyService
	Configs      *ConfigService
	Geodata      *GeodataService
	Backup       *BackupService
	Stats        *StatsService
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
	Size() int64
}

func New(deps ServiceDeps) *Services {
	settings := NewSettingsService(deps.Config, deps.Repo, deps.Logger)
	subscription := NewSubscriptionService(deps.Repo, settings, deps.Cache)
	configs := NewConfigService(deps.Config, settings, deps.Systemctl, deps.Xray, deps.Hysteria, deps.Logger)
	telegram := NewTelegramProxyService(deps.Config, settings, deps.Systemctl)

	return &Services{
		Auth:         NewAuthService(deps.Config, deps.Repo, deps.Logger),
		Users:        NewUserService(deps.Repo, deps.Xray, deps.Hysteria, deps.Cache, subscription, configs, deps.Logger),
		Subscription: subscription,
		Settings:     settings,
		Telegram:     telegram,
		Configs:      configs,
		Geodata:      NewGeodataService(deps.Config.Xray, deps.Logger, deps.Systemctl),
		Backup:       NewBackupService(deps.Repo, settings, configs, deps.Cache),
		Stats:        NewStatsService(deps.Repo, deps.Xray, deps.Hysteria, deps.Cache, deps.Version, deps.StartedAt),
	}
}
