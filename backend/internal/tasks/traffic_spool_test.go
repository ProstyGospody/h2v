package tasks

import (
	"testing"

	"github.com/prost/h2v/backend/internal/domain"
)

func TestTrafficSpoolRoundTrip(t *testing.T) {
	spool := newTrafficSpool(t.TempDir())
	stats := map[string]domain.TrafficDelta{
		"alice": domain.TrafficDelta{Uplink: 10, Downlink: 20},
	}

	batch, err := spool.Enqueue("xray", stats)
	if err != nil {
		t.Fatalf("enqueue traffic batch: %v", err)
	}
	stats["alice"] = domain.TrafficDelta{Uplink: 999, Downlink: 999}

	batches, err := spool.List()
	if err != nil {
		t.Fatalf("list traffic batches: %v", err)
	}
	if len(batches) != 1 {
		t.Fatalf("batch count = %d, want 1", len(batches))
	}
	if batches[0].ID != batch.ID {
		t.Fatalf("batch id = %q, want %q", batches[0].ID, batch.ID)
	}
	if got := batches[0].Stats["alice"]; got.Uplink != 10 || got.Downlink != 20 {
		t.Fatalf("alice traffic = %+v, want uplink 10 downlink 20", got)
	}
	if err := spool.Delete(batches[0]); err != nil {
		t.Fatalf("delete traffic batch: %v", err)
	}

	batches, err = spool.List()
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(batches) != 0 {
		t.Fatalf("batch count after delete = %d, want 0", len(batches))
	}
}

func TestTrafficSpoolRejectsInvalidBatch(t *testing.T) {
	spool := newTrafficSpool(t.TempDir())
	err := spool.Write(trafficSpoolBatch{
		ID:   "bad",
		Core: "xray",
		Stats: map[string]domain.TrafficDelta{
			"alice": domain.TrafficDelta{Uplink: -1},
		},
	})
	if err == nil {
		t.Fatal("expected invalid batch error")
	}
}
