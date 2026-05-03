#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${ROOT_DIR}"
REPO_OWNER="ProstyGospody"
REPO_NAME="h2v"
# Use latest commit from main by default. Override H2V_REF only when you need
# to install a specific branch, tag, or commit.
REPO_REF="${H2V_REF:-main}"
# Version embedded into the panel binary. Defaults to the selected ref for main/dev installs.
H2V_VERSION="${H2V_VERSION:-${REPO_REF}}"
# main is a moving ref, so allow floating refs by default. Set to 0 only when
# you intentionally require a pinned tag/commit.
H2V_ALLOW_FLOATING_REF="${H2V_ALLOW_FLOATING_REF:-1}"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_REF}"
H2V_SOURCE_SHA256="${H2V_SOURCE_SHA256:-}"
TMP_SOURCE_DIR=""
INSTALL_DIR="/opt/mypanel"
ENV_FILE="${INSTALL_DIR}/.env"
BUILD_STATE_DIR="${INSTALL_DIR}/build"
GO_VERSION="${GO_VERSION:-1.26.2}"
NODE_VERSION="${NODE_VERSION:-22.22.2}"
NPM_VERSION="${NPM_VERSION:-10.9.7}"
XRAY_VERSION="${XRAY_VERSION:-v26.3.27}"
XRAY_SHA256_64="${XRAY_SHA256_64:-23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae}"
XRAY_SHA256_ARM64_V8A="${XRAY_SHA256_ARM64_V8A:-4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c}"
HYSTERIA_VERSION="${HYSTERIA_VERSION:-app/v2.8.2}"
HYSTERIA_SHA256_AMD64="${HYSTERIA_SHA256_AMD64:-b11bf0fb5f84a3f5c6baff3696e899539e68af4cee868c9203cfb896784ad3b0}"
HYSTERIA_SHA256_ARM64="${HYSTERIA_SHA256_ARM64:-802d77ae3ca37bdc235ec848edfaaa7cb9109007d9044f50b0746239269cb8cf}"
XRAY_GEODATA_DIR_DEFAULT="${INSTALL_DIR}/data/geodata"
XRAY_GEODATA_DIR_LEGACY="/usr/local/share/xray"
XRAY_GEOIP_URL_DEFAULT="https://github.com/v2fly/geoip/releases/latest/download/geoip.dat"
XRAY_GEOSITE_URL_DEFAULT="https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat"

FIRST_INSTALL=false
NEEDS_CONFIG=false
PANEL_DOMAIN_INPUT=""
PANEL_PUBLIC_PORT_INPUT=""
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

UI_TTY=false
if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
  UI_TTY=true
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

terminal_width() {
  local width="${COLUMNS:-}"
  if [[ -z "${width}" || ! "${width}" =~ ^[0-9]+$ ]]; then
    width="$(tput cols 2>/dev/null || true)"
  fi
  if [[ -z "${width}" || ! "${width}" =~ ^[0-9]+$ ]]; then
    width=80
  fi
  if (( width < 60 )); then
    width=60
  elif (( width > 120 )); then
    width=120
  fi
  printf '%s' "${width}"
}

clear_screen() {
  ${UI_TTY} || return 0
  [[ "${H2V_NO_CLEAR:-}" == "1" ]] && return 0
  printf '\033[2J\033[H'
}

progress_bar() {
  local current="$1"
  local total="$2"
  local width
  local filled empty percent fill_chunk empty_chunk

  if (( total <= 0 )); then
    return 0
  fi

  width=$(( $(terminal_width) / 3 ))
  if (( width < 20 )); then
    width=20
  elif (( width > 40 )); then
    width=40
  fi

  filled=$(( current * width / total ))
  empty=$(( width - filled ))
  percent=$(( current * 100 / total ))

  printf -v fill_chunk '%*s' "${filled}" ''
  printf -v empty_chunk '%*s' "${empty}" ''
  fill_chunk="${fill_chunk// /█}"
  empty_chunk="${empty_chunk// /░}"

  printf '%s[%s%s%s%s]%s %3d%%' "${DIM}" "${CYAN}" "${fill_chunk}" "${DIM}" "${empty_chunk}" "${RESET}" "${percent}"
}

tty_clean_previous_line() {
  ${UI_TTY} || return 0
  can_prompt || return 0
  printf '\033[1A\r\033[2K' >/dev/tty
}

tty_prompt_result() {
  local label="$1"
  local value="$2"
  ${UI_TTY} || return 0
  can_prompt || return 0
  tty_clean_previous_line
  tty_prompt_result_current "${label}" "${value}"
}

tty_prompt_result_current() {
  local label="$1"
  local value="$2"
  ${UI_TTY} || return 0
  can_prompt || return 0
  printf '\r\033[2K' >/dev/tty
  printf '  %s✓%s %s%s%s: %s\n' "${GREEN}" "${RESET}" "${BOLD}" "${label}" "${RESET}" "${value}" >/dev/tty
}

step() {
  STAGE_INDEX=$((STAGE_INDEX + 1))
  local counter=""
  if (( STAGE_TOTAL > 0 )); then
    counter=$(printf 'Stage %02d/%02d' "${STAGE_INDEX}" "${STAGE_TOTAL}")
  else
    counter=$(printf '%s' "$1")
  fi
  printf '\n%s▶%s %s%s%s %s%s%s\n' "${CYAN}" "${RESET}" "${DIM}" "${counter}" "${RESET}" "${BOLD}" "$2" "${RESET}"
  if (( STAGE_TOTAL > 0 )); then
    printf '  %s\n' "$(progress_bar "${STAGE_INDEX}" "${STAGE_TOTAL}")"
  fi
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
  printf '  %sSource ref%s   %s %s(defaults to latest main commit)%s\n' "${DIM}" "${RESET}" "${REPO_REF}" "${DIM}" "${RESET}"
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

verify_sha256() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if [[ -z "${expected}" || ! "${expected}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    fail "missing or invalid SHA256 for ${label}"
  fi
  printf '%s  %s\n' "${expected}" "${file}" | sha256sum -c - >/dev/null \
    || fail "${label} checksum verification failed"
}

download_verified() {
  local url="$1"
  local file="$2"
  local expected="$3"
  local label="$4"
  curl -fsSL "${url}" -o "${file}" || fail "${label} download failed"
  verify_sha256 "${file}" "${expected}" "${label}"
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
    iproute2 \
    rsync \
    git \
    tar \
    gzip \
    xz-utils \
    build-essential \
    sudo
}

install_xray_binary() {
  local arch sha
  case "$(uname -m)" in
    x86_64) arch="64"; sha="${XRAY_SHA256_64}" ;;
    aarch64|arm64) arch="arm64-v8a"; sha="${XRAY_SHA256_ARM64_V8A}" ;;
    *) fail "Unsupported architecture for Xray-core: $(uname -m)" ;;
  esac
  if [[ -x /usr/local/bin/xray ]]; then
    local current
    current="$(/usr/local/bin/xray version 2>/dev/null | awk 'NR==1 {print $2}')"
    if [[ "$(normalize_version "${current}")" == "$(normalize_version "${XRAY_VERSION}")" ]]; then
      substep "Xray-core already installed (${current})"
      return
    fi
    substep "replacing Xray-core ${current:-unknown} with ${XRAY_VERSION}"
  fi
  substep "downloading Xray-core ${XRAY_VERSION} (${arch})"
  local tmp
  tmp="$(mktemp -d)"
  download_verified \
    "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${arch}.zip" \
    "${tmp}/xray.zip" \
    "${sha}" \
    "Xray-core ${XRAY_VERSION} (${arch})"
  unzip -qo "${tmp}/xray.zip" -d "${tmp}"
  install -m 0755 "${tmp}/xray" /usr/local/bin/xray
  install -d -m 0755 /usr/local/share/xray
  [[ -f "${tmp}/geoip.dat" ]] && install -m 0644 "${tmp}/geoip.dat" /usr/local/share/xray/geoip.dat
  [[ -f "${tmp}/geosite.dat" ]] && install -m 0644 "${tmp}/geosite.dat" /usr/local/share/xray/geosite.dat
  rm -rf "${tmp}"
}

install_hysteria_binary() {
  local arch sha
  case "$(uname -m)" in
    x86_64) arch="amd64"; sha="${HYSTERIA_SHA256_AMD64}" ;;
    aarch64|arm64) arch="arm64"; sha="${HYSTERIA_SHA256_ARM64}" ;;
    *) fail "Unsupported architecture for Hysteria: $(uname -m)" ;;
  esac
  if [[ -x /usr/local/bin/hysteria ]]; then
    local current
    current="$(/usr/local/bin/hysteria version 2>/dev/null | awk '/Version:/ {print $2}')"
    if [[ "$(normalize_version "${current}")" == "$(normalize_version "${HYSTERIA_VERSION##*/}")" ]]; then
      substep "Hysteria 2 already installed (${current})"
      return
    fi
    substep "replacing Hysteria 2 ${current:-unknown} with ${HYSTERIA_VERSION}"
  fi
  substep "downloading Hysteria 2 ${HYSTERIA_VERSION} (${arch})"
  local tmp version_path
  tmp="$(mktemp -d)"
  version_path="${HYSTERIA_VERSION//\//%2F}"
  download_verified \
    "https://github.com/apernet/hysteria/releases/download/${version_path}/hysteria-linux-${arch}" \
    "${tmp}/hysteria" \
    "${sha}" \
    "Hysteria 2 ${HYSTERIA_VERSION} (${arch})"
  install -m 0755 "${tmp}/hysteria" /usr/local/bin/hysteria
  rm -rf "${tmp}"
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

update_geodata() {
  [[ -x "${INSTALL_DIR}/bin/panel" ]] || fail "panel binary missing; cannot update core geodata"
  local geodata_dir out status=0
  geodata_dir="$(env_get XRAY_GEODATA_DIR || true)"
  geodata_dir="${geodata_dir:-${XRAY_GEODATA_DIR_DEFAULT}}"
  install -d -m 0755 "${geodata_dir}"

  out="$(PANEL_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/panel" geodata update 2>&1)" || status=$?
  if [[ ${status} -ne 0 ]]; then
    if [[ -s "${geodata_dir}/geoip.dat" && -s "${geodata_dir}/geosite.dat" ]]; then
      warn "geodata update failed; keeping existing geoip.dat/geosite.dat"
      printf '%s\n' "${out}"
      return
    fi
    red "${out}"
    fail "geodata update failed"
  fi

  if [[ "${geodata_dir}" == "${INSTALL_DIR}/data" || "${geodata_dir}" == "${INSTALL_DIR}/data/"* ]]; then
    chown -R panel:panel "${geodata_dir}" 2>/dev/null || true
  elif getent group xray >/dev/null 2>&1; then
    chown -R root:xray "${geodata_dir}" 2>/dev/null || true
  fi
  chmod 0755 "${geodata_dir}" 2>/dev/null || true
  chmod 0644 "${geodata_dir}/geoip.dat" "${geodata_dir}/geosite.dat" 2>/dev/null || true
  substep "geoip.dat/geosite.dat updated in ${geodata_dir}"
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
  local panel_public_port vless_port hy2_port
  panel_public_port="$(env_get PANEL_PUBLIC_PORT || echo 443)"
  vless_port="$(env_get VLESS_PORT || echo 8444)"
  hy2_port="$(env_get HY2_PORT || echo 8443)"

  if [[ "${vless_port}" == "${panel_public_port}" ]] && ss -tln 2>/dev/null | awk -v p="${panel_public_port}" '{print $4}' | grep -qE "(:|\\.)${panel_public_port}$"; then
    warn "VLESS_PORT=${vless_port} conflicts with another listener (likely Caddy panel HTTPS)"
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

  case "${REPO_REF}" in
    main|master|HEAD|latest)
      if [[ "${H2V_ALLOW_FLOATING_REF:-0}" != "1" ]]; then
        fail "ref ${REPO_REF} is moving; set H2V_REF to a pinned tag/commit or H2V_ALLOW_FLOATING_REF=1 to use latest main"
      fi
      ;;
  esac

  substep "downloading repository source ${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  TMP_SOURCE_DIR="$(mktemp -d)"
  local archive
  archive="${TMP_SOURCE_DIR}/source.tar.gz"
  if ! curl -fsSL "${ARCHIVE_URL}" -o "${archive}"; then
    if [[ "${REPO_REF}" == "v${H2V_VERSION:-}" ]]; then
      fail "repository ref ${REPO_REF} was not found. Run from a full local checkout, set H2V_REF=main H2V_ALLOW_FLOATING_REF=1, or set H2V_REF to an existing tag/commit"
    fi
    fail "unable to download repository source ${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  fi
  if [[ -n "${H2V_SOURCE_SHA256}" ]]; then
    verify_sha256 "${archive}" "${H2V_SOURCE_SHA256}" "${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  elif [[ "${H2V_REQUIRE_SOURCE_SHA256:-0}" == "1" ]]; then
    fail "H2V_SOURCE_SHA256 is required for repository source verification"
  else
    warn "repository source checksum not set; using repository ref ${REPO_REF}"
  fi
  tar -xzf "${archive}" -C "${TMP_SOURCE_DIR}"

  local extracted
  extracted="$(find "${TMP_SOURCE_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${extracted}" || ! -f "${extracted}/.env.example" ]]; then
    red "Failed to prepare repository source from ${ARCHIVE_URL}"
    exit 1
  fi

  SOURCE_DIR="${extracted}"
}

can_prompt() {
  [[ -r /dev/tty && -w /dev/tty ]]
}

prompt_value() {
  local prompt="$1"
  local default="$2"
  local show_result="${3:-yes}"
  local answer=""
  local value=""
  if can_prompt; then
    if [[ -n "${default}" ]]; then
      printf '%s [%s]: ' "${prompt}" "${default}" >/dev/tty
    else
      printf '%s: ' "${prompt}" >/dev/tty
    fi
    read -r answer </dev/tty
  fi
  value="${answer:-${default}}"
  if can_prompt && [[ "${show_result}" == "yes" ]]; then
    tty_prompt_result "${prompt}" "${value:-<empty>}"
  elif can_prompt; then
    tty_clean_previous_line
  fi
  printf '%s' "${value}"
}

prompt_password() {
  local prompt="$1"
  local answer=""
  local status="auto-generate"
  if can_prompt; then
    printf '%s: ' "${prompt}" >/dev/tty
    read -r -s answer </dev/tty
    printf '\n' >/dev/tty
  fi
  if [[ -n "${answer}" ]]; then
    status="set"
  fi
  if can_prompt; then
    tty_prompt_result "${prompt}" "${status}"
  fi
  printf '%s' "${answer}"
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-no}"
  local answer=""
  local suffix="[y/N]"
  if [[ "${default}" == "yes" ]]; then
    suffix="[Y/n]"
  fi
  if can_prompt; then
    printf '%s %s: ' "${prompt}" "${suffix}" >/dev/tty
    read -r answer </dev/tty
  fi
  answer="${answer#"${answer%%[![:space:]]*}"}"
  answer="${answer%"${answer##*[![:space:]]}"}"
  answer="${answer:-${default}}"
  case "${answer,,}" in
    y|yes|1|true|д|да)
      if can_prompt; then
        tty_prompt_result "${prompt}" "yes"
      fi
      return 0
      ;;
    *)
      if can_prompt; then
        tty_prompt_result "${prompt}" "no"
      fi
      return 1
      ;;
  esac
}

valid_port_number() {
  local port="$1"
  [[ "${port}" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 ))
}

port_listener_in_use() {
  local protocol="$1"
  local port="$2"
  local ss_args

  if command_exists ss; then
    case "${protocol}" in
      tcp) ss_args="-H -ltn" ;;
      udp) ss_args="-H -lun" ;;
      *) return 1 ;;
    esac
    ss ${ss_args} 2>/dev/null | awk -v p="${port}" '
      {
        n = split($4, parts, ":")
        if (parts[n] == p) found = 1
      }
      END { exit found ? 0 : 1 }
    '
    return $?
  fi

  if [[ "${protocol}" == "tcp" ]]; then
    (: >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1 && return 0
  fi
  return 1
}

selected_panel_domain_is_real() {
  [[ -n "${PANEL_DOMAIN_INPUT}" && "${PANEL_DOMAIN_INPUT}" != "panel.example.com" ]]
}

vless_fallback_port() {
  local panel_public_port="$1"
  if [[ "${panel_public_port}" == "8444" ]]; then
    printf '443'
  else
    printf '8444'
  fi
}

prompt_service_port() {
  local key="$1"
  local label="$2"
  local default="$3"
  local protocol="$4"
  local port
  local is_tty=false
  can_prompt && is_tty=true

  while true; do
    port="$(prompt_value "${label}" "${default}" "no")"
    if ! valid_port_number "${port}"; then
      red "${label} must be a number between 1 and 65535." >&2
      ${is_tty} || fail "${label} is invalid"
      continue
    fi
    if [[ "${key}" == "PANEL_PUBLIC_PORT" && ( "${port}" == "80" || ( "${port}" -lt 1024 && "${port}" != "443" ) ) ]]; then
      red "${label} must be 443 or 1024 or higher." >&2
      ${is_tty} || fail "${label} must be 443 or 1024 or higher"
      continue
    fi
    if selected_panel_domain_is_real && [[ "${key}" == "VLESS_PORT" && -n "${PANEL_PUBLIC_PORT_INPUT}" && "${port}" == "${PANEL_PUBLIC_PORT_INPUT}" ]]; then
      red "${label} ${port}/tcp conflicts with the panel public HTTPS port." >&2
      ${is_tty} || fail "${label} ${port}/tcp conflicts with panel public HTTPS"
      continue
    fi
    if [[ "${key}" != "PANEL_PUBLIC_PORT" || selected_panel_domain_is_real ]] && port_listener_in_use "${protocol}" "${port}"; then
      red "${label} ${port}/${protocol} is already in use. Choose another port." >&2
      ${is_tty} || fail "${label} ${port}/${protocol} is already in use"
      continue
    fi
    if can_prompt; then
      tty_prompt_result_current "${label}" "${port}"
    fi
    printf '%s' "${port}"
    return
  done
}

collect_install_inputs() {
  local env_exists=false
  local default_domain="panel.example.com"
  local default_panel_public_port="443"
  local default_vless_port="8444"
  local default_hy2_port="8443"
  local default_admin_username="${PANEL_ADMIN_USERNAME:-admin}"

  if [[ -f "${ENV_FILE}" ]]; then
    env_exists=true
    local cur_domain cur_panel_public_port cur_vless_port cur_hy2_port
    cur_domain="$(env_get PANEL_DOMAIN || true)"
    cur_panel_public_port="$(env_get PANEL_PUBLIC_PORT || true)"
    cur_vless_port="$(env_get VLESS_PORT || true)"
    cur_hy2_port="$(env_get HY2_PORT || true)"
    [[ -n "${cur_domain}" ]] && default_domain="${cur_domain}"
    [[ -n "${cur_panel_public_port}" ]] && default_panel_public_port="${cur_panel_public_port}"
    [[ -n "${cur_vless_port}" ]] && default_vless_port="${cur_vless_port}"
    [[ -n "${cur_hy2_port}" ]] && default_hy2_port="${cur_hy2_port}"
  else
    FIRST_INSTALL=true
    NEEDS_CONFIG=true
  fi

  if ${env_exists}; then
    if ! can_prompt; then
      return
    fi
    if ! prompt_yes_no "Reconfigure panel variables (domain and public ports)?" "no"; then
      return
    fi
    info "reconfiguration enabled - panel domain and ports will be prompted"
  fi

  local is_tty=false
  can_prompt && is_tty=true

  if ${is_tty}; then
    banner "Panel configuration" "press Enter to accept defaults"
  else
    printf '\n'
    warn "non-interactive install: using defaults and generated admin password"
  fi

  local domain_default="${default_domain}"
  [[ "${domain_default}" == "panel.example.com" ]] && domain_default=""

  local domain_label="Panel domain (e.g. vpn.example.com)"
  while true; do
    PANEL_DOMAIN_INPUT="$(prompt_value "${domain_label}" "${domain_default}" "no")"
    if [[ -n "${PANEL_DOMAIN_INPUT}" && "${PANEL_DOMAIN_INPUT}" != "panel.example.com" ]]; then
      if can_prompt; then
        tty_prompt_result_current "${domain_label}" "${PANEL_DOMAIN_INPUT}"
      fi
      break
    fi
    if ! ${is_tty}; then
      PANEL_DOMAIN_INPUT="${default_domain}"
      yellow "No domain provided — keeping placeholder '${PANEL_DOMAIN_INPUT}'. Edit ${ENV_FILE} manually."
      break
    fi
    red "A real domain is required."
  done

  PANEL_PUBLIC_PORT_INPUT="$(prompt_service_port PANEL_PUBLIC_PORT "Panel public HTTPS port" "${default_panel_public_port}" tcp)"
  while true; do
    VLESS_PORT_INPUT="$(prompt_service_port VLESS_PORT "VLESS Reality TCP port" "${default_vless_port}" tcp)"
    if [[ "${VLESS_PORT_INPUT}" != "${PANEL_PUBLIC_PORT_INPUT}" ]]; then
      break
    fi
    red "VLESS Reality TCP port must differ from Panel public HTTPS port." >&2
    ${is_tty} || fail "VLESS Reality TCP port conflicts with Panel public HTTPS port"
  done
  HY2_PORT_INPUT="$(prompt_service_port HY2_PORT "Hysteria 2 UDP port" "${default_hy2_port}" udp)"
  if ! ${env_exists}; then
    ADMIN_USERNAME_INPUT="$(prompt_value "Admin username" "${default_admin_username}")"

    if [[ -n "${PANEL_ADMIN_PASSWORD:-}" ]]; then
      ADMIN_PASSWORD_INPUT="${PANEL_ADMIN_PASSWORD}"
    elif can_prompt; then
      ADMIN_PASSWORD_INPUT="$(prompt_password "Admin password (blank to auto-generate)")"
    fi

    if [[ -z "${ADMIN_PASSWORD_INPUT}" ]]; then
      ADMIN_PASSWORD_INPUT="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
      ADMIN_PASSWORD_GENERATED=true
    fi
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
  chmod 0755 "${INSTALL_DIR}/data" 2>/dev/null || true
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
    local public_prefix="https://${PANEL_DOMAIN_INPUT}"
    if [[ -n "${PANEL_PUBLIC_PORT_INPUT}" && "${PANEL_PUBLIC_PORT_INPUT}" != "443" ]]; then
      public_prefix="https://${PANEL_DOMAIN_INPUT}:${PANEL_PUBLIC_PORT_INPUT}"
    fi
    env_set SUB_URL_PREFIX "${public_prefix}"
  fi
  if [[ -n "${PANEL_PUBLIC_PORT_INPUT}" ]]; then
    env_set PANEL_PUBLIC_PORT "${PANEL_PUBLIC_PORT_INPUT}"
  fi
  env_set_default PANEL_PORT 8000
  env_set_default PANEL_PUBLIC_PORT 443
  if [[ -n "${VLESS_PORT_INPUT}" ]]; then
    env_set VLESS_PORT "${VLESS_PORT_INPUT}"
  fi
  if [[ -n "${HY2_PORT_INPUT}" ]]; then
    env_set HY2_PORT "${HY2_PORT_INPUT}"
  fi

  local geodata_dir
  geodata_dir="$(env_get XRAY_GEODATA_DIR || true)"
  if [[ -z "${geodata_dir}" || "${geodata_dir}" == "${XRAY_GEODATA_DIR_LEGACY}" ]]; then
    geodata_dir="${XRAY_GEODATA_DIR_DEFAULT}"
    env_set XRAY_GEODATA_DIR "${geodata_dir}"
  fi
  geodata_dir="${geodata_dir:-${XRAY_GEODATA_DIR_DEFAULT}}"
  env_set XRAY_LOCATION_ASSET "${geodata_dir}"
  env_set_default XRAY_GEOIP_URL "${XRAY_GEOIP_URL_DEFAULT}"
  env_set_default XRAY_GEOSITE_URL "${XRAY_GEOSITE_URL_DEFAULT}"
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

env_set_default() {
  local key="${1}"
  local value="${2}"
  local current
  current="$(env_get "${key}" || true)"
  if [[ -z "${current}" ]]; then
    env_set "${key}" "${value}"
  fi
}

panel_domain_is_real() {
  local domain
  domain="$(env_get PANEL_DOMAIN || true)"
  [[ -n "${domain}" && "${domain}" != "panel.example.com" ]]
}

normalize_vless_env_port() {
  local panel_public_port vless_port
  if ! panel_domain_is_real; then
    return
  fi

  panel_public_port="$(env_get PANEL_PUBLIC_PORT || echo 443)"
  vless_port="$(env_get VLESS_PORT || echo 8444)"
  if [[ "${vless_port}" == "${panel_public_port}" ]]; then
    local fallback
    fallback="$(vless_fallback_port "${panel_public_port}")"
    warn "VLESS_PORT=${vless_port} conflicts with the panel public HTTPS port; switching VLESS_PORT to ${fallback}"
    env_set VLESS_PORT "${fallback}"
  fi
}

validate_selected_runtime_ports() {
  local domain panel_port panel_public_port vless_port hy2_port
  domain="$(env_get PANEL_DOMAIN || true)"
  panel_port="$(env_get PANEL_PORT || echo 8000)"
  panel_public_port="$(env_get PANEL_PUBLIC_PORT || echo 443)"
  vless_port="$(env_get VLESS_PORT || echo 8444)"
  hy2_port="$(env_get HY2_PORT || echo 8443)"

  valid_port_number "${panel_port}" || fail "PANEL_PORT must be a number between 1 and 65535"
  valid_port_number "${panel_public_port}" || fail "PANEL_PUBLIC_PORT must be a number between 1 and 65535"
  valid_port_number "${vless_port}" || fail "VLESS_PORT must be a number between 1 and 65535"
  valid_port_number "${hy2_port}" || fail "HY2_PORT must be a number between 1 and 65535"

  if (( panel_port < 1024 )); then
    fail "PANEL_PORT is the internal panel listener and must be 1024 or higher"
  fi
  if [[ "${panel_public_port}" == "80" || ( "${panel_public_port}" -lt 1024 && "${panel_public_port}" != "443" ) ]]; then
    fail "PANEL_PUBLIC_PORT must be 443 or 1024 or higher"
  fi
  if [[ -n "${domain}" && "${domain}" != "panel.example.com" && "${panel_public_port}" == "${panel_port}" ]]; then
    fail "PANEL_PUBLIC_PORT and PANEL_PORT cannot both use TCP ${panel_public_port}"
  fi
  if [[ "${panel_port}" == "${vless_port}" ]]; then
    fail "PANEL_PORT and VLESS_PORT cannot both use TCP ${panel_port}"
  fi
  if [[ -n "${domain}" && "${domain}" != "panel.example.com" && "${panel_public_port}" == "${vless_port}" ]]; then
    fail "PANEL_PUBLIC_PORT and VLESS_PORT cannot both use TCP ${panel_public_port}"
  fi

  if ${NEEDS_CONFIG}; then
    if port_listener_in_use tcp "${panel_port}"; then
      fail "PANEL_PORT=${panel_port}/tcp is already in use"
    fi
    if [[ -n "${domain}" && "${domain}" != "panel.example.com" ]] && port_listener_in_use tcp "${panel_public_port}"; then
      fail "PANEL_PUBLIC_PORT=${panel_public_port}/tcp is already in use"
    fi
    if port_listener_in_use tcp "${vless_port}"; then
      fail "VLESS_PORT=${vless_port}/tcp is already in use"
    fi
    if port_listener_in_use udp "${hy2_port}"; then
      fail "HY2_PORT=${hy2_port}/udp is already in use"
    fi
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
  local db_host db_port db_name db_user db_password panel_public_port vless_port current
  if ! panel_domain_is_real; then
    return
  fi

  panel_public_port="$(env_get PANEL_PUBLIC_PORT || echo 443)"
  vless_port="$(env_get VLESS_PORT || echo 8444)"
  if [[ "${vless_port}" == "${panel_public_port}" ]]; then
    local fallback
    fallback="$(vless_fallback_port "${panel_public_port}")"
    warn "VLESS_PORT=${vless_port} conflicts with the panel public HTTPS port; switching VLESS_PORT to ${fallback}"
    env_set VLESS_PORT "${fallback}"
    vless_port="${fallback}"
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

  if [[ "${current}" != "${panel_public_port}" ]]; then
    return
  fi

  warn "database setting vless.port still conflicts with PANEL_PUBLIC_PORT=${panel_public_port}; updating it to ${vless_port}"
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
  local build_commit
  local build_time
  local ldflags
  frontend_dir="${SOURCE_DIR}/frontend"
  cached_lock="${BUILD_STATE_DIR}/frontend-package-lock.json"
  backend_log="${BUILD_STATE_DIR}/backend-build.log"
  frontend_log="${BUILD_STATE_DIR}/frontend-build.log"
  build_commit="${REPO_REF}"
  if [[ -d "${SOURCE_DIR}/.git" ]]; then
    build_commit="$(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD 2>/dev/null || printf '%s' "${REPO_REF}")"
  fi
  build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ldflags="-s -w -X main.version=${H2V_VERSION} -X main.commit=${build_commit} -X main.builtAt=${build_time}"

  substep "compiling backend (go build ./cmd/panel)"
  if ! (
    cd "${SOURCE_DIR}/backend" &&
    go mod download &&
    go mod verify &&
    go build -mod=readonly -ldflags "${ldflags}" -o "${INSTALL_DIR}/bin/panel" ./cmd/panel
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
      npm ci --no-fund &&
      npm audit --audit-level=high &&
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
      npm install --no-fund &&
      npm audit --audit-level=high &&
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
  rsync -a --delete "${SOURCE_DIR}/templates/" "${INSTALL_DIR}/templates/"
  rsync -a --delete "${SOURCE_DIR}/backend/migrations/" "${INSTALL_DIR}/migrations/"
  chown -R panel:panel "${INSTALL_DIR}/templates"
  chown -R panel:panel "${INSTALL_DIR}/migrations"
}

install_units() {
  cp "${SOURCE_DIR}/units/"*.service /etc/systemd/system/
  cp "${SOURCE_DIR}/units/"*.timer /etc/systemd/system/
  systemctl daemon-reload
}

setup_geodata_timer() {
  if ! systemctl enable --now h2v-geodata-update.timer >/dev/null 2>&1; then
    warn "failed to enable h2v-geodata-update.timer; run panel geodata update manually if needed"
    return
  fi
  substep "h2v-geodata-update.timer enabled"
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
  local domain panel_port panel_public_port site_address public_url
  domain="$(env_get PANEL_DOMAIN || true)"
  panel_port="$(env_get PANEL_PORT || true)"
  panel_port="${panel_port:-8000}"
  panel_public_port="$(env_get PANEL_PUBLIC_PORT || true)"
  panel_public_port="${panel_public_port:-443}"

  if [[ -z "${domain}" || "${domain}" == "panel.example.com" ]]; then
    warn "skipping Caddy config (no real PANEL_DOMAIN set)"
    info "panel is local-only at http://127.0.0.1:${panel_port}/ — set PANEL_DOMAIN and rerun for auto-TLS"
    return
  fi
  site_address="${domain}"
  public_url="https://${domain}/"
  if [[ "${panel_public_port}" != "443" ]]; then
    site_address="${domain}:${panel_public_port}"
    public_url="https://${domain}:${panel_public_port}/"
  fi

  substep "writing /etc/caddy/Caddyfile for ${site_address}"
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

${site_address} {
  encode zstd gzip

  @private path /metrics /hy2/auth
  respond @private 404

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
  substep "Caddy active for ${public_url} (auto-TLS via Let's Encrypt)"
  if [[ "${panel_public_port}" == "443" ]]; then
    info "DNS must point ${domain} at this server; ports 80/443 must be open"
  else
    info "DNS must point ${domain} at this server; ports 80 and ${panel_public_port}/tcp must be open"
  fi
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
  if [[ "${admin_output}" == *"already taken"* || "${admin_output}" == *"already exists"* ]]; then
    warn "admin account already exists - keeping existing credentials"
    NEEDS_CONFIG=false
    ADMIN_PASSWORD_GENERATED=false
    return
  fi
  red "${admin_output}"
  fail "failed to create admin user"
}

plan_value() {
  local input="$1"
  local key="$2"
  local fallback="$3"
  local current=""

  if [[ -n "${input}" ]]; then
    printf '%s' "${input}"
    return
  fi

  current="$(env_get "${key}" || true)"
  printf '%s' "${current:-${fallback}}"
}

print_install_plan() {
  local domain panel_port panel_public_port vless_port hy2_port panel_url mode
  domain="$(plan_value "${PANEL_DOMAIN_INPUT}" "PANEL_DOMAIN" "panel.example.com")"
  panel_port="$(plan_value "" "PANEL_PORT" "8000")"
  panel_public_port="$(plan_value "${PANEL_PUBLIC_PORT_INPUT}" "PANEL_PUBLIC_PORT" "443")"
  vless_port="$(plan_value "${VLESS_PORT_INPUT}" "VLESS_PORT" "8444")"
  hy2_port="$(plan_value "${HY2_PORT_INPUT}" "HY2_PORT" "8443")"

  if [[ -n "${domain}" && "${domain}" != "panel.example.com" ]]; then
    if [[ "${panel_public_port}" == "443" ]]; then
      panel_url="https://${domain}/"
    else
      panel_url="https://${domain}:${panel_public_port}/"
    fi
  else
    panel_url="http://127.0.0.1:${panel_port}/"
  fi

  if ${FIRST_INSTALL}; then
    mode="fresh install"
  elif ${NEEDS_CONFIG}; then
    mode="reconfigure"
  else
    mode="update"
  fi

  printf '\n%sInstall plan%s\n' "${BOLD}" "${RESET}"
  printf '  %s%-18s%s %s\n' "${DIM}" "Mode" "${RESET}" "${mode}"
  printf '  %s%-18s%s %s/%s@%s\n' "${DIM}" "Source" "${RESET}" "${REPO_OWNER}" "${REPO_NAME}" "${REPO_REF}"
  printf '  %s%-18s%s %s\n' "${DIM}" "Install dir" "${RESET}" "${INSTALL_DIR}"
  printf '  %s%-18s%s %s\n' "${DIM}" "Panel URL" "${RESET}" "${panel_url}"
  printf '  %s%-18s%s %s/tcp\n' "${DIM}" "VLESS Reality" "${RESET}" "${vless_port}"
  printf '  %s%-18s%s %s/udp\n' "${DIM}" "Hysteria 2" "${RESET}" "${hy2_port}"
  printf '\n'
}

install_all() {
  require_root
  detect_os
  clear_screen
  banner "h2v panel installer" "VLESS Reality + Hysteria 2 | Ubuntu 22.04/24.04"
  resolve_source_dir

  collect_install_inputs
  print_install_plan

  STAGE_INDEX=0
  STAGE_TOTAL=13

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
  validate_selected_runtime_ports
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

  step "geodata" "Downloading GeoIP and Geosite data"
  update_geodata
  success "routing data ready for Xray and Hysteria 2"

  step "units" "Installing systemd units"
  install_units
  install_sudoers
  setup_geodata_timer
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

  local final_domain final_port final_public_port access_url local_url
  final_domain="$(env_get PANEL_DOMAIN || echo panel.example.com)"
  final_port="$(env_get PANEL_PORT || echo 8000)"
  final_public_port="$(env_get PANEL_PUBLIC_PORT || echo 443)"
  local_url="http://127.0.0.1:${final_port}/"
  if [[ -n "${final_domain}" && "${final_domain}" != "panel.example.com" ]]; then
    if [[ "${final_public_port}" == "443" ]]; then
      access_url="https://${final_domain}/"
    else
      access_url="https://${final_domain}:${final_public_port}/"
    fi
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

update_geodata_command() {
  require_root
  [[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} not found"
  clear_screen
  banner "Core geodata update" "geoip.dat + geosite.dat"
  STAGE_INDEX=0
  STAGE_TOTAL=1
  step "geodata" "Downloading GeoIP and Geosite data"
  update_geodata
  success "routing data ready for Xray and Hysteria 2"
  systemctl try-restart xray.service hysteria.service >/dev/null 2>&1 || true
}

uninstall_all() {
  require_root
  clear_screen
  banner "h2v panel uninstaller" "stopping services and removing ${INSTALL_DIR}"
  STAGE_INDEX=0
  STAGE_TOTAL=2

  step "stop" "Stopping and disabling services"
  systemctl disable --now panel hysteria xray h2v-geodata-update.timer h2v-geodata-update.service 2>/dev/null || true
  success "panel/hysteria/xray services and geodata timer stopped"

  step "purge" "Removing application files and units"
  rm -rf "${INSTALL_DIR}"
  rm -f /etc/systemd/system/panel.service /etc/systemd/system/xray.service /etc/systemd/system/hysteria.service
  rm -f /etc/systemd/system/h2v-geodata-update.service /etc/systemd/system/h2v-geodata-update.timer
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

  clear_screen
  banner "Admin password reset" "panel admin set-password"

  local username password generated=false
  username="${1:-}"
  password="${2:-}"

  if [[ -z "${username}" ]]; then
    username="$(prompt_value "Admin username" "admin")"
  fi

  if [[ -z "${password}" ]]; then
    if can_prompt; then
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
  geodata|update-geodata) update_geodata_command ;;
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
  install.sh geodata | update-geodata        refresh core geoip.dat/geosite.dat
  install.sh uninstall                       remove /opt/mypanel and systemd units
  install.sh reset-admin [user] [pw]         reset admin password
  install.sh backup                          dump database to data/backups
  install.sh restore <file>                  restore database from a gzip dump

Env overrides:
  H2V_REF=<branch|tag|commit>                repository source; defaults to main
  H2V_VERSION=<version>                      panel version embedded via ldflags; defaults to H2V_REF/main
  H2V_SOURCE_SHA256=<sha256>                 verify downloaded source archive
  H2V_REQUIRE_SOURCE_SHA256=1                fail if source checksum is absent
  XRAY_VERSION, HYSTERIA_VERSION             override pinned core versions
  H2V_NO_CLEAR=1                             keep previous terminal output
  PANEL_ADMIN_USERNAME, PANEL_ADMIN_PASSWORD seed non-interactive admin

USAGE
    ;;
  *)
    red "Usage: $0 {install|update|reinstall|geodata|update-geodata|uninstall|reset-admin [username] [password]|backup|restore <file>|help}"
    exit 1
    ;;
esac
