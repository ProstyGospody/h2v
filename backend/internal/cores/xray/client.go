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
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

type Client struct {
	cfg    config.XrayConfig
	logger *slog.Logger
}

var execCommandContext = exec.CommandContext

const (
	vlessInboundTag = "vless-reality"
	apiCallTimeout  = 5 * time.Second
)

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

func (c *Client) AddUser(ctx context.Context, user *domain.User) error {
	if user == nil || strings.TrimSpace(c.cfg.Binary) == "" {
		return nil
	}
	if err := c.ensureBinary(); err != nil {
		return err
	}
	content, err := vlessInboundUserConfig(user)
	if err != nil {
		return err
	}
	path, cleanup, err := writeTempAPIConfig(content)
	if err != nil {
		return err
	}
	defer cleanup()

	out, err := c.runAPICommand(ctx, "adu", path)
	if err == nil && (apiUserChangeSucceeded(out, "Added") || toleratedAddUserOutput(out)) {
		return nil
	}
	return apiCommandError("add", user.Username, out, err)
}

func (c *Client) RemoveUser(ctx context.Context, username string) error {
	username = strings.TrimSpace(username)
	if username == "" || strings.TrimSpace(c.cfg.Binary) == "" {
		return nil
	}
	if err := c.ensureBinary(); err != nil {
		return err
	}
	out, err := c.runAPICommand(ctx, "rmu", "-tag", vlessInboundTag, username)
	if err == nil && (apiUserChangeSucceeded(out, "Removed") || toleratedRemoveUserOutput(out)) {
		return nil
	}
	return apiCommandError("remove", username, out, err)
}

func (c *Client) QueryStats(ctx context.Context) (map[string]domain.TrafficDelta, error) {
	if strings.TrimSpace(c.cfg.Binary) == "" {
		return map[string]domain.TrafficDelta{}, nil
	}
	if err := c.ensureBinary(); err != nil {
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
	if err := c.ensureBinary(); err != nil {
		return err
	}
	_, err := c.runStatsQuery(ctx, true)
	return err
}

func (c *Client) ensureBinary() error {
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
		cmd := execCommandContext(ctx, c.cfg.Binary, args...)
		out, err := cmd.CombinedOutput()
		if err == nil {
			return out, nil
		}
		failures = append(failures, fmt.Sprintf("%s: %s", strings.Join(args, " "), strings.TrimSpace(string(out))))
	}
	return nil, fmt.Errorf("xray statsquery failed: %s", strings.Join(failures, "; "))
}

func (c *Client) runAPICommand(ctx context.Context, subcommand string, args ...string) ([]byte, error) {
	deadline, cancel := context.WithTimeout(ctx, apiCallTimeout)
	defer cancel()

	commandArgs := append([]string{"api", subcommand, "-server", c.cfg.APIAddr, "-timeout", strconv.Itoa(int(apiCallTimeout.Seconds()))}, args...)
	cmd := execCommandContext(deadline, c.cfg.Binary, commandArgs...)
	return cmd.CombinedOutput()
}

func vlessInboundUserConfig(user *domain.User) ([]byte, error) {
	payload := map[string]any{
		"inbounds": []map[string]any{
			{
				"tag":      vlessInboundTag,
				"listen":   "127.0.0.1",
				"port":     1,
				"protocol": "vless",
				"settings": map[string]any{
					"clients": []map[string]any{
						{
							"id":    user.VlessUUID.String(),
							"email": user.Username,
							"flow":  "xtls-rprx-vision",
						},
					},
					"decryption": "none",
				},
			},
		},
	}
	return json.Marshal(payload)
}

func writeTempAPIConfig(content []byte) (string, func(), error) {
	tmp, err := os.CreateTemp("", "h2v-xray-user-*.json")
	if err != nil {
		return "", func() {}, err
	}
	cleanup := func() { _ = os.Remove(tmp.Name()) }
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		cleanup()
		return "", func() {}, err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return "", func() {}, err
	}
	path, err := filepath.Abs(tmp.Name())
	if err != nil {
		return tmp.Name(), cleanup, nil
	}
	return path, cleanup, nil
}

func toleratedAddUserOutput(out []byte) bool {
	message := strings.ToLower(string(out))
	return strings.Contains(message, "already exist") ||
		strings.Contains(message, "duplicate")
}

func toleratedRemoveUserOutput(out []byte) bool {
	message := strings.ToLower(string(out))
	return strings.Contains(message, "not found") ||
		strings.Contains(message, "not exist") ||
		strings.Contains(message, "no such user")
}

func apiUserChangeSucceeded(out []byte, verb string) bool {
	fields := strings.Fields(string(out))
	for i := 0; i+1 < len(fields); i++ {
		if !strings.EqualFold(strings.Trim(fields[i], ":"), verb) {
			continue
		}
		count, err := strconv.Atoi(fields[i+1])
		return err == nil && count > 0
	}
	return false
}

func compactOutput(out []byte) string {
	message := strings.Join(strings.Fields(string(out)), " ")
	if message == "" {
		return "xray returned a non-zero exit code"
	}
	if len(message) > 240 {
		return message[:240] + "..."
	}
	return message
}

func apiCommandError(action, username string, out []byte, err error) error {
	message := compactOutput(out)
	if err != nil {
		return fmt.Errorf("xray %s user %q: %s: %w", action, username, message, err)
	}
	return fmt.Errorf("xray %s user %q: %s", action, username, message)
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
