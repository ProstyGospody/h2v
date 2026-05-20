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

type xrayRouteRuleForTest struct {
	Domain []string `json:"domain"`
	IP     []string `json:"ip"`
}

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

func TestConfigOverridePatchReappliesManualBlocksToFreshManagedConfig(t *testing.T) {
	managed := []byte(`{
		"log":{"loglevel":"warning"},
		"inbounds":[{"tag":"vless-reality","settings":{"clients":["old"]}}],
		"routing":{"rules":[{"domain":["geosite:category-ru"]}]}
	}`)
	edited := []byte(`{
		"log":{"loglevel":"warning"},
		"inbounds":[{"tag":"vless-reality","settings":{"clients":["old"]}}],
		"routing":{"rules":[{"domain":["geosite:category-ru"]},{"ip":["geoip:private"],"outboundTag":"block"}]}
	}`)
	patch, err := configOverridePatch(managed, edited)
	if err != nil {
		t.Fatal(err)
	}

	freshManaged := []byte(`{
		"log":{"loglevel":"warning"},
		"inbounds":[{"tag":"vless-reality","settings":{"clients":["new"]}}],
		"routing":{"rules":[{"domain":["geosite:category-ru"]}]}
	}`)
	merged, err := applyConfigOverridePatch(freshManaged, patch)
	if err != nil {
		t.Fatal(err)
	}

	var payload struct {
		Inbounds []struct {
			Settings struct {
				Clients []string `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
		Routing struct {
			Rules []xrayRouteRuleForTest `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(merged, &payload); err != nil {
		t.Fatal(err)
	}
	if got := payload.Inbounds[0].Settings.Clients[0]; got != "new" {
		t.Fatalf("managed client = %q, want new", got)
	}
	if !routingHasIPRule(payload.Routing.Rules, "geoip:private") {
		t.Fatalf("manual routing rule was not reapplied: %s", merged)
	}
}

func TestConfigOverridePatchRejectsManagedArrayChanges(t *testing.T) {
	managed := []byte(`{"inbounds":[{"tag":"vless-reality","settings":{"clients":["old"]}}]}`)
	edited := []byte(`{"inbounds":[{"tag":"vless-reality","settings":{"clients":["stale"]}}]}`)
	if _, err := configOverridePatch(managed, edited); err == nil {
		t.Fatal("managed inbounds array change should fail")
	}
}

func TestApplyLegacyArrayOverrideKeepsManagedArray(t *testing.T) {
	freshManaged := []byte(`{"inbounds":[{"tag":"vless-reality","settings":{"clients":["new"]}}]}`)
	legacyPatch := []byte(`{"inbounds":[{"tag":"vless-reality","settings":{"clients":["old"]}}]}`)
	merged, err := applyConfigOverridePatch(freshManaged, legacyPatch)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Inbounds []struct {
			Settings struct {
				Clients []string `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(merged, &payload); err != nil {
		t.Fatal(err)
	}
	if got := payload.Inbounds[0].Settings.Clients[0]; got != "new" {
		t.Fatalf("managed client = %q, want new", got)
	}
}

func TestValidateHysteriaConfigRejectsMissingTrafficSecret(t *testing.T) {
	content := renderHysteriaTemplateForTest(t, RuntimeSettings{
		H2VPort:          8000,
		Hy2Port:          8443,
		Hy2Domain:        "vpn.example.com",
		Hy2CertPath:      "/etc/letsencrypt/live/vpn.example.com/fullchain.pem",
		Hy2KeyPath:       "/etc/letsencrypt/live/vpn.example.com/privkey.pem",
		Hy2BandwidthUp:   "1 gbps",
		Hy2BandwidthDown: "1 gbps",
		Hy2TrafficListen: "127.0.0.1:7653",
		GeoIPPath:        "/opt/h2v/data/geodata/geoip.dat",
		GeositePath:      "/opt/h2v/data/geodata/geosite.dat",
	})
	service := NewConfigService(config.Config{}, nil, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := service.Validate(context.Background(), "hysteria", content); err == nil {
		t.Fatal("missing trafficStats.secret should fail")
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
	runtime := baseXrayRuntimeForTest()
	runtime.Clients = nil
	runtime.FallbackClient = ClientEntry{UUID: "22222222-2222-2222-2222-222222222222", Email: "__h2v_no_active_users__"}
	content := renderXrayTemplateForTest(t, runtime)

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
	runtime := baseXrayRuntimeForTest()
	runtime.Clients = []ClientEntry{
		{UUID: "11111111-1111-1111-1111-111111111111", Email: "alice"},
	}
	content := renderXrayTemplateForTest(t, runtime)

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

func TestRenderXrayConfigSortsClientsForStableOutput(t *testing.T) {
	runtime := baseXrayRuntimeForTest()
	runtime.Clients = []ClientEntry{
		{UUID: "22222222-2222-2222-2222-222222222222", Email: "bob"},
		{UUID: "11111111-1111-1111-1111-111111111111", Email: "alice"},
	}
	content := renderXrayTemplateForTest(t, runtime)

	var payload struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Settings struct {
				Clients []struct {
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
		if len(inbound.Settings.Clients) != 2 {
			t.Fatalf("vless clients = %d, want 2", len(inbound.Settings.Clients))
		}
		got := []string{inbound.Settings.Clients[0].Email, inbound.Settings.Clients[1].Email}
		if want := []string{"alice", "bob"}; !stringSlicesEqual(got, want) {
			t.Fatalf("client order = %#v, want %#v", got, want)
		}
		return
	}
	t.Fatal("vless-reality inbound not found")
}

func TestRenderXrayConfigUsesStabilityRoutingAndSniffingDefaults(t *testing.T) {
	content := renderXrayTemplateForTest(t, baseXrayRuntimeForTest())

	var payload struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			StreamSettings struct {
				RealitySettings struct {
					Target string `json:"target"`
				} `json:"realitySettings"`
			} `json:"streamSettings"`
			Sniffing struct {
				Enabled      bool     `json:"enabled"`
				DestOverride []string `json:"destOverride"`
				RouteOnly    bool     `json:"routeOnly"`
			} `json:"sniffing"`
		} `json:"inbounds"`
		Routing struct {
			DomainStrategy string `json:"domainStrategy"`
			Rules          []xrayRouteRuleForTest `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}

	var sniffing struct {
		Enabled      bool
		DestOverride []string
		RouteOnly    bool
	}
	var realityTarget string
	for _, inbound := range payload.Inbounds {
		if inbound.Tag == "vless-reality" {
			realityTarget = inbound.StreamSettings.RealitySettings.Target
			sniffing.Enabled = inbound.Sniffing.Enabled
			sniffing.DestOverride = inbound.Sniffing.DestOverride
			sniffing.RouteOnly = inbound.Sniffing.RouteOnly
			break
		}
	}
	if !sniffing.Enabled || !sniffing.RouteOnly {
		t.Fatalf("sniffing = %#v, want enabled routeOnly", sniffing)
	}
	if got, want := sniffing.DestOverride, []string{"http", "tls"}; !stringSlicesEqual(got, want) {
		t.Fatalf("destOverride = %#v, want %#v", got, want)
	}
	if got, want := realityTarget, "www.google.com:443"; got != want {
		t.Fatalf("reality target = %q, want %q", got, want)
	}
	if payload.Routing.DomainStrategy != "AsIs" {
		t.Fatalf("domainStrategy = %q, want AsIs", payload.Routing.DomainStrategy)
	}
	if !routingHasDomainRule(payload.Routing.Rules, "geosite:category-ru") {
		t.Fatalf("routing missing geosite:category-ru rule: %#v", payload.Routing.Rules)
	}
	if !routingHasIPRule(payload.Routing.Rules, "geoip:ru") {
		t.Fatalf("routing missing geoip:ru rule: %#v", payload.Routing.Rules)
	}
}

func TestRenderXrayConfigUsesConfiguredGeoRejectRules(t *testing.T) {
	runtime := baseXrayRuntimeForTest()
	runtime.GeoBlockedCountries = []string{"cn", "ir"}
	runtime.GeoBlockedGeositeTags = nil
	content := renderXrayTemplateForTest(t, runtime)

	var payload struct {
		Routing struct {
			Rules []xrayRouteRuleForTest `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if !routingHasIPRule(payload.Routing.Rules, "geoip:cn") || !routingHasIPRule(payload.Routing.Rules, "geoip:ir") {
		t.Fatalf("routing missing configured country blocks: %#v", payload.Routing.Rules)
	}
	if routingHasDomainRule(payload.Routing.Rules, "geosite:category-ru") {
		t.Fatalf("routing should not include Russian geosite block when Russia is disabled: %#v", payload.Routing.Rules)
	}
}

func TestRenderXrayConfigOmitsGeoRejectRulesWhenCountriesDisabled(t *testing.T) {
	runtime := baseXrayRuntimeForTest()
	runtime.GeoBlockedCountries = nil
	runtime.GeoBlockedGeositeTags = nil
	content := renderXrayTemplateForTest(t, runtime)

	var payload struct {
		Routing struct {
			Rules []xrayRouteRuleForTest `json:"rules"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if routingHasIPRule(payload.Routing.Rules, "geoip:ru") || routingHasDomainRule(payload.Routing.Rules, "geosite:category-ru") {
		t.Fatalf("routing should not include country rejects when countries are disabled: %#v", payload.Routing.Rules)
	}
}

func TestRenderHysteriaConfigUsesRegionalStabilityDefaults(t *testing.T) {
	runtime := RuntimeSettings{
		H2VPort:        8000,
		Hy2Port:          8443,
		Hy2Domain:        "vpn.example.com",
		Hy2CertPath:      "/etc/letsencrypt/live/vpn.example.com/fullchain.pem",
		Hy2KeyPath:       "/etc/letsencrypt/live/vpn.example.com/privkey.pem",
		Hy2BandwidthUp:   "1 gbps",
		Hy2BandwidthDown: "1 gbps",
		Hy2TrafficSecret: "traffic-secret",
		Hy2TrafficListen: "127.0.0.1:7653",
		Hy2ObfsEnabled:   true,
		Hy2ObfsPassword:  "obfs-secret",
		GeoIPPath:        "/opt/h2v/data/geodata/geoip.dat",
		GeositePath:      "/opt/h2v/data/geodata/geosite.dat",
		GeoBlockedCountries:   []string{"ru"},
		GeoBlockedGeositeTags: []string{"category-ru"},
	}
	content := renderHysteriaTemplateForTest(t, runtime)

	var payload struct {
		Congestion struct {
			Type       string `json:"type"`
			BBRProfile string `json:"bbrProfile"`
		} `json:"congestion"`
		Sniff struct {
			Enable        bool   `json:"enable"`
			Timeout       string `json:"timeout"`
			RewriteDomain bool   `json:"rewriteDomain"`
			TCPPorts      string `json:"tcpPorts"`
			UDPPorts      string `json:"udpPorts"`
		} `json:"sniff"`
		ACL struct {
			Inline []string `json:"inline"`
		} `json:"acl"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Congestion.Type != "bbr" || payload.Congestion.BBRProfile != "conservative" {
		t.Fatalf("congestion = %#v, want bbr/conservative", payload.Congestion)
	}
	if !payload.Sniff.Enable || payload.Sniff.Timeout != "2s" || payload.Sniff.RewriteDomain {
		t.Fatalf("sniff = %#v, want enabled 2s without rewrite", payload.Sniff)
	}
	if payload.Sniff.TCPPorts != "80,443" || payload.Sniff.UDPPorts != "443" {
		t.Fatalf("sniff ports = %#v, want tcp 80,443 and udp 443", payload.Sniff)
	}
	if got, want := payload.ACL.Inline, []string{"reject(geosite:category-ru)", "reject(geoip:ru)"}; !stringSlicesEqual(got, want) {
		t.Fatalf("acl inline = %#v, want %#v", got, want)
	}
}

func TestRenderHysteriaConfigOmitsGeoRejectRulesWhenCountriesDisabled(t *testing.T) {
	runtime := RuntimeSettings{
		H2VPort:          8000,
		Hy2Port:          8443,
		Hy2Domain:        "vpn.example.com",
		Hy2CertPath:      "/etc/letsencrypt/live/vpn.example.com/fullchain.pem",
		Hy2KeyPath:       "/etc/letsencrypt/live/vpn.example.com/privkey.pem",
		Hy2BandwidthUp:   "1 gbps",
		Hy2BandwidthDown: "1 gbps",
		Hy2TrafficSecret: "traffic-secret",
		Hy2TrafficListen: "127.0.0.1:7653",
		Hy2ObfsEnabled:   true,
		Hy2ObfsPassword:  "obfs-secret",
		GeoIPPath:        "/opt/h2v/data/geodata/geoip.dat",
		GeositePath:      "/opt/h2v/data/geodata/geosite.dat",
	}
	content := renderHysteriaTemplateForTest(t, runtime)

	var payload struct {
		ACL struct {
			Inline []string `json:"inline"`
		} `json:"acl"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ACL.Inline) != 0 {
		t.Fatalf("acl inline = %#v, want no country rejects", payload.ACL.Inline)
	}
}

func baseXrayRuntimeForTest() RuntimeSettings {
	return RuntimeSettings{
		RealityDest:               "www.google.com:443",
		RealityPrivateKey:         "private",
		RealityServerNames:        []string{"www.google.com"},
		RealityShortIDs:           []string{"a1b2c3d4"},
		VlessPort:                 8444,
		XrayAPIListen:             "127.0.0.1",
		XrayAPIPort:               10085,
		XraySniffingEnabled:       true,
		XraySniffingDestOverride:  []string{"http", "tls"},
		GeoBlockedCountries:       []string{"ru"},
		GeoBlockedGeositeTags:     []string{"category-ru"},
		GeoUpdateIntervalHours:    24,
	}
}

func routingHasDomainRule(rules []xrayRouteRuleForTest, value string) bool {
	for _, rule := range rules {
		for _, domain := range rule.Domain {
			if domain == value {
				return true
			}
		}
	}
	return false
}

func routingHasIPRule(rules []xrayRouteRuleForTest, value string) bool {
	for _, rule := range rules {
		for _, ip := range rule.IP {
			if ip == value {
				return true
			}
		}
	}
	return false
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func renderXrayTemplateForTest(t *testing.T, runtime RuntimeSettings) []byte {
	t.Helper()

	cfg := config.Config{
		H2V: config.H2VConfig{
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

func renderHysteriaTemplateForTest(t *testing.T, runtime RuntimeSettings) []byte {
	t.Helper()

	cfg := config.Config{
		H2V: config.H2VConfig{
			TemplatesDir: filepath.Join("..", "..", "..", "templates"),
		},
	}
	service := NewConfigService(cfg, nil, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	content, err := service.RenderWithRuntime("hysteria", runtime)
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
