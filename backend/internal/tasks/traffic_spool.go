package tasks

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/prost/h2v/backend/internal/domain"
)

type trafficSpool struct {
	dir string
}

type trafficSpoolBatch struct {
	ID        string                         `json:"id"`
	Core      string                         `json:"core"`
	CreatedAt time.Time                      `json:"created_at"`
	Stats     map[string]domain.TrafficDelta `json:"stats"`
	path      string
}

func newTrafficSpool(dir string) *trafficSpool {
	return &trafficSpool{dir: dir}
}

func (s *trafficSpool) Enqueue(core string, stats map[string]domain.TrafficDelta) (*trafficSpoolBatch, error) {
	if len(stats) == 0 {
		return nil, nil
	}
	if strings.TrimSpace(s.dir) == "" {
		return nil, errors.New("traffic spool directory is empty")
	}
	id, err := newTrafficBatchID(core)
	if err != nil {
		return nil, err
	}
	batch := &trafficSpoolBatch{
		ID:        id,
		Core:      core,
		CreatedAt: time.Now().UTC(),
		Stats:     cloneTrafficStats(stats),
	}
	if err := s.Write(*batch); err != nil {
		return nil, err
	}
	return batch, nil
}

func (s *trafficSpool) List() ([]trafficSpoolBatch, error) {
	if strings.TrimSpace(s.dir) == "" {
		return nil, errors.New("traffic spool directory is empty")
	}
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		paths = append(paths, filepath.Join(s.dir, entry.Name()))
	}
	sort.Strings(paths)

	batches := make([]trafficSpoolBatch, 0, len(paths))
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var batch trafficSpoolBatch
		if err := json.Unmarshal(raw, &batch); err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		batch.path = path
		if err := batch.Validate(); err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		batches = append(batches, batch)
	}
	return batches, nil
}

func (s *trafficSpool) Write(batch trafficSpoolBatch) error {
	if strings.TrimSpace(s.dir) == "" {
		return errors.New("traffic spool directory is empty")
	}
	if err := batch.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o750); err != nil {
		return err
	}
	data, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(s.dir, "."+batch.ID+"-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, filepath.Join(s.dir, batch.ID+".json")); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func (s *trafficSpool) Delete(batch trafficSpoolBatch) error {
	if batch.path == "" {
		batch.path = filepath.Join(s.dir, batch.ID+".json")
	}
	return os.Remove(batch.path)
}

func (b trafficSpoolBatch) Validate() error {
	if strings.TrimSpace(b.ID) == "" {
		return errors.New("traffic batch id is empty")
	}
	if b.Core != "xray" && b.Core != "hysteria" {
		return fmt.Errorf("unsupported traffic core %q", b.Core)
	}
	if len(b.Stats) == 0 {
		return errors.New("traffic batch stats are empty")
	}
	for username, delta := range b.Stats {
		if strings.TrimSpace(username) == "" {
			return errors.New("traffic batch username is empty")
		}
		if delta.Uplink < 0 || delta.Downlink < 0 {
			return fmt.Errorf("traffic batch for %s contains negative delta", username)
		}
	}
	return nil
}

func newTrafficBatchID(core string) (string, error) {
	var randomBytes [12]byte
	if _, err := rand.Read(randomBytes[:]); err != nil {
		return "", err
	}
	return time.Now().UTC().Format("20060102T150405.000000000Z") + "-" + core + "-" + hex.EncodeToString(randomBytes[:]), nil
}

func cloneTrafficStats(stats map[string]domain.TrafficDelta) map[string]domain.TrafficDelta {
	out := make(map[string]domain.TrafficDelta, len(stats))
	for username, delta := range stats {
		out[username] = delta
	}
	return out
}
