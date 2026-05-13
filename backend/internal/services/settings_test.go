package services

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNormalizeSettingValueAcceptsVLESSAndXrayStabilitySettings(t *testing.T) {
	for key, raw := range map[string]json.RawMessage{
		"vless.udp_enabled":             json.RawMessage(`true`),
		"vless.xudp_enabled":            json.RawMessage(`false`),
		"xray.sniffing_enabled":         json.RawMessage(`true`),
		"xray.sniffing_dest_override":   json.RawMessage(`"http,tls"`),
		"reality.fingerprint":           json.RawMessage(`"Safari"`),
		"config.override.xray":          json.RawMessage(`{"routing":{"rules":[]}}`),
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
}

func TestNormalizeSettingValueRejectsInvalidVLESSAndXrayStabilitySettings(t *testing.T) {
	for key, raw := range map[string]json.RawMessage{
		"vless.udp_enabled":           json.RawMessage(`"true"`),
		"xray.sniffing_enabled":       json.RawMessage(`1`),
		"xray.sniffing_dest_override": json.RawMessage(`["http","ftp"]`),
		"reality.fingerprint":         json.RawMessage(`"opera"`),
		"config.override.xray":        json.RawMessage(`[]`),
	} {
		if _, err := normalizeSettingValue(key, raw); err == nil {
			t.Fatalf("normalize %s should fail", key)
		}
	}
}
