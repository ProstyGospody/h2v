-- +goose Up
ALTER TABLE admins DROP COLUMN IF EXISTS totp_secret;

-- +goose Down
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT;
