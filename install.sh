#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${ROOT_DIR}"
REPO_OWNER="ProstyGospody"
REPO_NAME="h2v"
REPO_REF="${H2V_REF:-main}"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_REF}"
TMP_SOURCE_DIR=""
INSTALL_DIR="/opt/mypanel"
ENV_FILE="${INSTALL_DIR}/.env"
GO_VERSION="${GO_VERSION:-1.22.12}"
NODE_MAJOR="${NODE_MAJOR:-22}"
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/go/bin:${PATH}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
step() { printf '\n[%s] %s\n' "$1" "$2"; }
log() { printf '%s\n' "$1"; }

cleanup() {
  if [[ -n "${TMP_SOURCE_DIR}" && -d "${TMP_SOURCE_DIR}" ]]; then
    rm -rf "${TMP_SOURCE_DIR}"
  fi
}

trap cleanup EXIT

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

fail() {
  red "$1"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

major_version() {
  local raw="${1#v}"
  printf '%s' "${raw%%.*}"
}

ensure_base_packages() {
  step "deps" "Installing Ubuntu dependencies"
  apt-get update
  apt-get install -y \
    bash \
    ca-certificates \
    curl \
    wget \
    openssl \
    jq \
    uuid-runtime \
    certbot \
    postgresql \
    postgresql-contrib \
    caddy \
    rsync \
    git \
    tar \
    gzip \
    xz-utils \
    build-essential \
    sudo
}

install_go() {
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture for Go install: $(uname -m)" ;;
  esac

  step "go" "Installing Go ${GO_VERSION}"
  rm -rf /usr/local/go
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" | tar -C /usr/local -xz
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
}

ensure_go() {
  if command_exists go; then
    local current
    local go_major
    local go_minor
    current="$(go version | awk '{print $3}' | sed 's/^go//')"
    IFS='.' read -r go_major go_minor _ <<< "${current}"
    if [[ "${go_major:-0}" -gt 1 || ( "${go_major:-0}" -eq 1 && "${go_minor:-0}" -ge 22 ) ]]; then
      log "Go already installed: ${current}"
      return
    fi
  fi
  install_go
}

install_node() {
  step "node" "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

ensure_node() {
  if command_exists node && command_exists npm; then
    local current
    current="$(node -v)"
    if [[ "$(major_version "${current}")" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js already installed: ${current}"
      return
    fi
  fi
  install_node
}

ensure_build_toolchain() {
  ensure_go
  ensure_node
  command_exists go || fail "go is still unavailable after install"
  command_exists npm || fail "npm is still unavailable after install"
}

resolve_source_dir() {
  if [[ -f "${SOURCE_DIR}/.env.example" && -d "${SOURCE_DIR}/backend" && -d "${SOURCE_DIR}/frontend" && -d "${SOURCE_DIR}/templates" && -d "${SOURCE_DIR}/units" ]]; then
    return
  fi

  step "source" "Downloading repository source for ${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  TMP_SOURCE_DIR="$(mktemp -d)"
  curl -fsSL "${ARCHIVE_URL}" | tar -xz -C "${TMP_SOURCE_DIR}"

  local extracted
  extracted="$(find "${TMP_SOURCE_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${extracted}" || ! -f "${extracted}/.env.example" ]]; then
    red "Failed to prepare repository source from ${ARCHIVE_URL}"
    exit 1
  fi

  SOURCE_DIR="${extracted}"
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

  cp "${SOURCE_DIR}/.env.example" "${ENV_FILE}.tmp"
  chmod 600 "${ENV_FILE}.tmp"
  chown panel:panel "${ENV_FILE}.tmp"
  mv "${ENV_FILE}.tmp" "${ENV_FILE}"
}

build_artifacts() {
  step "build" "Building backend and frontend"
  (cd "${SOURCE_DIR}/backend" && go build -o "${INSTALL_DIR}/bin/panel" ./cmd/panel)
  (cd "${SOURCE_DIR}/frontend" && npm install && npm run build)
  rsync -a --delete "${SOURCE_DIR}/frontend/dist/" "${INSTALL_DIR}/frontend/"

  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "backend build completed without producing ${INSTALL_DIR}/bin/panel"
  [[ -f "${INSTALL_DIR}/frontend/index.html" ]] || fail "frontend build completed without producing ${INSTALL_DIR}/frontend/index.html"

  chown -R panel:panel "${INSTALL_DIR}/bin" "${INSTALL_DIR}/frontend"
}

install_templates() {
  rsync -a "${SOURCE_DIR}/templates/" "${INSTALL_DIR}/templates/"
  rsync -a "${SOURCE_DIR}/backend/migrations/" "${INSTALL_DIR}/migrations/"
  chown -R panel:panel "${INSTALL_DIR}/templates"
  chown -R panel:panel "${INSTALL_DIR}/migrations"
}

install_units() {
  cp "${SOURCE_DIR}/units/"*.service /etc/systemd/system/
  systemctl daemon-reload
}

run_migrations() {
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot run migrations"
  PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" migrate up
}

create_admin() {
  local admin_username="${PANEL_ADMIN_USERNAME:-admin}"
  local admin_password="${PANEL_ADMIN_PASSWORD:-admin123456}"
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot create initial admin"
  PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" admin create \
    --username="${admin_username}" \
    --password="${admin_password}" || true
}

install_all() {
  require_root
  detect_os
  resolve_source_dir

  ensure_base_packages
  ensure_build_toolchain

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
  green "Go: $(go version)"
  green "Node: $(node -v), npm: $(npm -v)"
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
