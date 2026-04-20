#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${ROOT_DIR}"
REPO_OWNER="ProstyGospody"
REPO_NAME="h2v"
REPO_REF="${H2V_REF:-main}"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_REF}"
TMP_SOURCE_DIR=""
INSTALL_DIR="/opt/mypanel"
ENV_FILE="${INSTALL_DIR}/.env"
BUILD_STATE_DIR="${INSTALL_DIR}/build"
GO_VERSION="${GO_VERSION:-1.22.12}"
NODE_VERSION="${NODE_VERSION:-22.22.2}"
NPM_VERSION="${NPM_VERSION:-10.9.7}"

FIRST_INSTALL=false
NEEDS_CONFIG=false
PANEL_DOMAIN_INPUT=""
PANEL_PORT_INPUT=""
HY2_PORT_INPUT=""
ADMIN_USERNAME_INPUT=""
ADMIN_PASSWORD_INPUT=""
ADMIN_PASSWORD_GENERATED=false
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

normalize_version() {
  local raw="${1#v}"
  printf '%s' "${raw}"
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
    current="$(go version | awk '{print $3}' | sed 's/^go//')"
    if [[ "$(normalize_version "${current}")" == "${GO_VERSION}" ]]; then
      log "Go already installed: ${current}"
      return
    fi
  fi
  install_go
}

install_node() {
  local arch
  local node_dir
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture for Node.js install: $(uname -m)" ;;
  esac

  step "node" "Installing Node.js ${NODE_VERSION}"
  node_dir="/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${arch}"
  rm -rf /usr/local/lib/nodejs
  mkdir -p /usr/local/lib/nodejs
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /usr/local/lib/nodejs
  ln -sf "${node_dir}/bin/node" /usr/local/bin/node
  ln -sf "${node_dir}/bin/npm" /usr/local/bin/npm
  ln -sf "${node_dir}/bin/npx" /usr/local/bin/npx
  if [[ -x "${node_dir}/bin/corepack" ]]; then
    ln -sf "${node_dir}/bin/corepack" /usr/local/bin/corepack
  fi
  npm install -g "npm@${NPM_VERSION}"
}

ensure_node() {
  if command_exists node && command_exists npm; then
    local current_node
    local current_npm
    current_node="$(node -v)"
    current_npm="$(npm -v)"
    if [[ "$(normalize_version "${current_node}")" == "${NODE_VERSION}" && "$(normalize_version "${current_npm}")" == "${NPM_VERSION}" ]]; then
      log "Node.js already installed: ${current_node}, npm ${current_npm}"
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
  [[ "$(go version | awk '{print $3}' | sed 's/^go//')" == "${GO_VERSION}" ]] || fail "unexpected Go version after install"
  [[ "$(normalize_version "$(node -v)")" == "${NODE_VERSION}" ]] || fail "unexpected Node.js version after install"
  [[ "$(normalize_version "$(npm -v)")" == "${NPM_VERSION}" ]] || fail "unexpected npm version after install"
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

prompt_value() {
  local prompt="$1"
  local default="$2"
  local answer=""
  if [[ -t 0 ]]; then
    if [[ -n "${default}" ]]; then
      read -r -p "${prompt} [${default}]: " answer </dev/tty
    else
      read -r -p "${prompt}: " answer </dev/tty
    fi
  fi
  printf '%s' "${answer:-${default}}"
}

prompt_password() {
  local prompt="$1"
  local answer=""
  if [[ -t 0 ]]; then
    read -r -s -p "${prompt}: " answer </dev/tty
    printf '\n' >&2
  fi
  printf '%s' "${answer}"
}

collect_install_inputs() {
  local env_exists=false
  local default_domain="panel.example.com"
  local default_panel_port="8000"
  local default_hy2_port="8443"
  local default_admin_username="${PANEL_ADMIN_USERNAME:-admin}"

  if [[ -f "${ENV_FILE}" ]]; then
    env_exists=true
    local cur_domain cur_panel_port cur_hy2_port
    cur_domain="$(env_get PANEL_DOMAIN || true)"
    cur_panel_port="$(env_get PANEL_PORT || true)"
    cur_hy2_port="$(env_get HY2_PORT || true)"
    [[ -n "${cur_domain}" ]] && default_domain="${cur_domain}"
    [[ -n "${cur_panel_port}" ]] && default_panel_port="${cur_panel_port}"
    [[ -n "${cur_hy2_port}" ]] && default_hy2_port="${cur_hy2_port}"
  else
    FIRST_INSTALL=true
  fi

  # Skip prompts only if .env exists and already has a real (non-placeholder) domain.
  if ${env_exists} && [[ "${default_domain}" != "panel.example.com" ]]; then
    return
  fi

  NEEDS_CONFIG=true

  local is_tty=false
  [[ -t 0 ]] && is_tty=true

  if ${is_tty}; then
    step "config" "Panel configuration (press Enter to accept defaults)"
  else
    step "config" "Non-interactive install: using defaults and generated admin password"
  fi

  local domain_default="${default_domain}"
  [[ "${domain_default}" == "panel.example.com" ]] && domain_default=""

  while true; do
    PANEL_DOMAIN_INPUT="$(prompt_value "Panel domain (e.g. vpn.example.com)" "${domain_default}")"
    if [[ -n "${PANEL_DOMAIN_INPUT}" && "${PANEL_DOMAIN_INPUT}" != "panel.example.com" ]]; then
      break
    fi
    if ! ${is_tty}; then
      PANEL_DOMAIN_INPUT="${default_domain}"
      yellow "No domain provided — keeping placeholder '${PANEL_DOMAIN_INPUT}'. Edit ${ENV_FILE} manually."
      break
    fi
    red "A real domain is required."
  done

  PANEL_PORT_INPUT="$(prompt_value "Panel HTTP port" "${default_panel_port}")"
  HY2_PORT_INPUT="$(prompt_value "Hysteria 2 port" "${default_hy2_port}")"
  ADMIN_USERNAME_INPUT="$(prompt_value "Admin username" "${default_admin_username}")"

  if [[ -n "${PANEL_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASSWORD_INPUT="${PANEL_ADMIN_PASSWORD}"
  elif [[ -t 0 ]]; then
    ADMIN_PASSWORD_INPUT="$(prompt_password "Admin password (blank to auto-generate)")"
  fi

  if [[ -z "${ADMIN_PASSWORD_INPUT}" ]]; then
    ADMIN_PASSWORD_INPUT="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
    ADMIN_PASSWORD_GENERATED=true
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
    "${BUILD_STATE_DIR}" \
    "${INSTALL_DIR}/data/backups" \
    "${INSTALL_DIR}/logs"
  chown -R panel:panel "${INSTALL_DIR}"
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${SOURCE_DIR}/.env.example" "${ENV_FILE}.tmp"
    chmod 600 "${ENV_FILE}.tmp"
    chown panel:panel "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  else
    yellow ".env already exists, keeping existing secrets."
  fi

  if [[ -n "${PANEL_DOMAIN_INPUT}" ]]; then
    env_set PANEL_DOMAIN "${PANEL_DOMAIN_INPUT}"
    env_set HY2_DOMAIN "${PANEL_DOMAIN_INPUT}"
    env_set HY2_CERT_PATH "/etc/letsencrypt/live/${PANEL_DOMAIN_INPUT}/fullchain.pem"
    env_set HY2_KEY_PATH "/etc/letsencrypt/live/${PANEL_DOMAIN_INPUT}/privkey.pem"
    env_set SUB_URL_PREFIX "https://${PANEL_DOMAIN_INPUT}"
  fi
  if [[ -n "${PANEL_PORT_INPUT}" ]]; then
    env_set PANEL_PORT "${PANEL_PORT_INPUT}"
  fi
  if [[ -n "${HY2_PORT_INPUT}" ]]; then
    env_set HY2_PORT "${HY2_PORT_INPUT}"
  fi
}

env_get() {
  local key="${1}"
  [[ -f "${ENV_FILE}" ]] || return 1
  awk -F= -v key="${key}" '
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/\r$/, "", value)
      print value
      exit
    }
  ' "${ENV_FILE}"
}

env_set() {
  local key="${1}"
  local value="${2}"
  local tmp="${ENV_FILE}.tmp"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "${ENV_FILE}" > "${tmp}"

  chmod 600 "${tmp}"
  chown panel:panel "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

ensure_secret_value() {
  local key="${1}"
  local value

  value="$(env_get "${key}" || true)"
  if [[ -n "${value}" ]]; then
    return
  fi

  case "${key}" in
    PANEL_JWT_SECRET) value="$(openssl rand -hex 64)" ;;
    DB_PASSWORD) value="$(openssl rand -hex 24)" ;;
    HY2_TRAFFIC_SECRET) value="$(openssl rand -hex 32)" ;;
    HY2_OBFS_PASSWORD) value="$(openssl rand -base64 24 | tr -d '\n')" ;;
    *)
      fail "unknown secret key requested: ${key}"
      ;;
  esac

  env_set "${key}" "${value}"
}

ensure_runtime_secrets() {
  ensure_secret_value PANEL_JWT_SECRET
  ensure_secret_value DB_PASSWORD
  ensure_secret_value HY2_TRAFFIC_SECRET
  ensure_secret_value HY2_OBFS_PASSWORD
}

ensure_postgres() {
  local db_host db_port db_name db_user db_password
  local db_user_literal db_user_ident db_name_literal db_name_ident db_password_literal
  db_host="$(env_get DB_HOST || true)"
  db_port="$(env_get DB_PORT || true)"
  db_name="$(env_get DB_NAME || true)"
  db_user="$(env_get DB_USER || true)"
  db_password="$(env_get DB_PASSWORD || true)"

  db_host="${db_host:-127.0.0.1}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-mypanel}"
  db_user="${db_user:-panel}"

  if [[ -z "${db_password}" ]]; then
    fail "DB_PASSWORD is empty after env initialization"
  fi

  if [[ "${db_host}" != "127.0.0.1" && "${db_host}" != "localhost" && "${db_host}" != "::1" ]]; then
    yellow "Skipping local PostgreSQL setup because DB_HOST=${db_host}"
    return
  fi

  step "db" "Ensuring PostgreSQL role, password, and database"
  systemctl enable --now postgresql >/dev/null 2>&1 || true
  systemctl start postgresql

  db_user_literal="$(printf "%s" "${db_user}" | sed "s/'/''/g")"
  db_user_ident="$(printf "%s" "${db_user}" | sed 's/"/""/g')"
  db_name_literal="$(printf "%s" "${db_name}" | sed "s/'/''/g")"
  db_name_ident="$(printf "%s" "${db_name}" | sed 's/"/""/g')"
  db_password_literal="$(printf "%s" "${db_password}" | sed "s/'/''/g")"

  if [[ -z "$(sudo -u postgres psql -tA --dbname=postgres --port="${db_port}" -c "SELECT 1 FROM pg_roles WHERE rolname = '${db_user_literal}'")" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
      -c "CREATE ROLE \"${db_user_ident}\" LOGIN PASSWORD '${db_password_literal}'"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
      -c "ALTER ROLE \"${db_user_ident}\" WITH LOGIN PASSWORD '${db_password_literal}'"
  fi

  if [[ -z "$(sudo -u postgres psql -tA --dbname=postgres --port="${db_port}" -c "SELECT 1 FROM pg_database WHERE datname = '${db_name_literal}'")" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
      -c "CREATE DATABASE \"${db_name_ident}\" OWNER \"${db_user_ident}\""
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
    -c "ALTER DATABASE \"${db_name_ident}\" OWNER TO \"${db_user_ident}\""
}

build_artifacts() {
  local frontend_dir
  local cached_lock
  frontend_dir="${SOURCE_DIR}/frontend"
  cached_lock="${BUILD_STATE_DIR}/frontend-package-lock.json"

  step "build" "Building backend and frontend"
  (cd "${SOURCE_DIR}/backend" && go mod download && go mod verify && go build -mod=readonly -o "${INSTALL_DIR}/bin/panel" ./cmd/panel)

  if [[ ! -f "${frontend_dir}/package-lock.json" && -f "${cached_lock}" ]]; then
    cp "${cached_lock}" "${frontend_dir}/package-lock.json"
  fi

  if [[ -f "${frontend_dir}/package-lock.json" ]]; then
    (cd "${frontend_dir}" && npm ci --no-fund --no-audit && npm run build)
  else
    (cd "${frontend_dir}" && npm install --no-fund --no-audit && npm run build)
  fi

  [[ -f "${frontend_dir}/package-lock.json" ]] || fail "frontend build did not produce package-lock.json"
  cp "${frontend_dir}/package-lock.json" "${cached_lock}"
  rsync -a --delete "${frontend_dir}/dist/" "${INSTALL_DIR}/frontend/"

  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "backend build completed without producing ${INSTALL_DIR}/bin/panel"
  [[ -f "${INSTALL_DIR}/frontend/index.html" ]] || fail "frontend build completed without producing ${INSTALL_DIR}/frontend/index.html"

  chown -R panel:panel "${INSTALL_DIR}/bin" "${INSTALL_DIR}/frontend" "${BUILD_STATE_DIR}"
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

start_panel() {
  step "service" "Enabling and starting panel.service"
  systemctl enable panel.service >/dev/null 2>&1 || true
  if ! systemctl restart panel.service; then
    red "panel.service failed to start. Recent logs:"
    journalctl -u panel.service -n 30 --no-pager || true
    fail "panel.service is not running"
  fi
  sleep 1
  if ! systemctl is-active --quiet panel.service; then
    red "panel.service is not active after start. Recent logs:"
    journalctl -u panel.service -n 30 --no-pager || true
    fail "panel.service failed to come up"
  fi
}

setup_reverse_proxy() {
  local domain panel_port
  domain="$(env_get PANEL_DOMAIN || true)"
  panel_port="$(env_get PANEL_PORT || true)"
  panel_port="${panel_port:-8000}"

  if [[ -z "${domain}" || "${domain}" == "panel.example.com" ]]; then
    yellow "Skipping Caddy configuration (no real PANEL_DOMAIN set)."
    yellow "Panel is reachable locally at http://127.0.0.1:${panel_port}/ — configure a reverse proxy or set PANEL_HOST=0.0.0.0 for external access."
    return
  fi

  step "proxy" "Writing /etc/caddy/Caddyfile for ${domain}"
  mkdir -p /etc/caddy
  cat >/etc/caddy/Caddyfile <<EOF
{
  admin off
}

${domain} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${panel_port}
}
EOF

  systemctl enable caddy.service >/dev/null 2>&1 || true
  if ! systemctl reload caddy.service 2>/dev/null; then
    if ! systemctl restart caddy.service; then
      red "caddy.service failed to start. Recent logs:"
      journalctl -u caddy.service -n 30 --no-pager || true
      yellow "Panel backend is up on 127.0.0.1:${panel_port}, but reverse proxy is not — fix Caddy separately."
      return
    fi
  fi
  green "Caddy configured for https://${domain}/ (auto-TLS via Let's Encrypt; requires DNS → this server and ports 80/443 open)."
}

run_migrations() {
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot run migrations"
  PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" migrate up
}

create_admin() {
  if ! ${NEEDS_CONFIG}; then
    return
  fi
  local admin_username="${ADMIN_USERNAME_INPUT:-${PANEL_ADMIN_USERNAME:-admin}}"
  local admin_password="${ADMIN_PASSWORD_INPUT:-${PANEL_ADMIN_PASSWORD:-admin123456}}"
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot create initial admin"

  local admin_output
  local admin_status=0
  admin_output="$(PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" admin create \
    --username="${admin_username}" \
    --password="${admin_password}" 2>&1)" || admin_status=$?

  if [[ ${admin_status} -eq 0 ]]; then
    return
  fi
  if [[ "${admin_output}" == *"already taken"* ]]; then
    yellow "Admin user '${admin_username}' already exists — keeping existing credentials."
    ADMIN_PASSWORD_GENERATED=false
    return
  fi
  red "${admin_output}"
  fail "failed to create admin user"
}

install_all() {
  require_root
  detect_os
  resolve_source_dir

  collect_install_inputs

  ensure_base_packages
  ensure_build_toolchain

  step "user" "Ensuring panel system user and directories"
  ensure_panel_user
  ensure_dirs
  ensure_env
  ensure_runtime_secrets
  ensure_postgres
  install_templates
  build_artifacts
  install_units
  run_migrations
  create_admin
  start_panel
  setup_reverse_proxy

  local final_domain final_port access_url
  final_domain="$(env_get PANEL_DOMAIN || echo panel.example.com)"
  final_port="$(env_get PANEL_PORT || echo 8000)"
  if [[ -n "${final_domain}" && "${final_domain}" != "panel.example.com" ]]; then
    access_url="https://${final_domain}/"
  else
    access_url="http://127.0.0.1:${final_port}/"
  fi

  green "Installation flow completed."
  green "Panel URL:  ${access_url}"
  green "Local URL:  http://127.0.0.1:${final_port}/"
  if ${NEEDS_CONFIG}; then
    green "Admin username: ${ADMIN_USERNAME_INPUT}"
    if ${ADMIN_PASSWORD_GENERATED}; then
      yellow "Admin password (generated): ${ADMIN_PASSWORD_INPUT}"
    else
      yellow "Admin password: ${ADMIN_PASSWORD_INPUT}"
    fi
    yellow "Save this password — it will not be shown again."
  fi
  green "Review ${ENV_FILE} before enabling production services."
  green "Go: $(go version)"
  green "Node: $(node -v), npm: $(npm -v)"
  yellow "Source ref: ${REPO_REF} (set H2V_REF to a tag or commit for immutable source rebuilds)"
}

backup_db() {
  require_root
  local db_host db_port db_name db_user db_password backup_dir
  db_host="$(env_get DB_HOST || true)"
  db_port="$(env_get DB_PORT || true)"
  db_name="$(env_get DB_NAME || true)"
  db_user="$(env_get DB_USER || true)"
  db_password="$(env_get DB_PASSWORD || true)"
  backup_dir="$(env_get BACKUP_DIR || true)"

  db_host="${db_host:-127.0.0.1}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-mypanel}"
  db_user="${db_user:-panel}"
  backup_dir="${backup_dir:-${INSTALL_DIR}/data/backups}"

  mkdir -p "${backup_dir}"
  local name="panel-$(date -u +%F).sql.gz"
  PGPASSWORD="${db_password}" pg_dump -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" | gzip > "${backup_dir}/${name}"
  green "Backup written to ${backup_dir}/${name}"
}

restore_db() {
  require_root
  local db_host db_port db_name db_user db_password
  db_host="$(env_get DB_HOST || true)"
  db_port="$(env_get DB_PORT || true)"
  db_name="$(env_get DB_NAME || true)"
  db_user="$(env_get DB_USER || true)"
  db_password="$(env_get DB_PASSWORD || true)"

  db_host="${db_host:-127.0.0.1}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-mypanel}"
  db_user="${db_user:-panel}"

  local file="${1:-}"
  if [[ -z "${file}" || ! -f "${file}" ]]; then
    red "Provide a valid backup file."
    exit 1
  fi
  gunzip -c "${file}" | PGPASSWORD="${db_password}" psql -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}"
  green "Restore complete."
}

update_all() {
  install_all
}

uninstall_all() {
  require_root
  systemctl disable --now panel hysteria xray 2>/dev/null || true
  rm -rf "${INSTALL_DIR}"
  rm -f /etc/systemd/system/panel.service /etc/systemd/system/xray.service /etc/systemd/system/hysteria.service
  systemctl daemon-reload
  green "Application files removed. Packages, certificates, and database objects were left in place."
}

reset_admin() {
  require_root
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing at ${INSTALL_DIR}/bin/panel — run install first"
  [[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} not found"

  local username password generated=false
  username="${1:-}"
  password="${2:-}"

  if [[ -z "${username}" ]]; then
    username="$(prompt_value "Admin username" "admin")"
  fi

  if [[ -z "${password}" ]]; then
    if [[ -t 0 ]]; then
      password="$(prompt_password "New password (blank to auto-generate)")"
    fi
    if [[ -z "${password}" ]]; then
      password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
      generated=true
    fi
  fi

  step "reset" "Setting new password for admin '${username}'"
  local out status=0
  out="$(PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" admin set-password \
    --username="${username}" \
    --password="${password}" 2>&1)" || status=$?

  if [[ ${status} -ne 0 ]]; then
    red "${out}"
    fail "failed to reset admin password"
  fi

  green "Admin username: ${username}"
  if ${generated}; then
    yellow "Admin password (generated): ${password}"
  else
    yellow "Admin password: ${password}"
  fi
  yellow "Save this password — it will not be shown again."
}

case "${1:-install}" in
  install) install_all ;;
  update|reinstall) update_all ;;
  uninstall) uninstall_all ;;
  reset-admin) reset_admin "${2:-}" "${3:-}" ;;
  backup) backup_db ;;
  restore) restore_db "${2:-}" ;;
  *)
    red "Usage: $0 {install|update|reinstall|uninstall|reset-admin [username] [password]|backup|restore <file>}"
    exit 1
    ;;
esac
