package hysteria

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

type Client struct {
	cfg        config.HysteriaConfig
	httpClient *http.Client
	logger     *slog.Logger
}

func NewClient(cfg config.HysteriaConfig, logger *slog.Logger) *Client {
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 2 * time.Second,
		},
		logger: logger,
	}
}

func (c *Client) Health(ctx context.Context) error {
	parsed, err := url.Parse(c.cfg.TrafficURL)
	if err != nil {
		return fmt.Errorf("invalid hysteria traffic API URL %q: %w", c.cfg.TrafficURL, err)
	}
	if parsed.Host == "" {
		return fmt.Errorf("invalid hysteria traffic API URL %q: missing host", c.cfg.TrafficURL)
	}
	addr := parsed.Host
	conn, err := (&net.Dialer{Timeout: 500 * time.Millisecond}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("hysteria traffic API unavailable at %s: %w", addr, err)
	}
	_ = conn.Close()
	return nil
}

func (c *Client) GetTraffic(ctx context.Context, reset bool) (map[string]domain.TrafficDelta, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.cfg.TrafficURL, "/")+"/traffic", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	if reset {
		q.Set("clear", "1")
	}
	req.URL.RawQuery = q.Encode()
	if c.cfg.TrafficSecret != "" {
		req.Header.Set("Authorization", c.cfg.TrafficSecret)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hysteria traffic request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read hysteria traffic response: %w", err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("hysteria traffic API returned %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var payload any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode hysteria traffic: %w", err)
	}

	stats := parseTrafficPayload(payload)
	c.logger.Debug("hysteria traffic collected", "users", len(stats))
	return stats, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func parseTrafficPayload(payload any) map[string]domain.TrafficDelta {
	root, ok := payload.(map[string]any)
	if !ok {
		return map[string]domain.TrafficDelta{}
	}
	result := make(map[string]domain.TrafficDelta, len(root))
	for username, raw := range root {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		tx, _ := trafficCounterInt64(entry["tx"])
		rx, _ := trafficCounterInt64(entry["rx"])
		if tx <= 0 && rx <= 0 {
			continue
		}
		result[username] = domain.TrafficDelta{Uplink: tx, Downlink: rx}
	}
	return result
}

func trafficCounterInt64(value any) (int64, bool) {
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

func (c *Client) Kick(ctx context.Context, usernames []string) error {
	if len(usernames) == 0 {
		return nil
	}
	body, err := json.Marshal(usernames)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TrafficURL+"/kick", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.TrafficSecret != "" {
		req.Header.Set("Authorization", c.cfg.TrafficSecret)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Warn("hysteria kick request failed", "err", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		c.logger.Warn("hysteria kick rejected", "status", resp.StatusCode)
	}
	return nil
}
