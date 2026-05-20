package services

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/prost/h2v/backend/internal/config"
)

func TestNormalizeSettingValueAcceptsVLESSAndXrayStabilitySettings(t *testing.T) {
	for key, raw := range map[string]json.RawMessage{
		"vless.udp_enabled":             json.RawMessage(`true`),
		"vless.xudp_enabled":            json.RawMessage(`false`),
		"xray.sniffing_enabled":         json.RawMessage(`true`),
		"xray.sniffing_dest_override":   json.RawMessage(`"http,tls"`),
		"reality.fingerprint":           json.RawMessage(`"Safari"`),
		"hy2.traffic_secret":            json.RawMessage(`"traffic-secret"`),
		"config.override.xray":          json.RawMessage(`{"routing":{"rules":[]}}`),
		"geo.blocked_countries":         json.RawMessage(`"RU, cn,ru"`),
		"geo.blocked_geosite_tags":      json.RawMessage(`["category-ru","google@ads"]`),
		"geo.update_interval_hours":     json.RawMessage(`168`),
	} {
		if _, err := normalizeSettingValue(key, raw); err != nil {
			t.Fatalf("normalize %s: %v", key, err)
		}
	}

	value, err := normalizeSettingValue("xray.sniffing_dest_override", json.RawMessage(`["tls","http","tls"]`))
	if err != nil {
		t.Fatalf("normalize sniffing override: %v", err)
	}
	if got, want := value.([]string), []string{"tls", "http"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("sniffing override = %#v, want %#v", got, want)
	}

	value, err = normalizeSettingValue("reality.fingerprint", json.RawMessage(`"Safari"`))
	if err != nil {
		t.Fatalf("normalize fingerprint: %v", err)
	}
	if got := value.(string); got != "safari" {
		t.Fatalf("fingerprint = %q, want safari", got)
	}

	value, err = normalizeSettingValue("geo.blocked_countries", json.RawMessage(`"RU, cn,ru"`))
	if err != nil {
		t.Fatalf("normalize countries: %v", err)
	}
	if got, want := value.([]string), []string{"ru", "cn"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("countries = %#v, want %#v", got, want)
	}
}

func TestNormalizeSettingValueRejectsInvalidVLESSAndXrayStabilitySettings(t *testing.T) {
	for key, raw := range map[string]json.RawMessage{
		"vless.udp_enabled":           json.RawMessage(`"true"`),
		"xray.sniffing_enabled":       json.RawMessage(`1`),
		"xray.sniffing_dest_override": json.RawMessage(`["http","ftp"]`),
		"reality.fingerprint":         json.RawMessage(`"opera"`),
		"hy2.traffic_secret":          json.RawMessage(`""`),
		"config.override.xray":        json.RawMessage(`[]`),
		"geo.blocked_countries":       json.RawMessage(`["russia"]`),
		"geo.blocked_geosite_tags":    json.RawMessage(`["bad tag"]`),
		"geo.update_interval_hours":   json.RawMessage(`0`),
	} {
		if _, err := normalizeSettingValue(key, raw); err == nil {
			t.Fatalf("normalize %s should fail", key)
		}
	}
}

func TestValidateRealityKeyPairRejectsMismatchedPublicKey(t *testing.T) {
	service := NewSettingsService(config.Config{}, nil, nil)
	first, err := service.GenerateRealityKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.GenerateRealityKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRealityKeyPair(first.PrivateKey, first.PublicKey); err != nil {
		t.Fatalf("generated key pair should validate: %v", err)
	}
	if err := validateRealityKeyPair(first.PrivateKey, second.PublicKey); err == nil {
		t.Fatal("mismatched public key should fail")
	}
}

func TestNormalizeRuntimeDerivedValuesUsesOnlyCurrentRealitySNI(t *testing.T) {
	runtime := RuntimeSettings{
		RealitySNI:         "www.google.com",
		RealityServerNames: []string{"www.microsoft.com"},
		RealityShortIDs:    []string{"", "a1b2c3d4"},
	}

	normalizeRuntimeDerivedValues(&runtime)

	if got, want := runtime.RealityServerNames, []string{"www.google.com"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("server names = %#v, want %#v", got, want)
	}
}
