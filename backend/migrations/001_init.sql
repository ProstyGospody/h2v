-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-zA-Z0-9_-]{3,32}$'),
    vless_uuid UUID UNIQUE NOT NULL,
    hy2_password TEXT UNIQUE NOT NULL,
    sub_token TEXT UNIQUE NOT NULL,
    traffic_limit BIGINT NOT NULL DEFAULT 0,
    traffic_used BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_sub_token ON users(sub_token);
CREATE INDEX IF NOT EXISTS idx_users_vless_uuid ON users(vless_uuid);
CREATE INDEX IF NOT EXISTS idx_users_hy2_password ON users(hy2_password);
CREATE INDEX IF NOT EXISTS idx_users_status_expires ON users(status, expires_at);

CREATE TABLE IF NOT EXISTS traffic_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    core TEXT NOT NULL,
    uplink BIGINT NOT NULL,
    downlink BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traffic_user_time ON traffic_log(user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_traffic_recorded ON traffic_log(recorded_at);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    role TEXT NOT NULL DEFAULT 'admin',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_history (
    id BIGSERIAL PRIMARY KEY,
    core TEXT NOT NULL,
    content TEXT NOT NULL,
    applied_by UUID REFERENCES admins(id),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_config_history_core_time ON config_history(core, applied_at DESC);

-- +goose Down
DROP TABLE IF EXISTS config_history;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS traffic_log;
DROP TABLE IF EXISTS users;
