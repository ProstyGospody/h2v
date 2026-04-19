#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/mypanel"
ENV_FILE="${INSTALL_DIR}/.env"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
step() { printf '\n[%s] %s\n' "$1" "$2"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    red "This script must run as root."
    exit 1
  fi
}

detect_os() {
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    red "Ubuntu 22.04 or 24.04 is required."
    exit 1
  fi
}

ensure_panel_user() {
  if ! id -u panel >/dev/null 2>&1; then
    useradd -r -s /bin/false panel
  fi
}

ensure_dirs() {
  mkdir -p "${INSTALL_DIR}/bin" \
    "${INSTALL_DIR}/configs/xray" \
    "${INSTALL_DIR}/configs/hysteria" \
    "${INSTALL_DIR}/templates" \
    "${INSTALL_DIR}/migrations" \
    "${INSTALL_DIR}/frontend" \
    "${INSTALL_DIR}/data/backups" \
    "${INSTALL_DIR}/logs"
  chown -R panel:panel "${INSTALL_DIR}"
}

ensure_env() {
  if [[ -f "${ENV_FILE}" ]]; then
    yellow ".env already exists, keeping existing secrets."
    return
  fi

  cp "${ROOT_DIR}/.env.example" "${ENV_FILE}.tmp"
  chmod 600 "${ENV_FILE}.tmp"
  chown panel:panel "${ENV_FILE}.tmp"
  mv "${ENV_FILE}.tmp" "${ENV_FILE}"
}

build_artifacts() {
  step "build" "Building backend and frontend"
  if command -v go >/dev/null 2>&1; then
    (cd "${ROOT_DIR}/backend" && go build -o "${INSTALL_DIR}/bin/panel" ./cmd/panel)
  else
    yellow "go not found; backend binary was not built."
  fi

  if command -v npm >/dev/null 2>&1; then
    (cd "${ROOT_DIR}/frontend" && npm install && npm run build)
    rsync -a --delete "${ROOT_DIR}/frontend/dist/" "${INSTALL_DIR}/frontend/"
  else
    yellow "npm not found; frontend assets were not built."
  fi

  chown -R panel:panel "${INSTALL_DIR}/bin" "${INSTALL_DIR}/frontend"
}

install_templates() {
  rsync -a "${ROOT_DIR}/templates/" "${INSTALL_DIR}/templates/"
  rsync -a "${ROOT_DIR}/backend/migrations/" "${INSTALL_DIR}/migrations/"
  chown -R panel:panel "${INSTALL_DIR}/templates"
  chown -R panel:panel "${INSTALL_DIR}/migrations"
}

install_units() {
  cp "${ROOT_DIR}/units/"*.service /etc/systemd/system/
  systemctl daemon-reload
}

run_migrations() {
  if [[ -x "${INSTALL_DIR}/bin/panel" ]]; then
    PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" migrate up
  else
    yellow "panel binary missing; migrations skipped."
  fi
}

create_admin() {
  local admin_username="${PANEL_ADMIN_USERNAME:-admin}"
  local admin_password="${PANEL_ADMIN_PASSWORD:-admin123456}"
  if [[ -x "${INSTALL_DIR}/bin/panel" ]]; then
    PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" admin create \
      --username="${admin_username}" \
      --password="${admin_password}" || true
  fi
}

install_all() {
  require_root
  detect_os

  step "deps" "Installing Ubuntu dependencies"
  apt-get update
  apt-get install -y curl wget openssl jq uuid-runtime certbot postgresql postgresql-contrib caddy rsync

  step "user" "Ensuring panel system user and directories"
  ensure_panel_user
  ensure_dirs
  ensure_env
  install_templates
  build_artifacts
  install_units
  run_migrations
  create_admin

  green "Installation flow completed."
  green "Review ${ENV_FILE} before enabling production services."
}

backup_db() {
  require_root
  source "${ENV_FILE}"
  mkdir -p "${BACKUP_DIR}"
  local name="panel-$(date -u +%F).sql.gz"
  PGPASSWORD="${DB_PASSWORD}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}" | gzip > "${BACKUP_DIR}/${name}"
  green "Backup written to ${BACKUP_DIR}/${name}"
}

restore_db() {
  require_root
  source "${ENV_FILE}"
  local file="${1:-}"
  if [[ -z "${file}" || ! -f "${file}" ]]; then
    red "Provide a valid backup file."
    exit 1
  fi
  gunzip -c "${file}" | PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}"
  green "Restore complete."
}

update_all() {
  install_all
  systemctl enable --now panel || true
}

uninstall_all() {
  require_root
  systemctl disable --now panel hysteria xray 2>/dev/null || true
  rm -rf "${INSTALL_DIR}"
  rm -f /etc/systemd/system/panel.service /etc/systemd/system/xray.service /etc/systemd/system/hysteria.service
  systemctl daemon-reload
  green "Application files removed. Packages, certificates, and database objects were left in place."
}

case "${1:-install}" in
  install) install_all ;;
  update|reinstall) update_all ;;
  uninstall) uninstall_all ;;
  backup) backup_db ;;
  restore) restore_db "${2:-}" ;;
  *)
    red "Usage: $0 {install|update|reinstall|uninstall|backup|restore <file>}"
    exit 1
    ;;
esac
