package main

import (
	"context"
	"database/sql"
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
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

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

var version = "0.1.0"

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))

	if len(os.Args) < 2 {
		fatal(logger, errors.New("expected subcommand: serve | migrate up | admin create | admin set-password | config render"))
	}

	switch os.Args[1] {
	case "serve":
		runServe(cfg, logger)
	case "migrate":
		runMigrate(cfg, logger, os.Args[2:])
	case "admin":
		runAdmin(cfg, logger, os.Args[2:])
	case "config":
		runConfig(cfg, logger, os.Args[2:])
	default:
		fatal(logger, fmt.Errorf("unknown subcommand %q", os.Args[1]))
	}
}

func runServe(cfg config.Config, logger *slog.Logger) {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, repository, svc, scheduler, httpServer := buildApp(ctx, cfg, logger)
	defer pool.Close()

	go scheduler.Start(ctx)
	go func() {
		logger.Info("http server starting", "addr", config.Address(cfg.Panel.Host, cfg.Panel.Port))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal(logger, err)
		}
	}()

	_, _ = daemon.SdNotify(false, daemon.SdNotifyReady)
	<-ctx.Done()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown failed", "err", err)
	}
	_ = svc
	_ = repository
	logger.Info("shutdown complete")
}

func buildApp(ctx context.Context, cfg config.Config, logger *slog.Logger) (*pgxpool.Pool, *repo.Repository, *services.Services, *tasks.Scheduler, *api.Server) {
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
		Systemctl: systemctl.New(cfg.Panel.DisableSystemctl),
		Cache:     userCache,
		Logger:    logger,
		Version:   version,
		StartedAt: time.Now(),
	})

	if err := serviceBundle.Settings.Bootstrap(ctx); err != nil {
		logger.Warn("settings bootstrap failed", "err", err)
	}

	if err := serviceBundle.Configs.ReconcileXray(ctx); err != nil {
		logger.Warn("initial xray config reconcile failed", "err", err)
	}

	reconciler := tasks.NewReconciler(repository, xrayClient, logger)
	if err := reconciler.Run(ctx); err != nil {
		logger.Warn("initial reconcile failed", "err", err)
	}
	scheduler := tasks.NewScheduler(logger)
	scheduler.Every("collector", 10*time.Second, tasks.NewCollector(repository, xrayClient, hysteriaClient, logger).Run)
	scheduler.Every("enforcer", 30*time.Second, tasks.NewEnforcer(repository, xrayClient, hysteriaClient, userCache, logger).Run)
	scheduler.Every("reconciler", 60*time.Second, reconciler.Run)
	scheduler.Every("cache_refresh", 5*time.Minute, userCache.Refresh)
	scheduler.Every("backup", 24*time.Hour, tasks.NewBackup(cfg).Run)

	httpServer := api.New(cfg, serviceBundle, logger)
	return pool, repository, serviceBundle, scheduler, httpServer
}

func runMigrate(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 || args[0] != "up" {
		fatal(logger, errors.New("usage: panel migrate up"))
	}
	dbHandle, err := sql.Open("pgx", db.DSN(cfg.DB))
	if err != nil {
		fatal(logger, err)
	}
	defer dbHandle.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		fatal(logger, err)
	}
	dir := filepath.Join(cfg.Panel.RootDir, "migrations")
	if _, err := os.Stat(dir); err != nil {
		dir = filepath.Join("migrations")
	}
	if _, err := os.Stat(dir); err != nil {
		dir = filepath.Join("backend", "migrations")
	}
	if err := goose.Up(dbHandle, dir); err != nil {
		fatal(logger, err)
	}
	logger.Info("migrations applied")
}

func runAdmin(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 {
		fatal(logger, errors.New("usage: panel admin <create|set-password> --username <name> --password <password>"))
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
	role := cmd.String("role", "admin", "")
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
		Role:         *role,
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
	if err := repository.UpdateAdminPassword(ctx, admin.ID, hash, admin.TOTPSecret); err != nil {
		fatal(logger, err)
	}
	logger.Info("admin password updated", "username", admin.Username)
}

func runConfig(cfg config.Config, logger *slog.Logger, args []string) {
	if len(args) == 0 || args[0] != "render" {
		fatal(logger, errors.New("usage: panel config render --core <xray|hysteria>"))
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
	configSvc := services.NewConfigService(cfg, repository, settingsSvc, systemctl.New(true), xray.NewClient(cfg.Xray, logger), hysteria.NewClient(cfg.Hysteria, logger), logger)
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

func fatal(logger *slog.Logger, err error) {
	logger.Error("command failed", "err", err)
	os.Exit(1)
}
