package services

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

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
	return s.issueTokens(*admin)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthTokens, error) {
	claims, err := s.parse(refreshToken, "refresh")
	if err != nil {
		return nil, err
	}
	adminID, err := uuid.Parse(claims.AdminID)
	if err != nil {
		return nil, domain.NewError(401, "invalid_token", "Invalid token", err)
	}
	admin, err := s.repo.GetAdminByID(ctx, adminID)
	if err != nil {
		return nil, err
	}
	return s.issueTokens(*admin)
}

func (s *AuthService) ParseAccess(token string) (*domain.Claims, error) {
	claims, err := s.parse(token, "access")
	if err != nil {
		return nil, err
	}
	return &claims.Claims, nil
}

func (s *AuthService) issueTokens(admin domain.Admin) (*AuthTokens, error) {
	accessToken, err := s.sign(admin, "access", s.cfg.Panel.JWTAccessTTL)
	if err != nil {
		return nil, err
	}
	refreshToken, err := s.sign(admin, "refresh", s.cfg.Panel.JWTRefreshTTL)
	if err != nil {
		return nil, err
	}
	return &AuthTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    s.cfg.Panel.JWTAccessTTL,
		Admin:        admin,
	}, nil
}

func (s *AuthService) sign(admin domain.Admin, kind string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := tokenClaims{
		Claims: domain.Claims{
			AdminID:  admin.ID.String(),
			Username: admin.Username,
			Role:     admin.Role,
			Kind:     kind,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   admin.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.Panel.JWTSecret))
}

func (s *AuthService) parse(tokenString, expectedKind string) (*tokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &tokenClaims{}, func(token *jwt.Token) (any, error) {
		return []byte(s.cfg.Panel.JWTSecret), nil
	})
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
	return claims, nil
}
