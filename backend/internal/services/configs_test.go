package services

import (
	"strings"
	"testing"
)

func TestRenderCaddyfileUsesInternalPanelPort(t *testing.T) {
	content := renderCaddyfile("vpn.example.com", 8443, 8000)

	if !strings.Contains(content, "vpn.example.com:8443 {") {
		t.Fatalf("caddy site address should include public port: %s", content)
	}
	if !strings.Contains(content, "reverse_proxy 127.0.0.1:8000") {
		t.Fatalf("reverse proxy should target internal panel port: %s", content)
	}
}

func TestRenderCaddyfileOmitsDefaultPublicPort(t *testing.T) {
	content := renderCaddyfile("vpn.example.com", 443, 8000)

	if strings.Contains(content, "vpn.example.com:443 {") {
		t.Fatalf("default HTTPS port should not be rendered explicitly: %s", content)
	}
	if !strings.Contains(content, "vpn.example.com {") {
		t.Fatalf("caddy site address should use bare domain: %s", content)
	}
}
