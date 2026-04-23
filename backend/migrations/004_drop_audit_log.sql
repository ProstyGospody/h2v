-- +goose Up
DROP TABLE IF EXISTS audit_log;

-- +goose Down
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES admins(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip INET,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_admin_time ON audit_log(admin_id, created_at DESC);
