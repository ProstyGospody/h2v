package xray

import "testing"

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
