package services

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

var adminUsernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)

var adminIcons = map[string]struct{}{
	"astronaut": {},
	"bolt":      {},
	"crown":     {},
	"dino":      {},
	"flame":     {},
	"gem":       {},
	"planet":    {},
	"robot":     {},
	"rocket":    {},
	"shield":    {},
	"star":      {},
}

type AuthService struct {
	cfg    config.Config
	repo   *repo.Repository
	logger *slog.Logger
}

type AuthTokens struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresIn    time.Duration `json:"expires_in"`
	Admin        domain.Admin  `json:"admin"`
}

type UpdateAdminProfileRequest struct {
	Username string
	Password string
	Icon     string
}

type tokenClaims struct {
	domain.Claims
	jwt.RegisteredClaims
}

func NewAuthService(cfg config.Config, repository *repo.Repository, logger *slog.Logger) *AuthService {
	return &AuthService{cfg: cfg, repo: repository, logger: logger}
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*AuthTokens, error) {
	admin, err := s.repo.GetAdminByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if !util.VerifyPassword(admin.PasswordHash, password) {
		return nil, domain.NewError(401, "invalid_credentials", "Invalid username or password", nil)
	}
	if err := s.repo.TouchAdminLogin(ctx, admin.ID); err != nil {
		s.logger.Warn("touch admin login failed", "admin", admin.ID, "err", err)
	}
	return s.issueTokens(ctx, *admin)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthTokens, error) {
	claims, err := s.parse(refreshToken, "refresh")
	if err != nil {
		return nil, err
	}
	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	adminID, err := uuid.Parse(claims.AdminID)
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	session, err := s.repo.GetAdminSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if !validSession(session, adminID) || !sameTokenHash(session.RefreshTokenHash, refreshToken) {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", nil)
	}
	admin, err := s.repo.GetAdminByID(ctx, adminID)
	if err != nil {
		return nil, err
	}
	return s.rotateTokens(ctx, *admin, sessionID)
}

func (s *AuthService) CurrentAdmin(ctx context.Context, adminID uuid.UUID) (*domain.Admin, error) {
	return s.repo.GetAdminByID(ctx, adminID)
}

func (s *AuthService) UpdateProfile(ctx context.Context, adminID uuid.UUID, req UpdateAdminProfileRequest) (*AuthTokens, error) {
	admin, err := s.repo.GetAdminByID(ctx, adminID)
	if err != nil {
		return nil, err
	}

	username := strings.TrimSpace(req.Username)
	if username == "" {
		username = admin.Username
	}
	if !adminUsernamePattern.MatchString(username) {
		return nil, domain.NewError(400, "invalid_admin_username", "Username must be 3-32 characters and contain only letters, numbers, underscores, or hyphens", nil)
	}

	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = admin.Icon
	}
	if icon == "" {
		icon = "robot"
	}
	if _, ok := adminIcons[icon]; !ok {
		return nil, domain.NewError(400, "invalid_admin_icon", "Unknown profile icon", nil)
	}

	var passwordHash *string
	password := req.Password
	if password != "" {
		if len(password) < 8 {
			return nil, domain.NewError(400, "invalid_admin_password", "Password must be at least 8 characters", nil)
		}
		hash, err := util.HashPassword(password)
		if err != nil {
			return nil, err
		}
		passwordHash = &hash
	}

	updated, err := s.repo.UpdateAdminProfile(ctx, adminID, username, icon, passwordHash)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RevokeAdminSessions(ctx, adminID); err != nil {
		return nil, err
	}
	return s.issueTokens(ctx, *updated)
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	claims, err := s.parse(refreshToken, "refresh")
	if err != nil {
		return nil
	}
	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return nil
	}
	return s.repo.RevokeAdminSession(ctx, sessionID)
}

func (s *AuthService) ParseAccess(ctx context.Context, token string) (*domain.Claims, error) {
	claims, err := s.parse(token, "access")
	if err != nil {
		return nil, err
	}
	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	adminID, err := uuid.Parse(claims.AdminID)
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	session, err := s.repo.GetAdminSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if !validSession(session, adminID) {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", nil)
	}
	return &claims.Claims, nil
}

func (s *AuthService) issueTokens(ctx context.Context, admin domain.Admin) (*AuthTokens, error) {
	sessionID := uuid.New()
	tokens, session, err := s.tokensForSession(admin, sessionID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateAdminSession(ctx, session); err != nil {
		return nil, err
	}
	return tokens, nil
}

func (s *AuthService) rotateTokens(ctx context.Context, admin domain.Admin, previousSessionID uuid.UUID) (*AuthTokens, error) {
	sessionID := uuid.New()
	tokens, session, err := s.tokensForSession(admin, sessionID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RotateAdminSession(ctx, previousSessionID, session); err != nil {
		return nil, err
	}
	return tokens, nil
}

func (s *AuthService) tokensForSession(admin domain.Admin, sessionID uuid.UUID) (*AuthTokens, *domain.AdminSession, error) {
	now := time.Now()
	accessToken, err := s.sign(admin, "access", sessionID, s.cfg.H2V.JWTAccessTTL, now)
	if err != nil {
		return nil, nil, err
	}
	refreshToken, err := s.sign(admin, "refresh", sessionID, s.cfg.H2V.JWTRefreshTTL, now)
	if err != nil {
		return nil, nil, err
	}
	session := &domain.AdminSession{
		ID:               sessionID,
		AdminID:          admin.ID,
		RefreshTokenHash: tokenHash(refreshToken),
		CreatedAt:        now,
		LastUsedAt:       now,
		ExpiresAt:        now.Add(s.cfg.H2V.JWTRefreshTTL),
	}
	return &AuthTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    s.cfg.H2V.JWTAccessTTL,
		Admin:        admin,
	}, session, nil
}

func (s *AuthService) sign(admin domain.Admin, kind string, sessionID uuid.UUID, ttl time.Duration, now time.Time) (string, error) {
	claims := tokenClaims{
		Claims: domain.Claims{
			AdminID:   admin.ID.String(),
			SessionID: sessionID.String(),
			Username:  admin.Username,
			Role:      admin.Role,
			Kind:      kind,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   admin.ID.String(),
			ID:        sessionID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.H2V.JWTSecret))
}

func (s *AuthService) parse(tokenString, expectedKind string) (*tokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &tokenClaims{}, func(token *jwt.Token) (any, error) {
		return []byte(s.cfg.H2V.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	claims, ok := token.Claims.(*tokenClaims)
	if !ok || !token.Valid {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", errors.New("invalid claims"))
	}
	if claims.Kind != expectedKind {
		return nil, domain.NewError(401, "invalid_token", "Invalid token type", nil)
	}
	if claims.SessionID == "" {
		claims.SessionID = claims.ID
	}
	if claims.SessionID == "" {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", errors.New("missing session id"))
	}
	return claims, nil
}

func validSession(session *domain.AdminSession, adminID uuid.UUID) bool {
	return session != nil &&
		session.AdminID == adminID &&
		session.RevokedAt == nil &&
		session.ExpiresAt.After(time.Now())
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func sameTokenHash(hash, token string) bool {
	return subtle.ConstantTimeCompare([]byte(hash), []byte(tokenHash(token))) == 1
}
