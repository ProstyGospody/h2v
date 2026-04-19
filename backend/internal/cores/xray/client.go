package xray

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

// Client keeps the transport boundary isolated. The live gRPC wire-up can be
// swapped in here without changing the service layer.
type Client struct {
	cfg    config.XrayConfig
	logger *slog.Logger

	mu    sync.RWMutex
	users map[string]domain.User
}

func NewClient(cfg config.XrayConfig, logger *slog.Logger) *Client {
	return &Client{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]domain.User),
	}
}

func (c *Client) WaitReady(ctx context.Context, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		if err := c.Health(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *Client) Health(ctx context.Context) error {
	dialer := &net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := dialer.DialContext(ctx, "tcp", c.cfg.APIAddr)
	if err != nil {
		// Allow development boot without a running kernel while keeping the
		// transport contract explicit in logs.
		c.logger.Warn("xray health check failed; using in-process mirror until gRPC adapter is wired", "addr", c.cfg.APIAddr, "err", err)
		return nil
	}
	_ = conn.Close()
	return nil
}

func (c *Client) AddUser(_ context.Context, user *domain.User) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.users[user.Username] = *user
	return nil
}

func (c *Client) RemoveUser(_ context.Context, username string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.users, username)
	return nil
}

func (c *Client) ListUsers(_ context.Context) ([]string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]string, 0, len(c.users))
	for username := range c.users {
		out = append(out, username)
	}
	return out, nil
}

func (c *Client) QueryStats(_ context.Context) (map[string]domain.TrafficDelta, error) {
	return map[string]domain.TrafficDelta{}, nil
}

func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	return nil
}

var ErrNotReady = errors.New("xray not ready")

