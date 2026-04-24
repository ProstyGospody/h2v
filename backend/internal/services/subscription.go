package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/util"
)

type SubscriptionService struct {
	cfg      config.Config
	repo     *repo.Repository
	settings *SettingsService
	cache    SubscriptionCache
}

func NewSubscriptionService(cfg config.Config, repository *repo.Repository, settings *SettingsService, cache SubscriptionCache) *SubscriptionService {
	return &SubscriptionService{cfg: cfg, repo: repository, settings: settings, cache: cache}
}

func (s *SubscriptionService) GetByToken(ctx context.Context, token string) (*domain.User, error) {
	return s.repo.GetUserByToken(ctx, token)
}

func (s *SubscriptionService) LinksForUser(ctx context.Context, user *domain.User) (*domain.SubscriptionLinks, error) {
	runtime, err := s.settings.Runtime(ctx)
	if err != nil {
		return nil, err
	}

	vless := buildVLESS(runtime, user)
	hy2 := buildHysteria2(runtime, user)
	subURL := strings.TrimSuffix(runtime.SubURLPrefix, "/") + "/sub/" + user.SubToken

	return &domain.SubscriptionLinks{
		Subscription: subURL,
		VLESS:        vless,
		Hysteria2:    hy2,
		Usage: domain.UsageSnapshot{
			TrafficLimit: user.TrafficLimit,
			TrafficUsed:  user.TrafficUsed,
			ExpiresAt:    user.ExpiresAt,
			Status:       user.Status,
		},
		Username: user.Username,
	}, nil
}

func (s *SubscriptionService) RotateByToken(ctx context.Context, token string) (*domain.SubscriptionLinks, error) {
	user, err := s.repo.GetUserByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	next, err := util.RandomToken(32)
	if err != nil {
		return nil, err
	}
	user.SubToken = next
	user.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}
	s.cache.Set(user)
	return s.LinksForUser(ctx, user)
}

func (s *SubscriptionService) CheckPasswordCached(password string) (*domain.User, bool) {
	return s.cache.GetByPassword(password)
}

func (s *SubscriptionService) ResolveByToken(ctx context.Context, token string) (*domain.User, *domain.SubscriptionLinks, error) {
	user, err := s.repo.GetUserByToken(ctx, token)
	if err != nil {
		return nil, nil, err
	}
	links, err := s.LinksForUser(ctx, user)
	if err != nil {
		return nil, nil, err
	}
	return user, links, nil
}

func EncodedLinks(links *domain.SubscriptionLinks) string {
	return base64.StdEncoding.EncodeToString([]byte(links.VLESS + "\n" + links.Hysteria2))
}

func (s *SubscriptionService) BuildClashYAML(links *domain.SubscriptionLinks) string {
	return fmt.Sprintf("proxies:\n  - name: %q\n    type: vless\n    url: %q\n  - name: %q\n    type: hysteria2\n    url: %q\n", links.Username+"-vless", links.VLESS, links.Username+"-hy2", links.Hysteria2)
}

func (s *SubscriptionService) BuildSingBoxJSON(links *domain.SubscriptionLinks) ([]byte, error) {
	payload := map[string]any{
		"links": map[string]string{
			"subscription": links.Subscription,
			"vless":        links.VLESS,
			"hysteria2":    links.Hysteria2,
		},
		"usage": links.Usage,
	}
	return json.Marshal(payload)
}

func (s *SubscriptionService) BuildUserInfoHeader(user *domain.User) string {
	return util.FormatSubscriptionUserInfo(user.TrafficUsed, user.TrafficLimit, user.ExpiresAt)
}

type RuntimeSettings struct {
	PanelDomain       string
	PanelPort         int
	SubURLPrefix      string
	RealitySNI        string
	RealityDest       string
	RealityPublicKey  string
	RealityPrivateKey string
	RealityShortIDs   []string
	VlessPort         int
	Hy2Domain         string
	Hy2Port           int
	Hy2ObfsEnabled    bool
	Hy2ObfsPassword   string
	Hy2BandwidthUp    string
	Hy2BandwidthDown  string
	Hy2MasqueradeURL  string
	Hy2TrafficSecret  string
	Hy2CertPath       string
	Hy2KeyPath        string
}

func buildVLESS(runtime RuntimeSettings, user *domain.User) string {
	shortID := ""
	for _, candidate := range runtime.RealityShortIDs {
		if candidate != "" {
			shortID = candidate
			break
		}
	}
	query := url.Values{}
	query.Set("type", "tcp")
	query.Set("security", "reality")
	query.Set("pbk", runtime.RealityPublicKey)
	query.Set("sni", runtime.RealitySNI)
	query.Set("fp", "chrome")
	query.Set("flow", "xtls-rprx-vision")
	if shortID != "" {
		query.Set("sid", shortID)
	}
	query.Set("spx", "/")
	label := url.PathEscape(user.Username + "-VLESS")
	return fmt.Sprintf("vless://%s@%s:%d?%s#%s", user.VlessUUID.String(), runtime.PanelDomain, runtime.VlessPort, query.Encode(), label)
}

func buildHysteria2(runtime RuntimeSettings, user *domain.User) string {
	query := url.Values{}
	query.Set("sni", runtime.Hy2Domain)
	query.Set("insecure", "0")
	if runtime.Hy2ObfsEnabled {
		query.Set("obfs", "salamander")
		query.Set("obfs-password", runtime.Hy2ObfsPassword)
	}
	label := url.PathEscape(user.Username + "-HY2")
	return fmt.Sprintf("hysteria2://%s@%s:%d/?%s#%s", user.Hy2Password, runtime.Hy2Domain, runtime.Hy2Port, query.Encode(), label)
}
