-- +goose Up
DELETE FROM settings WHERE key = 'subscription.credential';

-- +goose Down
DELETE FROM settings WHERE key = 'subscription.credential';
