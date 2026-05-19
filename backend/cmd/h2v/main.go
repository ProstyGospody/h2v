package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/coreos/go-systemd/v22/daemon"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/prost/h2v/backend/internal/api"
	"github.com/prost/h2v/backend/internal/cache"
	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/cores/hysteria"
	"github.com/prost/h2v/backend/internal/cores/xray"
	"github.com/prost/h2v/backend/internal/db"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
	"github.com/prost/h2v/backend/internal/services"
	"github.com/prost/h2v/backend/internal/systemctl"
	"github.com/prost/h2v/backend/internal/tasks"
	"github.com/prost/h2v/backend/internal/util"
)

var (
	version = "0.1.1"
	commit  = "unknown"
	builtAt = "unknown"
)

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))

	if len(os.Args) < 2 {
		fatal(logger, errors.New("expected subcommand: serve | db init | admin create | admin set-password | config render | geodata update"))
	}

	switch os.Args[1] {
	case "serve":
		runServe(cfg, logger)
	case "db":
		runDB(cfg, logger, os.Args[2:])
	case "admin":
		runAdmin(cfg, logger, os.Args[2:])
	case "config":
		runConfig(cfg, logger, os.Args[2:])
	case "geodata":
		runGeodata(cfg, logger, os.Args[2:])
	default:
		fatal(logger, fmt.Errorf("unknown subcommand %q", os.Args[1]))
	}
}

func versionString() string {
	if commit == "" || commit == "unknown" {
		return version
	}
	if builtAt == "" || builtAt == "unknown" {
		return version + " (" + commit + ")"
	}
	return version + " (" + commit + ", " + builtAt + ")"
}

func runServe(cfg config.Config, logger *slog.Logger) {
	if err := cfg.ValidateServe(); err != nil {
		fatal(logger, err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, scheduler, httpServer, initialReconcile := buildApp(ctx, cfg, logger)
	defer pool.Close()

	go scheduler.Start(ctx)
	go func() {
		logger.Info("http server starting", "addr", config.Address(cfg.H2V.Host, cfg.H2V.Port))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal(logger, err)
		}
	}()

	_, _ = daemon.SdNotify(false, daemon.SdNotifyReady)
	go initialReconcile(ctx)
	<-ctx.Done()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown failed", "err", err)
	}
	logger.Info("shutdown complete")
}

func buildApp(ctx context.Context, cfg config.Config, logger *slog.Logger) (*pgxpool.Pool, *tasks.Scheduler, *api.Server, func(context.Context)) {
	pool, err := db.Connect(ctx, cfg.DB)
	if err != nil {
		fatal(logger, err)
	}
	repository := repo.New(pool)
	if err := repository.BootstrapSettings(ctx, cfg); err != nil {
		fatal(logger, err)
	}

	xrayClient := xray.NewClient(cfg.Xray, logger)
	if err := xrayClient.WaitReady(ctx, 2*time.Second); err != nil {
		logger.Warn("xray readiness timed out", "err", err)
	}
	hysteriaClient := hysteria.NewClient(cfg.Hysteria, logger)
	userCache := cache.NewUsersCache(repository)
	if err := userCache.LoadAll(ctx); err != nil {
		fatal(logger, err)
	}

	serviceBundle := services.New(services.ServiceDeps{
		Config:    cfg,
		Repo:      repository,
		Xray:      xrayClient,
		Hysteria:  hysteriaClient,
		Systemctl: systemctl.New(cfg.H2V.DisableSystemctl),
		Cache:     userCache,
		Logger:    logger,
		Version:   versionString(),
		StartedAt: time.Now(),
	})

	if err := serviceBundle.Settings.Bootstrap(ctx); err != nil {
		logger.Warn("settings bootstrap failed", "err", err)
	}

	reconcileXray := func(ctx context.Context) error { return serviceBundle.Configs.ReconcileXray(ctx) }
	reconcileHysteria := func(ctx context.Context) error { return serviceBundle.Configs.ReconcileHysteria(ctx) }
	coreReconciler := tasks.NewCoreReconciler(reconcileXray, reconcileHysteria, logger)

	scheduler := tasks.NewScheduler(logger)
	trafficSpoolDir := filepath.Join(cfg.H2V.RootDir, "data", "traffic-pending")
	scheduler.Every("collector", cfg.Tasks.CollectorInterval, tasks.NewCollector(repository, xrayClient, hysteriaClient, trafficSpoolDir, logger).Run)
	scheduler.Every("enforcer", cfg.Tasks.EnforcerInterval, tasks.NewEnforcer(repository, xrayClient, hysteriaClient, userCache, reconcileXray, logger).Run)
	scheduler.Every("core_reconciler", cfg.Tasks.CoreReconcileInterval, coreReconciler.Run)
	scheduler.Every("cache_refresh", cfg.Tasks.CacheRefreshInterval, userCache.Refresh)
	scheduler.Every("backup", 24*time.Hour, tasks.NewBackup(cfg).Run)
	scheduler.Every("traffic_retention", 24*time.Hour, tasks.NewTrafficRetention(repository, cfg.Traffic.RetentionDays, logger).Run)

	httpServer := api.New(cfg, serviceBundle, logger)
	return pool, scheduler, httpServer, func(ctx context.Context) {
		runInitialReconcile(ctx, serviceBundle, logger)
	}
}

func runInitialReconcile(ctx context.Context, serviceBundle *services.Services, logger *slog.Logger) {
	run := func(name string, timeout time.Duration, fn func(context.Context) error) {
		if ctx.Err() != nil {
			return
		}
		reconcileCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		if err := fn(reconcileCtx); err != nil {
			logger.Warn("initial "+name+" reconcile failed", "err", err)
		}
	}

	run("xray config", 30*time.Second, func(ctx context.Context) error {
		return serviceBundle.Configs.ReconcileXray(ctx)
	})
	run("hysteria config", 30*time.Second, func(ctx context.Context) error {
		return serviceBundle.Configs.ReconcileHysteria(ctx)
	})
}

func runDB(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 || args[0] != "init" {
		fatal(logger, errors.New("usage: h2v db init"))
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DB)
	if err != nil {
		fatal(logger, err)
	}
	defer pool.Close()

	schema, path, err := loadSchema(cfg)
	if err != nil {
		fatal(logger, err)
	}
	if _, err := pool.Exec(ctx, string(schema)); err != nil {
		fatal(logger, fmt.Errorf("apply database schema: %w", err))
	}
	logger.Info("database schema ready", "path", path)
}

func loadSchema(cfg config.Config) ([]byte, string, error) {
	candidates := []string{
		filepath.Join(cfg.H2V.RootDir, "schema.sql"),
		"schema.sql",
		filepath.Join("backend", "schema.sql"),
	}
	for _, path := range candidates {
		content, err := os.ReadFile(path)
		if err == nil {
			return content, path, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, "", fmt.Errorf("read %s: %w", path, err)
		}
	}
	return nil, "", fmt.Errorf("schema.sql not found in %v", candidates)
}

func runAdmin(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 {
		fatal(logger, errors.New("usage: h2v admin <create|set-password> --username <name> --password <password>"))
	}
	switch args[0] {
	case "create":
		runAdminCreate(cfg, logger, args[1:])
	case "set-password":
		runAdminSetPassword(cfg, logger, args[1:])
	default:
		fatal(logger, fmt.Errorf("unknown admin subcommand %q (expected create|set-password)", args[0]))
	}
}

func runAdminCreate(cfg config.Config, logger *slog.Logger, args []string) {
	cmd := flag.NewFlagSet("admin create", flag.ExitOnError)
	username := cmd.String("username", "admin", "")
	password := cmd.String("password", "", "")
	_ = cmd.Parse(args)
	if *password == "" {
		fatal(logger, errors.New("password is required"))
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DB)
	if err != nil {
		fatal(logger, err)
	}
	defer pool.Close()
	repository := repo.New(pool)
	hash, err := util.HashPassword(*password)
	if err != nil {
		fatal(logger, err)
	}
	admin := &domain.Admin{
		ID:           uuid.New(),
		Username:     *username,
		PasswordHash: hash,
		Role:         "admin",
		CreatedAt:    time.Now().UTC(),
	}
	if err := repository.CreateAdmin(ctx, admin); err != nil {
		fatal(logger, err)
	}
	logger.Info("admin created", "username", admin.Username)
}

func runAdminSetPassword(cfg config.Config, logger *slog.Logger, args []string) {
	cmd := flag.NewFlagSet("admin set-password", flag.ExitOnError)
	username := cmd.String("username", "admin", "")
	password := cmd.String("password", "", "")
	_ = cmd.Parse(args)
	if *password == "" {
		fatal(logger, errors.New("password is required"))
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DB)
	if err != nil {
		fatal(logger, err)
	}
	defer pool.Close()
	repository := repo.New(pool)
	admin, err := repository.GetAdminByUsername(ctx, *username)
	if err != nil {
		fatal(logger, err)
	}
	hash, err := util.HashPassword(*password)
	if err != nil {
		fatal(logger, err)
	}
	if err := repository.UpdateAdminPassword(ctx, admin.ID, hash); err != nil {
		fatal(logger, err)
	}
	logger.Info("admin password updated", "username", admin.Username)
}

func runConfig(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 || args[0] != "render" {
		fatal(logger, errors.New("usage: h2v config render --core <xray|hysteria>"))
	}
	cmd := flag.NewFlagSet("config render", flag.ExitOnError)
	core := cmd.String("core", "xray", "")
	_ = cmd.Parse(args[1:])

	logger = logger.With("core", *core)

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DB)
	if err != nil {
		fatal(logger, fmt.Errorf("connect db for config render: %w", err))
	}
	defer pool.Close()

	repository := repo.New(pool)
	settingsSvc := services.NewSettingsService(cfg, repository, logger)
	configSvc := services.NewConfigService(cfg, settingsSvc, systemctl.New(true), xray.NewClient(cfg.Xray, logger), hysteria.NewClient(cfg.Hysteria, logger), logger)
	content, err := configSvc.Render(ctx, *core)
	if err != nil {
		fatal(logger, err)
	}
	target := cfg.Xray.ConfigPath
	if *core == "hysteria" {
		target = cfg.Hysteria.ConfigPath
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		fatal(logger, err)
	}
	if err := os.WriteFile(target, content, 0o640); err != nil {
		fatal(logger, err)
	}
	logger.Info("config rendered", "path", target)
}

func runGeodata(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 || args[0] != "update" {
		fatal(logger, errors.New("usage: h2v geodata update"))
	}
	ctx := context.Background()
	if err := services.NewGeodataService(cfg.Xray, logger).Update(ctx); err != nil {
		fatal(logger, err)
	}
	logger.Info("core geodata update complete", "dir", cfg.Xray.GeodataDir)
}

func fatal(logger *slog.Logger, err error) {
	logger.Error("command failed", "err", err)
	os.Exit(1)
}
