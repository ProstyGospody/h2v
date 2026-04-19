package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/prost/h2v/backend/internal/config"
	"github.com/prost/h2v/backend/internal/domain"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

func (r *Repository) BootstrapSettings(ctx context.Context, cfg config.Config) error {
	settings := map[string]json.RawMessage{
		"panel.domain":       rawJSONString(cfg.Panel.Domain),
		"reality.sni":        rawJSONString(cfg.Xray.RealitySNI),
		"reality.dest":       rawJSONString(cfg.Xray.RealityDest),
		"reality.public_key": rawJSONString(cfg.Xray.RealityPubKey),
		"reality.short_ids":  rawJSONArray(cfg.Xray.RealityShortIDs),
		"vless.port":         rawJSONInt(cfg.Xray.VlessPort),
		"hy2.domain":         rawJSONString(cfg.Hysteria.Domain),
		"hy2.port":           rawJSONInt(cfg.Hysteria.Port),
		"hy2.obfs_enabled":   rawJSONBool(cfg.Hysteria.ObfsEnabled),
		"hy2.bandwidth_up":   rawJSONString(cfg.Hysteria.BandwidthUp),
		"hy2.bandwidth_down": rawJSONString(cfg.Hysteria.BandwidthDown),
		"hy2.masquerade_url": rawJSONString(cfg.Hysteria.MasqueradeURL),
	}
	return r.UpsertSettings(ctx, settings)
}

func (r *Repository) CreateUser(ctx context.Context, user *domain.User) error {
	const query = `
		INSERT INTO users (
			id, username, vless_uuid, hy2_password, sub_token,
			traffic_limit, traffic_used, expires_at, status, note, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`
	_, err := r.pool.Exec(ctx, query,
		user.ID, user.Username, user.VlessUUID, user.Hy2Password, user.SubToken,
		user.TrafficLimit, user.TrafficUsed, user.ExpiresAt, user.Status, user.Note, user.CreatedAt, user.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewError(409, "user_already_exists", "Username is already taken", err)
		}
		return err
	}
	return nil
}

func (r *Repository) GetUserByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	const query = `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)
	user, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(404, "user_not_found", "User with given id does not exist", err)
		}
		return nil, err
	}
	return user, nil
}

func (r *Repository) GetUserByToken(ctx context.Context, token string) (*domain.User, error) {
	const query = `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE sub_token = $1
	`
	row := r.pool.QueryRow(ctx, query, token)
	user, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(404, "subscription_not_found", "Subscription token does not exist", err)
		}
		return nil, err
	}
	return user, nil
}

func (r *Repository) GetUserByPassword(ctx context.Context, password string) (*domain.User, error) {
	const query = `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE hy2_password = $1
	`
	row := r.pool.QueryRow(ctx, query, password)
	user, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(404, "user_not_found", "User with given password does not exist", err)
		}
		return nil, err
	}
	return user, nil
}

func (r *Repository) ListUsers(ctx context.Context, filters domain.UserFilters) ([]domain.User, int, error) {
	if filters.Page <= 0 {
		filters.Page = 1
	}
	if filters.PerPage <= 0 || filters.PerPage > 100 {
		filters.PerPage = 20
	}

	clauses := []string{"1=1"}
	args := make([]any, 0, 6)
	index := 1

	if filters.Search != "" {
		clauses = append(clauses, fmt.Sprintf("username ILIKE $%d", index))
		args = append(args, "%"+filters.Search+"%")
		index++
	}
	if filters.Status != "" {
		clauses = append(clauses, fmt.Sprintf("status = $%d", index))
		args = append(args, filters.Status)
		index++
	}
	if filters.HasTrafficLimit {
		clauses = append(clauses, "traffic_limit > 0")
	}
	if filters.NearExpiryDays > 0 {
		clauses = append(clauses, fmt.Sprintf("expires_at IS NOT NULL AND expires_at <= now() + ($%d * interval '1 day')", index))
		args = append(args, filters.NearExpiryDays)
		index++
	}

	where := strings.Join(clauses, " AND ")
	offset := (filters.Page - 1) * filters.PerPage

	countQuery := "SELECT count(*) FROM users WHERE " + where
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, filters.PerPage, offset)
	listQuery := fmt.Sprintf(`
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, index, index+1)

	rows, err := r.pool.Query(ctx, listQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	users := make([]domain.User, 0, filters.PerPage)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, *user)
	}
	return users, total, rows.Err()
}

func (r *Repository) UpdateUser(ctx context.Context, user *domain.User) error {
	const query = `
		UPDATE users
		SET username = $2,
		    traffic_limit = $3,
		    traffic_used = $4,
		    expires_at = $5,
		    status = $6,
		    note = $7,
		    sub_token = $8,
		    updated_at = $9
		WHERE id = $1
	`
	tag, err := r.pool.Exec(ctx, query,
		user.ID, user.Username, user.TrafficLimit, user.TrafficUsed,
		user.ExpiresAt, user.Status, user.Note, user.SubToken, user.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewError(409, "user_already_exists", "Username is already taken", err)
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewError(404, "user_not_found", "User with given id does not exist", nil)
	}
	return nil
}

func (r *Repository) DeleteUser(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewError(404, "user_not_found", "User with given id does not exist", nil)
	}
	return nil
}

func (r *Repository) UpdateUserStatus(ctx context.Context, id uuid.UUID, status domain.UserStatus) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	return err
}

func (r *Repository) ResetUserToken(ctx context.Context, id uuid.UUID, token string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET sub_token = $2, updated_at = now() WHERE id = $1`, id, token)
	return err
}

func (r *Repository) ResetUserTraffic(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET traffic_used = 0, updated_at = now() WHERE id = $1`, id)
	return err
}

func (r *Repository) ListActiveUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE status = 'active'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]domain.User, 0, 64)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *user)
	}
	return users, rows.Err()
}

func (r *Repository) FindOffenders(ctx context.Context) ([]domain.User, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		WHERE status = 'active'
		  AND (
		    (expires_at IS NOT NULL AND expires_at < now())
		    OR (traffic_limit > 0 AND traffic_used >= traffic_limit)
		  )
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []domain.User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *user)
	}
	return users, rows.Err()
}

func (r *Repository) AddTrafficBatch(ctx context.Context, core string, stats map[string]domain.TrafficDelta) error {
	if len(stats) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	updateValues := make([]string, 0, len(stats))
	updateArgs := make([]any, 0, len(stats)*2)
	index := 1
	for username, delta := range stats {
		updateValues = append(updateValues, fmt.Sprintf("($%d, $%d)", index, index+1))
		updateArgs = append(updateArgs, username, delta.Uplink+delta.Downlink)
		index += 2
	}
	updateQuery := fmt.Sprintf(`
		UPDATE users AS u
		SET traffic_used = u.traffic_used + t.bytes,
		    updated_at = now()
		FROM (VALUES %s) AS t(username, bytes)
		WHERE u.username = t.username
	`, strings.Join(updateValues, ","))
	if _, err := tx.Exec(ctx, updateQuery, updateArgs...); err != nil {
		return err
	}

	insertValues := make([]string, 0, len(stats))
	insertArgs := make([]any, 0, len(stats)*4)
	index = 1
	for username, delta := range stats {
		insertValues = append(insertValues, fmt.Sprintf("($%d, $%d, $%d, $%d)", index, index+1, index+2, index+3))
		insertArgs = append(insertArgs, username, core, delta.Uplink, delta.Downlink)
		index += 4
	}
	insertQuery := fmt.Sprintf(`
		INSERT INTO traffic_log (user_id, core, uplink, downlink, recorded_at)
		SELECT u.id, t.core, t.uplink, t.downlink, now()
		FROM (VALUES %s) AS t(username, core, uplink, downlink)
		JOIN users u ON u.username = t.username
	`, strings.Join(insertValues, ","))
	if _, err := tx.Exec(ctx, insertQuery, insertArgs...); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *Repository) GetUserTraffic(ctx context.Context, id uuid.UUID, days int) ([]domain.TrafficPoint, error) {
	if days <= 0 {
		days = 7
	}
	rows, err := r.pool.Query(ctx, `
		SELECT date_trunc('hour', recorded_at) AS bucket, coalesce(sum(uplink), 0), coalesce(sum(downlink), 0)
		FROM traffic_log
		WHERE user_id = $1
		  AND recorded_at >= now() - ($2 * interval '1 day')
		GROUP BY bucket
		ORDER BY bucket
	`, id, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]domain.TrafficPoint, 0, 24)
	for rows.Next() {
		var point domain.TrafficPoint
		if err := rows.Scan(&point.RecordedAt, &point.Uplink, &point.Downlink); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

func (r *Repository) GetAggregateTraffic(ctx context.Context, days int) ([]domain.TrafficPoint, error) {
	if days <= 0 {
		days = 7
	}
	rows, err := r.pool.Query(ctx, `
		SELECT date_trunc('day', recorded_at) AS bucket, coalesce(sum(uplink), 0), coalesce(sum(downlink), 0)
		FROM traffic_log
		WHERE recorded_at >= now() - ($1 * interval '1 day')
		GROUP BY bucket
		ORDER BY bucket
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]domain.TrafficPoint, 0, days)
	for rows.Next() {
		var point domain.TrafficPoint
		if err := rows.Scan(&point.RecordedAt, &point.Uplink, &point.Downlink); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

func (r *Repository) GetOnlineUsers(ctx context.Context) ([]domain.OnlineUser, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.username, max(t.recorded_at) AS recorded_at, max(t.uplink + t.downlink) AS bytes
		FROM traffic_log t
		JOIN users u ON u.id = t.user_id
		WHERE t.recorded_at >= now() - interval '10 minutes'
		GROUP BY u.username
		ORDER BY recorded_at DESC
		LIMIT 10
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]domain.OnlineUser, 0, 10)
	for rows.Next() {
		var entry domain.OnlineUser
		if err := rows.Scan(&entry.Username, &entry.RecordedAt, &entry.Bytes); err != nil {
			return nil, err
		}
		users = append(users, entry)
	}
	return users, rows.Err()
}

func (r *Repository) GetOverviewCounts(ctx context.Context) (map[string]int64, int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT status, count(*) FROM users GROUP BY status`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	counts := map[string]int64{}
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return nil, 0, err
		}
		counts[status] = count
	}
	var todayTraffic int64
	if err := r.pool.QueryRow(ctx, `
		SELECT coalesce(sum(uplink + downlink), 0)
		FROM traffic_log
		WHERE recorded_at >= date_trunc('day', now())
	`).Scan(&todayTraffic); err != nil {
		return nil, 0, err
	}
	return counts, todayTraffic, nil
}

func (r *Repository) ListSettings(ctx context.Context) ([]domain.Setting, error) {
	rows, err := r.pool.Query(ctx, `SELECT key, value, updated_at FROM settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make([]domain.Setting, 0, 16)
	for rows.Next() {
		var item domain.Setting
		if err := rows.Scan(&item.Key, &item.Value, &item.UpdatedAt); err != nil {
			return nil, err
		}
		settings = append(settings, item)
	}
	return settings, rows.Err()
}

func (r *Repository) UpsertSettings(ctx context.Context, values map[string]json.RawMessage) error {
	if len(values) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for key, value := range values {
		if _, err := tx.Exec(ctx, `
			INSERT INTO settings (key, value, updated_at)
			VALUES ($1, $2::jsonb, now())
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value,
			    updated_at = now()
		`, key, string(value)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListConfigHistory(ctx context.Context, core string, limit int) ([]domain.ConfigHistory, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, core, content, applied_by, applied_at, note
		FROM config_history
		WHERE core = $1
		ORDER BY applied_at DESC
		LIMIT $2
	`, core, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	history := make([]domain.ConfigHistory, 0, limit)
	for rows.Next() {
		var item domain.ConfigHistory
		if err := rows.Scan(&item.ID, &item.Core, &item.Content, &item.AppliedBy, &item.AppliedAt, &item.Note); err != nil {
			return nil, err
		}
		history = append(history, item)
	}
	return history, rows.Err()
}

func (r *Repository) SaveConfigHistory(ctx context.Context, core, content string, adminID *uuid.UUID, note string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO config_history (core, content, applied_by, note)
		VALUES ($1, $2, $3, $4)
	`, core, content, adminID, note)
	return err
}

func (r *Repository) GetConfigHistory(ctx context.Context, id int64) (*domain.ConfigHistory, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, core, content, applied_by, applied_at, note
		FROM config_history
		WHERE id = $1
	`, id)
	var item domain.ConfigHistory
	if err := row.Scan(&item.ID, &item.Core, &item.Content, &item.AppliedBy, &item.AppliedAt, &item.Note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(404, "config_history_not_found", "Config history entry does not exist", err)
		}
		return nil, err
	}
	return &item, nil
}

func (r *Repository) AddAudit(ctx context.Context, entry domain.AuditEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO audit_log (admin_id, action, target_type, target_id, metadata, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
	`, entry.AdminID, entry.Action, entry.TargetType, entry.TargetID, string(entry.Metadata), entry.IP, entry.UserAgent)
	return err
}

func (r *Repository) ListAudit(ctx context.Context, limit int) ([]domain.AuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, admin_id, action, target_type, target_id, metadata, ip, user_agent, created_at
		FROM audit_log
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]domain.AuditEntry, 0, limit)
	for rows.Next() {
		var entry domain.AuditEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.AdminID,
			&entry.Action,
			&entry.TargetType,
			&entry.TargetID,
			&entry.Metadata,
			&entry.IP,
			&entry.UserAgent,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (r *Repository) GetAdminByUsername(ctx context.Context, username string) (*domain.Admin, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, totp_secret, role, last_login_at, created_at
		FROM admins
		WHERE username = $1
	`, username)
	admin, err := scanAdmin(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(401, "invalid_credentials", "Invalid username or password", err)
		}
		return nil, err
	}
	return admin, nil
}

func (r *Repository) GetAdminByID(ctx context.Context, id uuid.UUID) (*domain.Admin, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, totp_secret, role, last_login_at, created_at
		FROM admins
		WHERE id = $1
	`, id)
	admin, err := scanAdmin(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewError(404, "admin_not_found", "Admin does not exist", err)
		}
		return nil, err
	}
	return admin, nil
}

func (r *Repository) ListAdmins(ctx context.Context) ([]domain.Admin, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, username, password_hash, totp_secret, role, last_login_at, created_at
		FROM admins
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	admins := make([]domain.Admin, 0, 8)
	for rows.Next() {
		admin, err := scanAdmin(rows)
		if err != nil {
			return nil, err
		}
		admins = append(admins, *admin)
	}
	return admins, rows.Err()
}

func (r *Repository) CountAdmins(ctx context.Context) (int, error) {
	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM admins`).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r *Repository) CreateAdmin(ctx context.Context, admin *domain.Admin) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO admins (id, username, password_hash, totp_secret, role, last_login_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, admin.ID, admin.Username, admin.PasswordHash, admin.TOTPSecret, admin.Role, admin.LastLoginAt, admin.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.NewError(409, "admin_already_exists", "Admin username is already taken", err)
		}
		return err
	}
	return nil
}

func (r *Repository) UpdateAdminPassword(ctx context.Context, id uuid.UUID, passwordHash string, totpSecret *string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE admins
		SET password_hash = $2, totp_secret = $3
		WHERE id = $1
	`, id, passwordHash, totpSecret)
	return err
}

func (r *Repository) TouchAdminLogin(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE admins SET last_login_at = now() WHERE id = $1`, id)
	return err
}

func (r *Repository) DeleteAdmin(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM admins WHERE id = $1`, id)
	return err
}

func scanUser(row interface {
	Scan(dest ...any) error
}) (*domain.User, error) {
	var user domain.User
	if err := row.Scan(
		&user.ID,
		&user.Username,
		&user.VlessUUID,
		&user.Hy2Password,
		&user.SubToken,
		&user.TrafficLimit,
		&user.TrafficUsed,
		&user.ExpiresAt,
		&user.Status,
		&user.Note,
		&user.CreatedAt,
		&user.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &user, nil
}

func scanAdmin(row interface {
	Scan(dest ...any) error
}) (*domain.Admin, error) {
	var admin domain.Admin
	if err := row.Scan(
		&admin.ID,
		&admin.Username,
		&admin.PasswordHash,
		&admin.TOTPSecret,
		&admin.Role,
		&admin.LastLoginAt,
		&admin.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &admin, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func rawJSONString(value string) json.RawMessage {
	b, _ := json.Marshal(value)
	return b
}

func rawJSONInt(value int) json.RawMessage {
	b, _ := json.Marshal(value)
	return b
}

func rawJSONBool(value bool) json.RawMessage {
	b, _ := json.Marshal(value)
	return b
}

func rawJSONArray(values []string) json.RawMessage {
	b, _ := json.Marshal(values)
	return b
}

