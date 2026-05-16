package xray

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/domain"
)

func TestParseStatsQueryOutput(t *testing.T) {
	payload := []byte(`{
		"stat": [
			{ "name": "user>>>alice>>>traffic>>>uplink", "value": "128" },
			{ "name": "user>>>alice>>>traffic>>>downlink", "value": 256 },
			{ "name": "user>>>bob>>>traffic>>>downlink", "value": 0 },
			{ "name": "inbound>>>vless-reality>>>traffic>>>downlink", "value": 999 }
		]
	}`)

	stats, err := parseStatsQueryOutput(payload)
	if err != nil {
		t.Fatalf("parseStatsQueryOutput() error = %v", err)
	}
	if len(stats) != 1 {
		t.Fatalf("len(stats) = %d, want 1", len(stats))
	}
	alice := stats["alice"]
	if alice.Uplink != 128 || alice.Downlink != 256 {
		t.Fatalf("alice traffic = %+v, want uplink 128 downlink 256", alice)
	}
}

func TestParseStatsQueryOutputEmpty(t *testing.T) {
	stats, err := parseStatsQueryOutput([]byte(`{}`))
	if err != nil {
		t.Fatalf("parseStatsQueryOutput() error = %v", err)
	}
	if len(stats) != 0 {
		t.Fatalf("len(stats) = %d, want 0", len(stats))
	}
}

func TestVLESSInboundUserConfigBuildsADUPayload(t *testing.T) {
	user := &domain.User{
		Username:  "alice",
		VlessUUID: uuid.MustParse("11111111-1111-1111-1111-111111111111"),
	}

	content, err := vlessInboundUserConfig(user)
	if err != nil {
		t.Fatal(err)
	}

	var payload struct {
		Inbounds []struct {
			Tag      string `json:"tag"`
			Listen   string `json:"listen"`
			Port     int    `json:"port"`
			Protocol string `json:"protocol"`
			Settings struct {
				Clients []struct {
					ID    string `json:"id"`
					Email string `json:"email"`
					Flow  string `json:"flow"`
				} `json:"clients"`
				Decryption string `json:"decryption"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Inbounds) != 1 {
		t.Fatalf("inbounds = %d, want 1", len(payload.Inbounds))
	}
	inbound := payload.Inbounds[0]
	if inbound.Tag != vlessInboundTag || inbound.Listen != "127.0.0.1" || inbound.Port != 1 || inbound.Protocol != "vless" {
		t.Fatalf("inbound = %#v", inbound)
	}
	if len(inbound.Settings.Clients) != 1 {
		t.Fatalf("clients = %d, want 1", len(inbound.Settings.Clients))
	}
	client := inbound.Settings.Clients[0]
	if client.ID != user.VlessUUID.String() || client.Email != "alice" || client.Flow != "xtls-rprx-vision" {
		t.Fatalf("client = %#v", client)
	}
	if inbound.Settings.Decryption != "none" {
		t.Fatalf("decryption = %q, want none", inbound.Settings.Decryption)
	}
}

func TestAPIUserChangeSucceededParsesXrayCLIOutput(t *testing.T) {
	if !apiUserChangeSucceeded([]byte("processing inbound: vless-reality\nAdded 1 user(s) in total.\n"), "Added") {
		t.Fatal("expected Added 1 to be treated as success")
	}
	if apiUserChangeSucceeded([]byte("Removed 0 user(s) in total.\n"), "Removed") {
		t.Fatal("expected Removed 0 to be treated as failure")
	}
}
