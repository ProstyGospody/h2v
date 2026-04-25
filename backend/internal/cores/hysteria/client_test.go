package hysteria

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseTrafficPayloadDirectMap(t *testing.T) {
	payload := decodeTrafficTestPayload(t, `{
		"alice": { "tx": 100, "rx": "200" },
		"bob": { "tx": 0, "rx": 0 },
		"ignored": { "connections": 2 }
	}`)

	stats := parseTrafficPayload(payload)
	if len(stats) != 1 {
		t.Fatalf("len(stats) = %d, want 1", len(stats))
	}
	alice := stats["alice"]
	if alice.Uplink != 100 || alice.Downlink != 200 {
		t.Fatalf("alice traffic = %+v, want uplink 100 downlink 200", alice)
	}
}

func TestParseTrafficPayloadWrappedMap(t *testing.T) {
	payload := decodeTrafficTestPayload(t, `{
		"data": {
			"carol": { "uplink": "300", "downlink": 400 }
		}
	}`)

	stats := parseTrafficPayload(payload)
	carol := stats["carol"]
	if carol.Uplink != 300 || carol.Downlink != 400 {
		t.Fatalf("carol traffic = %+v, want uplink 300 downlink 400", carol)
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
