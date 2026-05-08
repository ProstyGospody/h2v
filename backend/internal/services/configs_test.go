package services

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/prost/h2v/backend/internal/config"
)

func TestNormalizeHostnameOnlyStripsSchemeAndPort(t *testing.T) {
	host, ok := normalizeHostnameOnly("https://VPN.Example.COM:8443/settings")
	if !ok {
		t.Fatal("hostname should normalize")
	}
	if host != "vpn.example.com" {
		t.Fatalf("host = %q, want vpn.example.com", host)
	}
}

func TestPrepareXrayConfigForTestRewritesInboundListenPorts(t *testing.T) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(`{"inbounds":[{"listen":"0.0.0.0","port":443,"protocol":"vless"}]}`), &payload); err != nil {
		t.Fatal(err)
	}

	content, err := prepareXrayConfigForTest(payload)
	if err != nil {
		t.Fatal(err)
	}

	var rewritten struct {
		Inbounds []struct {
			Listen string `json:"listen"`
			Port   int    `json:"port"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(content, &rewritten); err != nil {
		t.Fatal(err)
	}
	if len(rewritten.Inbounds) != 1 {
		t.Fatalf("inbounds = %d, want 1", len(rewritten.Inbounds))
	}
	if rewritten.Inbounds[0].Listen != "127.0.0.1" {
		t.Fatalf("listen = %q, want 127.0.0.1", rewritten.Inbounds[0].Listen)
	}
	if rewritten.Inbounds[0].Port == 443 || !validRuntimePort(rewritten.Inbounds[0].Port) {
		t.Fatalf("port = %d, want a valid temporary port", rewritten.Inbounds[0].Port)
	}
}

func TestXrayInboundPortsRejectsNonIntegerPort(t *testing.T) {
	if _, err := xrayInboundPorts([]byte(`{"inbounds":[{"port":8444.5}]}`)); err == nil {
		t.Fatal("expected non-integer port to fail")
	}
}

func TestRestartCoreUsesBoundedTimeout(t *testing.T) {
	previous := coreRestartTimeout
	coreRestartTimeout = 20 * time.Millisecond
	defer func() {
		coreRestartTimeout = previous
	}()

	service := NewConfigService(
		config.Config{},
		nil,
		blockingSystemctl{},
		nil,
		nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)

	started := time.Now()
	err := service.restartCore(context.Background(), "hysteria")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("restartCore error = %v, want context deadline exceeded", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("restartCore took %s, want a bounded timeout", elapsed)
	}
}

func TestRenderXrayConfigWithoutClientsKeepsVLESSInboundWithFallbackClient(t *testing.T) {
	content := renderXrayTemplateForTest(t, RuntimeSettings{
		RealityDest:        "www.cloudflare.com:443",
		RealityPrivateKey:  "private",
		RealityServerNames: []string{"www.cloudflare.com"},
		RealityShortIDs:    []string{"", "a1b2c3d4"},
		VlessPort:          8444,
		Clients:            nil,
		FallbackClient:     ClientEntry{UUID: "22222222-2222-2222-2222-222222222222", Email: "__h2v_no_active_users__"},
	})

	var payload struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Settings struct {
				Clients []struct {
					ID    string `json:"id"`
					Email string `json:"email"`
				} `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Inbounds) != 2 {
		t.Fatalf("inbounds = %d, want api and vless inbounds", len(payload.Inbounds))
	}
	if payload.Inbounds[0].Tag != "api" {
		t.Fatalf("inbound tag = %q, want api", payload.Inbounds[0].Tag)
	}
	if payload.Inbounds[1].Tag != "vless-reality" {
		t.Fatalf("second inbound tag = %q, want vless-reality", payload.Inbounds[1].Tag)
	}
	if len(payload.Inbounds[1].Settings.Clients) != 1 {
		t.Fatalf("fallback clients = %d, want 1", len(payload.Inbounds[1].Settings.Clients))
	}
	if payload.Inbounds[1].Settings.Clients[0].Email != "__h2v_no_active_users__" {
		t.Fatalf("fallback email = %q", payload.Inbounds[1].Settings.Clients[0].Email)
	}
}

func TestRenderXrayConfigWithClientsIncludesVLESSInbound(t *testing.T) {
	content := renderXrayTemplateForTest(t, RuntimeSettings{
		RealityDest:        "www.cloudflare.com:443",
		RealityPrivateKey:  "private",
		RealityServerNames: []string{"www.cloudflare.com"},
		RealityShortIDs:    []string{"", "a1b2c3d4"},
		VlessPort:          8444,
		Clients: []ClientEntry{
			{UUID: "11111111-1111-1111-1111-111111111111", Email: "alice"},
		},
	})

	var payload struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Settings struct {
				Clients []struct {
					ID    string `json:"id"`
					Email string `json:"email"`
				} `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}

	for _, inbound := range payload.Inbounds {
		if inbound.Tag != "vless-reality" {
			continue
		}
		if len(inbound.Settings.Clients) != 1 {
			t.Fatalf("vless clients = %d, want 1", len(inbound.Settings.Clients))
		}
		if inbound.Settings.Clients[0].Email != "alice" {
			t.Fatalf("client email = %q, want alice", inbound.Settings.Clients[0].Email)
		}
		return
	}
	t.Fatal("vless-reality inbound not found")
}

func renderXrayTemplateForTest(t *testing.T, runtime RuntimeSettings) []byte {
	t.Helper()

	cfg := config.Config{
		Panel: config.PanelConfig{
			TemplatesDir: filepath.Join("..", "..", "..", "templates"),
		},
	}
	service := NewConfigService(cfg, nil, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	content, err := service.RenderWithRuntime("xray", runtime)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

type blockingSystemctl struct{}

func (blockingSystemctl) Restart(ctx context.Context, _ string) error {
	<-ctx.Done()
	return ctx.Err()
}

func (blockingSystemctl) Stop(context.Context, string) error {
	return nil
}
