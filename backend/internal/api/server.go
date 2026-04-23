package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	chi "github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"golang.org/x/time/rate"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/services"
)

type Server struct {
	cfg      config.Config
	services *services.Services
	logger   *slog.Logger
	http     *http.Server
}

type contextKey string

const claimsContextKey contextKey = "claims"
const refreshCookieName = "panel_refresh_token"

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total HTTP requests",
	}, []string{"method", "path", "status"})
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"path"})
	hy2AuthRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hy2_auth_requests_total",
		Help: "Hysteria auth webhook requests",
	}, []string{"result"})
)

func New(cfg config.Config, services *services.Services, logger *slog.Logger) *Server {
	router := chi.NewRouter()
	server := &Server{
		cfg:      cfg,
		services: services,
		logger:   logger,
		http: &http.Server{
			Addr:         config.Address(cfg.Panel.Host, cfg.Panel.Port),
			Handler:      router,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
	}
	server.routes(router)
	return server
}

func (s *Server) ListenAndServe() error {
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) routes(r chi.Router) {
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(s.metricsMiddleware)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://" + s.cfg.Panel.Domain, "http://localhost:5173", "http://127.0.0.1:5173"},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(s.securityHeaders)
	r.Use(s.rateLimit("global", 100))

	r.Handle("/metrics", promhttp.Handler())

	r.Post("/api/auth/login", s.rateLimit("login", 5)(http.HandlerFunc(s.handleLogin)).ServeHTTP)
	r.Post("/api/auth/refresh", s.handleRefresh)
	r.Post("/api/auth/logout", s.handleLogout)

	r.With(s.rateLimit("sub", 60)).Get("/sub/{token}", s.handleSubscription)
	r.With(s.rateLimit("sub", 60)).Post("/sub/{token}/rotate", s.handleSubscriptionRotate)
	r.Post("/hy2/auth", s.handleHY2Auth)
	r.Get("/healthz", s.handleHealth)

	r.Route("/api", func(api chi.Router) {
		api.Use(s.requireAuth)

		api.Get("/users", s.handleUsersList)
		api.Post("/users", s.handleUsersCreate)
		api.Get("/users/{id}", s.handleUsersGet)
		api.Patch("/users/{id}", s.handleUsersUpdate)
		api.Delete("/users/{id}", s.handleUsersDelete)
		api.Post("/users/{id}/reset-sub", s.handleUsersResetSub)
		api.Post("/users/{id}/reset-traffic", s.handleUsersResetTraffic)
		api.Get("/users/{id}/traffic", s.handleUsersTraffic)
		api.Get("/users/{id}/links", s.handleUsersLinks)

		api.Get("/configs/{core}", s.handleConfigGet)
		api.Post("/configs/{core}/validate", s.handleConfigValidate)
		api.Post("/configs/{core}/apply", s.handleConfigApply)
		api.Get("/configs/{core}/history", s.handleConfigHistory)
		api.Post("/configs/{core}/restore/{historyID}", s.handleConfigRestore)

		api.Get("/settings", s.handleSettingsList)
		api.Patch("/settings", s.handleSettingsUpdate)

		api.Get("/stats/overview", s.handleStatsOverview)
		api.Get("/stats/traffic", s.handleStatsTraffic)
		api.Get("/stats/online", s.handleStatsOnline)

		api.Get("/admins", s.handleAdminsList)
		api.Post("/admins", s.handleAdminsCreate)
		api.Patch("/admins/{id}", s.handleAdminsUpdate)
		api.Delete("/admins/{id}", s.handleAdminsDelete)

		api.Get("/audit", s.handleAuditList)
	})

	s.mountFrontend(r)
}

func (s *Server) mountFrontend(r chi.Router) {
	indexPath := filepath.Join(s.cfg.Panel.FrontendDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}

	fileServer := http.FileServer(http.Dir(s.cfg.Panel.FrontendDir))
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/sub/") || r.URL.Path == "/hy2/auth" || r.URL.Path == "/metrics" {
			jsonError(w, domain.NewError(http.StatusNotFound, "not_found", "Not found", nil))
			return
		}
		path := filepath.Join(s.cfg.Panel.FrontendDir, strings.TrimPrefix(filepath.Clean(r.URL.Path), string(filepath.Separator)))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		TOTP     string `json:"totp"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	tokens, err := s.services.Auth.Login(r.Context(), req.Username, req.Password, req.TOTP)
	if err != nil {
		jsonError(w, err)
		return
	}
	setRefreshCookie(w, s.cfg, tokens.RefreshToken)
	jsonData(w, http.StatusOK, map[string]any{
		"access_token": tokens.AccessToken,
		"expires_in":   int(tokens.ExpiresIn.Seconds()),
		"admin": map[string]any{
			"id":         tokens.Admin.ID,
			"username":   tokens.Admin.Username,
			"role":       tokens.Admin.Role,
			"created_at": tokens.Admin.CreatedAt,
		},
	}, nil)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil {
		jsonError(w, domain.NewError(401, "unauthorized", "Refresh cookie is missing", err))
		return
	}
	tokens, err := s.services.Auth.Refresh(r.Context(), cookie.Value)
	if err != nil {
		jsonError(w, err)
		return
	}
	setRefreshCookie(w, s.cfg, tokens.RefreshToken)
	jsonData(w, http.StatusOK, map[string]any{
		"access_token": tokens.AccessToken,
		"expires_in":   int(tokens.ExpiresIn.Seconds()),
		"admin": map[string]any{
			"id":       tokens.Admin.ID,
			"username": tokens.Admin.Username,
			"role":     tokens.Admin.Role,
		},
	}, nil)
}

func (s *Server) handleLogout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
	jsonData(w, http.StatusOK, map[string]any{"ok": true}, nil)
}

func (s *Server) handleUsersList(w http.ResponseWriter, r *http.Request) {
	filters := domain.UserFilters{
		Page:            intQuery(r, "page", 1),
		PerPage:         intQuery(r, "per_page", 20),
		Search:          r.URL.Query().Get("search"),
		Status:          r.URL.Query().Get("status"),
		HasTrafficLimit: boolQuery(r, "has_traffic_limit"),
		NearExpiryDays:  intQuery(r, "near_expiry", 0),
	}
	items, total, err := s.services.Users.List(r.Context(), filters)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, items, map[string]any{
		"page":     filters.Page,
		"per_page": filters.PerPage,
		"total":    total,
	})
}

func (s *Server) handleUsersCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username     string     `json:"username"`
		TrafficLimit int64      `json:"traffic_limit"`
		ExpiresAt    *time.Time `json:"expires_at"`
		Note         string     `json:"note"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	user, err := s.services.Users.Create(r.Context(), services.CreateUserRequest{
		Username:     req.Username,
		TrafficLimit: req.TrafficLimit,
		ExpiresAt:    req.ExpiresAt,
		Note:         req.Note,
	}, actorFromRequest(r))
	if err != nil {
		jsonError(w, err)
		return
	}
	links, err := s.services.Subscription.LinksForUser(r.Context(), user)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusCreated, map[string]any{
		"id":            user.ID,
		"username":      user.Username,
		"status":        user.Status,
		"traffic_limit": user.TrafficLimit,
		"traffic_used":  user.TrafficUsed,
		"expires_at":    user.ExpiresAt,
		"sub_url":       links.Subscription,
		"created_at":    user.CreatedAt,
	}, nil)
}

func (s *Server) handleUsersGet(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	user, err := s.services.Users.Get(r.Context(), id)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, user, nil)
}

func (s *Server) handleUsersUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	var req struct {
		Username     *string            `json:"username"`
		TrafficLimit *int64             `json:"traffic_limit"`
		TrafficUsed  *int64             `json:"traffic_used"`
		ExpiresAt    *time.Time         `json:"expires_at"`
		Status       *domain.UserStatus `json:"status"`
		Note         *string            `json:"note"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	user, err := s.services.Users.Update(r.Context(), id, services.UpdateUserRequest{
		Username:     req.Username,
		TrafficLimit: req.TrafficLimit,
		TrafficUsed:  req.TrafficUsed,
		ExpiresAt:    req.ExpiresAt,
		Status:       req.Status,
		Note:         req.Note,
	}, actorFromRequest(r))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, user, nil)
}

func (s *Server) handleUsersDelete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	if err := s.services.Users.Delete(r.Context(), id, actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"ok": true}, nil)
}

func (s *Server) handleUsersResetSub(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	user, err := s.services.Users.ResetSubscription(r.Context(), id, actorFromRequest(r))
	if err != nil {
		jsonError(w, err)
		return
	}
	links, err := s.services.Subscription.LinksForUser(r.Context(), user)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, links, nil)
}

func (s *Server) handleUsersResetTraffic(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	user, err := s.services.Users.ResetTraffic(r.Context(), id, actorFromRequest(r))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, user, nil)
}

func (s *Server) handleUsersTraffic(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	points, err := s.services.Users.Traffic(r.Context(), id, intQuery(r, "days", 7))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, points, nil)
}

func (s *Server) handleUsersLinks(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	links, err := s.services.Users.Links(r.Context(), id)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, links, nil)
}

func (s *Server) handleConfigGet(w http.ResponseWriter, r *http.Request) {
	content, err := s.services.Configs.Get(r.Context(), chi.URLParam(r, "core"))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"content": string(content)}, nil)
}

func (s *Server) handleConfigValidate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	if err := s.services.Configs.Validate(r.Context(), chi.URLParam(r, "core"), []byte(req.Content)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"valid": true}, nil)
}

func (s *Server) handleConfigApply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	if err := s.services.Configs.Apply(r.Context(), chi.URLParam(r, "core"), []byte(req.Content), actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"applied": true}, nil)
}

func (s *Server) handleConfigHistory(w http.ResponseWriter, r *http.Request) {
	items, err := s.services.Configs.History(r.Context(), chi.URLParam(r, "core"))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, items, nil)
}

func (s *Server) handleConfigRestore(w http.ResponseWriter, r *http.Request) {
	historyID, err := strconv.ParseInt(chi.URLParam(r, "historyID"), 10, 64)
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_history_id", "Invalid history id", err))
		return
	}
	if err := s.services.Configs.Restore(r.Context(), historyID, actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"restored": true}, nil)
}

func (s *Server) handleSettingsList(w http.ResponseWriter, r *http.Request) {
	settings, err := s.services.Settings.List(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, settings, nil)
}

func (s *Server) handleSettingsUpdate(w http.ResponseWriter, r *http.Request) {
	values := map[string]json.RawMessage{}
	if err := decodeJSON(r, &values); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	if err := s.services.Settings.Update(r.Context(), values, actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"updated": true}, nil)
}

func (s *Server) handleStatsOverview(w http.ResponseWriter, r *http.Request) {
	data, err := s.services.Stats.Overview(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, data, nil)
}

func (s *Server) handleStatsTraffic(w http.ResponseWriter, r *http.Request) {
	data, err := s.services.Stats.Traffic(r.Context(), intQuery(r, "days", 7))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, data, nil)
}

func (s *Server) handleStatsOnline(w http.ResponseWriter, r *http.Request) {
	data, err := s.services.Stats.Online(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, data, nil)
}

func (s *Server) handleAdminsList(w http.ResponseWriter, r *http.Request) {
	admins, err := s.services.Admins.List(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, admins, nil)
}

func (s *Server) handleAdminsCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	admin, err := s.services.Admins.Create(r.Context(), services.CreateAdminRequest{
		Username: req.Username,
		Password: req.Password,
		Role:     req.Role,
	}, actorFromRequest(r))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusCreated, admin, nil)
}

func (s *Server) handleAdminsUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid admin id", err))
		return
	}
	var req struct {
		Password string  `json:"password"`
		TOTP     *string `json:"totp"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	if err := s.services.Admins.Update(r.Context(), id, services.UpdateAdminRequest{
		Password: req.Password,
		TOTP:     req.TOTP,
	}, actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"updated": true}, nil)
}

func (s *Server) handleAdminsDelete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid admin id", err))
		return
	}
	if err := s.services.Admins.Delete(r.Context(), id, actorFromRequest(r)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"deleted": true}, nil)
}

func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request) {
	entries, err := s.services.Audit.List(r.Context(), intQuery(r, "limit", 50))
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, entries, nil)
}

func (s *Server) handleSubscription(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if len(token) < 32 {
		http.NotFound(w, r)
		return
	}
	user, links, err := s.services.Subscription.ResolveByToken(r.Context(), token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if r.URL.Query().Get("format") == "json" || strings.Contains(r.Header.Get("Accept"), "application/json") {
		jsonData(w, http.StatusOK, links, nil)
		return
	}

	ua := strings.ToLower(r.Header.Get("User-Agent"))
	switch {
	case strings.Contains(ua, "clash"):
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		_, _ = w.Write([]byte(s.services.Subscription.BuildClashYAML(links)))
	case strings.Contains(ua, "sing-box"):
		payload, err := s.services.Subscription.BuildSingBoxJSON(links)
		if err != nil {
			jsonError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Profile-Update-Interval", strconv.Itoa(s.cfg.Subscription.UpdateIntervalHours))
		w.Header().Set("Subscription-Userinfo", s.services.Subscription.BuildUserInfoHeader(user))
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, user.Username))
		_, _ = w.Write([]byte(services.EncodedLinks(links)))
	}
}

func (s *Server) handleSubscriptionRotate(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if len(token) < 32 {
		http.NotFound(w, r)
		return
	}
	links, err := s.services.Subscription.RotateByToken(r.Context(), token)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, links, nil)
}

func (s *Server) handleHY2Auth(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	if ip != "127.0.0.1" && ip != "::1" {
		hy2AuthRequests.WithLabelValues("denied").Inc()
		jsonError(w, domain.NewError(403, "forbidden", "Forbidden", nil))
		return
	}

	password := r.FormValue("password")
	if password == "" {
		password = r.FormValue("auth")
	}
	if password == "" {
		var req map[string]string
		_ = decodeJSON(r, &req)
		password = req["password"]
		if password == "" {
			password = req["auth"]
		}
	}
	if password == "" {
		hy2AuthRequests.WithLabelValues("denied").Inc()
		jsonError(w, domain.NewError(401, "invalid_credentials", "Credentials are required", nil))
		return
	}

	user, ok := s.services.Subscription.CheckPasswordCached(password)
	if !ok || !user.CanConnect() {
		hy2AuthRequests.WithLabelValues("denied").Inc()
		jsonError(w, domain.NewError(403, "access_denied", "Access denied", nil))
		return
	}

	hy2AuthRequests.WithLabelValues("ok").Inc()
	jsonData(w, http.StatusOK, map[string]any{"ok": true, "user": user.Username}, nil)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	report, err := s.services.Stats.Health(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	status := http.StatusOK
	if report.Status != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, report)
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
		if raw == "" {
			jsonError(w, domain.NewError(401, "unauthorized", "Authorization header is required", nil))
			return
		}
		claims, err := s.services.Auth.ParseAccess(raw)
		if err != nil {
			jsonError(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsContextKey, claims)))
	})
}

func (s *Server) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		path := routePath(r)
		httpRequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(rec.status)).Inc()
		httpDuration.WithLabelValues(path).Observe(time.Since(start).Seconds())
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Robots-Tag", "noindex")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) rateLimit(name string, perMinute int) func(http.Handler) http.Handler {
	store := &limiterStore{
		limit:    rate.Every(time.Minute / time.Duration(perMinute)),
		burst:    perMinute,
		limiters: map[string]*rate.Limiter{},
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !store.allow(clientIP(r) + ":" + name) {
				jsonError(w, domain.NewError(429, "rate_limit_exceeded", "Too many requests, wait a minute", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type limiterStore struct {
	mu       sync.Mutex
	limit    rate.Limit
	burst    int
	limiters map[string]*rate.Limiter
}

func (s *limiterStore) allow(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	limiter, ok := s.limiters[key]
	if !ok {
		limiter = rate.NewLimiter(s.limit, s.burst)
		s.limiters[key] = limiter
	}
	return limiter.Allow()
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func jsonData(w http.ResponseWriter, status int, data any, meta any) {
	payload := map[string]any{"data": data}
	if meta != nil {
		payload["meta"] = meta
	}
	writeJSON(w, status, payload)
}

func jsonError(w http.ResponseWriter, err error) {
	appErr, ok := domain.AsAppError(err)
	if !ok {
		appErr = domain.NewError(http.StatusInternalServerError, "internal_error", "Internal server error", err)
	}
	writeJSON(w, appErr.Status, map[string]any{
		"error": map[string]any{
			"code":    appErr.Code,
			"message": appErr.Message,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func setRefreshCookie(w http.ResponseWriter, cfg config.Config, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   strings.HasPrefix(cfg.Subscription.URLPrefix, "https://"),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(cfg.Panel.JWTRefreshTTL.Seconds()),
	})
}

func actorFromRequest(r *http.Request) services.AuditActor {
	actor := services.AuditActor{
		IP:        clientIP(r),
		UserAgent: r.UserAgent(),
	}
	claims, _ := r.Context().Value(claimsContextKey).(*domain.Claims)
	if claims != nil && claims.AdminID != "" {
		if id, err := uuid.Parse(claims.AdminID); err == nil {
			actor.AdminID = &id
		}
	}
	return actor
}

func intQuery(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func boolQuery(r *http.Request, key string) bool {
	value, _ := strconv.ParseBool(r.URL.Query().Get(key))
	return value
}

func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func routePath(r *http.Request) string {
	if routeCtx := chi.RouteContext(r.Context()); routeCtx != nil {
		if pattern := routeCtx.RoutePattern(); pattern != "" {
			return pattern
		}
	}
	return r.URL.Path
}
