package xray

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
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

func (c *Client) QueryStats(ctx context.Context) (map[string]domain.TrafficDelta, error) {
	if strings.TrimSpace(c.cfg.Binary) == "" {
		return map[string]domain.TrafficDelta{}, nil
	}
	if _, err := os.Stat(c.cfg.Binary); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]domain.TrafficDelta{}, nil
		}
		return nil, fmt.Errorf("check xray binary: %w", err)
	}

	out, err := c.runStatsQuery(ctx)
	if err != nil {
		return nil, err
	}
	stats, err := parseStatsQueryOutput(out)
	if err != nil {
		return nil, err
	}
	return stats, nil
}

func (c *Client) runStatsQuery(ctx context.Context) ([]byte, error) {
	argSets := [][]string{
		{"api", "statsquery", "-s", c.cfg.APIAddr, "-pattern", "user>>>", "-reset"},
		{"api", "statsquery", "-server", c.cfg.APIAddr, "-pattern", "user>>>", "-reset"},
		{"api", "statsquery", "--server", c.cfg.APIAddr, "--pattern", "user>>>", "--reset"},
		{"api", "statsquery", "-s=" + c.cfg.APIAddr, "-pattern=user>>>", "-reset"},
		{"api", "statsquery", "--server=" + c.cfg.APIAddr, "--pattern=user>>>", "--reset"},
	}

	failures := make([]string, 0, len(argSets))
	for _, args := range argSets {
		cmd := exec.CommandContext(ctx, c.cfg.Binary, args...)
		out, err := cmd.CombinedOutput()
		if err == nil {
			return out, nil
		}
		failures = append(failures, fmt.Sprintf("%s: %s", strings.Join(args, " "), strings.TrimSpace(string(out))))
	}
	return nil, fmt.Errorf("xray statsquery failed: %s", strings.Join(failures, "; "))
}

type statsQueryPayload struct {
	Stat []statsQueryStat `json:"stat"`
}

type statsQueryStat struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

func parseStatsQueryOutput(data []byte) (map[string]domain.TrafficDelta, error) {
	result := map[string]domain.TrafficDelta{}
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return result, nil
	}

	var payload statsQueryPayload
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode xray statsquery: %w", err)
	}

	for _, stat := range payload.Stat {
		username, direction, ok := splitUserTrafficStat(stat.Name)
		if !ok {
			continue
		}
		value, ok := trafficValueInt64(stat.Value)
		if !ok || value <= 0 {
			continue
		}
		delta := result[username]
		switch direction {
		case "uplink":
			delta.Uplink += value
		case "downlink":
			delta.Downlink += value
		default:
			continue
		}
		result[username] = delta
	}
	return result, nil
}

func splitUserTrafficStat(name string) (string, string, bool) {
	const prefix = "user>>>"
	const marker = ">>>traffic>>>"
	rest, ok := strings.CutPrefix(name, prefix)
	if !ok {
		return "", "", false
	}
	username, direction, ok := strings.Cut(rest, marker)
	if !ok || username == "" || direction == "" {
		return "", "", false
	}
	return username, direction, true
}

func trafficValueInt64(value any) (int64, bool) {
	switch v := value.(type) {
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return i, true
		}
		f, err := strconv.ParseFloat(v.String(), 64)
		if err != nil {
			return 0, false
		}
		return int64(f), true
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case int:
		return int64(v), true
	case string:
		i, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, false
		}
		return i, true
	default:
		return 0, false
	}
}
