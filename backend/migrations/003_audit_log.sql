-- +goose Up
ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE audit_log
    DROP COLUMN IF EXISTS user_agent;
