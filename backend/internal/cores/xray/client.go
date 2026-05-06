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
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

// Client keeps the transport boundary isolated. The live gRPC wire-up can be
// swapped in here without changing the service layer.
type Client struct {
	cfg    config.XrayConfig
	logger *slog.Logger
}

func NewClient(cfg config.XrayConfig, logger *slog.Logger) *Client {
	return &Client{
		cfg:    cfg,
		logger: logger,
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
		return fmt.Errorf("xray api unavailable at %s: %w", c.cfg.APIAddr, err)
	}
	_ = conn.Close()
	return nil
}

func (_ *Client) AddUser(_ context.Context, _ *domain.User) error {
	return nil
}

func (_ *Client) RemoveUser(_ context.Context, _ string) error {
	return nil
}

func (c *Client) QueryStats(ctx context.Context) (map[string]domain.TrafficDelta, error) {
	if strings.TrimSpace(c.cfg.Binary) == "" {
		return map[string]domain.TrafficDelta{}, nil
	}
	if err := c.ensureStatsBinary(); err != nil {
		return nil, err
	}
	out, err := c.runStatsQuery(ctx, false)
	if err != nil {
		return nil, err
	}
	stats, err := parseStatsQueryOutput(out)
	if err != nil {
		return nil, err
	}
	return stats, nil
}

func (c *Client) ResetStats(ctx context.Context) error {
	if strings.TrimSpace(c.cfg.Binary) == "" {
		return nil
	}
	if err := c.ensureStatsBinary(); err != nil {
		return err
	}
	_, err := c.runStatsQuery(ctx, true)
	return err
}

func (c *Client) ensureStatsBinary() error {
	if _, err := os.Stat(c.cfg.Binary); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("xray binary %q not found", c.cfg.Binary)
		}
		return fmt.Errorf("check xray binary: %w", err)
	}
	return nil
}

func (c *Client) runStatsQuery(ctx context.Context, reset bool) ([]byte, error) {
	argSets := [][]string{
		{"api", "statsquery", "-s", c.cfg.APIAddr, "-pattern", "user>>>"},
		{"api", "statsquery", "-server", c.cfg.APIAddr, "-pattern", "user>>>"},
		{"api", "statsquery", "--server", c.cfg.APIAddr, "--pattern", "user>>>"},
		{"api", "statsquery", "-s=" + c.cfg.APIAddr, "-pattern=user>>>"},
		{"api", "statsquery", "--server=" + c.cfg.APIAddr, "--pattern=user>>>"},
	}
	resetFlags := []string{"-reset", "-reset", "--reset", "-reset", "--reset"}

	failures := make([]string, 0, len(argSets))
	for i, args := range argSets {
		if reset {
			args = append(append([]string{}, args...), resetFlags[i])
		}
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
