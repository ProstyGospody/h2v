package services

import "testing"

func TestNormalizeHostnameOnlyStripsSchemeAndPort(t *testing.T) {
	host, ok := normalizeHostnameOnly("https://VPN.Example.COM:8443/settings")
	if !ok {
		t.Fatal("hostname should normalize")
	}
	if host != "vpn.example.com" {
		t.Fatalf("host = %q, want vpn.example.com", host)
	}
}
