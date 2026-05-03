package services

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/prost/h2v/backend/internal/domain"
	"github.com/prost/h2v/backend/internal/repo"
)

const (
	panelBackupType    = "h2v.panel.backup"
	panelBackupVersion = 1
)

type BackupService struct {
	repo     *repo.Repository
	settings *SettingsService
	configs  *ConfigService
	cache    SubscriptionCache
}

type PanelBackup struct {
	Type       string           `json:"type"`
	Version    int              `json:"version"`
	ExportedAt time.Time        `json:"exported_at"`
	Settings   []domain.Setting `json:"settings"`
	Configs    map[string]string `json:"configs"`
	Users      []BackupUser     `json:"users"`
}

type BackupUser struct {
	ID           uuid.UUID          `json:"id"`
	Username     string             `json:"username"`
	VlessUUID    uuid.UUID          `json:"vless_uuid"`
	Hy2Password  string             `json:"hy2_password"`
	SubToken     string             `json:"sub_token"`
	TrafficLimit int64              `json:"traffic_limit"`
	TrafficUsed  int64              `json:"traffic_used"`
	ExpiresAt    *time.Time         `json:"expires_at"`
	Status       domain.UserStatus  `json:"status"`
	Note         string             `json:"note"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
}

type BackupImportSummary struct {
	Settings int `json:"settings"`
	Users    int `json:"users"`
	Configs  int `json:"configs"`
}

func NewBackupService(repository *repo.Repository, settings *SettingsService, configs *ConfigService, cache SubscriptionCache) *BackupService {
	return &BackupService{
		repo:     repository,
		settings: settings,
		configs:  configs,
		cache:    cache,
	}
}

func (s *BackupService) Export(ctx context.Context) (*PanelBackup, error) {
	settings, err := s.settings.List(ctx)
	if err != nil {
		return nil, err
	}
	users, err := s.repo.ListAllUsers(ctx)
	if err != nil {
		return nil, err
	}
	configs := map[string]string{}
	for _, core := range []string{"xray", "hysteria"} {
		content, err := s.configs.Get(ctx, core)
		if err != nil {
			return nil, err
		}
		configs[core] = string(content)
	}

	return &PanelBackup{
		Type:       panelBackupType,
		Version:    panelBackupVersion,
		ExportedAt: time.Now().UTC(),
		Settings:   settings,
		Configs:    configs,
		Users:      backupUsersFromDomain(users),
	}, nil
}

func (s *BackupService) Import(ctx context.Context, backup PanelBackup) (*BackupImportSummary, error) {
	if err := validatePanelBackup(backup); err != nil {
		return nil, err
	}

	users := domainUsersFromBackup(backup.Users)
	if err := validateBackupUsers(users); err != nil {
		return nil, err
	}

	configContents := map[string][]byte{}
	for _, core := range []string{"xray", "hysteria"} {
		content := strings.TrimSpace(backup.Configs[core])
		if content == "" {
			continue
		}
		raw := []byte(content)
		if err := s.configs.Validate(ctx, core, raw); err != nil {
			return nil, err
		}
		configContents[core] = raw
	}

	settings, err := backupSettingsForUpdate(backup.Settings)
	if err != nil {
		return nil, err
	}

	if err := s.settings.Update(ctx, settings); err != nil {
		return nil, err
	}
	if err := s.repo.ReplaceUsers(ctx, users); err != nil {
		return nil, err
	}
	if s.cache != nil {
		if err := s.cache.LoadAll(ctx); err != nil {
			return nil, err
		}
	}

	configCount := 0
	for _, core := range []string{"xray", "hysteria"} {
		content, ok := configContents[core]
		if !ok {
			continue
		}
		if err := s.configs.Apply(ctx, core, content); err != nil {
			return nil, err
		}
		configCount++
	}
	if configCount == 0 {
		if err := s.configs.ReconcileXray(ctx); err != nil {
			return nil, err
		}
		if err := s.configs.ReconcileHysteria(ctx); err != nil {
			return nil, err
		}
	}

	return &BackupImportSummary{
		Settings: len(settings),
		Users:    len(users),
		Configs:  configCount,
	}, nil
}

func validatePanelBackup(backup PanelBackup) error {
	if backup.Type != "" && backup.Type != panelBackupType {
		return domain.NewError(400, "invalid_backup", "Backup file is not an h2v panel backup", nil)
	}
	if backup.Version != panelBackupVersion {
		return domain.NewError(400, "invalid_backup", "Backup version is not supported", nil)
	}
	return nil
}

func backupSettingsForUpdate(items []domain.Setting) (map[string]json.RawMessage, error) {
	settings := make(map[string]json.RawMessage, len(items))
	for _, setting := range items {
		if setting.Key == "" || !json.Valid(setting.Value) {
			return nil, domain.NewError(400, "invalid_backup", "Backup contains invalid settings", nil)
		}
		if ignoredBackupSetting(setting.Key) {
			continue
		}
		settings[setting.Key] = setting.Value
	}
	return settings, nil
}

func ignoredBackupSetting(key string) bool {
	return installerManagedSetting(key) || legacyBackupSetting(key)
}

func legacyBackupSetting(key string) bool {
	switch key {
	case "subscription.credential":
		return true
	default:
		return false
	}
}

func validateBackupUsers(users []domain.User) error {
	ids := make(map[uuid.UUID]struct{}, len(users))
	usernames := make(map[string]struct{}, len(users))
	vless := make(map[uuid.UUID]struct{}, len(users))
	hy2 := make(map[string]struct{}, len(users))
	tokens := make(map[string]struct{}, len(users))
	for _, user := range users {
		if user.ID == uuid.Nil || user.VlessUUID == uuid.Nil || user.Username == "" || user.Hy2Password == "" || user.SubToken == "" {
			return domain.NewError(400, "invalid_backup", "Backup contains invalid users", nil)
		}
		switch user.Status {
		case domain.StatusActive, domain.StatusDisabled, domain.StatusExpired, domain.StatusLimited:
		default:
			return domain.NewError(400, "invalid_backup", "Backup contains users with invalid status", nil)
		}
		if _, ok := ids[user.ID]; ok {
			return domain.NewError(400, "invalid_backup", "Backup contains duplicate users", nil)
		}
		if _, ok := usernames[user.Username]; ok {
			return domain.NewError(400, "invalid_backup", "Backup contains duplicate usernames", nil)
		}
		if _, ok := vless[user.VlessUUID]; ok {
			return domain.NewError(400, "invalid_backup", "Backup contains duplicate VLESS UUIDs", nil)
		}
		if _, ok := hy2[user.Hy2Password]; ok {
			return domain.NewError(400, "invalid_backup", "Backup contains duplicate Hysteria passwords", nil)
		}
		if _, ok := tokens[user.SubToken]; ok {
			return domain.NewError(400, "invalid_backup", "Backup contains duplicate subscription tokens", nil)
		}
		ids[user.ID] = struct{}{}
		usernames[user.Username] = struct{}{}
		vless[user.VlessUUID] = struct{}{}
		hy2[user.Hy2Password] = struct{}{}
		tokens[user.SubToken] = struct{}{}
	}
	return nil
}

func backupUsersFromDomain(users []domain.User) []BackupUser {
	out := make([]BackupUser, 0, len(users))
	for _, user := range users {
		out = append(out, BackupUser{
			ID:           user.ID,
			Username:     user.Username,
			VlessUUID:    user.VlessUUID,
			Hy2Password:  user.Hy2Password,
			SubToken:     user.SubToken,
			TrafficLimit: user.TrafficLimit,
			TrafficUsed:  user.TrafficUsed,
			ExpiresAt:    user.ExpiresAt,
			Status:       user.Status,
			Note:         user.Note,
			CreatedAt:    user.CreatedAt,
			UpdatedAt:    user.UpdatedAt,
		})
	}
	return out
}

func domainUsersFromBackup(users []BackupUser) []domain.User {
	now := time.Now().UTC()
	out := make([]domain.User, 0, len(users))
	for _, user := range users {
		createdAt := user.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		updatedAt := user.UpdatedAt
		if updatedAt.IsZero() {
			updatedAt = now
		}
		status := user.Status
		if status == "" {
			status = domain.StatusActive
		}
		out = append(out, domain.User{
			ID:           user.ID,
			Username:     user.Username,
			VlessUUID:    user.VlessUUID,
			Hy2Password:  user.Hy2Password,
			SubToken:     user.SubToken,
			TrafficLimit: user.TrafficLimit,
			TrafficUsed:  user.TrafficUsed,
			ExpiresAt:    user.ExpiresAt,
			Status:       status,
			Note:         user.Note,
			CreatedAt:    createdAt,
			UpdatedAt:    updatedAt,
		})
	}
	return out
}
