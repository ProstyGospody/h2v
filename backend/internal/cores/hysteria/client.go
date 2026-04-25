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
		c.logger.Warn("hysteria traffic request failed", "err", err)
		return map[string]domain.TrafficDelta{}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return map[string]domain.TrafficDelta{}, nil
	}

	var payload any
	decoder := json.NewDecoder(resp.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode hysteria traffic: %w", err)
	}

	return parseTrafficPayload(payload), nil
}

func parseTrafficPayload(payload any) map[string]domain.TrafficDelta {
	root, ok := payload.(map[string]any)
	if !ok {
		return map[string]domain.TrafficDelta{}
	}
	if result := parseTrafficMap(root); len(result) > 0 {
		return result
	}
	for _, key := range []string{"users", "traffic", "stats", "data"} {
		nested, ok := root[key].(map[string]any)
		if !ok {
			continue
		}
		if result := parseTrafficMap(nested); len(result) > 0 {
			return result
		}
	}
	return map[string]domain.TrafficDelta{}
}

func parseTrafficMap(payload map[string]any) map[string]domain.TrafficDelta {
	result := make(map[string]domain.TrafficDelta, len(payload))
	for username, raw := range payload {
		delta, ok := parseTrafficCounters(raw)
		if !ok || (delta.Uplink <= 0 && delta.Downlink <= 0) {
			continue
		}
		result[username] = delta
	}
	return result
}

func parseTrafficCounters(raw any) (domain.TrafficDelta, bool) {
	payload, ok := raw.(map[string]any)
	if !ok {
		return domain.TrafficDelta{}, false
	}
	uplink, upOK := firstCounter(payload, "tx", "upload", "uplink", "up", "sent", "send")
	downlink, downOK := firstCounter(payload, "rx", "download", "downlink", "down", "recv", "receive", "received")
	if !upOK && !downOK {
		return domain.TrafficDelta{}, false
	}
	return domain.TrafficDelta{Uplink: uplink, Downlink: downlink}, true
}

func firstCounter(payload map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			if counter, ok := trafficCounterInt64(value); ok {
				return counter, true
			}
		}
		for existingKey, value := range payload {
			if strings.EqualFold(existingKey, key) {
				if counter, ok := trafficCounterInt64(value); ok {
					return counter, true
				}
			}
		}
	}
	return 0, false
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
