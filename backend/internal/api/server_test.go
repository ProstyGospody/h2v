package api

import (
	"encoding/json"
	"testing"
)

func TestShouldReconcileXrayIncludesXrayRuntimeSettings(t *testing.T) {
	values := map[string]json.RawMessage{
		"xray.sniffing_dest_override": json.RawMessage(`["http","tls"]`),
	}
	if !shouldReconcileXray(values) {
		t.Fatal("xray runtime settings should trigger xray reconcile")
	}
}

func TestShouldReconcileIncludesConfigOverrides(t *testing.T) {
	if !shouldReconcileXray(map[string]json.RawMessage{"config.override.xray": json.RawMessage(`{}`)}) {
		t.Fatal("xray config override should trigger xray reconcile")
	}
	if !shouldReconcileHysteria(map[string]json.RawMessage{"config.override.hysteria": json.RawMessage(`{}`)}) {
		t.Fatal("hysteria config override should trigger hysteria reconcile")
	}
}
