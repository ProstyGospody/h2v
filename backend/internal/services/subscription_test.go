package services

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/domain"
)

func TestBuildProtocolLinks(t *testing.T) {
	runtime := sampleRuntime()
	user := sampleUser()

	vless := buildVLESS(runtime, user)
	parsedVLESS, err := url.Parse(vless)
	if err != nil {
		t.Fatalf("parse vless: %v", err)
	}
	if parsedVLESS.Scheme != "vless" {
		t.Fatalf("scheme = %q, want vless", parsedVLESS.Scheme)
	}
	if got := parsedVLESS.User.Username(); got != user.VlessUUID.String() {
		t.Fatalf("vless uuid = %q, want %q", got, user.VlessUUID.String())
	}
	if got := parsedVLESS.Host; got != "vpn.example.com:443" {
		t.Fatalf("vless host = %q, want vpn.example.com:443", got)
	}
	q := parsedVLESS.Query()
	for key, want := range map[string]string{
		"encryption": "none",
		"type":       "tcp",
		"security":   "reality",
		"pbk":        "reality-public-key",
		"sni":        "www.cloudflare.com",
		"fp":         "chrome",
		"flow":       "xtls-rprx-vision",
		"sid":        "a1b2c3d4",
		"spx":        "/",
	} {
		if got := q.Get(key); got != want {
			t.Fatalf("vless %s = %q, want %q", key, got, want)
		}
	}

	hy2 := buildHysteria2(runtime, user)
	parsedHY2, err := url.Parse(hy2)
	if err != nil {
		t.Fatalf("parse hysteria2: %v", err)
	}
	if parsedHY2.Scheme != "hysteria2" {
		t.Fatalf("scheme = %q, want hysteria2", parsedHY2.Scheme)
	}
	if got := parsedHY2.User.Username(); got != user.Hy2Password {
		t.Fatalf("hy2 auth = %q, want %q", got, user.Hy2Password)
	}
	if got := parsedHY2.Host; got != "hy2.example.com:8443" {
		t.Fatalf("hy2 host = %q, want hy2.example.com:8443", got)
	}
	hy2q := parsedHY2.Query()
	if got := hy2q.Get("sni"); got != "hy2.example.com" {
		t.Fatalf("hy2 sni = %q, want hy2.example.com", got)
	}
	if got := hy2q.Get("obfs"); got != "" {
		t.Fatalf("hy2 obfs = %q, want empty for masquerade mode", got)
	}
	if got := hy2q.Get("obfs-password"); got != "" {
		t.Fatalf("hy2 obfs password = %q, want empty for masquerade mode", got)
	}
}

func TestEncodedLinks(t *testing.T) {
	links := sampleLinks()
	decoded, err := base64.StdEncoding.DecodeString(EncodedLinks(links))
	if err != nil {
		t.Fatalf("decode subscription: %v", err)
	}
	want := links.VLESS + "\n" + links.Hysteria2
	if got := string(decoded); got != want {
		t.Fatalf("decoded subscription = %q, want %q", got, want)
	}
}

func TestBuildClashYAMLUsesStructuredProxies(t *testing.T) {
	payload, err := (&SubscriptionService{}).BuildClashYAML(sampleLinks())
	if err != nil {
		t.Fatalf("build clash: %v", err)
	}
	for _, want := range []string{
		"type: vless",
		"uuid: \"11111111-1111-1111-1111-111111111111\"",
		"flow: \"xtls-rprx-vision\"",
		"packet-encoding: xudp",
		"reality-opts:",
		"public-key: \"reality-public-key\"",
		"encryption: \"\"",
		"type: hysteria2",
		"password: \"hy2/password+token\"",
		"proxy-groups:",
	} {
		if !strings.Contains(payload, want) {
			t.Fatalf("clash payload missing %q:\n%s", want, payload)
		}
	}
	if strings.Contains(payload, "url:") {
		t.Fatalf("clash payload must not wrap proxies as url fields:\n%s", payload)
	}
	if strings.Contains(payload, "obfs:") || strings.Contains(payload, "obfs-password:") {
		t.Fatalf("clash payload must not include obfs in masquerade mode:\n%s", payload)
	}
}

func TestBuildSingBoxJSONUsesDocumentedOutbounds(t *testing.T) {
	payload, err := (&SubscriptionService{}).BuildSingBoxJSON(sampleLinks())
	if err != nil {
		t.Fatalf("build sing-box: %v", err)
	}

	var config map[string]any
	if err := json.Unmarshal(payload, &config); err != nil {
		t.Fatalf("decode sing-box json: %v", err)
	}

	inbounds, ok := config["inbounds"].([]any)
	if !ok || len(inbounds) != 1 {
		t.Fatalf("inbounds = %#v, want one inbound", config["inbounds"])
	}
	inbound, ok := inbounds[0].(map[string]any)
	if !ok || inbound["type"] != "mixed" || inbound["listen"] != "127.0.0.1" {
		t.Fatalf("mixed inbound = %#v", inbounds[0])
	}

	vless := outboundByType(t, config, "vless")
	if got := vless["uuid"]; got != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("sing-box vless uuid = %#v", got)
	}
	if got := vless["flow"]; got != "xtls-rprx-vision" {
		t.Fatalf("sing-box vless flow = %#v", got)
	}
	tls, ok := vless["tls"].(map[string]any)
	if !ok {
		t.Fatalf("sing-box vless tls = %#v", vless["tls"])
	}
	reality, ok := tls["reality"].(map[string]any)
	if !ok || reality["public_key"] != "reality-public-key" {
		t.Fatalf("sing-box vless reality = %#v", tls["reality"])
	}

	hy2 := outboundByType(t, config, "hysteria2")
	if got := hy2["password"]; got != "hy2/password+token" {
		t.Fatalf("sing-box hy2 password = %#v", got)
	}
	if _, ok := hy2["obfs"]; ok {
		t.Fatalf("sing-box hy2 must not include obfs in masquerade mode: %#v", hy2["obfs"])
	}
}

func outboundByType(t *testing.T, config map[string]any, proxyType string) map[string]any {
	t.Helper()
	outbounds, ok := config["outbounds"].([]any)
	if !ok {
		t.Fatalf("outbounds = %#v", config["outbounds"])
	}
	for _, raw := range outbounds {
		outbound, ok := raw.(map[string]any)
		if ok && outbound["type"] == proxyType {
			return outbound
		}
	}
	t.Fatalf("missing outbound type %q in %#v", proxyType, outbounds)
	return nil
}

func sampleLinks() *domain.SubscriptionLinks {
	user := sampleUser()
	runtime := sampleRuntime()
	return &domain.SubscriptionLinks{
		Subscription: "https://panel.example.com/sub/token",
		VLESS:        buildVLESS(runtime, user),
		Hysteria2:    buildHysteria2(runtime, user),
		Username:     user.Username,
	}
}

func sampleRuntime() RuntimeSettings {
	return RuntimeSettings{
		PanelDomain:      "vpn.example.com",
		RealitySNI:       "www.cloudflare.com",
		RealityPublicKey: "reality-public-key",
		RealityShortIDs:  []string{"", "a1b2c3d4"},
		VlessPort:        443,
		Hy2Domain:        "hy2.example.com",
		Hy2Port:          8443,
	}
}

func sampleUser() *domain.User {
	return &domain.User{
		Username:    "user_1",
		VlessUUID:   uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Hy2Password: "hy2/password+token",
	}
}
