-- +goose Up
-- Switch traffic_log.user_id FK from CASCADE to SET NULL so the panel-wide
-- aggregate graph keeps history of deleted users. Per-user queries filter by
-- user_id and naturally drop NULL rows, so the per-user chart still empties
-- when a user is deleted.
ALTER TABLE traffic_log DROP CONSTRAINT IF EXISTS traffic_log_user_id_fkey;
ALTER TABLE traffic_log
    ADD CONSTRAINT traffic_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE traffic_log DROP CONSTRAINT IF EXISTS traffic_log_user_id_fkey;
ALTER TABLE traffic_log
    ADD CONSTRAINT traffic_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
