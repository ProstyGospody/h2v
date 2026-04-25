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
VLESS_PORT_INPUT=""
HY2_PORT_INPUT=""
ADMIN_USERNAME_INPUT=""
ADMIN_PASSWORD_INPUT=""
ADMIN_PASSWORD_GENERATED=false
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/go/bin:${PATH}"

if [[ -t 1 ]]; then
  RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; MAGENTA=$'\033[35m'
else
  RESET=""; BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; MAGENTA=""
fi

STAGE_INDEX=0
STAGE_TOTAL=0

green()   { printf '%s%s%s\n' "${GREEN}" "$1" "${RESET}"; }
yellow()  { printf '%s%s%s\n' "${YELLOW}" "$1" "${RESET}"; }
red()     { printf '%s%s%s\n' "${RED}" "$1" "${RESET}"; }
log()     { printf '    %s\n' "$1"; }
substep() { printf '  %s→%s %s\n' "${DIM}" "${RESET}" "$1"; }
success() { printf '  %s✓%s %s\n' "${GREEN}" "${RESET}" "$1"; }
warn()    { printf '  %s⚠%s %s\n' "${YELLOW}" "${RESET}" "$1"; }
info()    { printf '  %si%s %s\n' "${CYAN}" "${RESET}" "$1"; }

step() {
  STAGE_INDEX=$((STAGE_INDEX + 1))
  local counter=""
  if (( STAGE_TOTAL > 0 )); then
    counter=$(printf '[%d/%d]' "${STAGE_INDEX}" "${STAGE_TOTAL}")
  else
    counter=$(printf '[%s]' "$1")
  fi
  printf '\n%s▶%s %s%s%s %s%s%s\n' "${CYAN}" "${RESET}" "${DIM}" "${counter}" "${RESET}" "${BOLD}" "$2" "${RESET}"
}

banner() {
  local title="$1"
  local sub="${2:-}"
  # printf's width counts bytes, not columns — multi-byte UTF-8 inside the
  # title throws alignment off. Count characters with wc -m and pad manually.
  local title_pad sub_pad
  title_pad=$((60 - $(printf '%s' "${title}" | wc -m)))
  sub_pad=$((60 - $(printf '%s' "${sub}" | wc -m)))
  (( title_pad < 0 )) && title_pad=0
  (( sub_pad < 0 )) && sub_pad=0
  printf '\n'
  printf '%s╔══════════════════════════════════════════════════════════════╗%s\n' "${CYAN}" "${RESET}"
  printf '%s║%s %s%s%*s%s %s║%s\n' "${CYAN}" "${RESET}" "${BOLD}" "${title}" "${title_pad}" "" "${RESET}" "${CYAN}" "${RESET}"
  if [[ -n "${sub}" ]]; then
    printf '%s║%s %s%s%*s%s %s║%s\n' "${CYAN}" "${RESET}" "${DIM}" "${sub}" "${sub_pad}" "" "${RESET}" "${CYAN}" "${RESET}"
  fi
  printf '%s╚══════════════════════════════════════════════════════════════╝%s\n' "${CYAN}" "${RESET}"
}

print_summary() {
  local access_url="$1"
  local local_url="$2"
  printf '\n'
  printf '%s╔══════════════════════════════════════════════════════════════╗%s\n' "${GREEN}" "${RESET}"
  printf '%s║%s %s✓ h2v panel ready%s%44s%s║%s\n' "${GREEN}" "${RESET}" "${BOLD}${GREEN}" "${RESET}" "" "${GREEN}" "${RESET}"
  printf '%s╚══════════════════════════════════════════════════════════════╝%s\n' "${GREEN}" "${RESET}"
  printf '\n'
  printf '  %sPanel URL%s   %s%s%s\n' "${BOLD}" "${RESET}" "${CYAN}" "${access_url}" "${RESET}"
  printf '  %sLocal URL%s   %s%s%s\n' "${BOLD}" "${RESET}" "${DIM}" "${local_url}" "${RESET}"
  if ${NEEDS_CONFIG}; then
    printf '\n'
    printf '  %sAdmin login%s    %s\n' "${BOLD}" "${RESET}" "${ADMIN_USERNAME_INPUT}"
    if ${ADMIN_PASSWORD_GENERATED}; then
      printf '  %sAdmin password%s %s%s%s %s(auto-generated)%s\n' "${BOLD}" "${RESET}" "${YELLOW}" "${ADMIN_PASSWORD_INPUT}" "${RESET}" "${DIM}" "${RESET}"
    else
      printf '  %sAdmin password%s %s%s%s\n' "${BOLD}" "${RESET}" "${YELLOW}" "${ADMIN_PASSWORD_INPUT}" "${RESET}"
    fi
    printf '  %s⚠ Save this password — it will not be shown again.%s\n' "${YELLOW}" "${RESET}"
  fi
  printf '\n'
  printf '  %sEnv file%s     %s\n' "${DIM}" "${RESET}" "${ENV_FILE}"
  printf '  %sSource ref%s   %s %s(set H2V_REF to pin to a tag/commit)%s\n' "${DIM}" "${RESET}" "${REPO_REF}" "${DIM}" "${RESET}"
  printf '  %sToolchain%s    Go %s · Node %s · npm %s\n' "${DIM}" "${RESET}" "$(go version | awk '{print $3}')" "$(node -v)" "$(npm -v)"
  printf '\n'
  printf '  %sReset admin password:%s  %s/opt/mypanel/install.sh reset-admin%s\n' "${DIM}" "${RESET}" "${CYAN}" "${RESET}"
  printf '\n'
}

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
  apt-get update
  apt-get install -y \
    bash \
    ca-certificates \
    curl \
    wget \
    openssl \
    jq \
    unzip \
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

install_xray_binary() {
  local arch
  case "$(uname -m)" in
    x86_64) arch="64" ;;
    aarch64|arm64) arch="arm64-v8a" ;;
    *) fail "Unsupported architecture for Xray-core: $(uname -m)" ;;
  esac
  if [[ -x /usr/local/bin/xray ]]; then
    substep "Xray-core already installed ($(/usr/local/bin/xray version 2>/dev/null | awk 'NR==1 {print $2}'))"
    return
  fi
  substep "downloading Xray-core (${arch})"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-${arch}.zip" -o "${tmp}/xray.zip" \
    || fail "Xray-core download failed"
  unzip -qo "${tmp}/xray.zip" -d "${tmp}"
  install -m 0755 "${tmp}/xray" /usr/local/bin/xray
  install -d -m 0755 /usr/local/share/xray
  [[ -f "${tmp}/geoip.dat" ]] && install -m 0644 "${tmp}/geoip.dat" /usr/local/share/xray/geoip.dat
  [[ -f "${tmp}/geosite.dat" ]] && install -m 0644 "${tmp}/geosite.dat" /usr/local/share/xray/geosite.dat
  rm -rf "${tmp}"
}

install_hysteria_binary() {
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture for Hysteria: $(uname -m)" ;;
  esac
  if [[ -x /usr/local/bin/hysteria ]]; then
    substep "Hysteria 2 already installed ($(/usr/local/bin/hysteria version 2>/dev/null | awk '/Version:/ {print $2}'))"
    return
  fi
  substep "downloading Hysteria 2 (${arch})"
  curl -fsSL "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-${arch}" \
    -o /usr/local/bin/hysteria || fail "Hysteria 2 download failed"
  chmod 0755 /usr/local/bin/hysteria
  setcap 'cap_net_bind_service=+ep' /usr/local/bin/hysteria 2>/dev/null || true
}

ensure_core_users() {
  if ! id -u xray >/dev/null 2>&1; then
    useradd -r -s /bin/false xray
  fi
  if ! id -u hysteria >/dev/null 2>&1; then
    useradd -r -s /bin/false hysteria
  fi
}

ensure_reality_keys() {
  local priv pub
  priv="$(env_get REALITY_PRIVATE_KEY || true)"
  pub="$(env_get REALITY_PUBLIC_KEY || true)"
  if [[ -n "${priv}" && -n "${pub}" ]]; then
    substep "Reality keypair already present"
    return
  fi
  [[ -x /usr/local/bin/xray ]] || fail "xray binary missing; cannot generate Reality keypair"
  local out
  out="$(/usr/local/bin/xray x25519 2>&1)" || {
    red "xray x25519 failed. Raw output:"
    printf '%s\n' "${out}"
    fail "xray x25519 command failed"
  }
  # Xray versions print "Private key:" / "PrivateKey:" (and some releases also
  # print "Password:" as a duplicate of the private key). Split on ':' so the
  # field name variations don't matter — we just take whatever comes after the
  # first colon on the matching line.
  priv="$(printf '%s\n' "${out}" | awk -F: '/[Pp]rivate/ {gsub(/^[ \t]+|[ \t\r]+$/, "", $2); print $2; exit}')"
  pub="$(printf '%s\n' "${out}" | awk -F: '/[Pp]ublic/ {gsub(/^[ \t]+|[ \t\r]+$/, "", $2); print $2; exit}')"
  if [[ -z "${priv}" || -z "${pub}" ]]; then
    red "Could not parse Reality keypair from xray x25519 output:"
    printf '%s\n' "${out}"
    fail "failed to parse Reality keypair"
  fi
  env_set REALITY_PRIVATE_KEY "${priv}"
  env_set REALITY_PUBLIC_KEY "${pub}"
  substep "generated Reality x25519 keypair"
}

render_core_configs() {
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot render core configs"
  PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" config render --core xray \
    || fail "failed to render xray config"
  PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" config render --core hysteria \
    || fail "failed to render hysteria config"
  rm -f "${INSTALL_DIR}/configs/hysteria/config.yaml" "${INSTALL_DIR}/configs/hysteria/config.yml"
  chown panel:xray "${INSTALL_DIR}/configs/xray/config.json" 2>/dev/null || true
  chown panel:hysteria "${INSTALL_DIR}/configs/hysteria/config.json" 2>/dev/null || true
  chmod 0640 "${INSTALL_DIR}/configs/xray/config.json" "${INSTALL_DIR}/configs/hysteria/config.json" 2>/dev/null || true
}

grant_cert_access() {
  local domain cert_path key_path caddy_was_active=false
  domain="$(env_get PANEL_DOMAIN || true)"
  cert_path="$(env_get HY2_CERT_PATH || true)"
  key_path="$(env_get HY2_KEY_PATH || true)"
  [[ -z "${domain}" || "${domain}" == "panel.example.com" ]] && return
  [[ -z "${cert_path}" || -z "${key_path}" ]] && return
  if [[ ! -f "${cert_path}" || ! -f "${key_path}" ]]; then
    warn "TLS cert not found at ${cert_path}; trying certbot standalone for Hysteria 2"
    if systemctl is-active --quiet caddy.service; then
      caddy_was_active=true
      systemctl stop caddy.service || true
    fi
    if ! certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring -d "${domain}"; then
      warn "certbot failed to obtain ${domain}; Hysteria 2 will not start until HY2_CERT_PATH/HY2_KEY_PATH exist"
      info "manual command: systemctl stop caddy && certbot certonly --standalone -d ${domain} && systemctl start caddy"
      ${caddy_was_active} && systemctl start caddy.service || true
      return
    fi
    ${caddy_was_active} && systemctl start caddy.service || true
  fi
  if [[ "${cert_path}" == /etc/letsencrypt/* ]]; then
    chgrp -R hysteria /etc/letsencrypt/live /etc/letsencrypt/archive 2>/dev/null || true
    chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive 2>/dev/null || true
  fi
}

start_cores() {
  local vless_port hy2_port
  vless_port="$(env_get VLESS_PORT || echo 8444)"
  hy2_port="$(env_get HY2_PORT || echo 8443)"

  if [[ "${vless_port}" == "443" ]] && ss -tln 2>/dev/null | awk '{print $4}' | grep -qE '(:|\.)443$'; then
    warn "VLESS_PORT=443 conflicts with another listener (likely Caddy panel HTTPS)"
    info "set VLESS_PORT to a free port (e.g. 8444) in ${ENV_FILE} and rerun"
  fi

  systemctl enable xray.service hysteria.service >/dev/null 2>&1 || true
  systemctl reset-failed xray.service hysteria.service >/dev/null 2>&1 || true
  if ! systemctl restart xray.service; then
    red "xray.service failed to start. Recent logs:"
    journalctl -u xray.service -n 40 --no-pager || true
    warn "xray is NOT running — VLESS traffic will be rejected until resolved"
  else
    substep "xray.service active (VLESS Reality on TCP ${vless_port})"
  fi
  if ! systemctl restart hysteria.service; then
    red "hysteria.service failed to start. Recent logs:"
    journalctl -u hysteria.service -n 40 --no-pager || true
    warn "hysteria is NOT running — Hysteria 2 traffic will be rejected until resolved (most often a missing TLS cert)"
  else
    substep "hysteria.service active (Hysteria 2 on UDP ${hy2_port})"
  fi
}

install_go() {
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture for Go install: $(uname -m)" ;;
  esac

  substep "fetching Go ${GO_VERSION} (${arch})"
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
      substep "Go ${current} already installed"
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

  substep "fetching Node.js ${NODE_VERSION} (${arch})"
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
      substep "Node.js ${current_node} / npm ${current_npm} already installed"
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

  substep "downloading repository source ${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
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
  local default_vless_port="8444"
  local default_hy2_port="8443"
  local default_admin_username="${PANEL_ADMIN_USERNAME:-admin}"

  if [[ -f "${ENV_FILE}" ]]; then
    env_exists=true
    local cur_domain cur_panel_port cur_vless_port cur_hy2_port
    cur_domain="$(env_get PANEL_DOMAIN || true)"
    cur_panel_port="$(env_get PANEL_PORT || true)"
    cur_vless_port="$(env_get VLESS_PORT || true)"
    cur_hy2_port="$(env_get HY2_PORT || true)"
    [[ -n "${cur_domain}" ]] && default_domain="${cur_domain}"
    [[ -n "${cur_panel_port}" ]] && default_panel_port="${cur_panel_port}"
    [[ -n "${cur_vless_port}" ]] && default_vless_port="${cur_vless_port}"
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
    banner "Panel configuration" "press Enter to accept defaults"
  else
    printf '\n'
    warn "non-interactive install: using defaults and generated admin password"
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
  VLESS_PORT_INPUT="$(prompt_value "VLESS Reality TCP port" "${default_vless_port}")"
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
  chmod 0755 "${INSTALL_DIR}" "${INSTALL_DIR}/configs"
  if getent group xray >/dev/null; then
    chown panel:xray "${INSTALL_DIR}/configs/xray"
    chmod 2750 "${INSTALL_DIR}/configs/xray"
    usermod -aG xray panel 2>/dev/null || true
  fi
  if getent group hysteria >/dev/null; then
    chown panel:hysteria "${INSTALL_DIR}/configs/hysteria"
    chmod 2750 "${INSTALL_DIR}/configs/hysteria"
    usermod -aG hysteria panel 2>/dev/null || true
  fi
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${SOURCE_DIR}/.env.example" "${ENV_FILE}.tmp"
    chmod 600 "${ENV_FILE}.tmp"
    chown panel:panel "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
    substep "${ENV_FILE} seeded from .env.example"
  else
    substep "${ENV_FILE} already exists — preserving existing secrets"
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
  if [[ -n "${VLESS_PORT_INPUT}" ]]; then
    env_set VLESS_PORT "${VLESS_PORT_INPUT}"
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

panel_domain_is_real() {
  local domain
  domain="$(env_get PANEL_DOMAIN || true)"
  [[ -n "${domain}" && "${domain}" != "panel.example.com" ]]
}

normalize_vless_env_port() {
  local vless_port
  if ! panel_domain_is_real; then
    return
  fi

  vless_port="$(env_get VLESS_PORT || echo 8444)"
  if [[ "${vless_port}" == "443" ]]; then
    warn "VLESS_PORT=443 conflicts with Caddy panel HTTPS; switching VLESS_PORT to 8444"
    env_set VLESS_PORT 8444
  fi
}

normalize_config_paths() {
  local hy2_config_path xray_config_path

  xray_config_path="$(env_get XRAY_CONFIG_PATH || true)"
  if [[ -z "${xray_config_path}" || "${xray_config_path}" != "${INSTALL_DIR}/configs/xray/config.json" ]]; then
    env_set XRAY_CONFIG_PATH "${INSTALL_DIR}/configs/xray/config.json"
  fi

  hy2_config_path="$(env_get HY2_CONFIG_PATH || true)"
  if [[ -z "${hy2_config_path}" || "${hy2_config_path}" != "${INSTALL_DIR}/configs/hysteria/config.json" ]]; then
    warn "HY2_CONFIG_PATH must point to JSON; switching it to ${INSTALL_DIR}/configs/hysteria/config.json"
    env_set HY2_CONFIG_PATH "${INSTALL_DIR}/configs/hysteria/config.json"
  fi
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
    warn "skipping local PostgreSQL setup (DB_HOST=${db_host})"
    return
  fi

  substep "role=${db_user} db=${db_name} @ ${db_host}:${db_port}"
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

sync_runtime_settings() {
  local db_host db_port db_name db_user db_password vless_port current
  if ! panel_domain_is_real; then
    return
  fi

  vless_port="$(env_get VLESS_PORT || echo 8444)"
  if [[ "${vless_port}" == "443" ]]; then
    warn "VLESS_PORT=443 conflicts with Caddy panel HTTPS; switching VLESS_PORT to 8444"
    env_set VLESS_PORT 8444
    vless_port="8444"
  fi
  if ! [[ "${vless_port}" =~ ^[0-9]+$ ]]; then
    fail "VLESS_PORT must be numeric, got '${vless_port}'"
  fi

  db_host="$(env_get DB_HOST || true)"
  db_port="$(env_get DB_PORT || true)"
  db_name="$(env_get DB_NAME || true)"
  db_user="$(env_get DB_USER || true)"
  db_password="$(env_get DB_PASSWORD || true)"
  db_host="${db_host:-127.0.0.1}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-mypanel}"
  db_user="${db_user:-panel}"

  if [[ "${db_host}" == "127.0.0.1" || "${db_host}" == "localhost" || "${db_host}" == "::1" ]]; then
    current="$(sudo -u postgres psql -tA --dbname="${db_name}" --port="${db_port}" \
      -c "SELECT value::text FROM settings WHERE key = 'vless.port'" 2>/dev/null || true)"
  else
    current="$(PGPASSWORD="${db_password}" psql -tA -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" \
      -c "SELECT value::text FROM settings WHERE key = 'vless.port'" 2>/dev/null || true)"
  fi
  current="${current%\"}"
  current="${current#\"}"

  if [[ "${current}" != "443" ]]; then
    return
  fi

  warn "database setting vless.port is still 443; updating it to ${vless_port}"
  if [[ "${db_host}" == "127.0.0.1" || "${db_host}" == "localhost" || "${db_host}" == "::1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname="${db_name}" --port="${db_port}" \
      -c "INSERT INTO settings (key, value, updated_at) VALUES ('vless.port', '${vless_port}'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
  else
    PGPASSWORD="${db_password}" psql -v ON_ERROR_STOP=1 -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" \
      -c "INSERT INTO settings (key, value, updated_at) VALUES ('vless.port', '${vless_port}'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
  fi
}

build_artifacts() {
  local frontend_dir
  local cached_lock
  local backend_log
  local frontend_log
  frontend_dir="${SOURCE_DIR}/frontend"
  cached_lock="${BUILD_STATE_DIR}/frontend-package-lock.json"
  backend_log="${BUILD_STATE_DIR}/backend-build.log"
  frontend_log="${BUILD_STATE_DIR}/frontend-build.log"

  substep "compiling backend (go build ./cmd/panel)"
  if ! (
    cd "${SOURCE_DIR}/backend" &&
    go mod download &&
    go mod verify &&
    go build -mod=readonly -o "${INSTALL_DIR}/bin/panel" ./cmd/panel
  ) >"${backend_log}" 2>&1; then
    red "backend build failed"
    printf '  %slog:%s %s\n' "${DIM}" "${RESET}" "${backend_log}"
    tail -n 60 "${backend_log}" || true
    fail "unable to compile backend"
  fi

  substep "building frontend bundle (vite)"

  if [[ ! -f "${frontend_dir}/package-lock.json" && -f "${cached_lock}" ]]; then
    cp "${cached_lock}" "${frontend_dir}/package-lock.json"
  fi

  if [[ -f "${frontend_dir}/package-lock.json" ]]; then
    if ! (
      cd "${frontend_dir}" &&
      npm ci --no-fund --no-audit &&
      npm run build
    ) >"${frontend_log}" 2>&1; then
      red "frontend build failed"
      printf '  %slog:%s %s\n' "${DIM}" "${RESET}" "${frontend_log}"
      tail -n 80 "${frontend_log}" || true
      fail "unable to build frontend bundle"
    fi
  else
    if ! (
      cd "${frontend_dir}" &&
      npm install --no-fund --no-audit &&
      npm run build
    ) >"${frontend_log}" 2>&1; then
      red "frontend build failed"
      printf '  %slog:%s %s\n' "${DIM}" "${RESET}" "${frontend_log}"
      tail -n 80 "${frontend_log}" || true
      fail "unable to build frontend bundle"
    fi
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

install_sudoers() {
  local path="/etc/sudoers.d/mypanel-systemctl"
  local tmp="${path}.tmp"
  cat >"${tmp}" <<'EOF'
panel ALL=(root) NOPASSWD: /bin/systemctl restart xray.service, /bin/systemctl restart hysteria.service
panel ALL=(root) NOPASSWD: /bin/systemctl reload xray.service, /bin/systemctl reload hysteria.service
EOF
  chmod 0440 "${tmp}"
  if command_exists visudo; then
    visudo -cf "${tmp}" >/dev/null
  fi
  mv "${tmp}" "${path}"
}

start_panel() {
  substep "enabling panel.service"
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
    warn "skipping Caddy config (no real PANEL_DOMAIN set)"
    info "panel is local-only at http://127.0.0.1:${panel_port}/ — set PANEL_DOMAIN and rerun for auto-TLS"
    return
  fi

  substep "writing /etc/caddy/Caddyfile for ${domain}"
  mkdir -p /etc/caddy
  # protocols h1 h2: disable HTTP/3. The panel is low-traffic and UDP/443 is
  # frequently blocked or mangled by ISPs/NAT; leaving QUIC on triggers
  # ERR_QUIC_PROTOCOL_ERROR in browsers that cached the Alt-Svc hint.
  cat >/etc/caddy/Caddyfile <<EOF
{
  admin off
  servers {
    protocols h1 h2
  }
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
      warn "backend up on 127.0.0.1:${panel_port}, reverse proxy is NOT — fix Caddy separately"
      return
    fi
  fi
  substep "Caddy active for https://${domain}/ (auto-TLS via Let's Encrypt)"
  info "DNS must point ${domain} at this server; ports 80/443 must be open"
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
    warn "admin '${admin_username}' already exists — keeping existing credentials"
    NEEDS_CONFIG=false
    ADMIN_PASSWORD_GENERATED=false
    return
  fi
  red "${admin_output}"
  fail "failed to create admin user"
}

install_all() {
  require_root
  detect_os
  banner "h2v panel installer" "VLESS Reality + Hysteria 2 | Ubuntu 22.04/24.04"
  resolve_source_dir

  collect_install_inputs

  STAGE_INDEX=0
  STAGE_TOTAL=12

  step "deps" "Installing Ubuntu dependencies"
  ensure_base_packages
  success "base packages ready"

  step "toolchain" "Installing Go ${GO_VERSION} and Node ${NODE_VERSION}"
  ensure_build_toolchain
  success "Go $(go version | awk '{print $3}') · Node $(node -v) · npm $(npm -v)"

  step "cores" "Installing Xray-core and Hysteria 2 binaries"
  install_xray_binary
  install_hysteria_binary
  ensure_core_users
  success "xray and hysteria binaries installed"

  step "layout" "Creating panel user and directory layout"
  ensure_panel_user
  ensure_dirs
  ensure_env
  normalize_config_paths
  normalize_vless_env_port
  ensure_runtime_secrets
  ensure_reality_keys
  success "user/panel and ${INSTALL_DIR} prepared"

  step "db" "Ensuring PostgreSQL role and database"
  ensure_postgres
  success "PostgreSQL configured"

  step "assets" "Installing templates and migrations"
  install_templates
  success "templates and migrations synced"

  step "build" "Building backend and frontend"
  build_artifacts
  success "backend binary and frontend bundle built"

  step "units" "Installing systemd units"
  install_units
  install_sudoers
  success "systemd units installed"

  step "migrate" "Running database migrations"
  local migrate_out migrate_status=0
  migrate_out="$(run_migrations 2>&1)" || migrate_status=$?
  if [[ ${migrate_status} -ne 0 ]]; then
    printf '%s\n' "${migrate_out}"
    fail "migrations failed"
  fi
  success "migrations applied"

  step "admin" "Ensuring initial admin account"
  create_admin
  if ${NEEDS_CONFIG}; then
    success "admin '${ADMIN_USERNAME_INPUT}' ready"
  else
    info "existing admin account preserved"
  fi

  step "configs" "Rendering xray and hysteria configs"
  sync_runtime_settings
  render_core_configs
  grant_cert_access
  success "core configs written to ${INSTALL_DIR}/configs/"

  step "service" "Starting panel, cores, and reverse proxy"
  start_panel
  setup_reverse_proxy
  start_cores
  success "panel.service active"

  local final_domain final_port access_url local_url
  final_domain="$(env_get PANEL_DOMAIN || echo panel.example.com)"
  final_port="$(env_get PANEL_PORT || echo 8000)"
  local_url="http://127.0.0.1:${final_port}/"
  if [[ -n "${final_domain}" && "${final_domain}" != "panel.example.com" ]]; then
    access_url="https://${final_domain}/"
  else
    access_url="${local_url}"
  fi

  print_summary "${access_url}" "${local_url}"
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
  banner "h2v panel uninstaller" "stopping services and removing ${INSTALL_DIR}"
  STAGE_INDEX=0
  STAGE_TOTAL=2

  step "stop" "Stopping and disabling services"
  systemctl disable --now panel hysteria xray 2>/dev/null || true
  success "panel/hysteria/xray services stopped"

  step "purge" "Removing application files and units"
  rm -rf "${INSTALL_DIR}"
  rm -f /etc/systemd/system/panel.service /etc/systemd/system/xray.service /etc/systemd/system/hysteria.service
  rm -f /etc/sudoers.d/mypanel-systemctl
  systemctl daemon-reload
  success "${INSTALL_DIR} and systemd units removed"

  printf '\n'
  info "packages, Let's Encrypt certs, and database objects were left in place"
  printf '\n'
}

reset_admin() {
  require_root
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing at ${INSTALL_DIR}/bin/panel — run install first"
  [[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} not found"

  banner "Admin password reset" "panel admin set-password"

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

  STAGE_INDEX=0
  STAGE_TOTAL=1
  step "reset" "Applying new password for admin '${username}'"
  local out status=0
  out="$(PANEL_ENV_FILE="${ENV_FILE}" sudo -u panel "${INSTALL_DIR}/bin/panel" admin set-password \
    --username="${username}" \
    --password="${password}" 2>&1)" || status=$?

  if [[ ${status} -ne 0 ]]; then
    red "${out}"
    fail "failed to reset admin password"
  fi
  success "password updated"

  printf '\n'
  printf '  %sAdmin login%s    %s\n' "${BOLD}" "${RESET}" "${username}"
  if ${generated}; then
    printf '  %sAdmin password%s %s%s%s %s(auto-generated)%s\n' "${BOLD}" "${RESET}" "${YELLOW}" "${password}" "${RESET}" "${DIM}" "${RESET}"
  else
    printf '  %sAdmin password%s %s%s%s\n' "${BOLD}" "${RESET}" "${YELLOW}" "${password}" "${RESET}"
  fi
  printf '  %s⚠ Save this password — it will not be shown again.%s\n\n' "${YELLOW}" "${RESET}"
}

case "${1:-install}" in
  install) install_all ;;
  update|reinstall) update_all ;;
  uninstall) uninstall_all ;;
  reset-admin) reset_admin "${2:-}" "${3:-}" ;;
  backup) backup_db ;;
  restore) restore_db "${2:-}" ;;
  help|-h|--help)
    cat <<'USAGE'
h2v panel installer

Usage:
  install.sh install                         full install (interactive prompts)
  install.sh update | reinstall              re-run install against existing .env
  install.sh uninstall                       remove /opt/mypanel and systemd units
  install.sh reset-admin [user] [pw]         reset admin password
  install.sh backup                          dump database to data/backups
  install.sh restore <file>                  restore database from a gzip dump

Env overrides:
  H2V_REF=<tag|commit>                       pin repository source
  PANEL_ADMIN_USERNAME, PANEL_ADMIN_PASSWORD seed non-interactive admin

USAGE
    ;;
  *)
    red "Usage: $0 {install|update|reinstall|uninstall|reset-admin [username] [password]|backup|restore <file>|help}"
    exit 1
    ;;
esac
