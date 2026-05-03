-- +goose Up
UPDATE users
SET traffic_limit = 0
WHERE traffic_limit < 0;

UPDATE users
SET traffic_used = 0
WHERE traffic_used < 0;

UPDATE users
SET status = 'disabled'
WHERE status NOT IN ('active', 'disabled', 'expired', 'limited');

UPDATE users
SET note = left(note, 1000)
WHERE length(note) > 1000;

UPDATE traffic_log
SET uplink = 0
WHERE uplink < 0;

UPDATE traffic_log
SET downlink = 0
WHERE downlink < 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_status_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_status_check
            CHECK (status IN ('active', 'disabled', 'expired', 'limited'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_traffic_limit_nonnegative'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_traffic_limit_nonnegative
            CHECK (traffic_limit >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_traffic_used_nonnegative'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_traffic_used_nonnegative
            CHECK (traffic_used >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_note_length_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_note_length_check
            CHECK (length(note) <= 1000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'traffic_log_uplink_nonnegative'
          AND conrelid = 'traffic_log'::regclass
    ) THEN
        ALTER TABLE traffic_log
            ADD CONSTRAINT traffic_log_uplink_nonnegative
            CHECK (uplink >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'traffic_log_downlink_nonnegative'
          AND conrelid = 'traffic_log'::regclass
    ) THEN
        ALTER TABLE traffic_log
            ADD CONSTRAINT traffic_log_downlink_nonnegative
            CHECK (downlink >= 0);
    END IF;
END $$;

-- +goose Down
ALTER TABLE traffic_log DROP CONSTRAINT IF EXISTS traffic_log_downlink_nonnegative;
ALTER TABLE traffic_log DROP CONSTRAINT IF EXISTS traffic_log_uplink_nonnegative;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_note_length_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_traffic_used_nonnegative;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_traffic_limit_nonnegative;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
