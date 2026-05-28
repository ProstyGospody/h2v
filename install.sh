#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${ROOT_DIR}"
REPO_OWNER="ProstyGospody"
REPO_NAME="h2v"
REPO_REF="${H2V_REF:-main}"
H2V_VERSION="${H2V_VERSION:-${REPO_REF}}"
H2V_LANG="${H2V_LANG:-}"
H2V_ALLOW_FLOATING_REF="${H2V_ALLOW_FLOATING_REF:-1}"
ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_REF}"
H2V_SOURCE_SHA256="${H2V_SOURCE_SHA256:-}"
TMP_SOURCE_DIR=""
INSTALL_LOG="${H2V_INSTALL_LOG:-/tmp/h2v-install.log}"
INSTALL_DIR="/opt/h2v"
ENV_FILE="${INSTALL_DIR}/.env"
BUILD_STATE_DIR="${INSTALL_DIR}/build"
H2V_AUTO_SWAP="${H2V_AUTO_SWAP:-1}"
H2V_SWAP_FILE="${H2V_SWAP_FILE:-/swapfile}"
H2V_SWAP_SIZE_MB="${H2V_SWAP_SIZE_MB:-}"
GO_VERSION="${GO_VERSION:-1.26.2}"
NODE_VERSION="${NODE_VERSION:-22.22.2}"
NPM_VERSION="${NPM_VERSION:-10.9.7}"
H2V_NODE_MAX_OLD_SPACE_MB="${H2V_NODE_MAX_OLD_SPACE_MB:-512}"
XRAY_VERSION="${XRAY_VERSION:-v26.3.27}"
XRAY_SHA256_64="${XRAY_SHA256_64:-23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae}"
XRAY_SHA256_ARM64_V8A="${XRAY_SHA256_ARM64_V8A:-4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c}"
HYSTERIA_VERSION="${HYSTERIA_VERSION:-app/v2.9.2}"
HYSTERIA_SHA256_AMD64="${HYSTERIA_SHA256_AMD64:-86fef8e2f1b2bf41318ac96724eee6c3b449e4e510022cc89658b63a6713922a}"
HYSTERIA_SHA256_ARM64="${HYSTERIA_SHA256_ARM64:-9ec8f49f4ea554b1cac04e6f3690cea76ff835082e943e54196d7f323fcfba71}"
XRAY_GEODATA_DIR_DEFAULT="${INSTALL_DIR}/data/geodata"
XRAY_GEOIP_URL_DEFAULT="https://github.com/v2fly/geoip/releases/latest/download/geoip.dat"
XRAY_GEOSITE_URL_DEFAULT="https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat"

FIRST_INSTALL=false
RECONFIGURE_RUNTIME=false
H2V_DOMAIN_INPUT=""
H2V_PUBLIC_PORT_INPUT=""
VLESS_PORT_INPUT=""
HY2_PORT_INPUT=""
ADMIN_USERNAME_INPUT=""
ADMIN_PASSWORD_INPUT=""
ADMIN_PASSWORD_GENERATED=false
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/go/bin:${PATH}"

if [[ -t 1 ]]; then
  RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; MAGENTA=$'\033[35m'; BLUE=$'\033[34m'
else
  RESET=""; BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; MAGENTA=""; BLUE=""
fi

UI_TTY=false
if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
  UI_TTY=true
fi
UI_VERBOSE=false
case "${H2V_VERBOSE:-0}" in
  1|true|yes|on) UI_VERBOSE=true ;;
esac

STAGE_INDEX=0
STAGE_TOTAL=0
PROGRESS_ACTIVE=false
PROGRESS_COUNTER=""
PROGRESS_TITLE=""

normalize_language() {
  local raw="${1:-}"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')"
  case "${raw}" in
    ru|ru_*|ru.*|russian|русский) printf 'ru' ;;
    en|en_*|en.*|english) printf 'en' ;;
    *) return 1 ;;
  esac
}

default_language() {
  normalize_language "${LANG:-}" 2>/dev/null || printf 'en'
}

ui_ru() {
  [[ "${H2V_LANG:-en}" == "ru" ]]
}

ui_text() {
  if ui_ru; then
    printf '%s' "$1"
  else
    printf '%s' "$2"
  fi
}

select_language() {
  local selected default_lang default_choice answer normalized
  if selected="$(normalize_language "${H2V_LANG:-}" 2>/dev/null)"; then
    H2V_LANG="${selected}"
    export H2V_LANG
    return
  fi

  default_lang="$(default_language)"
  default_choice=2
  [[ "${default_lang}" == "ru" ]] && default_choice=1

  if can_prompt; then
    printf '\n  %s%s%s %sLanguage / Язык%s\n' "${BOLD}${CYAN}" "h2v" "${RESET}" "${BOLD}" "${RESET}" >/dev/tty
    printf '  %s  Русский\n' "$(ui_tag "${MAGENTA}" "1")" >/dev/tty
    printf '  %s  English\n' "$(ui_tag "${BLUE}" "2")" >/dev/tty
    while true; do
      printf '  %s [%s]: ' "Choose / Выберите" "${default_choice}" >/dev/tty
      read -r answer </dev/tty
      answer="${answer#"${answer%%[![:space:]]*}"}"
      answer="${answer%"${answer##*[![:space:]]}"}"
      answer="${answer:-${default_choice}}"
      case "${answer}" in
        1|ru|RU|Ru|r|R|русский|Русский) H2V_LANG="ru"; break ;;
        2|en|EN|En|e|E|english|English) H2V_LANG="en"; break ;;
        *)
          if normalized="$(normalize_language "${answer}" 2>/dev/null)"; then
            H2V_LANG="${normalized}"
            break
          fi
          printf '%sEnter 1 or 2. / Введите 1 или 2.%s\n' "${RED}" "${RESET}" >/dev/tty
          ;;
      esac
    done
  else
    H2V_LANG="${default_lang}"
  fi

  export H2V_LANG
}

green()   { ui_line "${GREEN}$1${RESET}"; }
yellow()  { ui_line "${YELLOW}$1${RESET}"; }
red()     { ui_line "${RED}$1${RESET}"; }
log()     { ui_detail "    $1"; }
substep() { ui_detail "  ${CYAN}>${RESET} $1"; }
success() { ui_detail "  ${GREEN}[ OK ]${RESET} $1"; }
warn()    { ui_line "  ${YELLOW}[WARN]${RESET} $1"; }
info()    { ui_detail "  ${CYAN}[INFO]${RESET} $1"; }

ui_rule() {
  local color="${1:-${DIM}}"
  printf '  %s%s%s\n' "${color}" "------------------------------------------------------------" "${RESET}"
}

ui_tag() {
  local color="$1"
  local text="$2"
  printf '%s[%s]%s' "${color}" "${text}" "${RESET}"
}

ui_item() {
  local color="$1"
  local tag="$2"
  local text="$3"
  printf '  %s %s\n' "$(ui_tag "${color}" "${tag}")" "${text}"
}

ui_value() {
  local color="$1"
  local tag="$2"
  local label="$3"
  local value="$4"
  printf '  %s %s\n' "$(ui_tag "${color}" "${tag}")" "${label}"
  printf '      %s%s%s\n' "${BOLD}${color}" "${value}" "${RESET}"
}

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
  local width="${3:-}"
  local filled empty percent fill_chunk empty_chunk

  if (( total <= 0 )); then
    return 0
  fi

  if [[ -z "${width}" || ! "${width}" =~ ^[0-9]+$ ]]; then
    width=$(( $(terminal_width) / 3 ))
    if (( width < 20 )); then
      width=20
    elif (( width > 40 )); then
      width=40
    fi
  fi

  filled=$(( current * width / total ))
  empty=$(( width - filled ))
  percent=$(( current * 100 / total ))

  printf -v fill_chunk '%*s' "${filled}" ''
  printf -v empty_chunk '%*s' "${empty}" ''
  fill_chunk="${fill_chunk// /#}"
  empty_chunk="${empty_chunk// /-}"

  printf '%s[%s%s%s%s]%s %3d%%' "${DIM}" "${CYAN}" "${fill_chunk}" "${DIM}" "${empty_chunk}" "${RESET}" "${percent}"
}

truncate_text() {
  local text="$1"
  local max="$2"
  if (( max <= 0 )); then
    printf ''
  elif (( ${#text} <= max )); then
    printf '%s' "${text}"
  elif (( max <= 3 )); then
    printf '%s' "${text:0:max}"
  else
    printf '%s...' "${text:0:max-3}"
  fi
}

progress_text() {
  local width bar_width title_width title
  width="$(terminal_width)"
  bar_width=$(( width / 4 ))
  if (( bar_width < 16 )); then
    bar_width=16
  elif (( bar_width > 28 )); then
    bar_width=28
  fi
  title_width=$(( width - bar_width - 25 ))
  if (( title_width < 12 )); then
    title_width=12
  fi
  title="$(truncate_text "${PROGRESS_TITLE}" "${title_width}")"
  printf '%s>%s %s%s%s %s%s%s  %s' \
    "${CYAN}" "${RESET}" \
    "${DIM}" "${PROGRESS_COUNTER}" "${RESET}" \
    "${BOLD}" "${title}" "${RESET}" \
    "$(progress_bar "${STAGE_INDEX}" "${STAGE_TOTAL}" "${bar_width}")"
}

progress_render() {
  ${UI_TTY} || return 0
  ${PROGRESS_ACTIVE} || return 0
  printf '\r\033[2K%s' "$(progress_text)"
}

progress_clear() {
  ${UI_TTY} || return 0
  ${PROGRESS_ACTIVE} || return 0
  printf '\r\033[2K'
}

progress_finish() {
  ${PROGRESS_ACTIVE} || return 0
  progress_clear
  PROGRESS_ACTIVE=false
  printf '\n'
}

with_progress_hidden() {
  local was_active=false
  if ${PROGRESS_ACTIVE}; then
    progress_clear
    PROGRESS_ACTIVE=false
    was_active=true
  fi
  set +e
  "$@"
  local status=$?
  set -e
  if ${was_active}; then
    PROGRESS_ACTIVE=true
    progress_render
  fi
  return "${status}"
}

run_quiet() {
  local label="$1"
  shift
  local status=0

  if ${UI_VERBOSE}; then
    with_progress_hidden "$@"
    return $?
  fi

  mkdir -p "$(dirname "${INSTALL_LOG}")" 2>/dev/null || true
  printf '\n== %s ==\n' "${label}" >>"${INSTALL_LOG}" 2>/dev/null || true

  set +e
  "$@" >>"${INSTALL_LOG}" 2>&1
  status=$?
  set -e

  if [[ ${status} -ne 0 ]]; then
    progress_finish
    red "$(ui_text "${label}: ошибка. Последние строки журнала ${INSTALL_LOG}:" "${label} failed. Last log lines from ${INSTALL_LOG}:")"
    tail -n 60 "${INSTALL_LOG}" || true
  fi
  return "${status}"
}

ui_line() {
  local line="${1:-}"
  if ${PROGRESS_ACTIVE}; then
    progress_clear
    printf '%s\n' "${line}"
    progress_render
  else
    printf '%s\n' "${line}"
  fi
}

ui_detail() {
  local line="${1:-}"
  if ${PROGRESS_ACTIVE} && ! ${UI_VERBOSE}; then
    return 0
  fi
  ui_line "${line}"
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
  printf '  %s[ok]%s %s%s%s: %s\n' "${GREEN}" "${RESET}" "${BOLD}" "${label}" "${RESET}" "${value}" >/dev/tty
}

step() {
  STAGE_INDEX=$((STAGE_INDEX + 1))
  local counter=""
  if (( STAGE_TOTAL > 0 )); then
    counter=$(printf '%s %02d/%02d' "$(ui_text "Шаг" "Step")" "${STAGE_INDEX}" "${STAGE_TOTAL}")
  else
    counter=$(printf '%s' "$1")
  fi
  if ${UI_TTY} && (( STAGE_TOTAL > 0 )); then
    progress_clear
    PROGRESS_COUNTER="${counter}"
    PROGRESS_TITLE="$2"
    PROGRESS_ACTIVE=true
    progress_render
  else
    printf '\n  %s %s%s%s\n' "$(ui_tag "${CYAN}" "${counter}")" "${BOLD}" "$2" "${RESET}"
    if (( STAGE_TOTAL > 0 )); then
      printf '  %s\n' "$(progress_bar "${STAGE_INDEX}" "${STAGE_TOTAL}")"
    fi
  fi
}

banner() {
  local title="$1"
  local sub="${2:-}"
  printf '\n'
  ui_rule "${CYAN}"
  printf '  %s%s%s  %s%s%s\n' "${BOLD}${CYAN}" "h2v" "${RESET}" "${BOLD}" "${title}" "${RESET}"
  if [[ -n "${sub}" ]]; then
    printf '  %s%s%s\n' "${MAGENTA}" "${sub}" "${RESET}"
  fi
  ui_rule "${CYAN}"
}

print_summary() {
  local access_url="$1"
  progress_finish
  printf '\n'
  ui_rule "${GREEN}"
  printf '  %s%s%s  %s%s%s\n' "${BOLD}${GREEN}" "$(ui_text "ГОТОВО" "READY")" "${RESET}" "${BOLD}" "$(ui_text "h2v запущен" "h2v is running")" "${RESET}"
  ui_rule "${GREEN}"
  printf '\n'
  ui_value "${CYAN}" "$(ui_text "ПАНЕЛЬ" "PANEL")" "$(ui_text "Адрес для входа" "Sign-in address")" "${access_url}"
  if ${FIRST_INSTALL}; then
    printf '\n'
    ui_value "${MAGENTA}" "$(ui_text "ЛОГИН" "LOGIN")" "$(ui_text "Администратор" "Administrator")" "${ADMIN_USERNAME_INPUT}"
    if ${ADMIN_PASSWORD_GENERATED}; then
      ui_value "${YELLOW}" "$(ui_text "ПАРОЛЬ" "PASSWORD")" "$(ui_text "Создан автоматически" "Generated automatically")" "${ADMIN_PASSWORD_INPUT}"
    else
      ui_value "${YELLOW}" "$(ui_text "ПАРОЛЬ" "PASSWORD")" "$(ui_text "Пароль администратора" "Admin password")" "${ADMIN_PASSWORD_INPUT}"
    fi
    printf '  %s[!] %s%s\n' "${YELLOW}" "$(ui_text "Сохраните пароль: он больше не будет показан." "Save this password: it will not be shown again.")" "${RESET}"
  fi
  printf '\n'
  printf '  %s%s%s\n' "${BOLD}" "$(ui_text "Полезные действия" "Useful actions")" "${RESET}"
  ui_item "${GREEN}" "$(ui_text "UPDATE" "UPDATE")" "$(ui_text "Обновить h2v:" "Update h2v:") ${CYAN}/opt/h2v/install.sh update${RESET}"
  ui_item "${BLUE}" "$(ui_text "ROUTES" "ROUTES")" "$(ui_text "Обновить маршруты:" "Update routing data:") ${CYAN}/opt/h2v/install.sh geodata${RESET}"
  ui_item "${MAGENTA}" "$(ui_text "ADMIN" "ADMIN")" "$(ui_text "Сменить пароль:" "Reset password:") ${CYAN}/opt/h2v/install.sh reset-admin${RESET}"
  ui_item "${YELLOW}" "$(ui_text "BACKUP" "BACKUP")" "$(ui_text "Создать копию:" "Create backup:") ${CYAN}/opt/h2v/install.sh backup${RESET}"
  printf '\n'
  printf '  %s%s:%s %s\n' "${DIM}" "$(ui_text "Журнал установки" "Install log")" "${RESET}" "${INSTALL_LOG}"
  printf '\n'
}

remove_tmp_source() {
  if [[ -n "${TMP_SOURCE_DIR}" && -d "${TMP_SOURCE_DIR}" ]]; then
    rm -rf "${TMP_SOURCE_DIR}"
  fi
}

trap remove_tmp_source EXIT

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    red "$(ui_text "Нужны права администратора." "Administrator privileges are required.")"
    info "$(ui_text "Запустите установку через sudo:" "Run the installer with sudo:")"
    printf '  %scurl -fsSL https://raw.githubusercontent.com/%s/%s/main/install.sh | sudo bash%s\n' "${CYAN}" "${REPO_OWNER}" "${REPO_NAME}" "${RESET}"
    exit 1
  fi
}

detect_os() {
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    red "$(ui_text "Эта система не поддерживается: ${PRETTY_NAME:-unknown}." "Unsupported OS: ${PRETTY_NAME:-unknown}.")"
    info "$(ui_text "Поддерживаются Ubuntu 22.04 и Ubuntu 24.04." "h2v supports Ubuntu 22.04 and Ubuntu 24.04.")"
    exit 1
  fi
}

fail() {
  progress_finish
  printf '%s%s%s\n' "${RED}" "$1" "${RESET}"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

frontend_build_node_options() {
  local options="${NODE_OPTIONS:-}"
  local max_mb="${H2V_NODE_MAX_OLD_SPACE_MB:-}"
  if [[ -n "${max_mb}" && "${max_mb}" != "0" && "${max_mb}" =~ ^[0-9]+$ && "${options}" != *"--max-old-space-size="* ]]; then
    options="${options:+${options} }--max-old-space-size=${max_mb}"
  fi
  printf '%s' "${options}"
}

meminfo_value_kb() {
  local key="$1"
  [[ -r /proc/meminfo ]] || return 1
  awk -v key="${key}:" '$1 == key {print $2; exit}' /proc/meminfo 2>/dev/null
}

recommended_swap_size_mb() {
  local mem_kb="$1"
  local target_kb=2097152
  local size_mb
  size_mb=$(( (target_kb - mem_kb + 1023) / 1024 ))
  (( size_mb < 1024 )) && size_mb=1024
  (( size_mb > 2048 )) && size_mb=2048
  printf '%s' "${size_mb}"
}

auto_swap_enabled() {
  case "$(printf '%s' "${H2V_AUTO_SWAP}" | tr '[:upper:]' '[:lower:]')" in
    0|false|no|off) return 1 ;;
    *) return 0 ;;
  esac
}

ensure_build_swap() {
  [[ -r /proc/meminfo ]] || return 0
  local mem_kb swap_kb swap_file swap_dir swap_size_mb free_mb
  mem_kb="$(meminfo_value_kb MemTotal || true)"
  swap_kb="$(meminfo_value_kb SwapTotal || true)"
  if ! [[ "${mem_kb}" =~ ^[0-9]+$ && "${swap_kb}" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  if (( mem_kb >= 1572864 || swap_kb > 0 )); then
    return 0
  fi
  if ! auto_swap_enabled; then
    warn "low-memory host has no swap; H2V_AUTO_SWAP=0 leaves frontend build at risk"
    return 0
  fi
  if (( EUID != 0 )); then
    warn "low-memory host has no swap; run as root to let installer create swap automatically"
    return 0
  fi
  if ! command_exists mkswap || ! command_exists swapon; then
    warn "low-memory host has no swap; mkswap/swapon are unavailable"
    return 0
  fi

  swap_file="${H2V_SWAP_FILE}"
  if [[ "${swap_file}" != /* ]]; then
    warn "H2V_SWAP_FILE must be an absolute path; skipping automatic swap"
    return 0
  fi
  if [[ -e "${swap_file}" ]]; then
    if swapon --show=NAME --noheadings 2>/dev/null | awk -v path="${swap_file}" '$1 == path { found = 1 } END { exit found ? 0 : 1 }'; then
      return 0
    fi
    warn "${swap_file} already exists but is not active; not modifying it automatically"
    return 0
  fi

  swap_size_mb="${H2V_SWAP_SIZE_MB:-$(recommended_swap_size_mb "${mem_kb}")}"
  if ! [[ "${swap_size_mb}" =~ ^[0-9]+$ && "${swap_size_mb}" -gt 0 ]]; then
    warn "H2V_SWAP_SIZE_MB must be a positive integer; skipping automatic swap"
    return 0
  fi
  swap_dir="$(dirname "${swap_file}")"
  if [[ ! -d "${swap_dir}" ]]; then
    warn "swap directory ${swap_dir} does not exist; skipping automatic swap"
    return 0
  fi
  free_mb="$(df -Pm "${swap_dir}" 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
  if [[ "${free_mb}" =~ ^[0-9]+$ && "${free_mb}" -lt $((swap_size_mb + 512)) ]]; then
    warn "not enough free disk for ${swap_size_mb} MiB swapfile at ${swap_file}"
    return 0
  fi

  substep "creating ${swap_size_mb} MiB swapfile at ${swap_file}"
  if command_exists fallocate; then
    if ! fallocate -l "${swap_size_mb}M" "${swap_file}"; then
      rm -f -- "${swap_file}"
      if ! dd if=/dev/zero of="${swap_file}" bs=1M count="${swap_size_mb}" status=none; then
        rm -f -- "${swap_file}"
        warn "automatic swapfile allocation failed; frontend build may fail on this low-memory host"
        return 0
      fi
    fi
  elif ! dd if=/dev/zero of="${swap_file}" bs=1M count="${swap_size_mb}" status=none; then
    rm -f -- "${swap_file}"
    warn "automatic swapfile allocation failed; frontend build may fail on this low-memory host"
    return 0
  fi
  if ! chmod 600 "${swap_file}"; then
    rm -f -- "${swap_file}"
    warn "automatic swapfile permission setup failed; frontend build may fail on this low-memory host"
    return 0
  fi
  if ! mkswap "${swap_file}" >/dev/null || ! swapon "${swap_file}"; then
    rm -f -- "${swap_file}"
    warn "automatic swap setup failed; frontend build may fail on this low-memory host"
    return 0
  fi
  if [[ -w /etc/fstab ]] && ! awk -v path="${swap_file}" '$1 == path && $3 == "swap" { found = 1 } END { exit found ? 0 : 1 }' /etc/fstab; then
    printf '%s none swap sw 0 0\n' "${swap_file}" >>/etc/fstab || warn "swap enabled but /etc/fstab was not updated"
  fi
  success "swap enabled (${swap_size_mb} MiB)"
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
  substep "updating apt package index"
  run_quiet "apt-get update" apt-get update -qq
  substep "installing required Ubuntu packages"
  run_quiet "apt-get install" apt-get install -y -qq \
    bash \
    ca-certificates \
    curl \
    wget \
    openssl \
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
    libcap2-bin \
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
  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "h2v binary missing; cannot render core configs"
  run_quiet "render xray config" sudo -u h2v env H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" config render --core xray \
    || fail "failed to render xray config"
  run_quiet "render hysteria config" sudo -u h2v env H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" config render --core hysteria \
    || fail "failed to render hysteria config"
  rm -f "${INSTALL_DIR}/configs/hysteria/config.yaml" "${INSTALL_DIR}/configs/hysteria/config.yml"
  chown h2v:xray "${INSTALL_DIR}/configs/xray/config.json" 2>/dev/null || true
  chown h2v:hysteria "${INSTALL_DIR}/configs/hysteria/config.json" 2>/dev/null || true
  chmod 0640 "${INSTALL_DIR}/configs/xray/config.json" "${INSTALL_DIR}/configs/hysteria/config.json" 2>/dev/null || true
}

update_geodata() {
  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "h2v binary missing; cannot update core geodata"
  local geodata_dir out status=0
  geodata_dir="$(env_get XRAY_GEODATA_DIR || true)"
  geodata_dir="${geodata_dir:-${XRAY_GEODATA_DIR_DEFAULT}}"
  install -d -m 0755 "${geodata_dir}"

  out="$(H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" geodata update 2>&1)" || status=$?
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
    chown -R h2v:h2v "${geodata_dir}" 2>/dev/null || true
  elif getent group xray >/dev/null 2>&1; then
    chown -R root:xray "${geodata_dir}" 2>/dev/null || true
  fi
  chmod 0755 "${geodata_dir}" 2>/dev/null || true
  chmod 0644 "${geodata_dir}/geoip.dat" "${geodata_dir}/geosite.dat" 2>/dev/null || true
  substep "geoip.dat/geosite.dat updated in ${geodata_dir}"
}

grant_cert_access() {
  local domain cert_path key_path caddy_was_active=false
  domain="$(env_get H2V_DOMAIN || true)"
  cert_path="$(env_get HY2_CERT_PATH || true)"
  key_path="$(env_get HY2_KEY_PATH || true)"
  [[ -z "${domain}" || "${domain}" == "h2v.example.com" ]] && return
  [[ -z "${cert_path}" || -z "${key_path}" ]] && return
  if [[ ! -f "${cert_path}" || ! -f "${key_path}" ]]; then
    warn "TLS cert not found at ${cert_path}; trying certbot standalone for Hysteria 2"
    if systemctl is-active --quiet caddy.service; then
      caddy_was_active=true
      systemctl stop caddy.service || true
    fi
    if ! run_quiet "certbot ${domain}" certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring -d "${domain}"; then
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
  local h2v_public_port vless_port hy2_port
  h2v_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  hy2_port="$(selected_runtime_value "${HY2_PORT_INPUT}" "hy2.port" "HY2_PORT" "8443")"

  if [[ "${vless_port}" == "${h2v_public_port}" ]] && ss -tln 2>/dev/null | awk -v p="${h2v_public_port}" '{print $4}' | grep -qE "(:|\\.)${h2v_public_port}$"; then
    warn "VLESS_PORT=${vless_port} conflicts with another listener (likely Caddy h2v HTTPS)"
    info "set VLESS_PORT to a free port (e.g. 8444) in ${ENV_FILE} and rerun"
  fi

  systemctl enable xray.service hysteria.service >/dev/null 2>&1 || true
  systemctl reset-failed xray.service hysteria.service >/dev/null 2>&1 || true
  if ! systemctl restart xray.service; then
    red "xray.service failed to start. Recent logs:"
    journalctl -u xray.service -n 40 --no-pager || true
    warn "xray is NOT running - VLESS traffic will be rejected until resolved"
  else
    substep "xray.service active (VLESS Reality on TCP ${vless_port})"
  fi
  if ! systemctl restart hysteria.service; then
    red "hysteria.service failed to start. Recent logs:"
    journalctl -u hysteria.service -n 40 --no-pager || true
    warn "hysteria is NOT running - Hysteria 2 traffic will be rejected until resolved (most often a missing TLS cert)"
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
  run_quiet "npm install -g npm@${NPM_VERSION}" npm install -g "npm@${NPM_VERSION}"
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
        fail "$(ui_text "Версия ${REPO_REF} не закреплена. Укажите точный tag/commit или разрешите main через H2V_ALLOW_FLOATING_REF=1." "Ref ${REPO_REF} is moving. Set H2V_REF to a pinned tag/commit or allow main with H2V_ALLOW_FLOATING_REF=1.")"
      fi
      ;;
  esac

  substep "$(ui_text "загрузка файлов h2v (${REPO_REF})" "downloading h2v files (${REPO_REF})")"
  TMP_SOURCE_DIR="$(mktemp -d)"
  local archive
  archive="${TMP_SOURCE_DIR}/source.tar.gz"
  if ! curl -fsSL "${ARCHIVE_URL}" -o "${archive}"; then
    if [[ "${REPO_REF}" == "v${H2V_VERSION:-}" ]]; then
      fail "$(ui_text "Версия ${REPO_REF} не найдена. Укажите существующий tag/commit или используйте main." "Repository ref ${REPO_REF} was not found. Set H2V_REF to an existing tag/commit or use main.")"
    fi
    fail "$(ui_text "Не удалось загрузить файлы h2v (${REPO_REF})." "Unable to download h2v files (${REPO_REF}).")"
  fi
  if [[ -n "${H2V_SOURCE_SHA256}" ]]; then
    verify_sha256 "${archive}" "${H2V_SOURCE_SHA256}" "${REPO_OWNER}/${REPO_NAME}@${REPO_REF}"
  elif [[ "${H2V_REQUIRE_SOURCE_SHA256:-0}" == "1" ]]; then
    fail "H2V_SOURCE_SHA256 is required for repository source verification"
  else
    info "$(ui_text "Используется версия ${REPO_REF} из GitHub." "Using ${REPO_REF} from GitHub.")"
  fi
  tar -xzf "${archive}" -C "${TMP_SOURCE_DIR}"

  local extracted
  extracted="$(find "${TMP_SOURCE_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "${extracted}" || ! -f "${extracted}/.env.example" ]]; then
    red "$(ui_text "Не удалось подготовить файлы h2v." "Failed to prepare h2v files.")"
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

prompt_reconfigure_choice() {
  local answer=""
  if ! can_prompt; then
    return 1
  fi

  printf '\n%s%s%s\n' "${BOLD}" "$(ui_text "Настройки h2v уже найдены" "Existing h2v settings found")" "${RESET}" >/dev/tty
  printf '  1  %s\n' "$(ui_text "Оставить настройки и обновить приложение" "Keep settings and update the app")" >/dev/tty
  printf '  2  %s\n' "$(ui_text "Изменить домен и публичные порты" "Change domain and public ports")" >/dev/tty

  while true; do
    printf '%s [1]: ' "$(ui_text "Выберите действие" "Choose an action")" >/dev/tty
    read -r answer </dev/tty
    answer="${answer#"${answer%%[![:space:]]*}"}"
    answer="${answer%"${answer##*[![:space:]]}"}"
    answer="${answer:-1}"
    case "${answer}" in
      1)
        tty_prompt_result_current "$(ui_text "Настройки" "Settings")" "$(ui_text "оставить текущие" "keep current")"
        return 1
        ;;
      2)
        tty_prompt_result_current "$(ui_text "Настройки" "Settings")" "$(ui_text "изменить" "change")"
        return 0
        ;;
      *)
        printf '%s%s%s\n' "${RED}" "$(ui_text "Введите 1 или 2." "Enter 1 or 2.")" "${RESET}" >/dev/tty
        ;;
    esac
  done
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

selected_h2v_domain_is_real() {
  [[ -n "${H2V_DOMAIN_INPUT}" && "${H2V_DOMAIN_INPUT}" != "h2v.example.com" ]]
}

vless_fallback_port() {
  local h2v_public_port="$1"
  if [[ "${h2v_public_port}" == "8444" ]]; then
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
  local current_port="${5:-}"
  local port
  local is_tty=false
  can_prompt && is_tty=true

  while true; do
    port="$(prompt_value "${label}" "${default}" "no")"
    if ! valid_port_number "${port}"; then
      red "$(ui_text "${label}: введите число от 1 до 65535." "${label} must be a number between 1 and 65535.")" >&2
      ${is_tty} || fail "$(ui_text "${label}: неверное значение" "${label} is invalid")"
      continue
    fi
    if [[ "${key}" == "H2V_PUBLIC_PORT" && ( "${port}" == "80" || ( "${port}" -lt 1024 && "${port}" != "443" ) ) ]]; then
      red "$(ui_text "${label}: используйте 443 или порт от 1024." "${label} must be 443 or 1024 or higher.")" >&2
      ${is_tty} || fail "$(ui_text "${label}: используйте 443 или порт от 1024" "${label} must be 443 or 1024 or higher")"
      continue
    fi
    if selected_h2v_domain_is_real && [[ "${key}" == "VLESS_PORT" && -n "${H2V_PUBLIC_PORT_INPUT}" && "${port}" == "${H2V_PUBLIC_PORT_INPUT}" ]]; then
      red "$(ui_text "${label} ${port}/tcp уже занят портом панели." "${label} ${port}/tcp conflicts with the h2v public HTTPS port.")" >&2
      ${is_tty} || fail "$(ui_text "${label} ${port}/tcp конфликтует с портом панели" "${label} ${port}/tcp conflicts with h2v public HTTPS")"
      continue
    fi
    if [[ -n "${current_port}" && "${port}" == "${current_port}" ]]; then
      :
    elif [[ "${key}" != "H2V_PUBLIC_PORT" || selected_h2v_domain_is_real ]] && port_listener_in_use "${protocol}" "${port}"; then
      red "$(ui_text "${label} ${port}/${protocol} уже используется. Выберите другой порт." "${label} ${port}/${protocol} is already in use. Choose another port.")" >&2
      ${is_tty} || fail "$(ui_text "${label} ${port}/${protocol} уже используется" "${label} ${port}/${protocol} is already in use")"
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
  local default_domain="h2v.example.com"
  local default_h2v_public_port="443"
  local default_vless_port="8444"
  local default_hy2_port="8443"
  local current_h2v_public_port=""
  local current_vless_port=""
  local current_hy2_port=""
  local default_admin_username="${H2V_ADMIN_USERNAME:-admin}"

  if [[ -f "${ENV_FILE}" ]]; then
    env_exists=true
    local cur_domain cur_h2v_public_port cur_vless_port cur_hy2_port
    cur_domain="$(env_get H2V_DOMAIN || true)"
    cur_h2v_public_port="$(env_get H2V_PUBLIC_PORT || true)"
    cur_vless_port="$(runtime_setting_value "vless.port" "VLESS_PORT" "")"
    cur_hy2_port="$(runtime_setting_value "hy2.port" "HY2_PORT" "")"
    [[ -n "${cur_domain}" ]] && default_domain="${cur_domain}"
    [[ -n "${cur_h2v_public_port}" ]] && default_h2v_public_port="${cur_h2v_public_port}"
    [[ -n "${cur_vless_port}" ]] && default_vless_port="${cur_vless_port}"
    [[ -n "${cur_hy2_port}" ]] && default_hy2_port="${cur_hy2_port}"
    current_h2v_public_port="${cur_h2v_public_port}"
    current_vless_port="${cur_vless_port}"
    current_hy2_port="${cur_hy2_port}"
  else
    FIRST_INSTALL=true
  fi

  if ${env_exists}; then
    if ! can_prompt; then
      return
    fi
    if ! prompt_reconfigure_choice; then
      return
    fi
    RECONFIGURE_RUNTIME=true
    info "$(ui_text "Можно изменить домен и публичные порты." "You can change the domain and public ports.")"
  fi

  local is_tty=false
  can_prompt && is_tty=true

  if ${is_tty}; then
    banner "$(ui_text "Настройка h2v" "h2v setup")" "$(ui_text "Нажмите Enter, чтобы принять предложенное значение" "Press Enter to accept the suggested value")"
  else
    printf '\n'
    warn "$(ui_text "Установка без ввода: будут использованы значения по умолчанию и созданный пароль." "Non-interactive install: using defaults and a generated admin password.")"
  fi

  local domain_default="${default_domain}"
  [[ "${domain_default}" == "h2v.example.com" ]] && domain_default=""

  local domain_label
  domain_label="$(ui_text "Домен панели, например panel.example.com" "Panel domain, for example panel.example.com")"
  while true; do
    H2V_DOMAIN_INPUT="$(prompt_value "${domain_label}" "${domain_default}" "no")"
    if [[ -n "${H2V_DOMAIN_INPUT}" && "${H2V_DOMAIN_INPUT}" != "h2v.example.com" ]]; then
      if can_prompt; then
        tty_prompt_result_current "${domain_label}" "${H2V_DOMAIN_INPUT}"
      fi
      break
    fi
    if ! ${is_tty}; then
      H2V_DOMAIN_INPUT="${default_domain}"
      yellow "$(ui_text "Домен не указан - оставляю '${H2V_DOMAIN_INPUT}'. Его можно изменить позже в ${ENV_FILE}." "No domain provided - keeping '${H2V_DOMAIN_INPUT}'. You can change it later in ${ENV_FILE}.")"
      break
    fi
    red "$(ui_text "Укажите реальный домен." "A real domain is required.")"
  done

  H2V_PUBLIC_PORT_INPUT="$(prompt_service_port H2V_PUBLIC_PORT "$(ui_text "HTTPS-порт панели" "Panel HTTPS port")" "${default_h2v_public_port}" tcp "${current_h2v_public_port}")"
  while true; do
    VLESS_PORT_INPUT="$(prompt_service_port VLESS_PORT "$(ui_text "TCP-порт VLESS Reality" "VLESS Reality TCP port")" "${default_vless_port}" tcp "${current_vless_port}")"
    if [[ "${VLESS_PORT_INPUT}" != "${H2V_PUBLIC_PORT_INPUT}" ]]; then
      break
    fi
    red "$(ui_text "Порт VLESS Reality должен отличаться от HTTPS-порта панели." "VLESS Reality TCP port must differ from the panel HTTPS port.")" >&2
    ${is_tty} || fail "$(ui_text "Порт VLESS Reality конфликтует с HTTPS-портом панели" "VLESS Reality TCP port conflicts with the panel HTTPS port")"
  done
  HY2_PORT_INPUT="$(prompt_service_port HY2_PORT "$(ui_text "UDP-порт Hysteria 2" "Hysteria 2 UDP port")" "${default_hy2_port}" udp "${current_hy2_port}")"
  if ! ${env_exists}; then
    ADMIN_USERNAME_INPUT="$(prompt_value "$(ui_text "Логин администратора" "Admin username")" "${default_admin_username}")"

    if [[ -n "${H2V_ADMIN_PASSWORD:-}" ]]; then
      ADMIN_PASSWORD_INPUT="${H2V_ADMIN_PASSWORD}"
    elif can_prompt; then
      ADMIN_PASSWORD_INPUT="$(prompt_password "$(ui_text "Пароль администратора (пусто - создать автоматически)" "Admin password (blank to auto-generate)")")"
    fi

    if [[ -z "${ADMIN_PASSWORD_INPUT}" ]]; then
      ADMIN_PASSWORD_INPUT="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
      ADMIN_PASSWORD_GENERATED=true
    fi
  fi
}

ensure_h2v_user() {
  if ! id -u h2v >/dev/null 2>&1; then
    useradd -r -s /bin/false h2v
  fi
}

ensure_dirs() {
  mkdir -p "${INSTALL_DIR}/bin" \
    "${INSTALL_DIR}/configs/xray" \
    "${INSTALL_DIR}/configs/hysteria" \
    "${INSTALL_DIR}/templates" \
    "${INSTALL_DIR}/frontend" \
    "${BUILD_STATE_DIR}" \
    "${INSTALL_DIR}/data/backups" \
    "${INSTALL_DIR}/data/traffic-pending" \
    "${INSTALL_DIR}/logs"
  chown -R h2v:h2v "${INSTALL_DIR}"
  chmod 0755 "${INSTALL_DIR}" "${INSTALL_DIR}/configs"
  chmod 0755 "${INSTALL_DIR}/data" 2>/dev/null || true
  if getent group xray >/dev/null; then
    chown h2v:xray "${INSTALL_DIR}/configs/xray"
    chmod 2750 "${INSTALL_DIR}/configs/xray"
    usermod -aG xray h2v 2>/dev/null || true
  fi
  if getent group hysteria >/dev/null; then
    chown h2v:hysteria "${INSTALL_DIR}/configs/hysteria"
    chmod 2750 "${INSTALL_DIR}/configs/hysteria"
    usermod -aG hysteria h2v 2>/dev/null || true
  fi
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${SOURCE_DIR}/.env.example" "${ENV_FILE}.tmp"
    chmod 600 "${ENV_FILE}.tmp"
    chown h2v:h2v "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
    substep "$(ui_text "создан файл настроек" "settings file created")"
  else
    substep "$(ui_text "текущие секреты сохранены" "existing secrets preserved")"
  fi

  if [[ -n "${H2V_DOMAIN_INPUT}" ]]; then
    env_set H2V_DOMAIN "${H2V_DOMAIN_INPUT}"
    env_set HY2_DOMAIN "${H2V_DOMAIN_INPUT}"
    env_set HY2_CERT_PATH "/etc/letsencrypt/live/${H2V_DOMAIN_INPUT}/fullchain.pem"
    env_set HY2_KEY_PATH "/etc/letsencrypt/live/${H2V_DOMAIN_INPUT}/privkey.pem"
    local public_prefix="https://${H2V_DOMAIN_INPUT}"
    if [[ -n "${H2V_PUBLIC_PORT_INPUT}" && "${H2V_PUBLIC_PORT_INPUT}" != "443" ]]; then
      public_prefix="https://${H2V_DOMAIN_INPUT}:${H2V_PUBLIC_PORT_INPUT}"
    fi
    env_set SUB_URL_PREFIX "${public_prefix}"
  fi
  if [[ -n "${H2V_PUBLIC_PORT_INPUT}" ]]; then
    env_set H2V_PUBLIC_PORT "${H2V_PUBLIC_PORT_INPUT}"
  fi
  env_set_default H2V_PORT 8000
  env_set_default H2V_PUBLIC_PORT 443
  env_set_default H2V_ARGON2_MAX_PARALLEL 2
  env_set_default H2V_COLLECTOR_INTERVAL 10s
  env_set_default H2V_ENFORCER_INTERVAL 30s
  env_set_default H2V_CORE_RECONCILE_INTERVAL 60s
  env_set_default H2V_CACHE_REFRESH_INTERVAL 5m
  if [[ -n "${VLESS_PORT_INPUT}" ]]; then
    env_set VLESS_PORT "${VLESS_PORT_INPUT}"
  fi
  env_set_default VLESS_UDP_ENABLED false
  env_set_default VLESS_XUDP_ENABLED false
  env_set_default REALITY_DEST "www.google.com:443"
  env_set_default REALITY_SNI "www.google.com"
  env_set_default REALITY_FINGERPRINT chrome
  env_set_default XRAY_SNIFFING_ENABLED true
  env_set_default XRAY_SNIFFING_DEST_OVERRIDE http,tls
  if [[ -n "${HY2_PORT_INPUT}" ]]; then
    env_set HY2_PORT "${HY2_PORT_INPUT}"
  fi
  env_set_default HY2_MASQUERADE_URL "https://www.google.com"

  local geodata_dir
  geodata_dir="$(env_get XRAY_GEODATA_DIR || true)"
  if [[ -z "${geodata_dir}" ]]; then
    geodata_dir="${XRAY_GEODATA_DIR_DEFAULT}"
    env_set XRAY_GEODATA_DIR "${geodata_dir}"
  fi
  geodata_dir="${geodata_dir:-${XRAY_GEODATA_DIR_DEFAULT}}"
  env_set XRAY_LOCATION_ASSET "${geodata_dir}"
  env_set_default XRAY_GEOIP_URL "${XRAY_GEOIP_URL_DEFAULT}"
  env_set_default XRAY_GEOSITE_URL "${XRAY_GEOSITE_URL_DEFAULT}"
  env_set_default GEO_BLOCKED_COUNTRIES ru
  env_set_default GEO_UPDATE_INTERVAL_HOURS 24
  ensure_public_server_ip
  auto_tune_low_memory_runtime_defaults
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

json_scalar_unquote() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "${value}"
}

db_setting_get() {
  local key="$1"
  local db_host db_port db_name db_user db_password key_literal raw

  [[ -f "${ENV_FILE}" ]] || return 1
  command_exists psql || return 1

  db_host="$(env_get DB_HOST || true)"
  db_port="$(env_get DB_PORT || true)"
  db_name="$(env_get DB_NAME || true)"
  db_user="$(env_get DB_USER || true)"
  db_password="$(env_get DB_PASSWORD || true)"
  db_host="${db_host:-127.0.0.1}"
  db_port="${db_port:-5432}"
  db_name="${db_name:-h2v}"
  db_user="${db_user:-h2v}"
  key_literal="$(printf "%s" "${key}" | sed "s/'/''/g")"

  if [[ "${db_host}" == "127.0.0.1" || "${db_host}" == "localhost" || "${db_host}" == "::1" ]] && command_exists sudo; then
    raw="$(sudo -u postgres psql -tA --dbname="${db_name}" --port="${db_port}" \
      -c "SELECT value::text FROM settings WHERE key = '${key_literal}'" 2>/dev/null || true)"
  else
    raw="$(PGPASSWORD="${db_password}" psql -tA -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" \
      -c "SELECT value::text FROM settings WHERE key = '${key_literal}'" 2>/dev/null || true)"
  fi

  raw="$(printf '%s\n' "${raw}" | awk 'NF {print; exit}')"
  [[ -n "${raw}" ]] || return 1
  json_scalar_unquote "${raw}"
}

runtime_setting_value() {
  local setting_key="$1"
  local env_key="$2"
  local fallback="$3"
  local value

  value="$(db_setting_get "${setting_key}" || true)"
  if [[ -n "${value}" ]]; then
    printf '%s' "${value}"
    return
  fi

  value="$(env_get "${env_key}" || true)"
  printf '%s' "${value:-${fallback}}"
}

selected_runtime_value() {
  local input="$1"
  local setting_key="$2"
  local env_key="$3"
  local fallback="$4"

  if [[ -n "${input}" ]]; then
    printf '%s' "${input}"
    return
  fi
  runtime_setting_value "${setting_key}" "${env_key}" "${fallback}"
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
  chown h2v:h2v "${tmp}"
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

valid_ipv4_literal() {
  local value="$1"
  local a b c d octet
  [[ "${value}" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || return 1
  IFS=. read -r a b c d <<<"${value}"
  for octet in "${a}" "${b}" "${c}" "${d}"; do
    [[ "${octet}" =~ ^[0-9]+$ ]] || return 1
    (( ${#octet} <= 3 )) || return 1
    (( 10#${octet} <= 255 )) || return 1
  done
}

valid_ipv6_literal() {
  local value="$1"
  [[ "${value}" == *:* && "${value}" =~ ^[0-9A-Fa-f:.]+$ ]]
}

valid_ip_literal() {
  valid_ipv4_literal "$1" || valid_ipv6_literal "$1"
}

detect_public_ip() {
  local url candidate
  for url in \
    "https://api.ipify.org" \
    "https://ifconfig.me/ip" \
    "https://checkip.amazonaws.com"
  do
    candidate="$(curl -fsSL --max-time 4 "${url}" 2>/dev/null | awk 'NF {print $1; exit}' || true)"
    candidate="${candidate//$'\r'/}"
    candidate="${candidate//$'\n'/}"
    if valid_ip_literal "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  return 1
}

ensure_public_server_ip() {
  local current detected
  current="$(env_get PUBLIC_SERVER_IP || true)"
  if [[ -n "${current}" ]]; then
    if ! valid_ip_literal "${current}"; then
      warn "PUBLIC_SERVER_IP=${current} is not an IP literal; protocol links will use domains"
    fi
    return 0
  fi

  detected="$(detect_public_ip || true)"
  if [[ -n "${detected}" ]]; then
    env_set PUBLIC_SERVER_IP "${detected}"
    substep "PUBLIC_SERVER_IP detected as ${detected}"
  else
    warn "could not auto-detect PUBLIC_SERVER_IP; protocol links will use domains"
  fi
}

auto_tune_low_memory_runtime_defaults() {
  [[ -r /proc/meminfo ]] || return 0
  local mem_kb current
  mem_kb="$(meminfo_value_kb MemTotal || true)"
  if ! [[ "${mem_kb}" =~ ^[0-9]+$ ]] || (( mem_kb >= 1048576 )); then
    return 0
  fi
  current="$(env_get H2V_ARGON2_MAX_PARALLEL || true)"
  if [[ -z "${current}" || "${current}" == "2" ]]; then
    env_set H2V_ARGON2_MAX_PARALLEL 1
    substep "low-memory runtime: H2V_ARGON2_MAX_PARALLEL=1"
  fi
}

h2v_domain_is_real() {
  local domain
  domain="$(env_get H2V_DOMAIN || true)"
  [[ -n "${domain}" && "${domain}" != "h2v.example.com" ]]
}

normalize_vless_env_port() {
  local h2v_public_port vless_port
  if ! h2v_domain_is_real; then
    return
  fi

  h2v_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  if [[ "${vless_port}" == "${h2v_public_port}" ]]; then
    local fallback
    fallback="$(vless_fallback_port "${h2v_public_port}")"
    warn "VLESS_PORT=${vless_port} conflicts with the h2v public HTTPS port; switching VLESS_PORT to ${fallback}"
    env_set VLESS_PORT "${fallback}"
  fi
}

validate_selected_runtime_ports() {
  local domain h2v_port h2v_public_port vless_port hy2_port
  domain="$(env_get H2V_DOMAIN || true)"
  h2v_port="$(env_get H2V_PORT || echo 8000)"
  h2v_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  hy2_port="$(selected_runtime_value "${HY2_PORT_INPUT}" "hy2.port" "HY2_PORT" "8443")"

  valid_port_number "${h2v_port}" || fail "H2V_PORT must be a number between 1 and 65535"
  valid_port_number "${h2v_public_port}" || fail "H2V_PUBLIC_PORT must be a number between 1 and 65535"
  valid_port_number "${vless_port}" || fail "VLESS_PORT must be a number between 1 and 65535"
  valid_port_number "${hy2_port}" || fail "HY2_PORT must be a number between 1 and 65535"

  if (( h2v_port < 1024 )); then
    fail "H2V_PORT is the internal h2v listener and must be 1024 or higher"
  fi
  if [[ "${h2v_public_port}" == "80" || ( "${h2v_public_port}" -lt 1024 && "${h2v_public_port}" != "443" ) ]]; then
    fail "H2V_PUBLIC_PORT must be 443 or 1024 or higher"
  fi
  if [[ -n "${domain}" && "${domain}" != "h2v.example.com" && "${h2v_public_port}" == "${h2v_port}" ]]; then
    fail "H2V_PUBLIC_PORT and H2V_PORT cannot both use TCP ${h2v_public_port}"
  fi
  if [[ "${h2v_port}" == "${vless_port}" ]]; then
    fail "H2V_PORT and VLESS_PORT cannot both use TCP ${h2v_port}"
  fi
  if [[ -n "${domain}" && "${domain}" != "h2v.example.com" && "${h2v_public_port}" == "${vless_port}" ]]; then
    fail "H2V_PUBLIC_PORT and VLESS_PORT cannot both use TCP ${h2v_public_port}"
  fi
  if ${FIRST_INSTALL}; then
    if port_listener_in_use tcp "${h2v_port}"; then
      fail "H2V_PORT=${h2v_port}/tcp is already in use"
    fi
    if [[ -n "${domain}" && "${domain}" != "h2v.example.com" ]] && port_listener_in_use tcp "${h2v_public_port}"; then
      fail "H2V_PUBLIC_PORT=${h2v_public_port}/tcp is already in use"
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

ufw_allow_port() {
  local port="$1"
  local protocol="$2"
  local label="$3"

  if ufw allow "${port}/${protocol}" >/dev/null 2>&1; then
    substep "UFW allows ${label} on ${port}/${protocol}"
  else
    warn "failed to update UFW for ${label} (${port}/${protocol}); open it manually if needed"
  fi
}

configure_local_firewall() {
  if ! command_exists ufw; then
    return
  fi
  if ! ufw status 2>/dev/null | grep -qi '^Status: active'; then
    return
  fi

  local domain h2v_public_port vless_port hy2_port
  domain="$(env_get H2V_DOMAIN || true)"
  h2v_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  hy2_port="$(selected_runtime_value "${HY2_PORT_INPUT}" "hy2.port" "HY2_PORT" "8443")"

  substep "opening required ports in UFW"
  if [[ -n "${domain}" && "${domain}" != "h2v.example.com" ]]; then
    ufw_allow_port "${h2v_public_port}" tcp "h2v HTTPS"
  fi
  ufw_allow_port "${vless_port}" tcp "VLESS Reality"
  ufw_allow_port "${hy2_port}" udp "Hysteria 2"
}

ensure_secret_value() {
  local key="${1}"
  local value

  value="$(env_get "${key}" || true)"
  if [[ -n "${value}" ]]; then
    return
  fi

  case "${key}" in
    H2V_JWT_SECRET) value="$(openssl rand -hex 64)" ;;
    DB_PASSWORD) value="$(openssl rand -hex 24)" ;;
    REALITY_SHORT_IDS) value="$(openssl rand -hex 8)" ;;
    HY2_TRAFFIC_SECRET) value="$(openssl rand -hex 32)" ;;
    HY2_OBFS_PASSWORD) value="$(openssl rand -base64 24 | tr -d '\n')" ;;
    *)
      fail "unknown secret key requested: ${key}"
      ;;
  esac

  env_set "${key}" "${value}"
}

ensure_runtime_secrets() {
  ensure_secret_value H2V_JWT_SECRET
  ensure_secret_value DB_PASSWORD
  ensure_secret_value REALITY_SHORT_IDS
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
  db_name="${db_name:-h2v}"
  db_user="${db_user:-h2v}"

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
      -c "CREATE ROLE \"${db_user_ident}\" LOGIN PASSWORD '${db_password_literal}'" >/dev/null
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
      -c "ALTER ROLE \"${db_user_ident}\" WITH LOGIN PASSWORD '${db_password_literal}'" >/dev/null
  fi

  if [[ -z "$(sudo -u postgres psql -tA --dbname=postgres --port="${db_port}" -c "SELECT 1 FROM pg_database WHERE datname = '${db_name_literal}'")" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
      -c "CREATE DATABASE \"${db_name_ident}\" OWNER \"${db_user_ident}\"" >/dev/null
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname=postgres --port="${db_port}" \
    -c "ALTER DATABASE \"${db_name_ident}\" OWNER TO \"${db_user_ident}\"" >/dev/null
}

sync_runtime_settings() {
  local db_host db_port db_name db_user db_password h2v_public_port vless_port current
  if ! h2v_domain_is_real; then
    return
  fi

  h2v_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  if [[ "${vless_port}" == "${h2v_public_port}" ]]; then
    local fallback
    fallback="$(vless_fallback_port "${h2v_public_port}")"
    warn "VLESS_PORT=${vless_port} conflicts with the h2v public HTTPS port; switching VLESS_PORT to ${fallback}"
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
  db_name="${db_name:-h2v}"
  db_user="${db_user:-h2v}"

  if [[ "${db_host}" == "127.0.0.1" || "${db_host}" == "localhost" || "${db_host}" == "::1" ]]; then
    current="$(sudo -u postgres psql -tA --dbname="${db_name}" --port="${db_port}" \
      -c "SELECT value::text FROM settings WHERE key = 'vless.port'" 2>/dev/null || true)"
  else
    current="$(PGPASSWORD="${db_password}" psql -tA -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" \
      -c "SELECT value::text FROM settings WHERE key = 'vless.port'" 2>/dev/null || true)"
  fi
  current="${current%\"}"
  current="${current#\"}"

  if [[ "${current}" != "${h2v_public_port}" ]]; then
    return
  fi

  warn "database setting vless.port still conflicts with H2V_PUBLIC_PORT=${h2v_public_port}; updating it to ${vless_port}"
  if [[ "${db_host}" == "127.0.0.1" || "${db_host}" == "localhost" || "${db_host}" == "::1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 --dbname="${db_name}" --port="${db_port}" \
      -c "INSERT INTO settings (key, value, updated_at) VALUES ('vless.port', '${vless_port}'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()" >/dev/null
  else
    PGPASSWORD="${db_password}" psql -v ON_ERROR_STOP=1 -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" \
      -c "INSERT INTO settings (key, value, updated_at) VALUES ('vless.port', '${vless_port}'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()" >/dev/null
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
  local node_options
  frontend_dir="${SOURCE_DIR}/frontend"
  cached_lock="${BUILD_STATE_DIR}/frontend-package-lock.json"
  backend_log="${BUILD_STATE_DIR}/backend-build.log"
  frontend_log="${BUILD_STATE_DIR}/frontend-build.log"
  node_options="$(frontend_build_node_options)"
  build_commit="${REPO_REF}"
  if [[ -d "${SOURCE_DIR}/.git" ]]; then
    build_commit="$(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD 2>/dev/null || printf '%s' "${REPO_REF}")"
  fi
  build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ldflags="-s -w -X main.version=${H2V_VERSION:-${REPO_REF}} -X main.commit=${build_commit} -X main.builtAt=${build_time}"

  substep "compiling h2v backend"
  if ! (
    cd "${SOURCE_DIR}/backend" &&
    go mod download &&
    go mod verify &&
    go build -mod=readonly -ldflags "${ldflags}" -o "${INSTALL_DIR}/bin/h2v" ./cmd/h2v
  ) >"${backend_log}" 2>&1; then
    red "backend build failed"
    printf '  %slog:%s %s\n' "${DIM}" "${RESET}" "${backend_log}"
    tail -n 60 "${backend_log}" || true
    fail "unable to compile backend"
  fi

  substep "building frontend bundle (vite)"
  if [[ -n "${node_options}" ]]; then
    substep "frontend NODE_OPTIONS=${node_options}"
  fi
  ensure_build_swap

  if [[ ! -f "${frontend_dir}/package-lock.json" && -f "${cached_lock}" ]]; then
    cp "${cached_lock}" "${frontend_dir}/package-lock.json"
  fi

  if [[ -f "${frontend_dir}/package-lock.json" ]]; then
    if ! (
      cd "${frontend_dir}" &&
      export NODE_OPTIONS="${node_options}" &&
      npm ci --no-fund &&
      { npm audit --audit-level=high || true; } &&
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
      export NODE_OPTIONS="${node_options}" &&
      npm install --no-fund &&
      { npm audit --audit-level=high || true; } &&
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

  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "backend build completed without producing ${INSTALL_DIR}/bin/h2v"
  [[ -f "${INSTALL_DIR}/frontend/index.html" ]] || fail "frontend build completed without producing ${INSTALL_DIR}/frontend/index.html"

  chown -R h2v:h2v "${INSTALL_DIR}/bin" "${INSTALL_DIR}/frontend" "${BUILD_STATE_DIR}"
}

install_templates() {
  rsync -a --delete "${SOURCE_DIR}/templates/" "${INSTALL_DIR}/templates/"
  install -m 0644 "${SOURCE_DIR}/backend/schema.sql" "${INSTALL_DIR}/schema.sql"
  install -m 0755 "${SOURCE_DIR}/install.sh" "${INSTALL_DIR}/install.sh"
  chown root:root "${INSTALL_DIR}/install.sh" 2>/dev/null || true
  chown -R h2v:h2v "${INSTALL_DIR}/templates"
  chown h2v:h2v "${INSTALL_DIR}/schema.sql"
}

install_units() {
  cp "${SOURCE_DIR}/units/"*.service /etc/systemd/system/
  cp "${SOURCE_DIR}/units/"*.timer /etc/systemd/system/
  systemctl daemon-reload
}

setup_geodata_timer() {
  if ! systemctl enable --now h2v-geodata-update.timer >/dev/null 2>&1; then
    warn "failed to enable h2v-geodata-update.timer; run h2v geodata update manually if needed"
    return
  fi
  substep "h2v-geodata-update.timer enabled"
}

install_sudoers() {
  local path="/etc/sudoers.d/h2v-systemctl"
  local tmp="${path}.tmp"
  cat >"${tmp}" <<'EOF'
h2v ALL=(root) NOPASSWD: /bin/systemctl restart xray.service, /bin/systemctl restart hysteria.service
h2v ALL=(root) NOPASSWD: /bin/systemctl reload xray.service, /bin/systemctl reload hysteria.service
EOF
  chmod 0440 "${tmp}"
  if command_exists visudo; then
    visudo -cf "${tmp}" >/dev/null
  fi
  mv "${tmp}" "${path}"
}

start_h2v() {
  substep "enabling h2v.service"
  systemctl enable h2v.service >/dev/null 2>&1 || true
  if ! systemctl restart h2v.service; then
    red "h2v.service failed to start. Recent logs:"
    journalctl -u h2v.service -n 30 --no-pager || true
    fail "h2v.service is not running"
  fi
  sleep 1
  if ! systemctl is-active --quiet h2v.service; then
    red "h2v.service is not active after start. Recent logs:"
    journalctl -u h2v.service -n 30 --no-pager || true
    fail "h2v.service failed to come up"
  fi
}

setup_reverse_proxy() {
  local domain h2v_port h2v_public_port site_address public_url
  domain="$(env_get H2V_DOMAIN || true)"
  h2v_port="$(env_get H2V_PORT || true)"
  h2v_port="${h2v_port:-8000}"
  h2v_public_port="$(env_get H2V_PUBLIC_PORT || true)"
  h2v_public_port="${h2v_public_port:-443}"

  if [[ -z "${domain}" || "${domain}" == "h2v.example.com" ]]; then
    warn "skipping Caddy config (no real H2V_DOMAIN set)"
    info "h2v is local-only at http://127.0.0.1:${h2v_port}/ - set H2V_DOMAIN and rerun for auto-TLS"
    return
  fi
  site_address="${domain}"
  public_url="https://${domain}/"
  if [[ "${h2v_public_port}" != "443" ]]; then
    site_address="${domain}:${h2v_public_port}"
    public_url="https://${domain}:${h2v_public_port}/"
  fi

  substep "writing /etc/caddy/Caddyfile for ${site_address}"
  mkdir -p /etc/caddy
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

  reverse_proxy 127.0.0.1:${h2v_port}
}
EOF

  systemctl enable caddy.service >/dev/null 2>&1 || true
  if ! systemctl reload caddy.service 2>/dev/null; then
    if ! systemctl restart caddy.service; then
      red "caddy.service failed to start. Recent logs:"
      journalctl -u caddy.service -n 30 --no-pager || true
      warn "backend up on 127.0.0.1:${h2v_port}, reverse proxy is NOT - fix Caddy separately"
      return
    fi
  fi
  substep "Caddy active for ${public_url} (auto-TLS via Let's Encrypt)"
  if [[ "${h2v_public_port}" == "443" ]]; then
    info "DNS must point ${domain} at this server; ports 80/443 must be open"
  else
    info "DNS must point ${domain} at this server; ports 80 and ${h2v_public_port}/tcp must be open"
  fi
}

init_database_schema() {
  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "h2v binary missing; cannot initialize database schema"
  sudo -u h2v env H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" db init
}

create_admin() {
  if ! ${FIRST_INSTALL}; then
    return
  fi
  local admin_username="${ADMIN_USERNAME_INPUT:-${H2V_ADMIN_USERNAME:-admin}}"
  local admin_password="${ADMIN_PASSWORD_INPUT:-${H2V_ADMIN_PASSWORD:-admin123456}}"
  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "h2v binary missing; cannot create initial admin"

  local admin_output
  local admin_status=0
  admin_output="$(sudo -u h2v env H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" admin create \
    --username="${admin_username}" \
    --password="${admin_password}" 2>&1)" || admin_status=$?

  if [[ ${admin_status} -eq 0 ]]; then
    return
  fi
  if [[ "${admin_output}" == *"already taken"* || "${admin_output}" == *"already exists"* ]]; then
    warn "admin account already exists - keeping existing credentials"
    FIRST_INSTALL=false
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
  local domain h2v_port h2v_public_port vless_port hy2_port h2v_url mode config_note
  domain="$(plan_value "${H2V_DOMAIN_INPUT}" "H2V_DOMAIN" "h2v.example.com")"
  h2v_port="$(plan_value "" "H2V_PORT" "8000")"
  h2v_public_port="$(plan_value "${H2V_PUBLIC_PORT_INPUT}" "H2V_PUBLIC_PORT" "443")"
  vless_port="$(selected_runtime_value "${VLESS_PORT_INPUT}" "vless.port" "VLESS_PORT" "8444")"
  hy2_port="$(selected_runtime_value "${HY2_PORT_INPUT}" "hy2.port" "HY2_PORT" "8443")"

  if [[ -n "${domain}" && "${domain}" != "h2v.example.com" ]]; then
    if [[ "${h2v_public_port}" == "443" ]]; then
      h2v_url="https://${domain}/"
    else
      h2v_url="https://${domain}:${h2v_public_port}/"
    fi
  else
    h2v_url="http://127.0.0.1:${h2v_port}/"
  fi

  if ${FIRST_INSTALL}; then
    mode="$(ui_text "Новая установка" "New installation")"
    config_note="$(ui_text "Создать новые настройки" "Create new settings")"
  elif ${RECONFIGURE_RUNTIME}; then
    mode="$(ui_text "Изменить настройки" "Change settings")"
    config_note="$(ui_text "Обновить домен и порты" "Update domain and ports")"
  else
    mode="$(ui_text "Обновление" "Update")"
    config_note="$(ui_text "Сохранить текущие секреты" "Keep existing secrets")"
  fi

  printf '\n'
  ui_rule "${MAGENTA}"
  printf '  %s%s%s\n' "${BOLD}" "$(ui_text "План установки" "Install overview")" "${RESET}"
  ui_item "${GREEN}" "$(ui_text "РЕЖИМ" "MODE")" "${mode}"
  ui_item "${CYAN}" "$(ui_text "ПАНЕЛЬ" "PANEL")" "${h2v_url}"
  ui_item "${BLUE}" "VLESS" "TCP ${vless_port}"
  ui_item "${MAGENTA}" "HY2" "UDP ${hy2_port}"
  ui_item "${YELLOW}" "$(ui_text "ENV" "ENV")" "${config_note}"
  ui_rule "${MAGENTA}"
  printf '\n'
}

print_welcome() {
  printf '\n'
  printf '  %s%s%s\n' "${BOLD}" "$(ui_text "Что будет готово" "What will be ready")" "${RESET}"
  ui_item "${CYAN}" "$(ui_text "ПАНЕЛЬ" "PANEL")" "$(ui_text "веб-интерфейс h2v" "h2v web interface")"
  ui_item "${GREEN}" "$(ui_text "ЛЮДИ" "USERS")" "$(ui_text "пользователи, подписки и статистика" "users, subscriptions, and traffic stats")"
  ui_item "${MAGENTA}" "$(ui_text "ПРОКСИ" "PROXY")" "$(ui_text "VLESS Reality и Hysteria 2" "VLESS Reality and Hysteria 2")"
  ui_item "${YELLOW}" "$(ui_text "КОПИИ" "BACKUP")" "$(ui_text "резервные копии и маршрутные данные" "backups and routing data")"
  printf '\n'
  printf '  %s%s%s\n' "${DIM}" "$(ui_text "Подсказка: Enter принимает предложенное значение." "Tip: press Enter to accept the suggested value.")" "${RESET}"
}

install_all() {
  require_root
  detect_os
  clear_screen
  banner "$(ui_text "Установка h2v" "h2v installer")" "$(ui_text "Панель управления VLESS Reality и Hysteria 2" "Management panel for VLESS Reality and Hysteria 2")"
  print_welcome
  resolve_source_dir

  collect_install_inputs
  print_install_plan
  : >"${INSTALL_LOG}" 2>/dev/null || true

  STAGE_INDEX=0
  STAGE_TOTAL=13

  step "deps" "$(ui_text "Подготовка сервера" "Preparing the server")"
  ensure_base_packages
  ensure_build_swap
  success "$(ui_text "сервер готов к установке" "server is ready")"

  step "toolchain" "$(ui_text "Подготовка сборки" "Preparing the build environment")"
  ensure_build_toolchain
  success "$(ui_text "среда сборки готова" "build environment is ready")"

  step "cores" "$(ui_text "Установка прокси-ядер" "Installing proxy cores")"
  install_xray_binary
  install_hysteria_binary
  ensure_core_users
  success "$(ui_text "прокси-ядра установлены" "proxy cores are installed")"

  step "layout" "$(ui_text "Подготовка файлов h2v" "Preparing h2v files")"
  ensure_h2v_user
  ensure_dirs
  ensure_env
  normalize_config_paths
  normalize_vless_env_port
  ensure_runtime_secrets
  validate_selected_runtime_ports
  configure_local_firewall
  ensure_reality_keys
  success "$(ui_text "файлы и настройки подготовлены" "files and settings are prepared")"

  step "db" "$(ui_text "Подготовка базы данных" "Preparing the database")"
  ensure_postgres
  success "$(ui_text "база данных готова" "database is ready")"

  step "assets" "$(ui_text "Копирование шаблонов" "Copying templates")"
  install_templates
  success "$(ui_text "шаблоны обновлены" "templates are updated")"

  step "build" "$(ui_text "Сборка панели" "Building the panel")"
  build_artifacts
  success "$(ui_text "панель собрана" "panel is built")"

  step "geodata" "$(ui_text "Обновление маршрутных данных" "Updating routing data")"
  update_geodata
  success "$(ui_text "маршрутные данные готовы" "routing data is ready")"

  step "units" "$(ui_text "Настройка автозапуска" "Configuring autostart")"
  install_units
  install_sudoers
  setup_geodata_timer
  success "$(ui_text "автозапуск настроен" "autostart is configured")"

  step "schema" "$(ui_text "Инициализация данных" "Initializing data")"
  local schema_out schema_status=0
  schema_out="$(init_database_schema 2>&1)" || schema_status=$?
  if [[ ${schema_status} -ne 0 ]]; then
    printf '%s\n' "${schema_out}"
    fail "$(ui_text "Не удалось подготовить базу данных" "Database initialization failed")"
  fi
  success "$(ui_text "структура данных готова" "data schema is ready")"

  step "admin" "$(ui_text "Создание администратора" "Preparing admin access")"
  create_admin
  if ${FIRST_INSTALL}; then
    success "$(ui_text "администратор '${ADMIN_USERNAME_INPUT}' готов" "admin '${ADMIN_USERNAME_INPUT}' is ready")"
  else
    info "$(ui_text "текущий администратор сохранён" "existing admin account preserved")"
  fi

  step "configs" "$(ui_text "Применение настроек прокси" "Applying proxy settings")"
  sync_runtime_settings
  render_core_configs
  grant_cert_access
  success "$(ui_text "настройки прокси применены" "proxy settings are applied")"

  step "service" "$(ui_text "Запуск сервисов" "Starting services")"
  start_h2v
  setup_reverse_proxy
  start_cores
  success "$(ui_text "сервисы запущены" "services are running")"

  local final_domain final_port final_public_port access_url local_url
  final_domain="$(env_get H2V_DOMAIN || echo h2v.example.com)"
  final_port="$(env_get H2V_PORT || echo 8000)"
  final_public_port="$(env_get H2V_PUBLIC_PORT || echo 443)"
  local_url="http://127.0.0.1:${final_port}/"
  if [[ -n "${final_domain}" && "${final_domain}" != "h2v.example.com" ]]; then
    if [[ "${final_public_port}" == "443" ]]; then
      access_url="https://${final_domain}/"
    else
      access_url="https://${final_domain}:${final_public_port}/"
    fi
  else
    access_url="${local_url}"
  fi

  print_summary "${access_url}"
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
  db_name="${db_name:-h2v}"
  db_user="${db_user:-h2v}"
  backup_dir="${backup_dir:-${INSTALL_DIR}/data/backups}"

  mkdir -p "${backup_dir}"
  local name="h2v-$(date -u +%F-%H%M%S).sql.gz"
  PGPASSWORD="${db_password}" pg_dump -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}" | gzip > "${backup_dir}/${name}"
  green "$(ui_text "Резервная копия создана: ${backup_dir}/${name}" "Backup created: ${backup_dir}/${name}")"
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
  db_name="${db_name:-h2v}"
  db_user="${db_user:-h2v}"

  local file="${1:-}"
  if [[ -z "${file}" || ! -f "${file}" ]]; then
    red "$(ui_text "Укажите существующий файл резервной копии." "Provide a valid backup file.")"
    exit 1
  fi
  gunzip -c "${file}" | PGPASSWORD="${db_password}" psql -h "${db_host}" -p "${db_port}" -U "${db_user}" "${db_name}"
  green "$(ui_text "Восстановление завершено." "Restore complete.")"
}

update_all() {
  install_all
}

update_geodata_command() {
  require_root
  [[ -f "${ENV_FILE}" ]] || fail "$(ui_text "Настройки ${ENV_FILE} не найдены" "${ENV_FILE} not found")"
  clear_screen
  banner "$(ui_text "Обновление маршрутных данных" "Routing data update")" "geoip.dat + geosite.dat"
  STAGE_INDEX=0
  STAGE_TOTAL=1
  step "geodata" "$(ui_text "Загрузка GeoIP и Geosite" "Downloading GeoIP and Geosite")"
  update_geodata
  success "$(ui_text "маршрутные данные обновлены" "routing data is updated")"
  systemctl try-restart xray.service hysteria.service >/dev/null 2>&1 || true
}

uninstall_all() {
  require_root
  clear_screen
  banner "$(ui_text "Удаление h2v" "h2v uninstaller")" "$(ui_text "Остановка сервисов и удаление файлов приложения" "Stopping services and removing application files")"
  STAGE_INDEX=0
  STAGE_TOTAL=2

  step "stop" "$(ui_text "Остановка сервисов" "Stopping services")"
  systemctl disable --now h2v hysteria xray h2v-geodata-update.timer h2v-geodata-update.service 2>/dev/null || true
  success "$(ui_text "сервисы h2v, Hysteria 2 и Xray остановлены" "h2v, Hysteria 2, and Xray services are stopped")"

  step "purge" "$(ui_text "Удаление файлов приложения" "Removing application files")"
  rm -rf "${INSTALL_DIR}"
  rm -f /etc/systemd/system/h2v.service /etc/systemd/system/xray.service /etc/systemd/system/hysteria.service
  rm -f /etc/systemd/system/h2v-geodata-update.service /etc/systemd/system/h2v-geodata-update.timer
  rm -f /etc/sudoers.d/h2v-systemctl
  systemctl daemon-reload
  success "$(ui_text "${INSTALL_DIR} и сервисные файлы удалены" "${INSTALL_DIR} and service files are removed")"

  printf '\n'
  info "$(ui_text "Пакеты, сертификаты Let's Encrypt и база данных оставлены на сервере." "Packages, Let's Encrypt certificates, and database objects were left on the server.")"
  printf '\n'
}

reset_admin() {
  require_root
  [[ -x "${INSTALL_DIR}/bin/h2v" ]] || fail "$(ui_text "h2v не найден в ${INSTALL_DIR}/bin/h2v - сначала выполните установку" "h2v binary missing at ${INSTALL_DIR}/bin/h2v - run install first")"
  [[ -f "${ENV_FILE}" ]] || fail "$(ui_text "Настройки ${ENV_FILE} не найдены" "${ENV_FILE} not found")"

  clear_screen
  banner "$(ui_text "Смена пароля администратора" "Admin password reset")" "$(ui_text "Новый пароль для входа в панель" "New password for panel access")"

  local username password generated=false
  username="${1:-}"
  password="${2:-}"

  if [[ -z "${username}" ]]; then
    username="$(prompt_value "$(ui_text "Логин администратора" "Admin username")" "admin")"
  fi

  if [[ -z "${password}" ]]; then
    if can_prompt; then
      password="$(prompt_password "$(ui_text "Новый пароль (пусто - создать автоматически)" "New password (blank to auto-generate)")")"
    fi
    if [[ -z "${password}" ]]; then
      password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
      generated=true
    fi
  fi

  STAGE_INDEX=0
  STAGE_TOTAL=1
  step "reset" "$(ui_text "Применение нового пароля для '${username}'" "Applying new password for '${username}'")"
  local out status=0
  out="$(sudo -u h2v env H2V_ENV_FILE="${ENV_FILE}" "${INSTALL_DIR}/bin/h2v" admin set-password \
    --username="${username}" \
    --password="${password}" 2>&1)" || status=$?

  if [[ ${status} -ne 0 ]]; then
    red "${out}"
    fail "$(ui_text "Не удалось сменить пароль администратора" "Failed to reset admin password")"
  fi
  success "$(ui_text "пароль обновлён" "password is updated")"

  printf '\n'
  printf '  %s%-18s%s %s\n' "${BOLD}" "$(ui_text "Логин" "Admin login")" "${RESET}" "${username}"
  if ${generated}; then
    printf '  %s%-18s%s %s%s%s %s%s%s\n' "${BOLD}" "$(ui_text "Пароль" "Admin password")" "${RESET}" "${YELLOW}" "${password}" "${RESET}" "${DIM}" "$(ui_text "(создан автоматически)" "(auto-generated)")" "${RESET}"
  else
    printf '  %s%-18s%s %s%s%s\n' "${BOLD}" "$(ui_text "Пароль" "Admin password")" "${RESET}" "${YELLOW}" "${password}" "${RESET}"
  fi
  printf '  %s[!] %s%s\n\n' "${YELLOW}" "$(ui_text "Сохраните пароль: он больше не будет показан." "Save this password: it will not be shown again.")" "${RESET}"
}

select_language "${1:-install}"

case "${1:-install}" in
  install) install_all ;;
  update|reinstall) update_all ;;
  geodata|update-geodata) update_geodata_command ;;
  uninstall) uninstall_all ;;
  reset-admin) reset_admin "${2:-}" "${3:-}" ;;
  backup) backup_db ;;
  restore) restore_db "${2:-}" ;;
  help|-h|--help)
    if ui_ru; then
      cat <<'USAGE'
Установщик h2v

Быстрая установка:
  curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash

Действия:
  install.sh install                         установить или обновить h2v
  install.sh update | reinstall              обновить, сохранив текущие настройки
  install.sh geodata | update-geodata        обновить маршрутные данные
  install.sh uninstall                       удалить приложение и сервисы h2v
  install.sh reset-admin [login] [password]  сменить пароль администратора
  install.sh backup                          создать резервную копию
  install.sh restore <file>                  восстановить из резервной копии

Язык:
  H2V_LANG=ru                                русский интерфейс
  H2V_LANG=en                                English interface

Дополнительно:
  H2V_REF=<branch|tag|commit>                версия исходного кода
  H2V_VERBOSE=1                              показать подробный вывод
  H2V_INSTALL_LOG=/path/to/log               путь к журналу установки
  H2V_NO_CLEAR=1                             не очищать экран перед запуском
  H2V_ADMIN_USERNAME, H2V_ADMIN_PASSWORD     логин и пароль для установки без вопросов

USAGE
    else
      cat <<'USAGE'
h2v installer

Quick install:
  curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash

Actions:
  install.sh install                         install or update h2v
  install.sh update | reinstall              update and keep current settings
  install.sh geodata | update-geodata        update routing data
  install.sh uninstall                       remove h2v app and services
  install.sh reset-admin [login] [password]  reset admin password
  install.sh backup                          create a backup
  install.sh restore <file>                  restore from backup

Language:
  H2V_LANG=en                                English interface
  H2V_LANG=ru                                русский интерфейс

Advanced:
  H2V_REF=<branch|tag|commit>                source version
  H2V_VERBOSE=1                              show detailed output
  H2V_INSTALL_LOG=/path/to/log               install log path
  H2V_NO_CLEAR=1                             keep previous terminal output
  H2V_ADMIN_USERNAME, H2V_ADMIN_PASSWORD     admin login and password for unattended install

USAGE
    fi
    ;;
  *)
    red "$(ui_text "Использование: $0 {install|update|reinstall|geodata|update-geodata|uninstall|reset-admin [login] [password]|backup|restore <file>|help}" "Usage: $0 {install|update|reinstall|geodata|update-geodata|uninstall|reset-admin [login] [password]|backup|restore <file>|help}")"
    exit 1
    ;;
esac
