-- +goose Up
WITH kept AS (
    SELECT id
    FROM admins
    ORDER BY (username = 'admin') DESC, created_at ASC, id ASC
    LIMIT 1
)
DELETE FROM admins
WHERE id NOT IN (SELECT id FROM kept);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_singleton ON admins ((true));

-- +goose Down
DROP INDEX IF EXISTS idx_admins_singleton;
