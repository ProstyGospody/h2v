package tasks

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

var (
	taskDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "task_duration_seconds",
		Help:    "Background task duration",
		Buckets: prometheus.DefBuckets,
	}, []string{"task"})
	taskErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "task_errors_total",
		Help: "Background task errors",
	}, []string{"task"})
)

type Task struct {
	Name     string
	Interval time.Duration
	Fn       func(context.Context) error
	mu       sync.Mutex
}

type Scheduler struct {
	logger *slog.Logger
	tasks  []*Task
}

func NewScheduler(logger *slog.Logger) *Scheduler {
	return &Scheduler{logger: logger}
}

func (s *Scheduler) Every(name string, interval time.Duration, fn func(context.Context) error) {
	s.tasks = append(s.tasks, &Task{Name: name, Interval: interval, Fn: fn})
}

func (s *Scheduler) Start(ctx context.Context) {
	for _, task := range s.tasks {
		go s.run(ctx, task)
	}
}

func (s *Scheduler) run(ctx context.Context, task *Task) {
	ticker := time.NewTicker(task.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !task.mu.TryLock() {
				s.logger.Warn("task overlap", "task", task.Name)
				continue
			}
			go func(t *Task) {
				defer t.mu.Unlock()
				defer func() {
					if r := recover(); r != nil {
						s.logger.Error("task panic", "task", t.Name, "panic", r, "stack", string(debug.Stack()))
					}
				}()
				taskCtx, cancel := context.WithTimeout(ctx, t.Interval*2)
				defer cancel()
				start := time.Now()
				if err := t.Fn(taskCtx); err != nil {
					taskErrors.WithLabelValues(t.Name).Inc()
					s.logger.Error("task failed", "task", t.Name, "err", err)
				}
				taskDuration.WithLabelValues(t.Name).Observe(time.Since(start).Seconds())
			}(task)
		}
	}
}

type Collector struct {
	repo     *repo.Repository
	xray     interface {
		QueryStats(context.Context) (map[string]domain.TrafficDelta, error)
		ResetStats(context.Context) error
	}
	hysteria interface{ GetTraffic(context.Context, bool) (map[string]domain.TrafficDelta, error) }
	logger   *slog.Logger
}

func NewCollector(repository *repo.Repository, xray interface {
	QueryStats(context.Context) (map[string]domain.TrafficDelta, error)
	ResetStats(context.Context) error
}, hysteria interface{ GetTraffic(context.Context, bool) (map[string]domain.TrafficDelta, error) }, logger *slog.Logger) *Collector {
	return &Collector{repo: repository, xray: xray, hysteria: hysteria, logger: logger}
}

func (t *Collector) Run(ctx context.Context) error {
	if xStats, err := t.xray.QueryStats(ctx); err != nil {
		t.logger.Warn("xray stats failed", "err", err)
	} else if len(xStats) > 0 {
		matched, err := t.repo.AddTrafficBatch(ctx, "xray", xStats)
		if err != nil {
			return fmt.Errorf("save xray traffic: %w", err)
		}
		t.logger.Info("xray stats saved", "users_reported", len(xStats), "users_matched", matched)
		if matched == 0 {
			t.logger.Warn("xray stats username mismatch — emails in xray config do not match users.username", "reported", keysOf(xStats))
		}
		if err := t.xray.ResetStats(ctx); err != nil {
			t.logger.Warn("xray stats reset failed after save; next collection may double count", "err", err)
		}
	}

	if hStats, err := t.hysteria.GetTraffic(ctx, false); err != nil {
		t.logger.Warn("hysteria traffic failed", "err", err)
	} else if len(hStats) > 0 {
		matched, err := t.repo.AddTrafficBatch(ctx, "hysteria", hStats)
		if err != nil {
			return fmt.Errorf("save hysteria traffic: %w", err)
		}
		t.logger.Info("hysteria stats saved", "users_reported", len(hStats), "users_matched", matched)
		if matched == 0 {
			t.logger.Warn("hysteria stats username mismatch — auth callback ids do not match users.username", "reported", keysOf(hStats))
		}
		if _, err := t.hysteria.GetTraffic(ctx, true); err != nil {
			t.logger.Warn("hysteria traffic reset failed after save; next collection may double count", "err", err)
		}
	}
	return nil
}

func keysOf(m map[string]domain.TrafficDelta) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

type Enforcer struct {
	repo     *repo.Repository
	xray     interface{ RemoveUser(context.Context, string) error }
	hysteria interface{ Kick(context.Context, []string) error }
	cache    interface{ Delete(*domain.User) }
	reconcileXray func(context.Context) error
	logger   *slog.Logger
}

func NewEnforcer(repository *repo.Repository, xray interface{ RemoveUser(context.Context, string) error }, hysteria interface{ Kick(context.Context, []string) error }, cache interface{ Delete(*domain.User) }, reconcileXray func(context.Context) error, logger *slog.Logger) *Enforcer {
	return &Enforcer{repo: repository, xray: xray, hysteria: hysteria, cache: cache, reconcileXray: reconcileXray, logger: logger}
}

func (t *Enforcer) Run(ctx context.Context) error {
	users, err := t.repo.FindOffenders(ctx)
	if err != nil {
		return err
	}
	for _, user := range users {
		status := domain.StatusLimited
		if user.IsExpired() {
			status = domain.StatusExpired
		}
		if err := t.repo.UpdateUserStatus(ctx, user.ID, status); err != nil {
			t.logger.Error("enforcer update status failed", "user", user.Username, "err", err)
			continue
		}
		_ = t.xray.RemoveUser(ctx, user.Username)
		_ = t.hysteria.Kick(ctx, []string{user.Username})
		t.cache.Delete(&user)
	}
	if len(users) > 0 && t.reconcileXray != nil {
		if err := t.reconcileXray(ctx); err != nil {
			return fmt.Errorf("reconcile xray after enforcement: %w", err)
		}
	}
	return nil
}

type CoreReconciler struct {
	reconcileXray     func(context.Context) error
	reconcileHysteria func(context.Context) error
	logger            *slog.Logger
}

func NewCoreReconciler(reconcileXray, reconcileHysteria func(context.Context) error, logger *slog.Logger) *CoreReconciler {
	return &CoreReconciler{reconcileXray: reconcileXray, reconcileHysteria: reconcileHysteria, logger: logger}
}

func (t *CoreReconciler) Run(ctx context.Context) error {
	if t.reconcileXray != nil {
		if err := t.reconcileXray(ctx); err != nil {
			return fmt.Errorf("reconcile xray: %w", err)
		}
	}
	if t.reconcileHysteria != nil {
		if err := t.reconcileHysteria(ctx); err != nil {
			return fmt.Errorf("reconcile hysteria: %w", err)
		}
	}
	return nil
}

type Backup struct {
	cfg config.Config
}

func NewBackup(cfg config.Config) *Backup {
	return &Backup{cfg: cfg}
}

func (b *Backup) Run(ctx context.Context) error {
	if err := os.MkdirAll(b.cfg.Backup.Dir, 0o750); err != nil {
		return err
	}
	filename := fmt.Sprintf("panel-%s.sql.gz", time.Now().UTC().Format("2006-01-02-150405"))
	path := filepath.Join(b.cfg.Backup.Dir, filename)
	tmpPath := path + ".tmp"
	if err := dumpPostgresBackup(ctx, b.cfg.DB, tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("commit backup file: %w", err)
	}
	return rotateOldFiles(b.cfg.Backup.Dir, b.cfg.Backup.RetentionDays)
}

func dumpPostgresBackup(ctx context.Context, db config.DBConfig, path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}

	gzipWriter := gzip.NewWriter(file)
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "pg_dump", "-h", db.Host, "-p", strconv.Itoa(db.Port), "-U", db.User, db.Name)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+db.Password)
	if strings.TrimSpace(db.SSLMode) != "" {
		cmd.Env = append(cmd.Env, "PGSSLMODE="+db.SSLMode)
	}
	cmd.Stdout = gzipWriter
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	closeGzipErr := gzipWriter.Close()
	closeFileErr := file.Close()
	if runErr != nil {
		return fmt.Errorf("backup failed: %s: %w", strings.TrimSpace(stderr.String()), runErr)
	}
	if closeGzipErr != nil {
		return fmt.Errorf("finish backup gzip: %w", closeGzipErr)
	}
	if closeFileErr != nil {
		return fmt.Errorf("finish backup file: %w", closeFileErr)
	}
	return nil
}

type TrafficRetention struct {
	repo          *repo.Repository
	retentionDays int
	logger        *slog.Logger
}

func NewTrafficRetention(repository *repo.Repository, retentionDays int, logger *slog.Logger) *TrafficRetention {
	return &TrafficRetention{repo: repository, retentionDays: retentionDays, logger: logger}
}

func (t *TrafficRetention) Run(ctx context.Context) error {
	if t.retentionDays <= 0 {
		return nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -t.retentionDays)
	deleted, err := t.repo.PurgeTrafficBefore(ctx, cutoff)
	if err != nil {
		return fmt.Errorf("purge traffic log: %w", err)
	}
	if deleted > 0 {
		t.logger.Info("traffic log retention applied", "deleted", deleted, "retention_days", t.retentionDays)
	}
	return nil
}

func rotateOldFiles(dir string, keepDays int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -keepDays)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
