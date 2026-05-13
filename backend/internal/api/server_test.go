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
