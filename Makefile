SHELL := /bin/bash

.PHONY: build backend frontend dev clean

build: backend frontend

backend:
	cd backend && go build ./cmd/panel

frontend:
	cd frontend && if [ -f package-lock.json ]; then npm ci --no-fund --no-audit; else npm install --no-fund --no-audit; fi && npm run build

dev:
	cd backend && PANEL_ROOT_DIR=.. PANEL_TEMPLATES_DIR=../templates PANEL_FRONTEND_DIR=../frontend/dist go run ./cmd/panel serve

clean:
	rm -rf backend/panel frontend/dist
