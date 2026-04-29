package services

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/prost/h2v/backend/internal/config"
)

const minGeodataBytes = 1024

type GeodataService struct {
	cfg       config.XrayConfig
	systemctl SystemctlAdapter
	client    *http.Client
	logger    *slog.Logger
}

func NewGeodataService(cfg config.XrayConfig, logger *slog.Logger, systemctl ...SystemctlAdapter) *GeodataService {
	var controller SystemctlAdapter
	if len(systemctl) > 0 {
		controller = systemctl[0]
	}
	return &GeodataService{
		cfg:       cfg,
		systemctl: controller,
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		logger: logger,
	}
}

func (s *GeodataService) Update(ctx context.Context) error {
	if s.cfg.GeodataDir == "" {
		return fmt.Errorf("XRAY_GEODATA_DIR is empty")
	}
	if s.cfg.GeoIPURL == "" {
		return fmt.Errorf("XRAY_GEOIP_URL is empty")
	}
	if s.cfg.GeositeURL == "" {
		return fmt.Errorf("XRAY_GEOSITE_URL is empty")
	}
	if err := os.MkdirAll(s.cfg.GeodataDir, 0o755); err != nil {
		return fmt.Errorf("create geodata dir: %w", err)
	}

	files := []struct {
		name string
		url  string
	}{
		{name: "geoip.dat", url: s.cfg.GeoIPURL},
		{name: "geosite.dat", url: s.cfg.GeositeURL},
	}
	for _, file := range files {
		target := filepath.Join(s.cfg.GeodataDir, file.name)
		if err := s.download(ctx, file.url, target); err != nil {
			return err
		}
		s.logger.Info("core geodata updated", "file", file.name, "path", target)
	}
	return nil
}

func (s *GeodataService) UpdateAndRestart(ctx context.Context) error {
	if err := s.Update(ctx); err != nil {
		return err
	}
	if s.systemctl == nil {
		return nil
	}
	for _, core := range []string{"xray", "hysteria"} {
		if err := s.systemctl.Restart(ctx, core); err != nil {
			return fmt.Errorf("restart %s after geodata update: %w", core, err)
		}
	}
	return nil
}

func (s *GeodataService) download(ctx context.Context, sourceURL, target string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return fmt.Errorf("create geodata request: %w", err)
	}
	req.Header.Set("User-Agent", "h2v-panel geodata updater")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", sourceURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("download %s: unexpected HTTP status %s", sourceURL, resp.Status)
	}

	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(target)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create temp geodata file: %w", err)
	}
	tmpName := tmp.Name()
	keepTemp := false
	defer func() {
		if !keepTemp {
			_ = os.Remove(tmpName)
		}
	}()

	written, copyErr := io.Copy(tmp, resp.Body)
	chmodErr := tmp.Chmod(0o644)
	closeErr := tmp.Close()
	if copyErr != nil {
		return fmt.Errorf("write %s: %w", target, copyErr)
	}
	if chmodErr != nil {
		return fmt.Errorf("chmod %s: %w", tmpName, chmodErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close %s: %w", tmpName, closeErr)
	}
	if written < minGeodataBytes {
		return fmt.Errorf("download %s: response is too small (%d bytes)", sourceURL, written)
	}
	if err := os.Rename(tmpName, target); err != nil {
		return fmt.Errorf("install %s: %w", target, err)
	}
	keepTemp = true
	return nil
}
