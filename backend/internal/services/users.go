package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type UserService struct {
	cfg          config.Config
	repo         *repo.Repository
	xray         XrayAdapter
	hysteria     HysteriaAdapter
	cache        SubscriptionCache
	subscription *SubscriptionService
	configs      *ConfigService
	logger       *slog.Logger
}

func NewUserService(cfg config.Config, repository *repo.Repository, xray XrayAdapter, hysteria HysteriaAdapter, cache SubscriptionCache, subscription *SubscriptionService, configs *ConfigService, logger *slog.Logger) *UserService {
	return &UserService{
		cfg:          cfg,
		repo:         repository,
		xray:         xray,
		hysteria:     hysteria,
		cache:        cache,
		subscription: subscription,
		configs:      configs,
		logger:       logger,
	}
}

func (s *UserService) List(ctx context.Context, filters domain.UserFilters) ([]domain.User, int, error) {
	return s.repo.ListUsers(ctx, filters)
}

func (s *UserService) Get(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return s.repo.GetUserByID(ctx, id)
}

func (s *UserService) Create(ctx context.Context, req CreateUserRequest, _ Actor) (*domain.User, error) {
	username := req.Username
	if username == "" {
		suffix, err := util.RandomToken(4)
		if err != nil {
			return nil, err
		}
		username = "user_" + suffix[:6]
	}

	hy2Password, err := util.RandomToken(24)
	if err != nil {
		return nil, err
	}
	subToken, err := util.RandomToken(32)
	if err != nil {
		return nil, err
	}

	user := &domain.User{
		ID:           uuid.New(),
		Username:     username,
		VlessUUID:    uuid.New(),
		Hy2Password:  hy2Password,
		SubToken:     subToken,
		TrafficLimit: req.TrafficLimit,
		TrafficUsed:  0,
		ExpiresAt:    req.ExpiresAt,
		Status:       domain.StatusActive,
		Note:         req.Note,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		return nil, err
	}
	_ = s.xray.AddUser(ctx, user)
	s.cache.Set(user)
	s.reconcileXray(ctx, "create", user.Username)
	return user, nil
}

func (s *UserService) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest, _ Actor) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Username != nil {
		user.Username = *req.Username
	}
	if req.TrafficLimit != nil {
		user.TrafficLimit = *req.TrafficLimit
	}
	if req.TrafficUsed != nil {
		user.TrafficUsed = *req.TrafficUsed
	}
	if req.ExpiresAt != nil {
		user.ExpiresAt = req.ExpiresAt
	}
	if req.Status != nil {
		user.Status = *req.Status
	}
	if req.Note != nil {
		user.Note = *req.Note
	}
	user.UpdatedAt = time.Now().UTC()

	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}

	if user.CanConnect() {
		_ = s.xray.AddUser(ctx, user)
		s.cache.Set(user)
	} else {
		_ = s.xray.RemoveUser(ctx, user.Username)
		_ = s.hysteria.Kick(ctx, []string{user.Username})
		s.cache.Delete(user)
	}
	s.reconcileXray(ctx, "update", user.Username)
	return user, nil
}

func (s *UserService) Delete(ctx context.Context, id uuid.UUID, _ Actor) error {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteUser(ctx, id); err != nil {
		return err
	}
	_ = s.xray.RemoveUser(ctx, user.Username)
	_ = s.hysteria.Kick(ctx, []string{user.Username})
	s.cache.Delete(user)
	s.reconcileXray(ctx, "delete", user.Username)
	return nil
}

func (s *UserService) ResetSubscription(ctx context.Context, id uuid.UUID, _ Actor) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	token, err := util.RandomToken(32)
	if err != nil {
		return nil, err
	}
	user.SubToken = token
	user.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}
	s.cache.Set(user)
	return user, nil
}

func (s *UserService) ResetTraffic(ctx context.Context, id uuid.UUID, _ Actor) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	user.TrafficUsed = 0
	user.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *UserService) Traffic(ctx context.Context, id uuid.UUID, days int) ([]domain.TrafficPoint, error) {
	return s.repo.GetUserTraffic(ctx, id, days)
}

func (s *UserService) Links(ctx context.Context, id uuid.UUID) (*domain.SubscriptionLinks, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.subscription.LinksForUser(ctx, user)
}

// reconcileXray regenerates xray/config.json from the current DB state and
// restarts the kernel. Failures are logged but do not fail the user operation
// — the DB is the source of truth and a later scheduled reconcile will retry.
func (s *UserService) reconcileXray(ctx context.Context, op, username string) {
	if s.configs == nil {
		return
	}
	if err := s.configs.ReconcileXray(ctx); err != nil {
		s.logger.Error("xray reconcile failed after user change", "op", op, "user", username, "err", err)
	}
}
