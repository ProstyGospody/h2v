package services

import (
	"encoding/json"
	"testing"

	"github.com/prost/h2v/backend/internal/domain"
)

func TestBackupSettingsForUpdateSkipsLegacyAndInstallerManagedSettings(t *testing.T) {
	settings, err := backupSettingsForUpdate([]domain.Setting{
		{Key: "subscription.credential", Value: json.RawMessage(`"legacy-token"`)},
		{Key: "panel.domain", Value: json.RawMessage(`"panel.example.com"`)},
		{Key: "hy2.domain", Value: json.RawMessage(`"vpn.example.com"`)},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := settings["subscription.credential"]; ok {
		t.Fatal("legacy subscription credential should be skipped")
	}
	if _, ok := settings["panel.domain"]; ok {
		t.Fatal("installer-managed panel domain should be skipped")
	}
	if got := string(settings["hy2.domain"]); got != `"vpn.example.com"` {
		t.Fatalf("hy2.domain = %s, want vpn.example.com", got)
	}
}

