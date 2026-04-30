package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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
	if err := r.deleteSettings(ctx, "panel.domain", "panel.port", "panel.public_port", "subscription.url_prefix"); err != nil {
		return err
	}
	settings := map[string]json.RawMessage{
		"reality.sni":        rawJSONString(cfg.Xray.RealitySNI),
		"reality.dest":       rawJSONString(cfg.Xray.RealityDest),
		"reality.private_key": rawJSONString(cfg.Xray.RealityPrivKey),
		"reality.public_key":  rawJSONString(cfg.Xray.RealityPubKey),
		"reality.short_ids":   rawJSONArray(cfg.Xray.RealityShortIDs),
		"vless.port":         rawJSONInt(cfg.Xray.VlessPort),
		"hy2.domain":         rawJSONString(cfg.Hysteria.Domain),
		"hy2.port":           rawJSONInt(cfg.Hysteria.Port),
		"hy2.obfs_enabled":   rawJSONBool(cfg.Hysteria.ObfsEnabled),
		"hy2.obfs_password":  rawJSONString(cfg.Hysteria.ObfsPassword),
		"hy2.bandwidth_up":   rawJSONString(cfg.Hysteria.BandwidthUp),
		"hy2.bandwidth_down": rawJSONString(cfg.Hysteria.BandwidthDown),
		"hy2.masquerade_url": rawJSONString(cfg.Hysteria.MasqueradeURL),
		"hy2.traffic_secret": rawJSONString(cfg.Hysteria.TrafficSecret),
	}
	return r.InsertMissingSettings(ctx, settings)
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

func (r *Repository) ListAllUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, username, vless_uuid, hy2_password, sub_token, traffic_limit, traffic_used,
		       expires_at, status, note, created_at, updated_at
		FROM users
		ORDER BY created_at ASC
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

func (r *Repository) ReplaceUsers(ctx context.Context, users []domain.User) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if len(users) == 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM users`); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	placeholders := make([]string, 0, len(users))
	args := make([]any, 0, len(users))
	for i, user := range users {
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
		args = append(args, user.ID)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id NOT IN (`+strings.Join(placeholders, ",")+`)`, args...); err != nil {
		return err
	}

	for _, user := range users {
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (
				id, username, vless_uuid, hy2_password, sub_token,
				traffic_limit, traffic_used, expires_at, status, note, created_at, updated_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (id) DO UPDATE
			SET username = EXCLUDED.username,
			    vless_uuid = EXCLUDED.vless_uuid,
			    hy2_password = EXCLUDED.hy2_password,
			    sub_token = EXCLUDED.sub_token,
			    traffic_limit = EXCLUDED.traffic_limit,
			    traffic_used = EXCLUDED.traffic_used,
			    expires_at = EXCLUDED.expires_at,
			    status = EXCLUDED.status,
			    note = EXCLUDED.note,
			    created_at = EXCLUDED.created_at,
			    updated_at = EXCLUDED.updated_at
		`,
			user.ID, user.Username, user.VlessUUID, user.Hy2Password, user.SubToken,
			user.TrafficLimit, user.TrafficUsed, user.ExpiresAt, user.Status, user.Note, user.CreatedAt, user.UpdatedAt,
		); err != nil {
			if isUniqueViolation(err) {
				return domain.NewError(409, "backup_user_conflict", "Backup contains users that conflict with existing or imported users", err)
			}
			return err
		}
	}
	return tx.Commit(ctx)
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

func (r *Repository) AddTrafficBatch(ctx context.Context, core string, stats map[string]domain.TrafficDelta) (int64, error) {
	if len(stats) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	updateValues := make([]string, 0, len(stats))
	updateArgs := make([]any, 0, len(stats)*2)
	index := 1
	for username, delta := range stats {
		updateValues = append(updateValues, fmt.Sprintf("($%d, $%d::bigint)", index, index+1))
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
	tag, err := tx.Exec(ctx, updateQuery, updateArgs...)
	if err != nil {
		return 0, err
	}
	matched := tag.RowsAffected()

	insertValues := make([]string, 0, len(stats))
	insertArgs := make([]any, 0, len(stats)*4)
	index = 1
	for username, delta := range stats {
		insertValues = append(insertValues, fmt.Sprintf("($%d, $%d, $%d::bigint, $%d::bigint)", index, index+1, index+2, index+3))
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
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return matched, nil
}

func (r *Repository) GetUserTraffic(ctx context.Context, id uuid.UUID, days int) ([]domain.TrafficPoint, error) {
	if days <= 0 {
		days = 7
	}
	rows, err := r.pool.Query(ctx, `
		WITH buckets AS (
			SELECT generate_series(
				date_trunc('day', now()) - (($2::int - 1) * interval '1 day'),
				date_trunc('day', now()),
				interval '1 day'
			) AS bucket
		),
		traffic AS (
			SELECT date_trunc('day', recorded_at) AS bucket, sum(uplink) AS uplink, sum(downlink) AS downlink
			FROM traffic_log
			WHERE user_id = $1
			  AND recorded_at >= date_trunc('day', now()) - (($2::int - 1) * interval '1 day')
			GROUP BY bucket
		)
		SELECT buckets.bucket, coalesce(traffic.uplink, 0), coalesce(traffic.downlink, 0)
		FROM buckets
		LEFT JOIN traffic ON traffic.bucket = buckets.bucket
		ORDER BY buckets.bucket
	`, id, days)
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

func (r *Repository) GetAggregateTraffic(ctx context.Context, days int) ([]domain.TrafficPoint, error) {
	if days <= 0 {
		days = 7
	}
	rows, err := r.pool.Query(ctx, `
		WITH buckets AS (
			SELECT generate_series(
				date_trunc('day', now()) - (($1::int - 1) * interval '1 day'),
				date_trunc('day', now()),
				interval '1 day'
			) AS bucket
		),
		traffic AS (
			SELECT date_trunc('day', recorded_at) AS bucket, sum(uplink) AS uplink, sum(downlink) AS downlink
			FROM traffic_log
			WHERE recorded_at >= date_trunc('day', now()) - (($1::int - 1) * interval '1 day')
			GROUP BY bucket
		)
		SELECT buckets.bucket, coalesce(traffic.uplink, 0), coalesce(traffic.downlink, 0)
		FROM buckets
		LEFT JOIN traffic ON traffic.bucket = buckets.bucket
		ORDER BY buckets.bucket
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

func (r *Repository) deleteSettings(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	placeholders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))
	for index, key := range keys {
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+1))
		args = append(args, key)
	}
	_, err := r.pool.Exec(ctx, `DELETE FROM settings WHERE key IN (`+strings.Join(placeholders, ",")+`)`, args...)
	return err
}

func (r *Repository) InsertMissingSettings(ctx context.Context, values map[string]json.RawMessage) error {
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
			ON CONFLICT (key) DO NOTHING
		`, key, string(value)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) GetAdminByUsername(ctx context.Context, username string) (*domain.Admin, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, username, password_hash, role, last_login_at, created_at
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
		SELECT id, username, password_hash, role, last_login_at, created_at
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

func (r *Repository) CreateAdmin(ctx context.Context, admin *domain.Admin) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO admins (id, username, password_hash, role, last_login_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, admin.ID, admin.Username, admin.PasswordHash, admin.Role, admin.LastLoginAt, admin.CreatedAt)
	if err != nil {
		if _, ok := uniqueViolationConstraint(err); ok {
			return domain.NewError(409, "admin_already_exists", "Admin account already exists", err)
		}
		return err
	}
	return nil
}

func (r *Repository) UpdateAdminPassword(ctx context.Context, id uuid.UUID, passwordHash string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE admins
		SET password_hash = $2
		WHERE id = $1
	`, id, passwordHash)
	return err
}

func (r *Repository) TouchAdminLogin(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE admins SET last_login_at = now() WHERE id = $1`, id)
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
		&admin.Role,
		&admin.LastLoginAt,
		&admin.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &admin, nil
}

func isUniqueViolation(err error) bool {
	_, ok := uniqueViolationConstraint(err)
	return ok
}

func uniqueViolationConstraint(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName, true
	}
	return "", false
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
