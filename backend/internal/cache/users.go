package cache

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

var (
	cacheSize = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "user_cache_size",
		Help: "Current cached user count for auth-webhook fast path",
	})
	cacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "user_cache_hits_total",
		Help: "User cache hits",
	})
	cacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "user_cache_misses_total",
		Help: "User cache misses",
	})
)

type UsersCache struct {
	repo *repo.Repository

	mu         sync.RWMutex
	byPassword map[string]domain.User
	size       atomic.Int64
}

func NewUsersCache(repository *repo.Repository) *UsersCache {
	return &UsersCache{
		repo:       repository,
		byPassword: map[string]domain.User{},
	}
}

func (c *UsersCache) LoadAll(ctx context.Context) error {
	users, err := c.repo.ListConnectableUsers(ctx)
	if err != nil {
		return err
	}
	nextPassword := make(map[string]domain.User, len(users))
	for _, user := range users {
		nextPassword[user.Hy2Password] = user
	}

	c.mu.Lock()
	c.byPassword = nextPassword
	c.mu.Unlock()

	c.size.Store(int64(len(users)))
	cacheSize.Set(float64(len(users)))
	return nil
}

func (c *UsersCache) Refresh(ctx context.Context) error {
	return c.LoadAll(ctx)
}

func (c *UsersCache) Set(user *domain.User) {
	if user == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.byPassword[user.Hy2Password] = *user
	c.size.Store(int64(len(c.byPassword)))
	cacheSize.Set(float64(len(c.byPassword)))
}

func (c *UsersCache) Delete(user *domain.User) {
	if user == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.byPassword, user.Hy2Password)
	c.size.Store(int64(len(c.byPassword)))
	cacheSize.Set(float64(len(c.byPassword)))
}

func (c *UsersCache) GetByPassword(password string) (*domain.User, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	user, ok := c.byPassword[password]
	if ok {
		cacheHits.Inc()
		return &user, true
	}
	cacheMisses.Inc()
	return nil, false
}

func (c *UsersCache) Size() int64 {
	return c.size.Load()
}
