package services

import (
	"encoding/json"
	"testing"

	"github.com/prost/h2v/backend/internal/domain"
)

func TestBackupSettingsForUpdateSkipsInstallerManagedSettings(t *testing.T) {
	settings, err := backupSettingsForUpdate([]domain.Setting{
		{Key: "h2v.domain", Value: json.RawMessage(`"h2v.example.com"`)},
		{Key: "hy2.domain", Value: json.RawMessage(`"vpn.example.com"`)},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := settings["h2v.domain"]; ok {
		t.Fatal("installer-managed h2v domain should be skipped")
	}
	if got := string(settings["hy2.domain"]); got != `"vpn.example.com"` {
		t.Fatalf("hy2.domain = %s, want vpn.example.com", got)
	}
}
