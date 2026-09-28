#!/usr/bin/env bash
#
# setup.sh - automates Parts 8-12 of DEPLOYMENT.md (fill in secrets, build,
# start, migrate, seed, verify) for a fresh production deployment.
#
# What this script does NOT do for you, on purpose - these genuinely need
# a human decision and are covered in DEPLOYMENT.md:
#   - Part 1-7:  provisioning a server, DNS, firewall/security groups
#   - Part 13:   HTTPS/TLS (needs a real domain to be pointed at this
#                server *before* it will work)
#   - Part 15:   backups
#
# Usage:
#   ./setup.sh --domain=example.com
#   ./setup.sh --domain=203.0.113.10          # no domain yet, IP only (HTTP only, see Part 13)
#   ./setup.sh --domain=example.com --admin-email=me@example.com --admin-password='...'
#
# Safe to re-run: it won't overwrite an existing .env.production, and the
# build/start/migrate/seed steps are all idempotent (see DEPLOYMENT.md
# Part 16).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
ENV_EXAMPLE=".env.production.example"

DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
ADMIN_NAME="Platform Administrator"
ASSUME_YES=0
PASSWORD_SOURCE="generated"

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
command -v docker >/dev/null 2>&1 || die "Docker isn't installed - see DEPLOYMENT.md Part 4."
docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin isn't available - see DEPLOYMENT.md Part 4."
command -v openssl >/dev/null 2>&1 || die "openssl isn't installed (needed to generate secrets)."

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

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

  # A bare IP address gets http:// (no HTTPS without a real domain - see
  # DEPLOYMENT.md Part 13); anything else is treated as a domain and gets https://.
  if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SCHEME="http"
    warn "Using an IP address ($DOMAIN) - the site will be HTTP-only. Get a domain and see DEPLOYMENT.md Part 13 for HTTPS."
  else
    SCHEME="https"
  fi

  sed -i \
    -e "s#DOMAIN=yourdomain.example#DOMAIN=${DOMAIN}#" \
    -e "s#https://yourdomain.example#${SCHEME}://${DOMAIN}#g" \
    "$ENV_FILE"

  log "Generating random secrets (MySQL passwords, JWT signing keys)"
  MYSQL_PASSWORD="$(openssl rand -base64 32)"
  MYSQL_ROOT_PASSWORD="$(openssl rand -base64 32)"
  JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
  JWT_REFRESH_SECRET="$(openssl rand -base64 48)"
  sed -i \
    -e "s#^MYSQL_PASSWORD=.*#MYSQL_PASSWORD=${MYSQL_PASSWORD}#" \
    -e "s#^MYSQL_ROOT_PASSWORD=.*#MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}#" \
    -e "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}#" \
    -e "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}#" \
    "$ENV_FILE"

  chmod 600 "$ENV_FILE"
fi

# Fail loudly on anything still left as a placeholder or blank, same check
# DEPLOYMENT.md Part 8.3 has you do by eye. Comment lines (like the one in
# .env.production.example that explains what to replace) don't count.
if grep -v '^\s*#' "$ENV_FILE" | grep -qE '(yourdomain\.example|^(MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=$)'; then
  die "$ENV_FILE still has placeholder or blank values - open it and fill in every line (see DEPLOYMENT.md Part 8), then re-run."
fi

# ---------------------------------------------------------------------------
# 3. Work out the initial admin's email/password (persisted into
#    .env.production so a re-run doesn't lose track of them - but never
#    passed to the long-running api container's own environment, only to
#    the one-off seed step in part 6 below).
# ---------------------------------------------------------------------------
ENV_DOMAIN="$(grep '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$ADMIN_EMAIL" ]; then
  if [[ "$ENV_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [ -z "$ENV_DOMAIN" ]; then
    ADMIN_EMAIL="admin@care-platform.local"
  else
    ADMIN_EMAIL="admin@${ENV_DOMAIN}"
  fi
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18)"
  PASSWORD_SOURCE="generated"
fi
grep -q '^INITIAL_ADMIN_EMAIL=' "$ENV_FILE" || echo "INITIAL_ADMIN_EMAIL=${ADMIN_EMAIL}" >> "$ENV_FILE"
grep -q '^INITIAL_ADMIN_PASSWORD=' "$ENV_FILE" || echo "INITIAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> "$ENV_FILE"
grep -q '^INITIAL_ADMIN_NAME=' "$ENV_FILE" || echo "INITIAL_ADMIN_NAME=${ADMIN_NAME}" >> "$ENV_FILE"

log "About to build and start CareLink using $ENV_FILE"
echo "  Domain:      ${ENV_DOMAIN:-<not set>}"
echo "  Admin email: ${ADMIN_EMAIL}"
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted."
fi

# ---------------------------------------------------------------------------
# 4. Build the images (DEPLOYMENT.md Part 9) - slow the first time.
# ---------------------------------------------------------------------------
log "Building images (this can take 5-15 minutes the first time)"
compose build

# ---------------------------------------------------------------------------
# 5. Start everything (Part 10)
# ---------------------------------------------------------------------------
log "Starting all services"
compose up -d

log "Waiting for mysql and api to be healthy/running"
ATTEMPTS=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q mysql)" 2>/dev/null)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "$ATTEMPTS" -ge 30 ] && die "mysql never became healthy - run 'docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs mysql' and see DEPLOYMENT.md Part 17."
  sleep 5
done
ATTEMPTS=0
until [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q api)" 2>/dev/null)" = "true" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "$ATTEMPTS" -ge 30 ] && die "api never started - run 'docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs api' and see DEPLOYMENT.md Part 17."
  sleep 5
done

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

# ---------------------------------------------------------------------------
# 7. Verify (Part 12) - best-effort; DNS/firewall issues are separate from
#    whether the deploy itself worked, so this warns rather than fails.
# ---------------------------------------------------------------------------
log "Checking the site responds"
CHECK_URL="http://${ENV_DOMAIN:-localhost}/"
if command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null --max-time 10 "$CHECK_URL"; then
  echo "  $CHECK_URL responded OK."
else
  warn "Couldn't confirm $CHECK_URL responds yet - this is often just DNS/firewall (Part 6-7), not this script. Check manually once those are in place."
fi

log "Done."
echo "  Visit: http://${ENV_DOMAIN:-<your-domain-or-server-ip>}/"
echo "  Staff login: http://${ENV_DOMAIN:-<your-domain-or-server-ip>}/staff/login"
echo "  Admin email:    ${ADMIN_EMAIL}"
case "$PASSWORD_SOURCE" in
  generated) echo "  Admin password: ${ADMIN_PASSWORD}   (generated just now - shown once, also saved in $ENV_FILE)" ;;
  flag)      echo "  Admin password: ${ADMIN_PASSWORD}   (the one you passed with --admin-password, also saved in $ENV_FILE)" ;;
  existing)  echo "  Admin password: ${ADMIN_PASSWORD}   (unchanged from a previous run of this script, saved in $ENV_FILE)" ;;
esac
echo
echo "  Log in and change that password immediately (top bar -> key icon)."
echo "  For HTTPS, see DEPLOYMENT.md Part 13. For backups, see Part 15."
