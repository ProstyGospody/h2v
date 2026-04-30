package services

import (
	"encoding/json"
	"testing"
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
