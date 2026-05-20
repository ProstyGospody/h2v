CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
CREATE INDEX IF NOT EXISTS idx_users_created_at_desc ON users(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_status_created_at_desc ON users(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops);

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

CREATE TABLE IF NOT EXISTS traffic_ingest_batches (
    id TEXT PRIMARY KEY,
    core TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_ingest_batches_created_at ON traffic_ingest_batches(created_at);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL CONSTRAINT admins_username_unique UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    icon TEXT NOT NULL DEFAULT 'robot' CONSTRAINT admins_icon_check CHECK (icon IN ('dino', 'robot', 'astronaut', 'rocket', 'crown', 'shield', 'bolt', 'gem', 'planet', 'flame', 'star')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'robot';
ALTER TABLE admins ALTER COLUMN icon SET DEFAULT 'robot';
UPDATE admins
SET icon = 'robot'
WHERE icon IS NULL OR icon NOT IN ('dino', 'robot', 'astronaut', 'rocket', 'crown', 'shield', 'bolt', 'gem', 'planet', 'flame', 'star');
ALTER TABLE admins ALTER COLUMN icon SET NOT NULL;
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_icon_check;

ALTER TABLE admins ADD CONSTRAINT admins_icon_check CHECK (icon IN ('dino', 'robot', 'astronaut', 'rocket', 'crown', 'shield', 'bolt', 'gem', 'planet', 'flame', 'star'));

WITH kept AS (
    SELECT id
    FROM admins
    ORDER BY (username = 'admin') DESC, created_at ASC, id ASC
    LIMIT 1
)
DELETE FROM admins
WHERE id NOT IN (SELECT id FROM kept);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_singleton ON admins ((true));

CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_sessions_refresh_token_hash ON admin_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_active ON admin_sessions(admin_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
