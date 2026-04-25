package hysteria

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseTrafficPayload(t *testing.T) {
	payload := decodeTrafficTestPayload(t, `{
		"alice": { "tx": 100, "rx": "200" },
		"bob":   { "tx": 0, "rx": 0 },
		"carol": { "tx": 5, "rx": 0 },
		"dan":   { "connections": 2 }
	}`)

	stats := parseTrafficPayload(payload)
	if len(stats) != 2 {
		t.Fatalf("len(stats) = %d, want 2", len(stats))
	}
	if a := stats["alice"]; a.Uplink != 100 || a.Downlink != 200 {
		t.Fatalf("alice = %+v, want {100 200}", a)
	}
	if c := stats["carol"]; c.Uplink != 5 || c.Downlink != 0 {
		t.Fatalf("carol = %+v, want {5 0}", c)
	}
}

func decodeTrafficTestPayload(t *testing.T, raw string) any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var payload any
	if err := decoder.Decode(&payload); err != nil {
		t.Fatalf("decode test payload: %v", err)
	}
	return payload
}
