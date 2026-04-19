package services

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type StatsService struct {
	repo      *repo.Repository
	xray      XrayAdapter
	hysteria  HysteriaAdapter
	cache     SubscriptionCache
	version   string
	startedAt time.Time
}

func NewStatsService(repository *repo.Repository, xray XrayAdapter, hysteria HysteriaAdapter, cache SubscriptionCache, version string, startedAt time.Time) *StatsService {
	return &StatsService{
		repo:      repository,
		xray:      xray,
		hysteria:  hysteria,
		cache:     cache,
		version:   version,
		startedAt: startedAt,
	}
}

func (s *StatsService) Overview(ctx context.Context) (*domain.OverviewStats, error) {
	counts, todayTraffic, err := s.repo.GetOverviewCounts(ctx)
	if err != nil {
		return nil, err
	}
	online, err := s.repo.GetOnlineUsers(ctx)
	if err != nil {
		return nil, err
	}

	xrayStatus := "ok"
	if err := s.xray.Health(ctx); err != nil {
		xrayStatus = "fail: " + err.Error()
	}
	hyStatus := "ok"
	if err := s.hysteria.Health(ctx); err != nil {
		hyStatus = "fail: " + err.Error()
	}

	return &domain.OverviewStats{
		ActiveUsers:    counts[string(domain.StatusActive)],
		ExpiredUsers:   counts[string(domain.StatusExpired)],
		LimitedUsers:   counts[string(domain.StatusLimited)],
		DisabledUsers:  counts[string(domain.StatusDisabled)],
		TodayTraffic:   todayTraffic,
		XrayStatus:     xrayStatus,
		HysteriaStatus: hyStatus,
		OnlineUsers:    online,
	}, nil
}

func (s *StatsService) Traffic(ctx context.Context, days int) ([]domain.TrafficPoint, error) {
	return s.repo.GetAggregateTraffic(ctx, days)
}

func (s *StatsService) Online(ctx context.Context) ([]domain.OnlineUser, error) {
	return s.repo.GetOnlineUsers(ctx)
}

func (s *StatsService) Health(ctx context.Context) (*domain.HealthReport, error) {
	components := map[string]string{"db": "ok", "xray": "ok", "hysteria": "ok", "cache": "ok"}
	status := "ok"

	if err := s.repo.Ping(ctx); err != nil {
		components["db"] = "fail: " + err.Error()
		status = "degraded"
	}
	if err := s.xray.Health(ctx); err != nil {
		components["xray"] = "fail: " + err.Error()
		status = "degraded"
	}
	if err := s.hysteria.Health(ctx); err != nil {
		components["hysteria"] = "fail: " + err.Error()
		status = "degraded"
	}
	if s.cache.Size() <= 0 {
		components["cache"] = "warning: empty"
	}

	return &domain.HealthReport{
		Status:        status,
		Components:    components,
		Version:       s.version,
		UptimeSeconds: int64(time.Since(s.startedAt).Seconds()),
	}, nil
}

type AdminService struct {
	repo   *repo.Repository
	logger LoggerLike
}

type LoggerLike interface {
	Warn(msg string, args ...any)
}

func NewAdminService(repository *repo.Repository, logger LoggerLike) *AdminService {
	return &AdminService{repo: repository, logger: logger}
}

func (s *AdminService) List(ctx context.Context) ([]domain.Admin, error) {
	return s.repo.ListAdmins(ctx)
}

func (s *AdminService) Create(ctx context.Context, req CreateAdminRequest, actor AuditActor) (*domain.Admin, error) {
	if strings.TrimSpace(req.Password) == "" {
		return nil, domain.NewError(400, "invalid_admin", "Password is required", nil)
	}
	hash, err := util.HashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	admin := &domain.Admin{
		ID:           uuid.New(),
		Username:     req.Username,
		PasswordHash: hash,
		Role:         firstNonEmpty(req.Role, "admin"),
		CreatedAt:    time.Now().UTC(),
	}
	if err := s.repo.CreateAdmin(ctx, admin); err != nil {
		return nil, err
	}
	recordAudit(ctx, s.repo, actor, "admin.create", "admin", admin.ID.String(), map[string]any{"username": admin.Username})
	return admin, nil
}

func (s *AdminService) Update(ctx context.Context, id uuid.UUID, req UpdateAdminRequest, actor AuditActor) error {
	hash, err := util.HashPassword(req.Password)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateAdminPassword(ctx, id, hash, req.TOTP); err != nil {
		return err
	}
	recordAudit(ctx, s.repo, actor, "admin.update", "admin", id.String(), nil)
	return nil
}

func (s *AdminService) Delete(ctx context.Context, id uuid.UUID, actor AuditActor) error {
	total, err := s.repo.CountAdmins(ctx)
	if err != nil {
		return err
	}
	if total <= 1 {
		return domain.NewError(400, "last_admin", "Cannot delete the last admin", nil)
	}
	if err := s.repo.DeleteAdmin(ctx, id); err != nil {
		return err
	}
	recordAudit(ctx, s.repo, actor, "admin.delete", "admin", id.String(), nil)
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
