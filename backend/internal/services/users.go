package services

import (
	"context"
	"errors"
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
	hotErr := s.applyXrayUserChange(ctx, nil, user)
	s.setCachedUser(user)
	s.persistXrayOrReconcile(ctx, "create", user.Username, hotErr)
	return user, nil
}

func (s *UserService) Update(ctx context.Context, id uuid.UUID, req UpdateUserRequest) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	previous := *user
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

	hotErr := s.applyXrayUserChange(ctx, &previous, user)
	if user.CanConnect() {
		s.setCachedUser(user)
		if previous.CanConnect() && previous.Username != user.Username {
			s.kickHysteriaUsers(ctx, []string{previous.Username})
		}
	} else {
		s.deleteCachedUser(&previous)
		s.kickHysteriaUsers(ctx, []string{previous.Username})
	}
	s.persistXrayOrReconcile(ctx, "update", user.Username, hotErr)
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
	hotErr := s.removeXrayUser(ctx, user.Username)
	s.kickHysteriaUsers(ctx, []string{user.Username})
	s.deleteCachedUser(user)
	s.persistXrayOrReconcile(ctx, "delete", user.Username, hotErr)
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
	var hotErr error
	needsPersist := false

	switch req.Action {
	case "enable":
		users, err = s.repo.BulkUpdateUserStatus(ctx, ids, domain.StatusActive)
		if err == nil {
			hotErr = s.syncConnectableUsers(ctx, users)
		}
		needsPersist = true
	case "disable":
		users, err = s.repo.BulkUpdateUserStatus(ctx, ids, domain.StatusDisabled)
		if err == nil {
			hotErr = s.removeUsersFromCores(ctx, users)
		}
		needsPersist = true
	case "delete":
		users, err = s.repo.BulkDeleteUsers(ctx, ids)
		if err == nil {
			hotErr = s.removeUsersFromCores(ctx, users)
		}
		needsPersist = true
	case "reset_traffic":
		users, err = s.repo.BulkResetUserTraffic(ctx, ids)
		if err == nil {
			hotErr = s.syncConnectableUsers(ctx, users)
		}
		needsPersist = true
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
			hotErr = s.syncConnectableUsers(ctx, users)
		}
		needsPersist = true
	default:
		return nil, domain.NewError(400, "invalid_bulk_action", "Bulk action is not supported", nil)
	}
	if err != nil {
		return nil, err
	}
	if needsPersist {
		s.persistXrayOrReconcile(ctx, "bulk_"+req.Action, "", hotErr)
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
	s.setCachedUser(user)
	return user, nil
}

func (s *UserService) ResetTraffic(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	user, err := s.repo.GetUserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	previous := *user
	user.TrafficUsed = 0
	user.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}
	hotErr := s.applyXrayUserChange(ctx, &previous, user)
	if user.CanConnect() {
		s.setCachedUser(user)
	} else {
		s.deleteCachedUser(&previous)
	}
	s.persistXrayOrReconcile(ctx, "reset_traffic", user.Username, hotErr)
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

func (s *UserService) syncConnectableUsers(ctx context.Context, users []domain.User) error {
	var err error
	for i := range users {
		user := &users[i]
		if user.CanConnect() {
			err = errors.Join(err, s.addXrayUser(ctx, user))
			s.setCachedUser(user)
			continue
		}
		err = errors.Join(err, s.removeXrayUser(ctx, user.Username))
		s.deleteCachedUser(user)
	}
	return err
}

func (s *UserService) removeUsersFromCores(ctx context.Context, users []domain.User) error {
	usernames := make([]string, 0, len(users))
	var err error
	for i := range users {
		user := &users[i]
		err = errors.Join(err, s.removeXrayUser(ctx, user.Username))
		s.deleteCachedUser(user)
		usernames = append(usernames, user.Username)
	}
	if len(usernames) > 0 {
		s.kickHysteriaUsers(ctx, usernames)
	}
	return err
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
		if s.logger != nil {
			s.logger.Error("xray reconcile failed after user change", "op", op, "user", username, "err", err)
		}
	}
}

func (s *UserService) persistXrayOrReconcile(_ context.Context, op, username string, hotErr error) {
	if s.configs == nil {
		return
	}
	if hotErr != nil {
		s.logWarn("xray hot user update failed; falling back to config reconcile", "op", op, "user", username, "err", hotErr)
		s.reconcileXray(context.Background(), op, username)
		return
	}

	persistCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := s.configs.PersistXray(persistCtx); err != nil {
		s.logWarn("xray config persist failed after hot update; falling back to config reconcile", "op", op, "user", username, "err", err)
		s.reconcileXray(context.Background(), op, username)
	}
}

func (s *UserService) applyXrayUserChange(ctx context.Context, previous, next *domain.User) error {
	previousCanConnect := previous != nil && previous.CanConnect()
	nextCanConnect := next != nil && next.CanConnect()

	switch {
	case !previousCanConnect && nextCanConnect:
		return s.addXrayUser(ctx, next)
	case previousCanConnect && !nextCanConnect:
		return s.removeXrayUser(ctx, previous.Username)
	case previousCanConnect && nextCanConnect:
		if previous.Username != next.Username || previous.VlessUUID != next.VlessUUID {
			return errors.Join(
				s.removeXrayUser(ctx, previous.Username),
				s.addXrayUser(ctx, next),
			)
		}
	}
	return nil
}

func (s *UserService) addXrayUser(ctx context.Context, user *domain.User) error {
	if s.xray == nil {
		return nil
	}
	return s.xray.AddUser(ctx, user)
}

func (s *UserService) removeXrayUser(ctx context.Context, username string) error {
	if s.xray == nil {
		return nil
	}
	return s.xray.RemoveUser(ctx, username)
}

func (s *UserService) setCachedUser(user *domain.User) {
	if s.cache != nil {
		s.cache.Set(user)
	}
}

func (s *UserService) deleteCachedUser(user *domain.User) {
	if s.cache != nil {
		s.cache.Delete(user)
	}
}

func (s *UserService) kickHysteriaUsers(ctx context.Context, usernames []string) {
	if s.hysteria != nil {
		_ = s.hysteria.Kick(ctx, usernames)
	}
}

func (s *UserService) logWarn(message string, args ...any) {
	if s.logger != nil {
		s.logger.Warn(message, args...)
	}
}
