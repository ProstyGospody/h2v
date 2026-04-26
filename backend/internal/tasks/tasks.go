package tasks

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"sort"
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
	xray     interface{ QueryStats(context.Context) (map[string]domain.TrafficDelta, error) }
	hysteria interface{ GetTraffic(context.Context, bool) (map[string]domain.TrafficDelta, error) }
	logger   *slog.Logger
}

func NewCollector(repository *repo.Repository, xray interface{ QueryStats(context.Context) (map[string]domain.TrafficDelta, error) }, hysteria interface{ GetTraffic(context.Context, bool) (map[string]domain.TrafficDelta, error) }, logger *slog.Logger) *Collector {
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
	}

	if hStats, err := t.hysteria.GetTraffic(ctx, true); err != nil {
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
	logger   *slog.Logger
}

func NewEnforcer(repository *repo.Repository, xray interface{ RemoveUser(context.Context, string) error }, hysteria interface{ Kick(context.Context, []string) error }, cache interface{ Delete(*domain.User) }, logger *slog.Logger) *Enforcer {
	return &Enforcer{repo: repository, xray: xray, hysteria: hysteria, cache: cache, logger: logger}
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
	return nil
}

type Reconciler struct {
	repo   *repo.Repository
	xray   interface {
		ListUsers(context.Context) ([]string, error)
		AddUser(context.Context, *domain.User) error
		RemoveUser(context.Context, string) error
	}
	logger *slog.Logger
}

func NewReconciler(repository *repo.Repository, xray interface {
	ListUsers(context.Context) ([]string, error)
	AddUser(context.Context, *domain.User) error
	RemoveUser(context.Context, string) error
}, logger *slog.Logger) *Reconciler {
	return &Reconciler{repo: repository, xray: xray, logger: logger}
}

func (t *Reconciler) Run(ctx context.Context) error {
	dbUsers, err := t.repo.ListActiveUsers(ctx)
	if err != nil {
		return err
	}
	xUsers, err := t.xray.ListUsers(ctx)
	if err != nil {
		return err
	}

	dbSet := make(map[string]domain.User, len(dbUsers))
	for _, user := range dbUsers {
		dbSet[user.Username] = user
	}
	sort.Strings(xUsers)

	xSet := make(map[string]struct{}, len(xUsers))
	for _, username := range xUsers {
		xSet[username] = struct{}{}
		if _, ok := dbSet[username]; !ok {
			_ = t.xray.RemoveUser(ctx, username)
		}
	}
	for _, user := range dbUsers {
		if _, ok := xSet[user.Username]; !ok {
			_ = t.xray.AddUser(ctx, &user)
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
	filename := fmt.Sprintf("panel-%s.sql.gz", time.Now().UTC().Format("2006-01-02"))
	path := filepath.Join(b.cfg.Backup.Dir, filename)
	cmdStr := fmt.Sprintf("PGPASSWORD=%s pg_dump -h %s -p %d -U %s %s | gzip > %s",
		b.cfg.DB.Password,
		b.cfg.DB.Host,
		b.cfg.DB.Port,
		b.cfg.DB.User,
		b.cfg.DB.Name,
		path,
	)
	cmd := exec.CommandContext(ctx, "sh", "-c", cmdStr)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("backup failed: %s: %w", out, err)
	}
	return rotateOldFiles(b.cfg.Backup.Dir, b.cfg.Backup.RetentionDays)
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
