#!/usr/bin/env bash
#
# uninstall.sh - tears down a CareLink deployment created by setup.sh.
#
# Two modes, and the difference is whether any data is destroyed:
#
#   ./uninstall.sh              Stop and remove the containers and network.
#                               KEEPS: data volumes (MySQL, caregiver
#                               documents), the TLS certificate, all Docker
#                               images, and .env.production. Re-running
#                               setup.sh afterwards brings the site straight
#                               back, with its data intact.
#
#   ./uninstall.sh --purge      Also destroys everything above, permanently
#                               and irreversibly: every volume, every
#                               image, the certificate, and the env file
#                               holding your secrets.
#
# A third mode keeps the deployment and wipes only what is in it:
#
#   ./uninstall.sh --factory-reset
#                               The site stays installed and running, but
#                               every client, caregiver, user, booking,
#                               invoice, payout, request, document and log
#                               is deleted, and the initial admin account is
#                               recreated from .env.production. Settings
#                               (branding, billing, email, WhatsApp, sign-in
#                               providers, AI, ads, analytics) and the skills
#                               and languages lists are KEPT unless
#                               --include-settings is given too. A backup of
#                               the database and documents is taken first.
#
# Safe to re-run: every mode is idempotent and reports what it finds.
#
# Usage:
#   ./uninstall.sh [--purge] [-y|--yes] [--dry-run]
#   ./uninstall.sh --factory-reset [--include-settings] [--no-backup] [-y] [--dry-run]
#
# Options:
#   -p, --purge        Delete data volumes, images, the certificate, and
#                      .env.production as well. Cannot be undone.
#   -r, --factory-reset
#                      Delete all application data but keep the deployment
#                      (containers, images, certificate, .env.production).
#   -s, --include-settings
#                      With --factory-reset: also reset every admin setting,
#                      the uploaded logo, and the skills/languages lists to
#                      their defaults.
#       --no-backup    With --factory-reset: skip the safety backup.
#   -y, --yes          Don't prompt for confirmation. Only meaningful
#                      together with --purge or --factory-reset; the default
#                      mode never prompts at all.
#   -n, --dry-run      Print what would be removed, change nothing.
#   -h, --help         Show this help.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
GENERATED_CONF="deploy/nginx.local.conf"

PURGE=0
ASSUME_YES=0
DRY_RUN=0
FACTORY_RESET=0
INCLUDE_SETTINGS=0
DO_BACKUP=1
BACKUP_DIR="backups"
STORAGE_ROOT="/storage/caregiver-documents"

usage() {
  cat <<EOF
Usage: $0 [--purge] [-y|--yes] [--dry-run]
       $0 --factory-reset [--include-settings] [--no-backup] [-y|--yes] [--dry-run]

Removes the CareLink deployment created by setup.sh.

  (no options)   Stop and remove containers + network. Data volumes, the
                 TLS certificate, Docker images and $ENV_FILE are all
                 KEPT, so setup.sh can recreate the site at any time.

  --purge        Also delete, permanently: all volumes (MySQL database and
                 every caregiver document ever uploaded), all Docker images,
                 the TLS certificate, $ENV_FILE, and the generated
                 $GENERATED_CONF. THIS CANNOT BE UNDONE.
  --factory-reset, -r
                 Keep the deployment running but delete all of its data:
                 clients, caregivers, users, bookings, invoices, payouts,
                 care requests, caregiver documents, audit logs, AI chats.
                 Locations are kept, and the initial admin account is
                 recreated from INITIAL_ADMIN_* in $ENV_FILE so you can sign
                 back in. A database + documents backup is written to
                 $BACKUP_DIR/ first.
  --include-settings, -s
                 With --factory-reset: also reset branding (name, colours,
                 logo, languages), billing, email, WhatsApp, sign-in
                 providers, AI, ads and analytics settings, and the skills
                 and languages lists, to their defaults.
  --no-backup    With --factory-reset: don't take the safety backup.

  -y, --yes       Skip the confirmation prompt (for --purge or
                 --factory-reset, when you have already decided).
  -n, --dry-run   Show what would be removed without removing anything.
  -h, --help      Show this help.

The automatic certificate-renewal cron entry is removed by both uninstall
modes (not by --factory-reset): it would otherwise keep firing against a
deployment that no longer exists.
EOF
}

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    -p|--purge)            PURGE=1 ;;
    -r|--factory-reset)    FACTORY_RESET=1 ;;
    -s|--include-settings) INCLUDE_SETTINGS=1 ;;
    --no-backup)           DO_BACKUP=0 ;;
    -y|--yes)              ASSUME_YES=1 ;;
    -n|--dry-run)          DRY_RUN=1 ;;
    -h|--help)             usage; exit 0 ;;
    *) die "Unknown option: $arg (see --help)" ;;
  esac
done

if [ "$PURGE" -eq 1 ] && [ "$FACTORY_RESET" -eq 1 ]; then
  die "--purge and --factory-reset are different operations - pick one."
fi
if [ "$FACTORY_RESET" -eq 0 ]; then
  [ "$INCLUDE_SETTINGS" -eq 1 ] && die "--include-settings only applies to --factory-reset."
  [ "$DO_BACKUP" -eq 0 ] && die "--no-backup only applies to --factory-reset."
fi

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
[ -f "$COMPOSE_FILE" ] || die "Run this from the repo root (couldn't find $COMPOSE_FILE here)."
command -v docker >/dev/null 2>&1 || die "Docker isn't installed - see DEPLOYMENT.md Part 4."
docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin isn't available - see DEPLOYMENT.md Part 4."
docker info >/dev/null 2>&1 || die "Can't talk to the Docker daemon (is it running, and is your user in the 'docker' group? See DEPLOYMENT.md 17.4)."

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# The compose project name is derived from the directory name, and it is
# the label docker puts on every container, volume and image belonging to
# this project. Deriving it the same way compose does - rather than
# hardcoding "care_link" - keeps this correct if the repo is checked out
# under another name, and, more importantly, keeps every sweep below
# scoped to THIS project so it can never touch another stack's data.
PROJECT="$(basename "$SCRIPT_DIR")"

# The domain, read only so the purge prompt can ask the operator to type it
# back. Never printed in full, never sent anywhere - it comes out of the
# env file with a single grep, not a cat of the whole file.
DOMAIN=""
if [ -f "$ENV_FILE" ]; then
  DOMAIN="$(grep '^DOMAIN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi

# ===========================================================================
# FACTORY RESET (--factory-reset)
#
# Unlike the two uninstall modes, this leaves the deployment exactly where it
# is - containers, images, certificate, .env.production, cron - and empties
# the application inside it. Everything below runs and then exits; the
# uninstall sections after it never execute in this mode.
#
# Tables are classified at run time from the live database rather than from
# a hardcoded list, so a table added by a future migration is covered
# without anyone remembering to edit this script:
#
#   reference  kept always, never reported: drizzle's migration journal
#              (__*) and the location hierarchy (provinces, districts,
#              cities). Wiping these would break the schema or every
#              address dropdown, and none of it is customer data.
#   settings   every *_settings singleton, plus skills and languages (the
#              admin-editable catalogues). Kept by default; emptied with
#              --include-settings, after which the API recreates each
#              settings row with its defaults on first use and the seed
#              restores the default skills and languages.
#   data       everything else: users, clients, patients, caregivers and
#              all their profile tables, bookings, invoices, payouts, care
#              requests, saved caregivers, documents, tokens, OTPs, audit
#              logs, AI conversations.
#
# A NEW REFERENCE TABLE (seeded, not customer data) must be added to the
# reference case in classify_table, or a factory reset will empty it.
# ===========================================================================
classify_table() {
  case "$1" in
    __*|provinces|districts|cities) echo reference ;;
    *_settings|skills|languages)    echo settings ;;
    *)                              echo data ;;
  esac
}

# SQL in on stdin, tab-separated rows out. MYSQL_PWD rather than -p keeps
# the root password off the process list and silences mysql's warning
# about it, without also swallowing real errors on stderr.
# shellcheck disable=SC2016  # expanded inside the container, on purpose
mysql_q() {
  compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE"'
}

# Set by factory_reset; read by its EXIT handler, so global on purpose.
RESET_FINISHED=0
db_backup=""
docs_backup=""

reset_on_exit() {
  [ "$RESET_FINISHED" -eq 1 ] && return
  warn "The factory reset did not finish. Restarting the site..."
  compose start api web public-web >/dev/null 2>&1 || true
  cl_reload_nginx
  if [ -n "$db_backup" ]; then
    warn "To put the data back exactly as it was, see DEPLOYMENT.md Part 16b.4 with:"
    warn "  $db_backup"
    warn "  $docs_backup"
  fi
}

factory_reset() {
  # Shared helpers (cl_lock, cl_wait_healthy, cl_reload_nginx, cl_env_get).
  # log/warn/die, COMPOSE_FILE and ENV_FILE are already defined, as lib.sh
  # expects.
  # shellcheck source=deploy/lib.sh
  . deploy/lib.sh

  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found - there is no deployment here to reset."

  # setup.sh / update.sh rebuild and migrate under the same lock; resetting
  # the database in the middle of a migration would be a mess.
  cl_lock

  local running
  running="$(compose ps --status running --services 2>/dev/null || true)"
  for svc in mysql api; do
    printf '%s\n' "$running" | grep -qx "$svc" \
      || die "The '$svc' container isn't running. A factory reset works on a live deployment - start it with ./setup.sh first."
  done

  # -------------------------------------------------------------------------
  # Who will be able to sign in afterwards. Checked BEFORE anything is
  # deleted: a reset that empties the users table and then can't create an
  # admin would lock everyone out of the site.
  # -------------------------------------------------------------------------
  local admin_email admin_password admin_name
  admin_email="$(cl_env_get INITIAL_ADMIN_EMAIL)"
  admin_password="$(cl_env_get INITIAL_ADMIN_PASSWORD)"
  admin_name="$(cl_env_get INITIAL_ADMIN_NAME)"
  if [ -z "$admin_email" ] || [ -z "$admin_password" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      warn "INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD aren't in $ENV_FILE - a real run will ask for them."
    elif [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
      die "INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set in $ENV_FILE so an admin can be recreated after the reset (or run without -y to be asked)."
    else
      log "No initial admin credentials in $ENV_FILE"
      info "All users are deleted by the reset, so a new admin account is needed."
      [ -n "$admin_email" ] || { printf '    Admin email: '; read -r admin_email; }
      while [ "${#admin_password}" -lt 8 ]; do
        printf '    Admin password (min 8 characters): '; read -rs admin_password; echo
      done
      [ -n "$admin_email" ] || die "An admin email is required."
    fi
  fi
  [ -n "$admin_password" ] && [ "${#admin_password}" -lt 8 ] && die "INITIAL_ADMIN_PASSWORD in $ENV_FILE is shorter than 8 characters - fix it first."

  # -------------------------------------------------------------------------
  # Inventory: every table, its class and its row count.
  # -------------------------------------------------------------------------
  local tables t cls
  tables="$(echo "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name;" | mysql_q)" \
    || die "Couldn't read the table list from MySQL."
  [ -n "$tables" ] || die "The database has no tables - has setup.sh run its migrations?"

  local wipe=() keep=() count_sql=""
  for t in $tables; do
    # Names go into SQL below; refuse anything that isn't a plain identifier.
    [[ "$t" =~ ^[A-Za-z0-9_]+$ ]] || die "Unexpected table name '$t' - refusing to continue."
    cls="$(classify_table "$t")"
    if [ "$cls" = data ] || { [ "$cls" = settings ] && [ "$INCLUDE_SETTINGS" -eq 1 ]; }; then
      wipe+=("$t")
    elif [ "$cls" = settings ]; then
      keep+=("$t")
    fi
    [ "$cls" = reference ] && continue
    count_sql+="${count_sql:+ UNION ALL }SELECT '$t', COUNT(*) FROM \`$t\`"
  done

  local counts
  counts="$(echo "${count_sql};" | mysql_q)" || die "Couldn't count rows."
  rows_of() { printf '%s\n' "$counts" | awk -F'\t' -v t="$1" '$1 == t { print $2 }'; }

  local file_scope="caregiver documents"
  [ "$INCLUDE_SETTINGS" -eq 1 ] && file_scope="caregiver documents and the uploaded logo"
  local find_keep=""
  [ "$INCLUDE_SETTINGS" -eq 1 ] || find_keep="! -name branding"
  local file_filter="" file_count
  [ "$INCLUDE_SETTINGS" -eq 1 ] || file_filter="! -path '$STORAGE_ROOT/branding/*'"
  file_count="$(compose exec -T api sh -c "find '$STORAGE_ROOT' -type f $file_filter 2>/dev/null | wc -l" | tr -d ' \r')" || file_count="?"

  log "Factory reset (project: ${PROJECT}${DOMAIN:+, $DOMAIN})"
  printf '\n  \033[1;31mWILL BE DELETED:\033[0m\n'
  local total=0 n
  for t in "${wipe[@]}"; do
    n="$(rows_of "$t")"; n="${n:-0}"; total=$((total + n))
    printf '    %-34s %8s rows\n' "$t" "$n"
  done
  printf '    %-34s %8s rows in total\n' "" "$total"
  printf '    files: %s (%s)\n' "$file_count" "$file_scope"

  printf '\n  \033[1;32mKEPT:\033[0m\n'
  info "  the deployment itself - containers, images, TLS certificate, $ENV_FILE"
  info "  locations (provinces, districts, cities)"
  if [ "${#keep[@]}" -gt 0 ]; then
    info "  settings: ${keep[*]}"
    info "  the uploaded logo"
    info "  (the invoice number sequence restarts at 1, since no invoices remain)"
  fi
  echo
  info "Afterwards the admin account ${admin_email:-<asked for>} is recreated, and everyone"
  info "else (including that admin's current sessions) is signed out."
  if [ "$DO_BACKUP" -eq 1 ]; then
    info "A backup of the database and documents is written to $BACKUP_DIR/ first."
  else
    printf '\n    \033[1;33mNo backup will be taken (--no-backup). There is no undo.\033[0m\n'
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run - nothing was changed."
    exit 0
  fi

  if [ "$ASSUME_YES" -ne 1 ]; then
    local confirm="${DOMAIN:-$PROJECT}"
    printf '\n    Type %s to confirm the factory reset: ' "$confirm"
    read -r reply
    [ "$reply" = "$confirm" ] || die "Did not match - nothing was changed."
  fi

  # -------------------------------------------------------------------------
  # 1. Backup, while the site is still fully up. Named factory-reset-* so
  #    update.sh's rotation of db-*.sql.gz never deletes it.
  # -------------------------------------------------------------------------
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  if [ "$DO_BACKUP" -eq 1 ]; then
    log "Backing up"
    mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
    db_backup="$BACKUP_DIR/factory-reset-${stamp}-db.sql.gz"
    docs_backup="$BACKUP_DIR/factory-reset-${stamp}-documents.tar.gz"
    # shellcheck disable=SC2016
    if compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' | gzip > "$db_backup" \
       && [ "$(gzip -cd "$db_backup" | head -c 1000 | wc -c)" -gt 0 ]; then
      chmod 600 "$db_backup"; info "$db_backup ($(du -h "$db_backup" | cut -f1))"
    else
      rm -f "$db_backup"
      die "The database backup failed, so nothing was changed. Fix that, or re-run with --no-backup if you have your own backup."
    fi
    if compose exec -T api tar czf - -C "$STORAGE_ROOT" . > "$docs_backup" && tar tzf "$docs_backup" >/dev/null 2>&1; then
      chmod 600 "$docs_backup"; info "$docs_backup ($(du -h "$docs_backup" | cut -f1))"
    else
      rm -f "$docs_backup"
      die "The documents backup failed, so nothing was changed (the database backup is in $db_backup)."
    fi
  fi

  # If anything below fails, the site must not be left half-stopped: bring
  # the apps back up and say where the backup is.
  trap reset_on_exit EXIT

  # -------------------------------------------------------------------------
  # 2. Stop the apps so nothing writes while tables are emptied (a booking
  #    created half way through would survive with its client gone). MySQL
  #    and nginx stay up; visitors get a 502 for the minute this takes.
  # -------------------------------------------------------------------------
  log "Stopping the apps"
  compose stop api web public-web >/dev/null

  # -------------------------------------------------------------------------
  # 3. Empty the tables. One session, so FOREIGN_KEY_CHECKS=0 covers every
  #    TRUNCATE and the order doesn't matter. TRUNCATE also resets
  #    AUTO_INCREMENT counters, which DELETE would not.
  # -------------------------------------------------------------------------
  log "Emptying ${#wipe[@]} tables"
  local sql="SET FOREIGN_KEY_CHECKS = 0;"
  for t in "${wipe[@]}"; do sql+=" TRUNCATE TABLE \`$t\`;"; done
  sql+=" SET FOREIGN_KEY_CHECKS = 1;"

  # Kept settings still name, in updated_by, users that no longer exist, and
  # billing still counts on from the last invoice. Neither column is a
  # foreign key, so fix them by hand - found by name, so this keeps working
  # as settings tables come and go.
  if [ "${#keep[@]}" -gt 0 ]; then
    local kept_list cols tbl col
    kept_list="$(printf "'%s'," "${keep[@]}")"; kept_list="${kept_list%,}"
    cols="$(echo "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${kept_list}) AND column_name IN ('updated_by', 'next_invoice_number');" | mysql_q)"
    while IFS=$'\t' read -r tbl col; do
      [ -n "$tbl" ] || continue
      case "$col" in
        updated_by)          sql+=" UPDATE \`$tbl\` SET updated_by = NULL;" ;;
        next_invoice_number) sql+=" UPDATE \`$tbl\` SET next_invoice_number = 1;" ;;
      esac
    done <<< "$cols"
  fi
  printf '%s\n' "$sql" | mysql_q >/dev/null
  info "done"

  # -------------------------------------------------------------------------
  # 4. Uploaded files. The api container is stopped, so a throwaway one
  #    mounts the same volume. Caregiver documents live under
  #    <caregiverId>/..., the logo under branding/.
  # -------------------------------------------------------------------------
  log "Deleting ${file_scope}"
  compose run --rm --no-deps -T --entrypoint sh api -c \
    "find '$STORAGE_ROOT' -mindepth 1 -maxdepth 1 $find_keep -exec rm -rf {} +" >/dev/null
  info "done"

  # -------------------------------------------------------------------------
  # 5. Bring the API back, then reseed: reference data (and, after
  #    --include-settings, the default skills and languages) plus the
  #    initial admin - seed-production creates one because none exists now.
  # -------------------------------------------------------------------------
  log "Starting the API and recreating the admin account"
  compose start api >/dev/null
  cl_wait_healthy api 180 || die "The API didn't come back up - check: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs api"
  compose exec -T -w /app/apps/api \
    -e INITIAL_ADMIN_EMAIL="$admin_email" \
    -e INITIAL_ADMIN_PASSWORD="$admin_password" \
    -e INITIAL_ADMIN_NAME="${admin_name:-Platform Administrator}" \
    api node dist/src/database/seed-production.js

  # The web apps cache branding for server rendering; a restart picks up
  # the reset (or kept) settings cleanly. nginx is reloaded because restarted
  # containers can come back on new addresses.
  log "Starting the web apps"
  compose start web public-web >/dev/null
  cl_reload_nginx

  RESET_FINISHED=1
  trap - EXIT

  log "Factory reset complete."
  cat <<EOF
  Deleted: ${total} rows across ${#wipe[@]} tables, and ${file_scope}.
  Sign in as: ${admin_email}  (password: INITIAL_ADMIN_PASSWORD in $ENV_FILE,
              or the one you just entered)
EOF
  if [ "$INCLUDE_SETTINGS" -eq 1 ]; then
    echo "  Settings are back to their defaults - set branding, billing, email and"
    echo "  sign-in providers again under Settings before going live."
  else
    echo "  Settings were kept; invoice numbering restarts at 1."
  fi
  if [ -n "$db_backup" ]; then
    echo
    echo "  Backup of everything that was deleted:"
    echo "    $db_backup"
    echo "    $docs_backup"
    echo "  See DEPLOYMENT.md Part 16b.4 to restore it. Delete these once you are"
    echo "  sure you won't need them - they contain personal data."
  fi
  exit 0
}

if [ "$FACTORY_RESET" -eq 1 ]; then
  factory_reset
fi

# ---------------------------------------------------------------------------
# 2. Work out what is actually there, so the summary is truthful rather
#    than a list of things that may or may not exist.
# ---------------------------------------------------------------------------
RUNNING="$(compose ps -q 2>/dev/null | wc -l | tr -d ' ')"
ALL_CONTAINERS="$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null | wc -l | tr -d ' ')"
VOLUMES="$(docker volume ls -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null || true)"
IMAGES="$(docker images -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null | sort -u | wc -l | tr -d ' ')"
HAS_CRON=0
# Counts only uncommented lines. A commented-out renewal is a note to self,
# not a scheduled job, so it must not trigger a crontab rewrite here.
if crontab -l 2>/dev/null | grep -E '^[[:space:]]*[^#[:space:]]' | grep -q "certbot renew"; then HAS_CRON=1; fi

if [ "$ALL_CONTAINERS" -eq 0 ] && [ -z "$VOLUMES" ] && [ ! -f "$ENV_FILE" ]; then
  log "Nothing to remove - no containers, volumes or $ENV_FILE found for project '${PROJECT}'."
  info "If you expected a deployment here, check DEPLOYMENT.md Part 14 for how the project name is derived."
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Show what will happen, and get confirmation for the destructive part.
# ---------------------------------------------------------------------------
log "What will be removed (project: ${PROJECT})"

if [ "$ALL_CONTAINERS" -gt 0 ]; then
  info "containers: $ALL_CONTAINERS  ($(compose ps --services 2>/dev/null | tr '\n' ' '))"
else
  info "containers: none found"
fi
if [ -n "$VOLUMES" ]; then
  info "volumes:    $(echo "$VOLUMES" | wc -l | tr -d ' ')  ($(echo "$VOLUMES" | tr '\n' ' '))"
else
  info "volumes:    none found"
fi
info "network:    ${PROJECT}_default"
[ "$HAS_CRON" -eq 1 ] && info "cron entry: a 'certbot renew' entry will be removed from your crontab"
[ -f "$ENV_FILE" ] && info "env file:   $ENV_FILE exists"

if [ "$PURGE" -eq 0 ]; then
  cat <<EOF

  Everything above that is data will be KEPT:
    - all volumes, including the MySQL database and every caregiver
      document ever uploaded
    - the TLS certificate in certbot-conf
    - all Docker images (rebuilds are fast; re-pulling is not)
    - $ENV_FILE, with your secrets and generated passwords

  Re-run ./setup.sh afterwards to bring the site back exactly as it was.
EOF
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run - nothing was changed."
    exit 0
  fi
  log "Removing containers and network (data kept)."
else
  printf '\n  \033[1;31mTHIS PERMANENTLY DELETES:\033[0m\n'
  cat <<EOF
    - the MySQL database - every user, caregiver, booking and setting
    - every caregiver document ever uploaded (qualifications, ID scans)
    - the TLS certificate
    - all Docker images built or pulled for this project
    - $ENV_FILE (secrets, generated passwords)
EOF
  cat <<EOF

  There is no undo and no backup taken by this script. If you have not
  backed the data up elsewhere, cancel now and do that first - see
  DEPLOYMENT.md Part 15 for what the backup set consists of.
EOF
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run - nothing was changed."
    exit 0
  fi
  if [ "$ASSUME_YES" -ne 1 ]; then
    # Typing the domain back is deliberate friction. A bare y/N prompt is
    # easy to muscle through by reflex, and this is the one irreversible
    # operation in the script.
    CONFIRM="${DOMAIN:-$PROJECT}"
    printf '    Type %s to confirm permanent deletion: ' "$CONFIRM"
    read -r reply
    if [ "$reply" != "$CONFIRM" ]; then
      die "Did not match - nothing was removed."
    fi
  fi
  log "Removing everything, including data."
fi

# ---------------------------------------------------------------------------
# 4. Remove containers and network.
#
# `down` without -v/--rmi is what makes the default mode non-destructive:
# it removes containers and the project network and nothing else. The
# `--volumes`/`--rmi` flags are added only in purge mode.
#
# `|| true` throughout: a partially-created deployment (say, the build
# failed half way) can leave compose unable to resolve something, and the
# goal here is to clean up what exists rather than to insist on a tidy
# project description.
# ---------------------------------------------------------------------------
DOWN_ARGS=(down --remove-orphans)
if [ "$PURGE" -eq 1 ]; then
  DOWN_ARGS+=(--volumes --rmi all)
fi

if [ "$DRY_RUN" -eq 1 ]; then
  info "would run: docker compose ${DOWN_ARGS[*]}"
else
  compose "${DOWN_ARGS[@]}" >/dev/null 2>&1 || true

  # `down` only removes containers it can see in the project. A container
  # left over from a crashed or partially-removed deploy can survive it,
  # so sweep by label as a backstop. This is scoped to the project label,
  # so it can never touch another project's containers.
  if [ "$ALL_CONTAINERS" -gt 0 ]; then
    REMAINING="$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$REMAINING" -gt 0 ]; then
      info "removing $REMAINING leftover container(s)"
      docker rm -f "$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}")" >/dev/null 2>&1 || true
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. Volumes.
#
# `down --volumes` handles the ones compose knows about. The explicit
# sweep below catches volumes that were created by an earlier run and are
# no longer declared in the compose file - an older deploy's leftover
# mysql-data would otherwise sit on the host holding real data forever.
#
# Still scoped to the project label, so a volume from some other stack
# (there is an older `care_platform_*` set on some hosts) is never touched.
# ---------------------------------------------------------------------------
if [ "$PURGE" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    info "would remove volumes labelled for project '${PROJECT}'"
  else
    STALE="$(docker volume ls -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null || true)"
    if [ -n "$STALE" ]; then
      # shellcheck disable=SC2086
      docker volume rm $STALE >/dev/null 2>&1 || true
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. Files.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 5b. Release images and the build cache.
#
# `down --rmi all` removes only the images of the release that is running.
# setup.sh / update.sh tag every release by commit and keep the previous one
# for rollback, so those are removed by name here. Build cache is shared with
# any other project on the host, so only the part nothing uses is cleared.
#
# The database backups update.sh took (backups/) are deliberately KEPT: they
# are the way back if this purge was a mistake. They are named in the report.
# ---------------------------------------------------------------------------
if [ "$PURGE" -eq 1 ]; then
  IMAGE_PREFIX_VAL="$(grep '^IMAGE_PREFIX=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  IMAGE_PREFIX_VAL="${IMAGE_PREFIX_VAL:-$PROJECT}"
  RELEASE_IMAGES="$(for s in api web public-web; do docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=${IMAGE_PREFIX_VAL}-${s}" 2>/dev/null; done)"
  if [ "$DRY_RUN" -eq 1 ]; then
    [ -n "$RELEASE_IMAGES" ] && info "would remove release images: $(echo "$RELEASE_IMAGES" | tr '\n' ' ')"
    info "would clear unused build cache"
  else
    for ref in $RELEASE_IMAGES; do docker rmi "$ref" >/dev/null 2>&1 || true; done
    docker builder prune -af >/dev/null 2>&1 || true
    rm -rf .deploy
  fi
fi

if [ "$PURGE" -eq 1 ]; then
  for f in "$ENV_FILE" "$GENERATED_CONF"; do
    if [ -f "$f" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        info "would delete $f"
      else
        rm -f "$f" && info "deleted $f"
      fi
    fi
  done
fi

# ---------------------------------------------------------------------------
# 7. The renewal cron entry.
#
# Removed in BOTH modes. It references this project's compose file and
# would keep running twice a day against a deployment that no longer
# exists - at best harmless noise in the system logs, at worst a confusing
# pile of errors if the directory is later reused for something else.
#
# Only lines that mention `certbot renew` are touched, so unrelated cron
# jobs in the same crontab are preserved. If the crontab would be left
# empty, it is removed rather than left as a blank entry.
# ---------------------------------------------------------------------------
if [ "$HAS_CRON" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    info "would remove the 'certbot renew' entry from your crontab"
  else
    CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
    # Only *active* lines are dropped. A commented-out copy is a note to
    # self, not a job, and a plain `grep -v` would silently delete it -
    # `awk` keeps any line that is either commented out or unrelated.
    KEPT="$(printf '%s\n' "$CURRENT_CRONTAB" | awk '!/certbot renew/ || /^[[:space:]]*#/')"
    if [ -z "$(printf '%s' "$KEPT" | tr -d '[:space:]')" ]; then
      # Nothing else was scheduled by anyone, so an empty crontab file is
      # just clutter.
      crontab -r 2>/dev/null && info "removed your crontab (it held only the renewal entry)"
    else
      printf '%s\n' "$KEPT" | crontab - 2>/dev/null \
        && info "removed the renewal entry from your crontab (other jobs kept)" \
        || warn "Couldn't update your crontab. Remove the 'certbot renew' line by hand: crontab -e"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 8. Report.
#
# The leftovers section matters: a purge that silently left something
# behind would leave the operator believing the host is clean when it
# isn't. Anything still present that belongs to this project is named
# explicitly.
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run complete - nothing was changed."
  exit 0
fi

echo
LEFT_VOLUMES="$(docker volume ls -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null || true)"
LEFT_CONTAINERS="$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null | wc -l | tr -d ' ')"
LEFT_IMAGES="$(docker images -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null | sort -u | wc -l | tr -d ' ')"

log "Done."
if [ "$PURGE" -eq 0 ]; then
  cat <<EOF
  Removed: containers and the project network.

  Kept, so ./setup.sh can restore the site with its data intact:
    volumes:  $(echo "$VOLUMES" | grep -c . 2>/dev/null || echo 0)  (database, caregiver documents, certificate)
    images:   ${IMAGES}
    $ENV_FILE

  Re-run ./setup.sh to bring it back, or ./uninstall.sh --purge to remove
  the data as well.
EOF
else
  if [ "$LEFT_CONTAINERS" -gt 0 ] || [ -n "$LEFT_VOLUMES" ] || [ "$LEFT_IMAGES" -gt 0 ]; then
    warn "Some resources are still present - usually because another container is still using them:"
    [ "$LEFT_CONTAINERS" -gt 0 ] && warn "  containers: $LEFT_CONTAINERS"
    [ -n "$LEFT_VOLUMES" ] && warn "  volumes: $(echo "$LEFT_VOLUMES" | tr '\n' ' ')"
    [ "$LEFT_IMAGES" -gt 0 ] && warn "  images: $LEFT_IMAGES"
    warn "Check with: docker ps -a --filter label=com.docker.compose.project=${PROJECT}"
  fi
  cat <<EOF
  Removed: containers, network, all volumes (database, caregiver documents,
  certificate), Docker images of every release, $ENV_FILE, and the renewal
  cron entry.

  Nothing from this project remains on the host. The repo itself is still
  here - delete the directory if you are finished with it.
EOF
  if ls backups/*.gz >/dev/null 2>&1; then
    echo "  Kept: the backups update.sh and --factory-reset took, in $(pwd)/backups/ -"
    echo "  delete them yourself once you are sure you won't need them."
  fi
fi
