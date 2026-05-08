CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9_-]{3,32}$'),
    vless_uuid UUID NOT NULL,
    hy2_password TEXT NOT NULL,
    sub_token TEXT NOT NULL,
    traffic_limit BIGINT NOT NULL DEFAULT 0 CONSTRAINT users_traffic_limit_nonnegative CHECK (traffic_limit >= 0),
    traffic_used BIGINT NOT NULL DEFAULT 0 CONSTRAINT users_traffic_used_nonnegative CHECK (traffic_used >= 0),
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled', 'expired', 'limited')),
    note TEXT NOT NULL DEFAULT '' CONSTRAINT users_note_length_check CHECK (length(note) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_vless_uuid_unique UNIQUE (vless_uuid),
    CONSTRAINT users_hy2_password_unique UNIQUE (hy2_password),
    CONSTRAINT users_sub_token_unique UNIQUE (sub_token)
);

DROP INDEX IF EXISTS idx_users_sub_token;
DROP INDEX IF EXISTS idx_users_vless_uuid;
DROP INDEX IF EXISTS idx_users_hy2_password;

CREATE INDEX IF NOT EXISTS idx_users_status_expires ON users(status, expires_at);

CREATE TABLE IF NOT EXISTS traffic_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    core TEXT NOT NULL,
    uplink BIGINT NOT NULL CONSTRAINT traffic_log_uplink_nonnegative CHECK (uplink >= 0),
    downlink BIGINT NOT NULL CONSTRAINT traffic_log_downlink_nonnegative CHECK (downlink >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_user_time ON traffic_log(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_traffic_recorded ON traffic_log(recorded_at);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL CONSTRAINT admins_username_unique UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH kept AS (
    SELECT id
    FROM admins
    ORDER BY (username = 'admin') DESC, created_at ASC, id ASC
    LIMIT 1
)
DELETE FROM admins
WHERE id NOT IN (SELECT id FROM kept);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_singleton ON admins ((true));

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
