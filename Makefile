SHELL := /bin/bash

.PHONY: build backend frontend dev clean

build: backend frontend

backend:
	cd backend && go build ./cmd/panel

frontend:
	cd frontend && npm install && npm run build

dev:
	cd backend && PANEL_ROOT_DIR=.. PANEL_TEMPLATES_DIR=../templates PANEL_FRONTEND_DIR=../frontend/dist go run ./cmd/panel serve

clean:
	rm -rf backend/panel frontend/dist
