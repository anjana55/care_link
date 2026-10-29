#!/usr/bin/env bash
#
# setup.sh - automates Parts 8-13 of DEPLOYMENT.md (fill in secrets, build,
# start, migrate, seed, obtain HTTPS, verify) for a fresh production
# deployment.
#
# What this script does NOT do for you, on purpose - these genuinely need
# a human decision and are covered in DEPLOYMENT.md:
#   - Part 1-7:  provisioning a server, DNS, firewall/security groups
#   - Part 15:   backups
#
# Part 13 (HTTPS) IS automated, but only when it can work: a certificate
# requires a real domain already pointing at this server, so --domain with
# a bare IP or localhost still deploys HTTP-only. See --skip-tls.
#
# Usage:
#   ./setup.sh --domain=example.com --tls-email=me@example.com
#   ./setup.sh --domain=203.0.113.10          # no domain yet, IP only, HTTP only
#   ./setup.sh --domain=example.com --admin-email=me@example.com --admin-password='...'
#   ./setup.sh --domain=example.com --skip-tls   # deploy HTTP only, add TLS later
#
# Safe to re-run: it won't overwrite an existing .env.production, and the
# build/start/migrate/seed steps are all idempotent. An existing certificate
# is detected and never re-requested - re-running will not burn Let's Encrypt
# rate limit. Every run cleans up after itself (old images, build cache past
# a budget, stray volumes), so repeated runs no longer fill the disk.
#
# This is for the FIRST deploy, and for repairing one. To deploy new code -
# a merged PR, a branch, a single PR to try out - use ./update.sh, which
# rebuilds only what changed, backs up the database before migrations, and
# can roll back. See DEPLOYMENT.md Part 16.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
ENV_EXAMPLE=".env.production.example"
NGINX_HTTPS_TEMPLATE="deploy/nginx.https.conf"
NGINX_LOCAL_CONF="deploy/nginx.local.conf"

DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
ADMIN_NAME="Platform Administrator"
TLS_EMAIL=""
SKIP_TLS=0
SKIP_SWAP=0
ASSUME_YES=0
# Build cache kept after a deploy, in GB: enough that the next build reuses
# the npm installs, not so much that it fills a small disk. Blank = by disk
# size (deploy/lib.sh cl_default_build_cache_gb).
BUILD_CACHE_GB=""
CLEANUP=1
PASSWORD_SOURCE="generated"
TLS_ENABLED=0

usage() {
  cat <<EOF
Usage: $0 --domain=<your-domain-or-server-ip> [options]

Options:
  --domain=HOST           Required on first run. Your real domain (e.g. example.com)
                           or, if you don't have one yet, your server's public IP.
  --admin-email=EMAIL     Initial admin login email (default: admin@<domain>, or
                           admin@care-platform.local if --domain is a bare IP).
  --admin-password=PASS   Initial admin password (default: randomly generated and
                           printed at the end - save it, you won't see it again).
  --tls-email=EMAIL       Contact address for the HTTPS certificate. Let's Encrypt
                           uses it to warn you if a renewal ever fails, so use an
                           address you actually read. (default: your --admin-email
                           if it looks like a real address, else admin@<domain>.)
                           Ignored when --domain is a bare IP or localhost, or with
                           --skip-tls.
  --skip-tls              Deploy over plain HTTP and don't attempt a certificate.
                           Use this when the domain isn't pointing at this server
                           yet; re-run later without it to add HTTPS.
  --skip-swap             Don't create a swap file on a server with under 6 GB of
                           RAM. Only use this if you manage swap yourself - without
                           enough memory a build can stall, or run the server out
                           of memory and take MySQL down during a later update.
  --build-cache=GB        Build cache to keep after the deploy so the next build is
                           quick (default 1 on a disk under 18 GB, else 3). 0 clears
                           it all - smallest disk use,
                           slowest next build.
  --no-cleanup            Don't remove old images and build cache afterwards.
  -y, --yes               Don't pause for confirmation before starting.
  -h, --help              Show this help.
EOF
}

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --domain=*) DOMAIN="${arg#*=}" ;;
    --admin-email=*) ADMIN_EMAIL="${arg#*=}" ;;
    --admin-password=*) ADMIN_PASSWORD="${arg#*=}" ;;
    --tls-email=*) TLS_EMAIL="${arg#*=}" ;;
    --skip-tls) SKIP_TLS=1 ;;
    --skip-swap) SKIP_SWAP=1 ;;
    --build-cache=*) BUILD_CACHE_GB="${arg#*=}"; [[ "$BUILD_CACHE_GB" =~ ^[0-9]+$ ]] || die "--build-cache takes a whole number of GB" ;;
    --no-cleanup) CLEANUP=0 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg (see --help)" ;;
  esac
done
[ -n "$ADMIN_PASSWORD" ] && PASSWORD_SOURCE="flag"

# ---------------------------------------------------------------------------
# 1. Preflight checks
# ---------------------------------------------------------------------------
[ -f "$COMPOSE_FILE" ] || die "Run this from the repo root (couldn't find $COMPOSE_FILE here)."
[ -f deploy/lib.sh ] || die "deploy/lib.sh is missing - is this a complete checkout?"
# shellcheck source=deploy/lib.sh
. deploy/lib.sh

# Install Docker Engine + the Compose plugin if Docker is missing.
# Supports Ubuntu/Debian using Docker's official apt repository. Installation
# requires root/sudo and network access; other distributions must install
# Docker manually before re-running this script.
ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker is already installed"
    return 0
  fi

  log "Docker is not installed; attempting to install Docker Engine and Compose"
  command -v apt-get >/dev/null 2>&1 || die "Automatic Docker installation supports Ubuntu/Debian only. Install Docker and the Compose plugin manually, then re-run."

  local SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "Docker installation needs root privileges. Re-run as root or install sudo, then retry."
    SUDO="sudo"
  fi

  . /etc/os-release
  local DOCKER_REPO_OS="$ID"
  case "$DOCKER_REPO_OS" in
    ubuntu|debian) ;;
    *) die "Unsupported OS '$DOCKER_REPO_OS' for automatic Docker installation. Install Docker manually, then re-run." ;;
  esac
  local DOCKER_CODENAME="${VERSION_CODENAME:-}"
  [ -n "$DOCKER_CODENAME" ] || die "Couldn't determine OS codename for Docker's apt repository."

  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$DOCKER_REPO_OS/gpg" | $SUDO tee /etc/apt/keyrings/docker.asc >/dev/null
  $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$DOCKER_REPO_OS $DOCKER_CODENAME stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  # The downloaded .deb files are no use once installed.
  $SUDO apt-get clean

  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl enable --now docker
  fi

  command -v docker >/dev/null 2>&1 || die "Docker installation finished but the docker command is still unavailable."
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin installation failed."
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed, but this user cannot access the Docker daemon. Re-run as root or configure Docker permissions, then retry."
  fi
  log "Docker Engine and Compose are installed and ready"
}

ensure_docker
docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin isn't available - see DEPLOYMENT.md Part 4."
command -v openssl >/dev/null 2>&1 || die "openssl isn't installed (needed to generate secrets)."
cl_lock
BUILD_CACHE_GB="${BUILD_CACHE_GB:-$(cl_default_build_cache_gb)}"

# ---------------------------------------------------------------------------
# 1b. Small servers (t3.micro / t3.small and similar).
#
# Building the images is by far the most memory-hungry thing this script
# does: each Next.js build (web, public-web) peaks around 1.3 GB on its own,
# and `docker compose build` runs all three images AT ONCE. On a 1-2 GB
# instance with no swap - which is how EC2's Ubuntu images come - that
# doesn't fail cleanly. The kernel thrashes the page cache, the build stops
# making progress, and SSH barely responds: the script just looks stuck in
# the middle. MySQL 8 then wants another ~400 MB on top at runtime.
#
# Later updates are harder on memory than this first build: update.sh builds
# while the live site keeps running, so MySQL, the API and both Next.js
# servers hold another ~1-1.5 GB on top. A "4 GB" server with no swap ran out
# during a full rebuild, and the kernel killed mysqld - taking the site down.
#
# So on a server with under 6 GB of RAM this:
#   - adds a swap file so memory + swap reaches ~6 GB (persisted in fstab),
#   - builds the images one at a time instead of all together (deploy/lib.sh),
#   - gives the Next.js builds an explicit heap limit that uses that swap
#     (Node otherwise sizes its heap from physical RAM and dies with
#     "JavaScript heap out of memory"),
# and on one with under 4 GB it also
#   - runs MySQL without performance_schema, which saves ~250 MB.
# A server with 6 GB or more is left exactly as it was.
# ---------------------------------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

LOW_MEMORY=0
# Memory + swap to aim for: enough for a later update to build beside the live site.
BUILD_TARGET_MB=6144
MEM_MB="$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
SWAP_MB="$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${MEM_MB:-0}" -gt 0 ] && [ "$MEM_MB" -lt 3800 ]; then
  LOW_MEMORY=1
fi

ensure_swap() {
  [ "${MEM_MB:-0}" -gt 0 ] && [ "$MEM_MB" -lt "$BUILD_TARGET_MB" ] || return 0
  log "Server with ${MEM_MB} MB RAM and ${SWAP_MB} MB swap - making sure builds (now and in later updates) have room"

  local need_mb=$(( BUILD_TARGET_MB - MEM_MB - SWAP_MB ))
  if [ "$need_mb" -le 0 ]; then
    echo "  Memory + swap is already $(( MEM_MB + SWAP_MB )) MB - enough for the build."
    return 0
  fi
  if [ "$SKIP_SWAP" -eq 1 ]; then
    warn "--skip-swap given, but this server has only $(( MEM_MB + SWAP_MB )) MB of memory + swap."
    warn "Builds want about ${BUILD_TARGET_MB} MB; without more swap a later update can run out of memory and take MySQL down."
    return 0
  fi

  # Round up to a whole GB, minimum 1 GB - small odd sizes buy nothing.
  local size_mb=$(( (need_mb + 1023) / 1024 * 1024 ))
  [ "$size_mb" -lt 1024 ] && size_mb=1024
  local swapfile="/swapfile"
  local how_to="Add swap yourself (e.g. a ${size_mb} MB file: sudo fallocate -l ${size_mb}M /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile), or use an instance with at least 6 GB of RAM, then re-run. See DEPLOYMENT.md Part 17.14."

  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    warn "Can't create a swap file without root or sudo. $how_to"
    return 0
  fi
  if [ -e "$swapfile" ]; then
    # Exists but isn't active (a previous run, or the operator's own) - turn
    # it on rather than overwrite something we didn't create.
    if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$swapfile"; then
      $SUDO swapon "$swapfile" 2>/dev/null && echo "  Re-enabled the existing $swapfile." \
        || warn "$swapfile exists but couldn't be enabled. $how_to"
    fi
    return 0
  fi

  # The swap file and ~4 GB of images + build cache share the root volume,
  # and EC2's default 8 GB volume is tight. Shrink the swap file to what
  # leaves room for the images rather than filling the disk; below 1 GB it
  # isn't worth having, so say what to do instead.
  local free_mb fit_mb
  free_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
  fit_mb=$(( (${free_mb:-0} - 4096) / 1024 * 1024 ))
  if [ "$fit_mb" -lt "$size_mb" ]; then
    if [ "$fit_mb" -lt 1024 ]; then
      warn "Only ${free_mb} MB free on / - not enough room for a swap file as well as the images."
      warn "Grow the EBS volume to 20 GB or more (DEPLOYMENT.md Part 17.14) and re-run, or: $how_to"
      return 0
    fi
    warn "Only ${free_mb} MB free on / - creating a ${fit_mb} MB swap file instead of ${size_mb} MB."
    warn "The build may be slow; growing the EBS volume to 20 GB or more is recommended (DEPLOYMENT.md Part 17.14)."
    size_mb="$fit_mb"
  fi

  echo "  Creating a ${size_mb} MB swap file at $swapfile"
  if ! $SUDO fallocate -l "${size_mb}M" "$swapfile" 2>/dev/null; then
    # fallocate isn't supported on every filesystem; dd always works.
    $SUDO dd if=/dev/zero of="$swapfile" bs=1M count="$size_mb" status=none
  fi
  $SUDO chmod 600 "$swapfile"
  $SUDO mkswap "$swapfile" >/dev/null
  $SUDO swapon "$swapfile"
  # Persist across reboots - MySQL and the API still benefit from it at runtime.
  if ! grep -qE "^[[:space:]]*${swapfile}[[:space:]]" /etc/fstab 2>/dev/null; then
    echo "${swapfile} none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
  fi
  # Prefer keeping the running app in RAM; swap is the safety net for the
  # build, not somewhere to park MySQL's working set.
  $SUDO sysctl -q vm.swappiness=10 >/dev/null 2>&1 || true
  if [ -d /etc/sysctl.d ]; then
    echo 'vm.swappiness=10' | $SUDO tee /etc/sysctl.d/99-carelink-swap.conf >/dev/null || true
  fi
  SWAP_MB="$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)"
  echo "  Swap is now ${SWAP_MB} MB (memory + swap: $(( MEM_MB + SWAP_MB )) MB)."
}

ensure_swap

# Can this Docker actually publish port 80?
#
# Rootless Docker refuses to bind ports below 1024 by default, so the
# nginx container - the only thing that lets the outside world reach the
# site - dies at the very END of the deploy with
#   cannot expose privileged port 80, ... permission denied
# after the images have already spent 5-15 minutes building. That is a
# terrible way to find out, so it is checked here instead, while the
# failure is still free.
#
# `sysctl` reports the current value; anything at or below 80 means
# unprivileged processes may bind the web ports. Only rootless Docker is
# affected, so a rootful install is skipped rather than nagged about.
if [ "$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || echo 1024)" -gt 80 ] 2>/dev/null; then
  IS_ROOTLESS=0
  if docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -qi rootless; then
    IS_ROOTLESS=1
  fi
  if [ "$IS_ROOTLESS" -eq 1 ]; then
    die "This is a rootless Docker install, and it can't bind port 80 - nginx would fail to start.
  Fix it now (this applies immediately, no reboot needed):

    echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
    sudo sysctl -p

  Then re-run this script. It is safe to run those commands even if this
  turns out not to be your problem - see DEPLOYMENT.md Part 5."
  fi
fi

# ---------------------------------------------------------------------------
# 2. Create .env.production if it doesn't exist yet
# ---------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  log "$ENV_FILE already exists - leaving it as-is (delete it first if you want this script to regenerate it)."
  grep -q '^INITIAL_ADMIN_EMAIL=' "$ENV_FILE" && ADMIN_EMAIL="$(grep '^INITIAL_ADMIN_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [ -z "$ADMIN_PASSWORD" ] && grep -q '^INITIAL_ADMIN_PASSWORD=' "$ENV_FILE"; then
    ADMIN_PASSWORD="$(grep '^INITIAL_ADMIN_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
    PASSWORD_SOURCE="existing"
  fi
else
  [ -n "$DOMAIN" ] || die "No $ENV_FILE yet - pass --domain=<your-domain-or-server-ip> the first time you run this. See --help."

  log "Creating $ENV_FILE from $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # HTTPS needs a real domain pointed at this box *before* it can work (see
  # DEPLOYMENT.md Part 13); setup.sh does not obtain a certificate, so until
  # you run through Part 13 the bundled nginx only ever listens on 80. So
  # http:// is correct for a bare IP *and* for localhost - the two cases where
  # no certificate can exist yet. Treating "localhost" as a domain handed the
  # browser an https:// URL for a port with no TLS listener, so every API call
  # failed at the transport layer before it ever reached nginx.
  # The scheme baked into NEXT_PUBLIC_API_URL / CAREGIVER_WEB_URL /
  # PUBLIC_WEB_URL and the CORS origin. It has to match what is actually
  # listening, or the browser ends up talking https to a port with no TLS
  # listener and every request fails at the transport layer before it ever
  # reaches nginx. `--skip-tls` is a real https/http decision here, not just
  # a "don't get a certificate yet" hint - the certbot step further down
  # only runs when a certificate is actually obtained, so https URLs with
  # --skip-tls would point at nothing.
  case "$DOMAIN" in
    localhost)
      SCHEME="http"
      warn "Using localhost - the site will be HTTP-only. Get a domain and see DEPLOYMENT.md Part 13 for HTTPS."
      ;;
    *)
      if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        SCHEME="http"
        warn "Using an IP address ($DOMAIN) - the site will be HTTP-only. Get a domain and see DEPLOYMENT.md Part 13 for HTTPS."
      elif [ "$SKIP_TLS" -eq 1 ]; then
        SCHEME="http"
        warn "--skip-tls was given, so URLs will use http://. Re-run without it to switch the site to HTTPS."
      else
        SCHEME="https"
      fi
      ;;
  esac

  sed -i \
    -e "s#DOMAIN=yourdomain.example#DOMAIN=${DOMAIN}#" \
    -e "s#https://yourdomain.example#${SCHEME}://${DOMAIN}#g" \
    -e "s#yourdomain.example#${DOMAIN}#g" \
    "$ENV_FILE"

  log "Generating random secrets (MySQL passwords, JWT signing keys, settings encryption key)"
  # The MySQL passwords are hex, not base64: they get interpolated straight
  # into the mysql:// DATABASE_URL in docker-compose.prod.yml, and base64's
  # alphabet ('/', '+', '=') is not URL-safe - a '/' truncates the authority
  # and the whole connection string fails to parse. hex is URL-safe by
  # construction and still carries the full 256 bits of entropy.
  MYSQL_PASSWORD="$(openssl rand -hex 32)"
  MYSQL_ROOT_PASSWORD="$(openssl rand -hex 32)"
  JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
  JWT_REFRESH_SECRET="$(openssl rand -base64 48)"
  SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 48)"
  sed -i \
    -e "s#^MYSQL_PASSWORD=.*#MYSQL_PASSWORD=${MYSQL_PASSWORD}#" \
    -e "s#^MYSQL_ROOT_PASSWORD=.*#MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}#" \
    -e "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}#" \
    -e "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}#" \
    -e "s#^SETTINGS_ENCRYPTION_KEY=.*#SETTINGS_ENCRYPTION_KEY=${SETTINGS_ENCRYPTION_KEY}#" \
    "$ENV_FILE"

  chmod 600 "$ENV_FILE"
fi

# Fail loudly on anything still left as a placeholder or blank, same check
# DEPLOYMENT.md Part 8.3 has you do by eye. Comment lines (like the one in
# .env.production.example that explains what to replace) don't count.
if grep -v '^\s*#' "$ENV_FILE" | grep -qE '(yourdomain\.example|^(MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=$)'; then
  die "$ENV_FILE still has placeholder or blank values - open it and fill in every line (see DEPLOYMENT.md Part 8), then re-run."
fi

# Email isn't configured here any more: an admin sets up the mail server in
# the app, under Settings > Email (DEPLOYMENT.md Part 8.4). SMTP_* in the env
# file still work, but only to pre-fill that screen on the very first start.

# ---------------------------------------------------------------------------
# 3. Work out the initial admin's email/password (persisted into
#    .env.production so a re-run doesn't lose track of them - but never
#    passed to the long-running api container's own environment, only to
#    the one-off seed step in part 6 below).
# ---------------------------------------------------------------------------
ENV_DOMAIN="$(grep '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$ADMIN_EMAIL" ]; then
  # The admin address has to satisfy the API's @IsEmail() check, so any
  # domain without a dot in it is unusable - LoginDto rejects it at
  # validation, before the password is even compared, and the login page
  # reports that as a generic "Incorrect email or password". localhost and
  # bare IPs therefore get the same placeholder address rather than
  # admin@${DOMAIN}.
  case "$ENV_DOMAIN" in
    ""|localhost)                 ADMIN_EMAIL="admin@care-platform.local" ;;
    *)
      if [[ "$ENV_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        ADMIN_EMAIL="admin@care-platform.local"
      else
        ADMIN_EMAIL="admin@${ENV_DOMAIN}"
      fi
      ;;
  esac
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  # Hex, not base64: this one is typed by a human into the login form, and
  # base64's '/' '+' '=' are easy to mistype when copying it out of the env
  # file. Same 144 bits of entropy, nothing to transcribe wrong.
  ADMIN_PASSWORD="$(openssl rand -hex 18)"
  PASSWORD_SOURCE="generated"
fi
grep -q '^INITIAL_ADMIN_EMAIL=' "$ENV_FILE" || echo "INITIAL_ADMIN_EMAIL=${ADMIN_EMAIL}" >> "$ENV_FILE"
grep -q '^INITIAL_ADMIN_PASSWORD=' "$ENV_FILE" || echo "INITIAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> "$ENV_FILE"
grep -q '^INITIAL_ADMIN_NAME=' "$ENV_FILE" || echo "INITIAL_ADMIN_NAME=${ADMIN_NAME}" >> "$ENV_FILE"

# MySQL's performance_schema costs ~250 MB of RAM for diagnostics this app
# never reads. Switched off on small servers only, and only if the operator
# hasn't chosen a value themselves - an explicit line in the env file wins.
if [ "$LOW_MEMORY" -eq 1 ] && ! grep -q '^MYSQL_PERFORMANCE_SCHEMA=' "$ENV_FILE"; then
  echo "MYSQL_PERFORMANCE_SCHEMA=OFF" >> "$ENV_FILE"
fi

# ---------------------------------------------------------------------------
# 3b. Decide whether HTTPS is possible at all.
#
# Let's Encrypt's HTTP-01 challenge validates a *hostname* by fetching
# http://<domain>/.well-known/... from the public internet, so it cannot
# work for a bare IP or for localhost - there is no name to validate and
# no public DNS to point at this box. Those cases deploy HTTP-only, which
# is also why the SCHEME logic above chose http:// for them.
#
# A real domain is necessary but not sufficient: the A record also has to
# resolve here already. That is checked for real in the TLS step below,
# which fails with a clear message rather than silently serving HTTP.
# ---------------------------------------------------------------------------
TLS_PLANNED=0
if [ "$SKIP_TLS" -eq 1 ]; then
  log "Skipping HTTPS (--skip-tls) - deploying over plain HTTP"
  warn "The site will be http:// and browsers will show 'Not Secure'. Re-run without --skip-tls once you want HTTPS."
elif [ -z "$ENV_DOMAIN" ] || [ "$ENV_DOMAIN" = "localhost" ]; then
  warn "No real domain set - skipping HTTPS. A certificate can't be issued for localhost or a bare IP; point a domain at this server and re-run."
elif [[ "$ENV_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  warn "DOMAIN is a bare IP ($ENV_DOMAIN) - skipping HTTPS. Let's Encrypt validates domain names, not IP addresses. Point a domain at this server and re-run."
else
  TLS_PLANNED=1
  # A real contact address is how Let's Encrypt tells you a renewal
  # failed, and the expiring soon email is the main way you find out
  # renewal is broken at all. Fall back to the admin address when it
  # looks real, so --tls-email is optional in the common case.
  if [ -z "$TLS_EMAIL" ]; then
    case "$ADMIN_EMAIL" in
      *@*.*) TLS_EMAIL="$ADMIN_EMAIL" ;;
      *)     TLS_EMAIL="admin@${ENV_DOMAIN}" ;;
    esac
  fi
  case "$TLS_EMAIL" in
    *@*.*) : ;;
    *) die "--tls-email='$TLS_EMAIL' doesn't look like an email address. Let's Encrypt needs one to warn you about failed renewals." ;;
  esac
fi

# ---------------------------------------------------------------------------
# 3c. Name this release's images after the commit (see deploy/lib.sh), and
#     remember the one before it so its images survive for a rollback.
# ---------------------------------------------------------------------------
PROJECT="$(cl_project_name)"
PREV_IMAGE_TAG="$(cl_env_get IMAGE_TAG)"
PREV_COMMIT="$(cl_state_get DEPLOYED_COMMIT)"
IMAGE_TAG="$(cl_image_tag)"
cl_env_set IMAGE_PREFIX "$PROJECT"
cl_env_set IMAGE_TAG "$IMAGE_TAG"
[ "$PREV_IMAGE_TAG" = "$IMAGE_TAG" ] && PREV_IMAGE_TAG="$(cl_state_get PREVIOUS_IMAGE_TAG)"

# A run that fails half way (most often the build) still tidies up after
# itself - otherwise every failed retry left another set of layers behind,
# which is how repeated runs filled the disk. The successful path does the
# full cleanup at the end instead.
on_exit() {
  local rc=$?
  [ -n "${DRYRUN_LOG:-}" ] && rm -f "$DRYRUN_LOG"
  if [ "$rc" -ne 0 ] && [ "$CLEANUP" -eq 1 ]; then
    echo
    warn "setup.sh stopped with an error - removing leftovers from this run so a retry has room."
    docker image prune -f >/dev/null 2>&1 || true
    cl_prune_build_cache $(( BUILD_CACHE_GB * 1024 ))
  fi
}
trap on_exit EXIT

log "About to build and start CareLink using $ENV_FILE"
echo "  Domain:      ${ENV_DOMAIN:-<not set>}"
echo "  Admin email: ${ADMIN_EMAIL}"
if [ "$TLS_PLANNED" -eq 1 ]; then
  echo "  HTTPS:       yes - a Let's Encrypt certificate will be requested for"
  echo "               ${ENV_DOMAIN} (expiry notices to ${TLS_EMAIL})"
else
  echo "  HTTPS:       no - this deployment will be HTTP-only"
fi
echo "  Release:     ${IMAGE_TAG}${PREV_IMAGE_TAG:+ (previous: ${PREV_IMAGE_TAG}, kept for rollback)}"
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted."
fi

# ---------------------------------------------------------------------------
# 4. Build the images (DEPLOYMENT.md Part 9) - slow the first time.
# ---------------------------------------------------------------------------
# Three node images plus build cache need roughly 6 GB; a full disk shows up
# as a confusing "no space left on device" deep inside an npm install. If it
# is short, clear what a previous run left first instead of only warning.
cl_make_room 6144 "$IMAGE_TAG" "$PREV_IMAGE_TAG"

cl_detect_memory
if [ "$CL_LOW_MEMORY" -eq 1 ]; then
  # One image at a time (see 1b and deploy/lib.sh): three builds side by side
  # need ~4 GB, one at a time fits in RAM + swap. Slower, but it finishes. The
  # heap limit lets Node use that swap instead of aborting at its RAM-based default.
  log "Building images one at a time on this ${CL_MEM_MB} MB server (allow 15-30 minutes the first time)"
else
  log "Building images (this can take 5-15 minutes the first time)"
fi
cl_build "${CL_BUILT_SERVICES[@]}"
# Old images are NOT pruned here: the running containers still use them, so
# a prune at this point skips them (this is what used to leave every
# release's images behind). Cleanup runs at the end, after recreating.

# `compose build` only refreshes the image; it does not recreate containers
# that are already running. `up -d` then sees the same container and leaves
# it alone, so a re-run after a code change silently keeps serving the OLD
# build - which is how a server ended up serving a landing page that no
# longer existed in the source, with /find 404ing. Recreating unconditionally
# makes a re-run actually deploy what was just built. nginx is included
# deliberately: its config is bind-mounted, so the container must restart to
# pick up changes even though the image is unchanged.
log "Recreating containers so the new build is actually used"
compose up -d --force-recreate

# ---------------------------------------------------------------------------
# 5b. Make the document storage volume writable by the API's runtime user.
#
# The api image ships /storage/caregiver-documents already owned by its
# `app` user (see apps/api/Dockerfile), and an *empty* named volume inherits
# that ownership. But Docker only copies the image's ownership into a volume
# the first time it's created. A volume carried over from an earlier deploy -
# or one created before that Dockerfile fix shipped - stays root:root, and
# since the API deliberately runs as non-root (USER app), every upload then
# fails with "EACCES: permission denied, mkdir" and a 500.
#
# Fixing it here rather than only in the Dockerfile means an existing
# deployment heals on re-run, instead of needing the volume deleted by hand
# (which would throw away every caregiver document already stored).
# ---------------------------------------------------------------------------
log "Ensuring document storage is writable by the API"
API_CID="$(compose ps -q api)"
if [ -z "$API_CID" ]; then
  warn "Couldn't find the api container to fix storage permissions on - skipping."
else
  # Ask the container where its storage root is, rather than reading
  # STORAGE_LOCAL_ROOT from the env file or hardcoding a path - compose
  # hardcodes that variable, so it isn't in $ENV_FILE to be read, and this
  # stays correct if the path is ever changed there.
  STORAGE_ROOT="$(docker exec "$API_CID" sh -c 'printf %s "${STORAGE_LOCAL_ROOT:-/storage/caregiver-documents}"' 2>/dev/null || echo '')"
  STORAGE_ROOT="${STORAGE_ROOT:-/storage/caregiver-documents}"
  # Resolve the uid/gid the api actually runs as inside this image, rather
  # than hardcoding 100/101 - those are only the values adduser picks in the
  # current Dockerfile and would silently drift.
  API_USER="$(docker exec "$API_CID" id -u 2>/dev/null || echo '')"
  API_GROUP="$(docker exec "$API_CID" id -g 2>/dev/null || echo '')"
  if [ -n "$API_USER" ] && [ -n "$API_GROUP" ]; then
    # `|| true`: already-correct ownership makes chown a no-op that still
    # exits 0, but a read-only or missing path shouldn't abort the deploy.
    docker exec -u 0 "$API_CID" sh -c "mkdir -p '$STORAGE_ROOT' && chown -R ${API_USER}:${API_GROUP} '$STORAGE_ROOT'" >/dev/null 2>&1 || true
    if docker exec "$API_CID" sh -c "test -w '$STORAGE_ROOT'" >/dev/null 2>&1; then
      echo "  $STORAGE_ROOT writable by uid $API_USER."
    else
      warn "The api user still can't write to $STORAGE_ROOT - document uploads will fail until this is fixed."
    fi
  fi
fi

log "Waiting for mysql and api to be healthy/running"
ATTEMPTS=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q mysql)" 2>/dev/null)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  # 60 x 5s: first-time initialisation of MySQL 8 on a burstable 1-2 GB
  # instance can take several minutes.
  [ "$ATTEMPTS" -ge 60 ] && die "mysql never became healthy - run 'docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs mysql' and see DEPLOYMENT.md Part 17."
  sleep 5
done
ATTEMPTS=0
until [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q api)" 2>/dev/null)" = "true" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "$ATTEMPTS" -ge 30 ] && die "api never started - run 'docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs api' and see DEPLOYMENT.md Part 17."
  sleep 5
done

# ---------------------------------------------------------------------------
# 5c. HTTPS / TLS (Part 13).
#
# The ordering here is forced, and it is the part that is easy to get
# wrong by hand:
#
#   1. nginx is already running (from step 4) on plain HTTP, serving the
#      ACME challenge path out of the shared certbot-webroot volume.
#   2. certbot writes a challenge file into that volume and asks Let's
#      Encrypt to fetch it over http://<domain>/.well-known/... - which
#      only works if this machine's port 80 is reachable from the internet.
#   3. only THEN do we render the TLS config and restart nginx onto it.
#
# It cannot be done the other way round: nginx.https.conf names the
# certificate in `ssl_certificate`, and nginx refuses to start at all if
# that file is missing. So a deploy that started nginx on the HTTPS config
# before the certificate existed would just fail to come up. That is why
# the committed default is the certificate-free deploy/nginx.conf.
#
# A failure here is NOT fatal. The stack is already up and serving over
# HTTP at this point, so the worst case is a site without a padlock -
# strictly better than a script that aborts a working deployment. The
# failure is reported loudly with the reason, and re-running after fixing
# DNS picks up where this left off.
# ---------------------------------------------------------------------------
obtain_certificate() {
  log "Requesting an HTTPS certificate from Let's Encrypt for ${ENV_DOMAIN}"

  # An existing certificate must never be re-requested: Let's Encrypt
  # rate-limits duplicate certificates per domain (a handful per week), so
  # a re-run that re-issued every time would eventually lock the operator
  # out of their own domain for days. certbot itself is idempotent and
  # would keep what it has, but checking first means a re-run doesn't even
  # touch the API.
  if compose run --rm --entrypoint sh certbot -c \
       "test -s /etc/letsencrypt/live/${ENV_DOMAIN}/fullchain.pem" >/dev/null 2>&1; then
    echo "  A certificate for ${ENV_DOMAIN} already exists - keeping it."
    return 0
  fi

  # Confirm the domain actually points here before asking Let's Encrypt,
  # so the common "I haven't set up DNS yet" case produces an explanation
  # rather than a CA-side validation error. This is a best-effort check:
  # if dig is missing, or the answer is a stale/odd resolver response, we
  # still try - certbot is the real authority and its error is clearer.
  if command -v dig >/dev/null 2>&1; then
    RESOLVED="$(dig +short "$ENV_DOMAIN" 2>/dev/null | tail -1 || true)"
    PUBLIC_IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
    if [ -n "$RESOLVED" ] && [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
      warn "${ENV_DOMAIN} resolves to ${RESOLVED}, but this server's public IP is ${PUBLIC_IP}."
      warn "Let's Encrypt will fail until the DNS A record points here (DEPLOYMENT.md Part 7). Not requesting a certificate."
      return 1
    fi
  fi

  # --dry-run first is not possible for a first issuance (there is nothing
  # to renew), so this goes straight to Let's Encrypt's production API.
  # --non-interactive keeps certbot from waiting on a prompt that would
  # hang the script on a server with no terminal attached.
  if compose run --rm certbot certonly \
       --webroot -w /var/www/certbot \
       -d "$ENV_DOMAIN" \
       --email "$TLS_EMAIL" \
       --agree-tos --no-eff-email \
       --non-interactive; then
    echo "  Certificate issued."
    return 0
  fi

  warn "Let's Encrypt refused or could not validate the request."
  warn "Most common causes, in order:"
  warn "  - the A record for ${ENV_DOMAIN} does not point at this server yet (Part 7)"
  warn "  - port 80 is blocked by a firewall or cloud security group (Part 6)"
  warn "  - you have hit Let's Encrypt's duplicate-certificate rate limit"
  warn "The site is still running over HTTP. Fix the above and re-run this script;"
  warn "it will pick up where it left off and won't re-request on success."
  return 1
}

if [ "$TLS_PLANNED" -eq 1 ]; then
  if obtain_certificate; then
    TLS_ENABLED=1
  fi
fi

if [ "$TLS_ENABLED" -eq 1 ]; then
  log "Switching nginx onto the HTTPS config"
  [ -f "$NGINX_HTTPS_TEMPLATE" ] || die "$NGINX_HTTPS_TEMPLATE is missing - can't render the TLS config."

  # Render into a generated file rather than editing the committed template,
  # so the repo stays free of any one deployment's domain and a re-run or a
  # second domain is just another render. __DOMAIN__ is the only thing that
  # changes between deployments.
  sed "s#__DOMAIN__#${ENV_DOMAIN}#g" "$NGINX_HTTPS_TEMPLATE" > "$NGINX_LOCAL_CONF"

  # Point compose at the rendered config. Recorded in .env.production rather
  # than passed on the command line so that EVERY later compose invocation
  # - including the deploy hook that runs from cron with none of this
  # script's environment - keeps serving the same config. Without this, a
  # renewal-triggered reload would silently fall back to the HTTP config.
  if grep -q '^NGINX_CONF=' "$ENV_FILE"; then
    sed -i "s#^NGINX_CONF=.*#NGINX_CONF=./${NGINX_LOCAL_CONF}#" "$ENV_FILE"
  else
    echo "NGINX_CONF=./${NGINX_LOCAL_CONF}" >> "$ENV_FILE"
  fi

  # Recreate just nginx so it picks up the new config and the now-published
  # 443 mapping. The other services keep running, so this is a sub-second
  # blip rather than a full outage.
  compose up -d --force-recreate --no-deps nginx

  # Confirm nginx actually came up on the new config. It is supposed to -
  # the certificate exists by this point - but a failure here is worth
  # catching now rather than leaving a container restart-looping silently.
  ATTEMPTS=0
  until [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q nginx)" 2>/dev/null)" = "true" ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge 15 ]; then
      warn "nginx isn't running after switching to the HTTPS config."
      warn "Check 'docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs nginx' - the usual cause is a"
      warn "certificate that expired or was issued for a different domain. The site is still reachable over HTTP."
      break
    fi
    sleep 2
  done
  [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q nginx)" 2>/dev/null)" = "true" ] \
    && echo "  nginx is serving https://${ENV_DOMAIN}"

  log "Testing that automatic renewal works before it's needed"
  # --dry-run exercises the whole renewal path against Let's Encrypt's
  # staging server. It is the only way to know renewal works BEFORE the
  # 30-day window when a broken renewal turns into an expired certificate.
  # Failure is not fatal (the cert is valid for 90 days) but must be loud.
  #
  # Two things this must do, both learned the hard way:
  #
  #  - Pass --non-interactive. Without it certbot may stop and wait for
  #    input, and with no terminal attached to a script that wait is
  #    forever. That is what hung an earlier version of this step.
  #  - Put a timeout on it. The staging CA is a separate, often-slower
  #    endpoint; if the host can't reach it the call blocks on connect
  #    rather than failing, and a deploy script should never block on it.
  #
  # The reload step is deliberately NOT part of this test or of the renew
  # command. Doing it from inside the certbot container cannot work -
  # there is no docker CLI in that image and no socket mounted, so a hook
  # that shells out to `docker compose` dies with "docker: not found" (127).
  # The reload is chained onto the host side of the cron command instead,
  # where docker genuinely exists.
  DRYRUN_CMD=(compose run --rm certbot renew --dry-run --non-interactive)
  # A command the operator can actually paste into their own shell. This has
  # to be spelled out in full: `compose` is a shell function defined in this
  # script, so printing "${DRYRUN_CMD[*]}" would hand back something that
  # does not exist outside it - and without the -f/--env-file flags it would
  # default to the DEV compose file, which has no certbot service at all and
  # fails with a misleading "no such service: certbot".
  DRYRUN_PRINT="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} run --rm certbot renew --dry-run --non-interactive"

  # Keep the output. Sending it to /dev/null means a failure here is
  # undiagnosable without re-running the command by hand, which is exactly
  # the round trip this is meant to avoid.
  # Removed by on_exit (step 3c), which owns the EXIT trap.
  DRYRUN_LOG="$(mktemp)"

  if ! command -v timeout >/dev/null 2>&1; then
    warn "'timeout' isn't available, so the renewal self-test was skipped rather than risk hanging."
    warn "Test it yourself: $DRYRUN_PRINT"
  elif timeout 600 "${DRYRUN_CMD[@]}" >"$DRYRUN_LOG" 2>&1; then
    echo "  Renewal test passed."
  else
    DRYRUN_RC=$?
    if [ "$DRYRUN_RC" -eq 124 ]; then
      warn "The renewal self-test timed out after 10 minutes."
      warn "This host could not reach Let's Encrypt's staging server - check outbound HTTPS (port 443)."
    else
      warn "The renewal self-test failed. Your certificate is valid and in use, but automatic renewal may not work."
    fi
    warn "Here is what certbot reported:"
    # The tail, not the whole thing: certbot is verbose, and the actionable
    # error is at the end. 2>/dev/null because the progress spinner rewrites
    # its line and would otherwise appear as a wall of control characters.
    tail -n 15 "$DRYRUN_LOG" 2>/dev/null | sed 's/^/    /' >&2
    warn "To re-run it yourself: $DRYRUN_PRINT"
    warn "See DEPLOYMENT.md Part 17.11."
  fi

  log "Installing the automatic renewal timer"
  # Twice a day. Let's Encrypt only renews inside the last 30 days of a
  # 90-day certificate, so this leaves a very wide margin for a transient
  # failure to be retried. Installed via `crontab -l` rather than by
  # writing /etc/cron.d so this needs no root and doesn't touch a
  # system-wide file.
  #
  # The nginx reload is chained here, on the HOST, rather than run as a
  # certbot hook inside the container. `renew` exits 0 whether or not it
  # actually renewed anything, and `nginx -s reload` is a graceful reload
  # that re-reads the certificate and drops no connections - so running it
  # on the many no-op runs costs nothing and removes any need to detect
  # whether a renewal happened.
  RENEW_CMD="cd ${SCRIPT_DIR} && docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} run --rm certbot renew --quiet --non-interactive && docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} exec -T nginx nginx -s reload"
  # cron runs with a minimal environment and no cwd, so the command has to
  # be absolute about where it runs from - a bare `docker compose` there
  # would not find the compose file or the env file and would fail on the
  # required variables.
  CRON_LINE="17 3,15 * * * ${RENEW_CMD}"
  # `crontab -l` exits non-zero when the user has no crontab at all, which
  # is the normal first-run case - hence the `|| true` and empty default.
  CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$CURRENT_CRONTAB" | grep -qF "certbot renew"; then
    # An entry from a previous run exists. Its command is stale if this run
    # generated a different one (the reload was added later, --non-interactive
    # was added later), so it is replaced rather than left in place - but
    # only if the only thing it does is this renewal, since the crontab is
    # the user's and may hold unrelated jobs.
    if printf '%s\n' "$CURRENT_CRONTAB" | grep -F "$RENEW_CMD" >/dev/null; then
      echo "  Renewal timer already installed and up to date - leaving it alone."
    elif printf '%s\n' "$CURRENT_CRONTAB" | grep -v "certbot renew" | grep -qvE '^\s*(#|$)'; then
      warn "Found an older certificate-renewal entry in your crontab but also unrelated jobs, so it"
      warn "was left alone rather than overwritten. Update it by hand to reload nginx as well:"
      warn "  $CRON_LINE"
    else
      printf '%s\n' "$CURRENT_CRONTAB" | grep -v "certbot renew" | crontab - 2>/dev/null || true
      printf '%s\n' "$CRON_LINE" | crontab - 2>/dev/null \
        && echo "  Replaced the old renewal entry (it did not reload nginx)." \
        || warn "Couldn't update the renewal entry. Set it by hand: $CRON_LINE"
    fi
  else
    # Append rather than replace: the user's crontab is not ours to
    # overwrite, and it may already hold unrelated jobs. The write is done
    # to a temp file and only installed if it succeeds, so a failure here
    # can't leave a truncated crontab behind.
    NEW_CRONTAB="$(printf '%s\n%s\n' "$CURRENT_CRONTAB" "$CRON_LINE" | grep -v '^[[:space:]]*$')"
    if printf '%s\n' "$NEW_CRONTAB" | crontab - 2>/dev/null; then
      # Off-the-hour minute is deliberate: many crontabs fire at :00, and
      # Let's Encrypt's rate limiter is shared across unrelated deployments.
      echo "  Installed: renewal checked twice daily (03:17 and 15:17), with nginx reloaded after each."
    else
      warn "Couldn't install a cron entry (no crontab for this user). The certificate will NOT renew automatically."
      warn "Add this to your crontab, or run it by hand before the certificate expires:"
      warn "  $CRON_LINE"
    fi
  fi
else
  log "Skipping the HTTPS setup - the site will be served over plain HTTP"
fi

# ---------------------------------------------------------------------------
# 6. Migrations + seed (Part 11) - both are safe to run every time.
# ---------------------------------------------------------------------------
log "Running database migrations"
compose exec -T -w /app/apps/api api node dist/src/database/migrate.js

log "Seeding reference data (skills/languages/locations) and the initial admin"
compose exec -T -w /app/apps/api \
  -e INITIAL_ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e INITIAL_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e INITIAL_ADMIN_NAME="$ADMIN_NAME" \
  api node dist/src/database/seed-production.js

# The release is up: record it, so update.sh knows what is deployed and what to roll back to.
cl_state_save "$(git rev-parse HEAD 2>/dev/null || echo unknown)" "$IMAGE_TAG" "${PREV_COMMIT:-}" "${PREV_IMAGE_TAG:-}"

# ---------------------------------------------------------------------------
# 6b. Clean up (see deploy/lib.sh for why each of these used to pile up):
#     old images except this release and the previous one, the build cache
#     past its budget, stray anonymous volumes and stopped one-off containers.
# ---------------------------------------------------------------------------
if [ "$CLEANUP" -eq 1 ]; then
  log "Cleaning up old images and build cache"
  cl_cleanup $(( BUILD_CACHE_GB * 1024 )) "$IMAGE_TAG" "$PREV_IMAGE_TAG"
else
  log "Skipping cleanup (--no-cleanup) - see 'docker system df' for what is using the disk"
fi

# ---------------------------------------------------------------------------
# 7. Verify (Part 12) - best-effort; DNS/firewall issues are separate from
#    whether the deploy itself worked, so this warns rather than fails.
# ---------------------------------------------------------------------------
log "Checking the site responds"
# Check the scheme that is actually being served, which is not always the
# one that was requested: a certificate can fail to issue (see step 5c) and
# leave the site on HTTP even though the env file says https. Reporting
# "https responded OK" when only http is listening would be a lie that
# sends the operator off to debug the wrong thing.
if [ "$TLS_ENABLED" -eq 1 ]; then
  LIVE_SCHEME="https"
else
  LIVE_SCHEME="http"
fi
CHECK_URL="${LIVE_SCHEME}://${ENV_DOMAIN:-localhost}/"
if command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null --max-time 10 "$CHECK_URL"; then
  echo "  $CHECK_URL responded OK."
else
  warn "Couldn't confirm $CHECK_URL responds yet - this is often just DNS/firewall (Part 6-7), not this script. Check manually once those are in place."
fi

log "Done."
echo "  Visit: ${LIVE_SCHEME}://${ENV_DOMAIN:-<your-domain-or-server-ip>}/"
echo "  Staff login: ${LIVE_SCHEME}://${ENV_DOMAIN:-<your-domain-or-server-ip>}/staff/login"
echo "  Admin email:    ${ADMIN_EMAIL}"
case "$PASSWORD_SOURCE" in
  generated) echo "  Admin password: ${ADMIN_PASSWORD}   (generated just now - shown once, also saved in $ENV_FILE)" ;;
  # Note: on a RE-RUN this line prints the password from $ENV_FILE, but the
  # seed only applies it when no admin exists yet (seed-production.ts checks
  # for an existing ADMIN and leaves it alone). Once the password has been
  # changed in-app it no longer matches the stored hash, so re-running this
  # script will NOT reset it - a 401 here means the DB password differs from
  # the one printed, not that the deploy is broken.
  flag)      echo "  Admin password: ${ADMIN_PASSWORD}   (the one you passed with --admin-password, also saved in $ENV_FILE)" ;;
  existing)  echo "  Admin password: ${ADMIN_PASSWORD}   (unchanged from a previous run of this script, saved in $ENV_FILE)" ;;
esac
echo
echo "  Log in and change that password immediately (top bar -> key icon)."
echo "  Then set up email under Settings > Email, or nobody receives their"
echo "  verification email (they are written to 'docker compose logs api' until then)."
if [ "$TLS_ENABLED" -eq 1 ]; then
  echo "  HTTPS is on and renews itself twice daily. Back up the certbot-conf"
  echo "  volume along with your database - see DEPLOYMENT.md Part 15."
else
  echo "  This deployment is HTTP-only, so browsers will show 'Not Secure'."
  if [ "$TLS_PLANNED" -eq 1 ]; then
    # TLS was wanted but didn't happen. Say exactly that, rather than the
    # generic "see Part 13", so it's obvious this is a failure to retry
    # and not a deliberate configuration.
    echo "  A certificate was NOT obtained (see the warnings above). Once the"
    echo "  cause is fixed, re-run this script - it will pick up where it left off."
  else
    echo "  To enable HTTPS later, point a domain at this server (Part 7) and"
    echo "  re-run this script without --skip-tls."
  fi
fi
echo "  For backups, see DEPLOYMENT.md Part 15."
echo "  To deploy new code later (or try a PR): ./update.sh - see DEPLOYMENT.md Part 16."
