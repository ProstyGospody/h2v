package hysteria

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.TrafficURL+"/traffic", nil)
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

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Warn("hysteria traffic request failed", "err", err)
		return map[string]domain.TrafficDelta{}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return map[string]domain.TrafficDelta{}, nil
	}

	payload := map[string]struct {
		Tx int64 `json:"tx"`
		Rx int64 `json:"rx"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode hysteria traffic: %w", err)
	}

	result := make(map[string]domain.TrafficDelta, len(payload))
	for username, stat := range payload {
		result[username] = domain.TrafficDelta{Uplink: stat.Tx, Downlink: stat.Rx}
	}
	return result, nil
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
