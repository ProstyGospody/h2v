package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/prost/h2v/backend/internal/config"
)

func TestGeodataUpdateDueUsesOldestRequiredFile(t *testing.T) {
	dir := t.TempDir()
	writeGeodataFile(t, filepath.Join(dir, "geoip.dat"), time.Now().Add(-2*time.Hour))
	writeGeodataFile(t, filepath.Join(dir, "geosite.dat"), time.Now())

	service := NewGeodataService(config.XrayConfig{GeodataDir: dir}, nil)
	due, err := service.updateDue(time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !due {
		t.Fatal("expected geodata update to be due when one file is older than the interval")
	}
}

func TestGeodataUpdateDueSkipsFreshFiles(t *testing.T) {
	dir := t.TempDir()
	writeGeodataFile(t, filepath.Join(dir, "geoip.dat"), time.Now())
	writeGeodataFile(t, filepath.Join(dir, "geosite.dat"), time.Now())

	service := NewGeodataService(config.XrayConfig{GeodataDir: dir}, nil)
	due, err := service.updateDue(time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if due {
		t.Fatal("expected fresh geodata files to skip update")
	}
}

func TestGeodataUpdateDueUpdatesMissingFiles(t *testing.T) {
	dir := t.TempDir()
	writeGeodataFile(t, filepath.Join(dir, "geoip.dat"), time.Now())

	service := NewGeodataService(config.XrayConfig{GeodataDir: dir}, nil)
	due, err := service.updateDue(24 * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !due {
		t.Fatal("expected geodata update to be due when a required file is missing")
	}
}

func TestGeodataUpdateIfDueReadsConfiguredInterval(t *testing.T) {
	dir := t.TempDir()
	writeGeodataFile(t, filepath.Join(dir, "geoip.dat"), time.Now().Add(-2*time.Hour))
	writeGeodataFile(t, filepath.Join(dir, "geosite.dat"), time.Now().Add(-2*time.Hour))

	service := NewGeodataService(config.XrayConfig{GeodataDir: dir}, nil)
	due, err := service.updateDue(time.Duration(fakeGeoSettings{hours: 3}.runtime().GeoUpdateIntervalHours) * time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if due {
		t.Fatal("expected configured 3h interval to keep 2h geodata fresh")
	}
}

type fakeGeoSettings struct {
	hours int
}

func (s fakeGeoSettings) Runtime(context.Context) (RuntimeSettings, error) {
	return s.runtime(), nil
}

func (s fakeGeoSettings) runtime() RuntimeSettings {
	return RuntimeSettings{GeoUpdateIntervalHours: s.hours}
}

func writeGeodataFile(t *testing.T, path string, modTime time.Time) {
	t.Helper()
	data := make([]byte, minGeodataBytes+1)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatal(err)
	}
}
