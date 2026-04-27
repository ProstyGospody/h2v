-- +goose Up
DROP TABLE IF EXISTS config_history;

-- +goose Down
SELECT 1;
