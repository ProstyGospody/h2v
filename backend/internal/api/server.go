package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
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

		api.Get("/settings", s.handleSettingsList)
		api.Patch("/settings", s.handleSettingsUpdate)
		api.Post("/settings/ports/check", s.handleSettingsPortsCheck)
		api.Post("/settings/reality-keypair", s.handleSettingsRealityKeyPair)
		api.Post("/geodata/update", s.handleGeodataUpdate)
		api.Get("/backup/export", s.handleBackupExport)
		api.Post("/backup/import", s.handleBackupImport)

		api.Get("/stats/overview", s.handleStatsOverview)
		api.Get("/stats/traffic", s.handleStatsTraffic)
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
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	tokens, err := s.services.Auth.Login(r.Context(), req.Username, req.Password)
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
	})
	if err != nil {
		jsonError(w, err)
		return
	}
	links, err := s.services.Subscription.LinksForUser(r.Context(), user)
	if err != nil {
		jsonError(w, err)
		return
	}
	links = linksForRequest(r, links, user.SubToken)
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
	})
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
	if err := s.services.Users.Delete(r.Context(), id); err != nil {
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
	user, err := s.services.Users.ResetSubscription(r.Context(), id)
	if err != nil {
		jsonError(w, err)
		return
	}
	links, err := s.services.Subscription.LinksForUser(r.Context(), user)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, linksForRequest(r, links, user.SubToken), nil)
}

func (s *Server) handleUsersResetTraffic(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, domain.NewError(400, "invalid_id", "Invalid user id", err))
		return
	}
	user, err := s.services.Users.ResetTraffic(r.Context(), id)
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
	jsonData(w, http.StatusOK, linksForRequest(r, links, subscriptionTokenFromURL(links.Subscription)), nil)
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
	if err := s.services.Configs.Apply(r.Context(), chi.URLParam(r, "core"), []byte(req.Content)); err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"applied": true}, nil)
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
	_, restartPanel := values["panel.port"]
	rollbackValues := map[string]json.RawMessage{}
	if shouldReconcileCaddy(values) {
		var err error
		rollbackValues, err = s.settingsRollbackValues(r.Context(), values)
		if err != nil {
			s.logger.Warn("settings rollback snapshot failed", "err", err)
		}
	}
	if err := s.services.Settings.Update(r.Context(), values); err != nil {
		jsonError(w, err)
		return
	}
	if shouldReconcileXray(values) {
		if err := s.services.Configs.ReconcileXray(r.Context(), values); err != nil {
			s.rollbackSettingsApply(r.Context(), rollbackValues, values)
			jsonError(w, err)
			return
		}
	}
	if shouldReconcileHysteria(values) {
		if err := s.services.Configs.ReconcileHysteria(r.Context(), values); err != nil {
			s.rollbackSettingsApply(r.Context(), rollbackValues, values)
			jsonError(w, err)
			return
		}
	}
	if shouldReconcileCaddy(values) {
		if err := s.services.Configs.ReconcileCaddy(r.Context(), values); err != nil {
			s.rollbackSettingsApply(r.Context(), rollbackValues, values)
			jsonError(w, domain.NewError(http.StatusInternalServerError, "caddy_reconcile_failed", "Unable to update Caddy reverse proxy; panel endpoint was not changed", err))
			return
		}
	}
	response := map[string]any{"updated": true}
	if restartPanel {
		response["restart"] = "panel"
	}
	jsonData(w, http.StatusOK, response, nil)
	if restartPanel {
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		s.restartPanelSoon()
	}
}

func (s *Server) handleSettingsPortsCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Ports []struct {
			Key      string `json:"key"`
			Port     int    `json:"port"`
			Protocol string `json:"protocol"`
		} `json:"ports"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	if len(req.Ports) > 24 {
		jsonError(w, domain.NewError(400, "invalid_request", "Too many ports to check", nil))
		return
	}

	type portResult struct {
		Available bool   `json:"available"`
		Key       string `json:"key"`
		Port      int    `json:"port"`
		Protocol  string `json:"protocol"`
		Reason    string `json:"reason,omitempty"`
	}
	results := make([]portResult, 0, len(req.Ports))
	for _, item := range req.Ports {
		if item.Key != "panel.port" && item.Key != "panel.public_port" && item.Key != "vless.port" && item.Key != "hy2.port" {
			jsonError(w, domain.NewError(400, "invalid_request", "Unknown port key", nil))
			return
		}
		if item.Protocol != "tcp" && item.Protocol != "udp" {
			jsonError(w, domain.NewError(400, "invalid_request", "Protocol must be tcp or udp", nil))
			return
		}
		probe := services.ProbePort(item.Protocol, item.Port)
		results = append(results, portResult{
			Available: probe.Available,
			Key:       item.Key,
			Port:      probe.Port,
			Protocol:  probe.Protocol,
			Reason:    probe.Reason,
		})
	}
	jsonData(w, http.StatusOK, results, nil)
}

func (s *Server) handleSettingsRealityKeyPair(w http.ResponseWriter, _ *http.Request) {
	keyPair, err := s.services.Settings.GenerateRealityKeyPair()
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, keyPair, nil)
}

func (s *Server) handleGeodataUpdate(w http.ResponseWriter, r *http.Request) {
	if err := s.services.Geodata.UpdateAndRestart(r.Context()); err != nil {
		s.logger.Error("geodata update failed", "err", err)
		jsonError(w, domain.NewError(http.StatusInternalServerError, "geodata_update_failed", fmt.Sprintf("Unable to update GeoIP/Geosite data: %v", err), err))
		return
	}
	jsonData(w, http.StatusOK, map[string]any{"updated": true}, nil)
}

func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	backup, err := s.services.Backup.Export(r.Context())
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, backup, nil)
}

func (s *Server) handleBackupImport(w http.ResponseWriter, r *http.Request) {
	var backup services.PanelBackup
	if err := decodeJSON(r, &backup); err != nil {
		jsonError(w, domain.NewError(400, "invalid_request", "Invalid request body", err))
		return
	}
	summary, err := s.services.Backup.Import(r.Context(), backup)
	if err != nil {
		jsonError(w, err)
		return
	}
	jsonData(w, http.StatusOK, summary, nil)
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

func (s *Server) handleSubscription(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if len(token) < 32 {
		http.NotFound(w, r)
		return
	}
	user, links, err := s.services.Subscription.ResolveByToken(r.Context(), token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	links = linksForRequest(r, links, token)
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "json" {
		jsonData(w, http.StatusOK, links, nil)
		return
	}

	w.Header().Set("Profile-Update-Interval", strconv.Itoa(s.cfg.Subscription.UpdateIntervalHours))
	w.Header().Set("Subscription-Userinfo", s.services.Subscription.BuildUserInfoHeader(user))

	ua := strings.ToLower(r.Header.Get("User-Agent"))
	switch {
	case format == "clash" || format == "mihomo" || format == "yaml" || (format == "" && isClashLikeUserAgent(ua)):
		payload, err := s.services.Subscription.BuildClashYAML(links)
		if err != nil {
			jsonError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		_, _ = w.Write([]byte(payload))
	case format == "sing-box" || format == "singbox" || (format == "" && strings.Contains(ua, "sing-box")):
		payload, err := s.services.Subscription.BuildSingBoxJSON(links)
		if err != nil {
			jsonError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, user.Username))
		_, _ = w.Write([]byte(services.EncodedLinks(links)))
	}
}

func (s *Server) handleSubscriptionRotate(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if len(token) < 32 {
		http.NotFound(w, r)
		return
	}
	links, err := s.services.Subscription.RotateByToken(r.Context(), token)
	if err != nil {
		jsonError(w, err)
		return
	}
	responseToken := subscriptionTokenFromURL(links.Subscription)
	jsonData(w, http.StatusOK, linksForRequest(r, links, responseToken), nil)
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

	password := ""
	if strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "json") {
		password = hy2AuthFromJSON(r)
	}
	if password != "" {
		allowHY2Auth(w, s, password)
		return
	}

	password = r.FormValue("auth")
	if password == "" {
		password = r.FormValue("password")
	}
	if password == "" {
		password = hy2AuthFromJSON(r)
	}
	if password == "" {
		hy2AuthRequests.WithLabelValues("denied").Inc()
		jsonError(w, domain.NewError(401, "invalid_credentials", "Credentials are required", nil))
		return
	}

	allowHY2Auth(w, s, password)
}

func hy2AuthFromJSON(r *http.Request) string {
	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return ""
	}
	if password := stringValue(req["auth"]); password != "" {
		return password
	}
	return stringValue(req["password"])
}

func allowHY2Auth(w http.ResponseWriter, s *Server, password string) {
	user, ok := s.services.Subscription.CheckPasswordCached(password)
	if !ok || !user.CanConnect() {
		hy2AuthRequests.WithLabelValues("denied").Inc()
		jsonError(w, domain.NewError(403, "access_denied", "Access denied", nil))
		return
	}

	hy2AuthRequests.WithLabelValues("ok").Inc()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": user.Username})
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

func linksForRequest(r *http.Request, links *domain.SubscriptionLinks, token string) *domain.SubscriptionLinks {
	if links == nil || token == "" {
		return links
	}
	origin := requestOrigin(r)
	if origin == "" {
		return links
	}
	copy := *links
	copy.Subscription = strings.TrimSuffix(origin, "/") + "/sub/" + url.PathEscape(token)
	return &copy
}

func requestOrigin(r *http.Request) string {
	host := cleanRequestHost(firstForwardedValue(r.Header.Get("X-Forwarded-Host")))
	if host == "" {
		host = cleanRequestHost(r.Host)
	}
	if host == "" {
		return ""
	}

	proto := strings.ToLower(firstForwardedValue(r.Header.Get("X-Forwarded-Proto")))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	if proto != "http" && proto != "https" {
		proto = "https"
	}
	return proto + "://" + host
}

func cleanRequestHost(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return strings.TrimRight(value, "/")
}

func firstForwardedValue(value string) string {
	return strings.TrimSpace(strings.Split(value, ",")[0])
}

func isClashLikeUserAgent(ua string) bool {
	return strings.Contains(ua, "clash") ||
		strings.Contains(ua, "mihomo") ||
		strings.Contains(ua, "stash")
}

func stringValue(value any) string {
	if str, ok := value.(string); ok {
		return str
	}
	return ""
}

func subscriptionTokenFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if parsed, err := url.Parse(raw); err == nil {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		for i := len(parts) - 2; i >= 0; i-- {
			if parts[i] == "sub" && parts[i+1] != "" {
				return parts[i+1]
			}
		}
	}
	const marker = "/sub/"
	if index := strings.LastIndex(raw, marker); index >= 0 {
		tail := strings.Trim(raw[index+len(marker):], "/")
		return strings.Split(tail, "?")[0]
	}
	return ""
}

func shouldReconcileXray(values map[string]json.RawMessage) bool {
	for key := range values {
		if strings.HasPrefix(key, "vless.") || strings.HasPrefix(key, "reality.") {
			return true
		}
	}
	return false
}

func shouldReconcileHysteria(values map[string]json.RawMessage) bool {
	for key := range values {
		if key == "panel.port" || strings.HasPrefix(key, "hy2.") {
			return true
		}
	}
	return false
}

func shouldReconcileCaddy(values map[string]json.RawMessage) bool {
	_, internalPortChanged := values["panel.port"]
	_, publicPortChanged := values["panel.public_port"]
	_, domainChanged := values["panel.domain"]
	return internalPortChanged || publicPortChanged || domainChanged
}

func (s *Server) settingsRollbackValues(ctx context.Context, values map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	previous, err := s.services.Settings.GetAll(ctx)
	rollback := make(map[string]json.RawMessage, len(values))
	for key := range values {
		switch key {
		case "panel.port":
			raw, marshalErr := json.Marshal(s.cfg.Panel.Port)
			if marshalErr == nil {
				rollback[key] = raw
			}
		case "panel.public_port":
			if raw, ok := previous[key]; ok {
				rollback[key] = cloneRawMessage(raw)
				continue
			}
			raw, marshalErr := json.Marshal(s.cfg.Panel.PublicPort)
			if marshalErr == nil {
				rollback[key] = raw
			}
		case "panel.domain":
			if raw, ok := previous[key]; ok {
				rollback[key] = cloneRawMessage(raw)
				continue
			}
			raw, marshalErr := json.Marshal(s.cfg.Panel.Domain)
			if marshalErr == nil {
				rollback[key] = raw
			}
		default:
			if raw, ok := previous[key]; ok {
				rollback[key] = cloneRawMessage(raw)
			}
		}
	}
	return rollback, err
}

func (s *Server) rollbackSettingsApply(ctx context.Context, rollbackValues, attemptedValues map[string]json.RawMessage) {
	if len(rollbackValues) == 0 {
		return
	}
	if err := s.services.Settings.Restore(ctx, rollbackValues); err != nil {
		s.logger.Error("settings rollback failed after config apply error", "err", err)
		return
	}
	if shouldReconcileXray(attemptedValues) {
		if err := s.services.Configs.ReconcileXray(ctx, rollbackValues); err != nil {
			s.logger.Error("xray rollback reconcile failed", "err", err)
		}
	}
	if shouldReconcileHysteria(attemptedValues) {
		if err := s.services.Configs.ReconcileHysteria(ctx, rollbackValues); err != nil {
			s.logger.Error("hysteria rollback reconcile failed", "err", err)
		}
	}
	if shouldReconcileCaddy(attemptedValues) {
		if err := s.services.Configs.ReconcileCaddy(ctx, rollbackValues); err != nil {
			s.logger.Error("caddy rollback reconcile failed", "err", err)
		}
	}
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	if raw == nil {
		return nil
	}
	cloned := make(json.RawMessage, len(raw))
	copy(cloned, raw)
	return cloned
}

func (s *Server) restartPanelSoon() {
	go func() {
		time.Sleep(750 * time.Millisecond)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := s.services.Configs.RestartService(ctx, "panel"); err != nil {
			s.logger.Error("panel restart failed after settings update", "err", err)
		}
	}()
}

func clientIP(r *http.Request) string {
	if forwarded := firstForwardedValue(r.Header.Get("X-Forwarded-For")); forwarded != "" {
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
