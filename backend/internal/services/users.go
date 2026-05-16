package services

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type UserService struct {
	repo         *repo.Repository
	xray         XrayAdapter
	hysteria     HysteriaAdapter
	cache        SubscriptionCache
	subscription *SubscriptionService
	configs      *ConfigService
	logger       *slog.Logger
}

type BulkUsersRequest struct {
	Action string
	IDs    []uuid.UUID
	Days   int
}

type BulkUsersResult struct {
	Action  string `json:"action"`
	Matched int    `json:"matched"`
}

const maxUserNoteBytes = 1000

var userUsernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)

func NewUserService(repository *repo.Repository, xray XrayAdapter, hysteria HysteriaAdapter, cache SubscriptionCache, subscription *SubscriptionService, configs *ConfigService, logger *slog.Logger) *UserService {
	return &UserService{
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

func (s *UserService) Create(ctx context.Context, req CreateUserRequest) (*domain.User, error) {
	username := strings.TrimSpace(req.Username)
	if username == "" {
		suffix, err := util.RandomToken(4)
		if err != nil {
			return nil, err
		}
		username = "user_" + suffix[:6]
	}
	if err := validateUserFields(username, req.TrafficLimit, 0, domain.StatusActive, req.Note); err != nil {
		return nil, err
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

func (s *UserService) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Username != nil {
		user.Username = strings.TrimSpace(*req.Username)
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
	if err := validateUserFields(user.Username, user.TrafficLimit, user.TrafficUsed, user.Status, user.Note); err != nil {
		return nil, err
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

func (s *UserService) Delete(ctx context.Context, id uuid.UUID) error {
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

func (s *UserService) Bulk(ctx context.Context, req BulkUsersRequest) (*BulkUsersResult, error) {
	ids := dedupeUUIDs(req.IDs)
	if len(ids) == 0 {
		return nil, domain.NewError(400, "empty_selection", "Select at least one user", nil)
	}
	if len(ids) > 500 {
		return nil, domain.NewError(400, "too_many_users", "Select 500 users or fewer", nil)
	}

	var users []domain.User
	var err error
	needsReconcile := false

	switch req.Action {
	case "enable":
		users, err = s.repo.BulkUpdateUserStatus(ctx, ids, domain.StatusActive)
		if err == nil {
			s.syncConnectableUsers(ctx, users)
		}
		needsReconcile = true
	case "disable":
		users, err = s.repo.BulkUpdateUserStatus(ctx, ids, domain.StatusDisabled)
		if err == nil {
			s.removeUsersFromCores(ctx, users)
		}
		needsReconcile = true
	case "delete":
		users, err = s.repo.BulkDeleteUsers(ctx, ids)
		if err == nil {
			s.removeUsersFromCores(ctx, users)
		}
		needsReconcile = true
	case "reset_traffic":
		users, err = s.repo.BulkResetUserTraffic(ctx, ids)
		if err == nil {
			s.syncConnectableUsers(ctx, users)
		}
		needsReconcile = true
	case "extend":
		days := req.Days
		if days <= 0 {
			days = 30
		}
		if days > 3650 {
			return nil, domain.NewError(400, "invalid_days", "Extension must be 3650 days or fewer", nil)
		}
		users, err = s.repo.BulkExtendUsers(ctx, ids, days)
		if err == nil {
			s.syncConnectableUsers(ctx, users)
		}
		needsReconcile = true
	default:
		return nil, domain.NewError(400, "invalid_bulk_action", "Bulk action is not supported", nil)
	}
	if err != nil {
		return nil, err
	}
	if needsReconcile {
		s.reconcileXray(ctx, "bulk_"+req.Action, "")
	}
	return &BulkUsersResult{Action: req.Action, Matched: len(users)}, nil
}

func (s *UserService) ResetSubscription(ctx context.Context, id uuid.UUID) (*domain.User, error) {
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

func (s *UserService) ResetTraffic(ctx context.Context, id uuid.UUID) (*domain.User, error) {
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

func (s *UserService) syncConnectableUsers(ctx context.Context, users []domain.User) {
	for i := range users {
		user := &users[i]
		if user.CanConnect() {
			_ = s.xray.AddUser(ctx, user)
			s.cache.Set(user)
			continue
		}
		_ = s.xray.RemoveUser(ctx, user.Username)
		s.cache.Delete(user)
	}
}

func (s *UserService) removeUsersFromCores(ctx context.Context, users []domain.User) {
	usernames := make([]string, 0, len(users))
	for i := range users {
		user := &users[i]
		_ = s.xray.RemoveUser(ctx, user.Username)
		s.cache.Delete(user)
		usernames = append(usernames, user.Username)
	}
	if len(usernames) > 0 {
		_ = s.hysteria.Kick(ctx, usernames)
	}
}

func dedupeUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func validateUserFields(username string, trafficLimit, trafficUsed int64, status domain.UserStatus, note string) error {
	if !validUsername(username) {
		return domain.NewError(400, "invalid_user", "Username must be 3-32 characters and contain only letters, numbers, underscores, or hyphens", nil)
	}
	if trafficLimit < 0 {
		return domain.NewError(400, "invalid_user", "Traffic limit cannot be negative", nil)
	}
	if trafficUsed < 0 {
		return domain.NewError(400, "invalid_user", "Traffic used cannot be negative", nil)
	}
	if !validUserStatus(status) {
		return domain.NewError(400, "invalid_user", "User status is not supported", nil)
	}
	if len(note) > maxUserNoteBytes {
		return domain.NewError(400, "invalid_user", "User note is too long", nil)
	}
	return nil
}

func validUsername(username string) bool {
	return userUsernamePattern.MatchString(username)
}

func validUserStatus(status domain.UserStatus) bool {
	switch status {
	case domain.StatusActive, domain.StatusDisabled, domain.StatusExpired, domain.StatusLimited:
		return true
	default:
		return false
	}
}

func (s *UserService) reconcileXray(_ context.Context, op, username string) {
	if s.configs == nil {
		return
	}
	reconcileCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := s.configs.ReconcileXray(reconcileCtx); err != nil {
		s.logger.Error("xray reconcile failed after user change", "op", op, "user", username, "err", err)
	}
}
