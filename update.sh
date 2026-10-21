#!/usr/bin/env bash
#
# update.sh - deploy new code to a server that setup.sh has already set up.
#
# setup.sh is for the first deploy: it installs Docker, makes swap, writes
# secrets, gets a certificate, builds all three apps and seeds the database.
# None of that needs doing again to ship a change. This script only:
#
#   1. fetches the code you name (main, a branch, a tag, a commit, or a PR),
#   2. works out which apps the change touches, and rebuilds only those
#      (the others keep their images - no 15-minute rebuild for a CSS fix),
#   3. backs up the database if the change adds migrations,
#   4. swaps in the new containers, runs migrations, reloads nginx,
#   5. checks the apps come up healthy - and if they don't, puts the
#      previous release back automatically,
#   6. cleans up, keeping the previous release's images for a rollback.
#
# Usage:
#   ./update.sh                     # deploy the latest origin/main
#   ./update.sh --ref=release-1.4   # a branch, tag or commit
#   ./update.sh --pr=17             # an open pull request, to try it out
#   ./update.sh --dry-run --pr=17   # only show what would happen
#   ./update.sh --rollback          # back to the release before this one
#
# Run it from the repo root on the server, as the same user that ran setup.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
BACKUP_DIR="backups"

REF=""
PR=""
REMOTE="origin"
ROLLBACK=0
DRY_RUN=0
FULL=0
BACKUP="auto"
KEEP_BACKUPS=5
BUILD_CACHE_GB=""
AUTO_ROLLBACK=1
ASSUME_YES=0

usage() {
  cat <<EOF
Usage: $0 [--ref=<branch|tag|commit> | --pr=<number> | --rollback] [options]

What to deploy (default: the latest $REMOTE/main):
  --ref=REF          A branch, tag or commit on $REMOTE (or a local commit).
  --pr=N             GitHub pull request N, as it is now (its head commit). Use this
                     to try a PR on the server before merging; deploy main again
                     (or --rollback) afterwards.
  --rollback         Go back to the release before the current one. Instant: its
                     images are still on disk. Database changes are NOT undone -
                     the script prints the backup to restore if there were any.

Options:
  --remote=NAME      Git remote to fetch from (default: origin).
  --full             Rebuild all three apps, even ones the change doesn't touch.
  --backup           Back up the database even if there are no new migrations.
  --no-backup        Don't back up the database, even before migrations.
  --keep-backups=N   Database backups to keep in $BACKUP_DIR/ (default 5).
  --build-cache=GB   Build cache to keep afterwards (default 1 on a disk under
                     18 GB, else 3; 0 = none).
  --no-auto-rollback If the new release isn't healthy, leave it running for
                     debugging instead of putting the previous one back.
  --dry-run          Show the plan and change nothing.
  -y, --yes          Don't ask before deploying.
  -h, --help         Show this help.
EOF
}

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --ref=*) REF="${arg#*=}" ;;
    --pr=*) PR="${arg#*=}"; [[ "$PR" =~ ^[0-9]+$ ]] || die "--pr takes a pull request number" ;;
    --remote=*) REMOTE="${arg#*=}" ;;
    --rollback) ROLLBACK=1 ;;
    --full) FULL=1 ;;
    --backup) BACKUP="always" ;;
    --no-backup) BACKUP="never" ;;
    --keep-backups=*) KEEP_BACKUPS="${arg#*=}"; [[ "$KEEP_BACKUPS" =~ ^[0-9]+$ ]] || die "--keep-backups takes a number" ;;
    --build-cache=*) BUILD_CACHE_GB="${arg#*=}"; [[ "$BUILD_CACHE_GB" =~ ^[0-9]+$ ]] || die "--build-cache takes a whole number of GB" ;;
    --no-auto-rollback) AUTO_ROLLBACK=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg (see --help)" ;;
  esac
done
[ -n "$REF" ] && [ -n "$PR" ] && die "Give --ref or --pr, not both."
[ "$ROLLBACK" -eq 1 ] && { [ -n "$REF" ] || [ -n "$PR" ]; } && die "--rollback goes back to the previous release; it can't be combined with --ref or --pr."

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[ -f "$COMPOSE_FILE" ] || die "Run this from the repo root (couldn't find $COMPOSE_FILE here)."
[ -f deploy/lib.sh ] || die "deploy/lib.sh is missing - is this a complete checkout?"
# shellcheck source=deploy/lib.sh
. deploy/lib.sh
[ -f "$ENV_FILE" ] || die "No $ENV_FILE here - this server hasn't been set up yet. Run ./setup.sh first (DEPLOYMENT.md Part 8)."
command -v git >/dev/null 2>&1 || die "git isn't installed."
git rev-parse --git-dir >/dev/null 2>&1 || die "This folder isn't a git checkout, so there is nothing to update from. Clone the repo (DEPLOYMENT.md Part 3)."
docker info >/dev/null 2>&1 || die "Can't talk to the Docker daemon (is it running, and is your user in the 'docker' group? See DEPLOYMENT.md 17.4)."
[ "$DRY_RUN" -eq 1 ] || cl_lock
BUILD_CACHE_GB="${BUILD_CACHE_GB:-$(cl_default_build_cache_gb)}"

# Local edits to tracked files would either block the checkout or be
# silently deployed under the wrong commit's name. Untracked files (the env
# file, the rendered nginx config, backups) are ignored and never touched.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  die "There are uncommitted changes to tracked files (above). Commit them, or set them aside with 'git stash', then re-run."
fi

CURRENT_COMMIT="$(cl_state_get DEPLOYED_COMMIT)"
CURRENT_TAG="$(cl_env_get IMAGE_TAG)"
PREVIOUS_COMMIT="$(cl_state_get PREVIOUS_COMMIT)"
PREVIOUS_TAG="$(cl_state_get PREVIOUS_IMAGE_TAG)"
RECORDED=1
if [ -z "$CURRENT_COMMIT" ] || [ "$CURRENT_COMMIT" = "unknown" ]; then
  # Set up before setup.sh recorded releases: what is checked out is the
  # best guess at what is running.
  CURRENT_COMMIT="$(git rev-parse HEAD)"
  RECORDED=0
fi
image_exists() { docker image inspect "$1" >/dev/null 2>&1; }
PREFIX="$(cl_env_get IMAGE_PREFIX)"
if [ -z "$PREFIX" ]; then
  # Set up by a setup.sh from before releases were tagged: the images are
  # named <project>-<service>, and the env file has to say so, or compose
  # would build them under its own default name and nothing would match.
  PREFIX="$(cl_project_name)"
  [ "$DRY_RUN" -eq 1 ] || cl_env_set IMAGE_PREFIX "$PREFIX"
fi
image_ref() { echo "${PREFIX}-$1:$2"; }

# ---------------------------------------------------------------------------
# Rollback: the previous release's images are still on disk, so this is a
# retag-free switch of IMAGE_TAG and a recreate - no build.
# ---------------------------------------------------------------------------
if [ "$ROLLBACK" -eq 1 ]; then
  [ -n "$PREVIOUS_TAG" ] && [ -n "$PREVIOUS_COMMIT" ] || die "No previous release is recorded here (only releases deployed by setup.sh/update.sh are). Deploy a specific commit instead: ./update.sh --ref=<commit>"
  for s in "${CL_BUILT_SERVICES[@]}"; do
    image_exists "$(image_ref "$s" "$PREVIOUS_TAG")" || die "The previous release's $s image ($(image_ref "$s" "$PREVIOUS_TAG")) is gone. Deploy that commit instead: ./update.sh --ref=$PREVIOUS_COMMIT"
  done
  log "Rolling back"
  echo "  From: ${CURRENT_COMMIT:0:12} (images $CURRENT_TAG)"
  echo "  To:   ${PREVIOUS_COMMIT:0:12} (images $PREVIOUS_TAG)"
  LAST_BACKUP="$(cl_state_get LAST_BACKUP)"
  if [ "$DRY_RUN" -eq 1 ]; then echo "  (dry run - nothing changed)"; exit 0; fi
  if [ "$ASSUME_YES" -ne 1 ]; then
    read -r -p "Roll back? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted."
  fi
  git checkout -q --detach "$PREVIOUS_COMMIT"
  cl_env_set IMAGE_TAG "$PREVIOUS_TAG"
  compose up -d --no-build --force-recreate api web public-web
  for s in "${CL_BUILT_SERVICES[@]}"; do cl_wait_healthy "$s" 180 || warn "$s isn't healthy after the rollback - check: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs $s"; done
  cl_reload_nginx
  cl_state_save "$PREVIOUS_COMMIT" "$PREVIOUS_TAG" "$CURRENT_COMMIT" "$CURRENT_TAG"
  log "Rolled back to ${PREVIOUS_COMMIT:0:12}."
  echo "  The release you left (${CURRENT_COMMIT:0:12}) is kept, so './update.sh --rollback' again switches back."
  if [ -n "$LAST_BACKUP" ]; then
    echo "  Database changes are not undone. If that release migrated the database and the old code"
    echo "  doesn't work with it, restore the backup taken before it:"
    echo "    gunzip -c $LAST_BACKUP | docker compose -f $COMPOSE_FILE --env-file $ENV_FILE exec -T mysql \\"
    echo "      sh -c 'exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \"\$MYSQL_DATABASE\"'"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Fetch what to deploy
# ---------------------------------------------------------------------------
log "Fetching from $REMOTE"
if [ -n "$PR" ]; then
  git fetch -q "$REMOTE" "pull/${PR}/head" || die "Couldn't fetch pull request #$PR from $REMOTE - check the number, and that $REMOTE is the GitHub repo."
  TARGET="$(git rev-parse FETCH_HEAD)"
  LABEL="PR #$PR"
else
  REF="${REF:-main}"
  git fetch -q "$REMOTE" || die "Couldn't fetch from $REMOTE."
  if git rev-parse -q --verify "refs/remotes/$REMOTE/$REF^{commit}" >/dev/null; then
    TARGET="$(git rev-parse "refs/remotes/$REMOTE/$REF^{commit}")"
  elif git rev-parse -q --verify "refs/tags/$REF^{commit}" >/dev/null; then
    TARGET="$(git rev-parse "refs/tags/$REF^{commit}")"
  elif git rev-parse -q --verify "$REF^{commit}" >/dev/null; then
    TARGET="$(git rev-parse "$REF^{commit}")"
  else
    die "Couldn't find '$REF' as a branch on $REMOTE, a tag, or a commit."
  fi
  LABEL="$REF"
fi
TARGET_TAG="$(git rev-parse --short=12 "$TARGET")"

# ---------------------------------------------------------------------------
# 2. What changed, and what that means for each part of the stack
# ---------------------------------------------------------------------------
if ! git cat-file -e "${CURRENT_COMMIT}^{commit}" 2>/dev/null; then
  warn "The deployed commit ${CURRENT_COMMIT:0:12} isn't in this checkout - rebuilding everything."
  FULL=1
  CHANGED=""
else
  CHANGED="$(git diff --name-only "$CURRENT_COMMIT" "$TARGET")"
fi

declare -A BUILD=()
RESTART_NGINX=0
MIGRATIONS=""
NOTES=()
if [ "$FULL" -eq 1 ]; then
  for s in "${CL_BUILT_SERVICES[@]}"; do BUILD[$s]=1; done
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    apps/api/src/database/migrations/*.sql) BUILD[api]=1; MIGRATIONS+="${f##*/} " ;;
    apps/api/*) BUILD[api]=1 ;;
    apps/web/*) BUILD[web]=1 ;;
    apps/public-web/*) BUILD[public-web]=1 ;;
    # Shared by all three apps, so any change rebuilds all of them.
    packages/shared/*|package.json|package-lock.json|.dockerignore) for s in "${CL_BUILT_SERVICES[@]}"; do BUILD[$s]=1; done ;;
    docker-compose.prod.yml) for s in "${CL_BUILT_SERVICES[@]}"; do BUILD[$s]=1; done; RESTART_NGINX=1 ;;
    deploy/*.conf) RESTART_NGINX=1 ;;
    .env.production.example) NOTES+=("$f changed - new settings may need adding to $ENV_FILE: git diff ${CURRENT_COMMIT:0:12} ${TARGET_TAG} -- .env.production.example") ;;
    setup.sh|update.sh|deploy/lib.sh) NOTES+=("$f changed - the new version takes effect from the next run.") ;;
  esac
done <<< "$CHANGED"

# A service whose image for the current release is missing has to be built
# regardless (e.g. the first update after an older setup.sh).
for s in "${CL_BUILT_SERVICES[@]}"; do
  if [ -z "${BUILD[$s]:-}" ] && { [ -z "$CURRENT_TAG" ] || ! image_exists "$(image_ref "$s" "$CURRENT_TAG")"; }; then
    BUILD[$s]=1
    NOTES+=("No image of $s for the current release ($(image_ref "$s" "${CURRENT_TAG:-?}")) - building it too.")
  fi
done
TO_BUILD=()
TO_REUSE=()
for s in "${CL_BUILT_SERVICES[@]}"; do
  if [ -n "${BUILD[$s]:-}" ]; then TO_BUILD+=("$s"); else TO_REUSE+=("$s"); fi
done

DO_BACKUP=0
case "$BACKUP" in
  always) DO_BACKUP=1 ;;
  auto) [ -n "$MIGRATIONS" ] && DO_BACKUP=1 ;;
esac

log "Plan"
echo "  Deploying:  $LABEL -> ${TARGET_TAG} $(git log -1 --format='"%s"' "$TARGET" | cut -c1-70)"
echo "  Running:    ${CURRENT_COMMIT:0:12}$([ "$RECORDED" -eq 1 ] || echo " (assumed - no release recorded yet, so this is what is checked out)")"
if [ "$CURRENT_COMMIT" = "$TARGET" ] && [ "$FULL" -eq 0 ] && [ "${#TO_BUILD[@]}" -eq 0 ]; then
  echo "  Already deployed - nothing to do. (--full rebuilds anyway.)"
  exit 0
fi
COMMITS="$(git rev-list --count "${CURRENT_COMMIT}..${TARGET}" 2>/dev/null || echo '?')"
echo "  Changes:    $COMMITS commit(s), $(printf '%s' "$CHANGED" | grep -c . || true) file(s)"
echo "  Rebuild:    ${TO_BUILD[*]:-nothing}"
echo "  Unchanged:  ${TO_REUSE[*]:-nothing} (left running - same image, tagged as this release)"
echo "  Migrations: ${MIGRATIONS:-none new}"
echo "  DB backup:  $([ "$DO_BACKUP" -eq 1 ] && echo "yes, into $BACKUP_DIR/ before migrating" || echo no)"
echo "  nginx:      $([ "$RESTART_NGINX" -eq 1 ] && echo "config changed - recreated" || echo "reloaded")"
for n in "${NOTES[@]}"; do warn "$n"; done
if git merge-base --is-ancestor "$TARGET" "$CURRENT_COMMIT" 2>/dev/null && [ "$CURRENT_COMMIT" != "$TARGET" ]; then
  warn "$LABEL is OLDER than what is running. Deploying it doesn't undo database migrations - prefer --rollback."
fi
if [ -n "$PR" ]; then
  warn "This deploys PR #$PR's own branch, which may be behind main. Deploy main again (or --rollback) when you're done."
fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "  (dry run - nothing changed)"
  exit 0
fi
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Deploy? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted."
fi

# ---------------------------------------------------------------------------
# 3. Build what changed. The live site keeps running on the old containers
#    until step 5, so a failed build changes nothing - the code is put back.
# ---------------------------------------------------------------------------
START_REF="$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)"
git checkout -q --detach "$TARGET"
restore_checkout() { git checkout -q "$START_REF" 2>/dev/null || git checkout -q --detach "$CURRENT_COMMIT" 2>/dev/null || true; }

cl_make_room $(( ${#TO_BUILD[@]} * 2048 + 1024 )) "$CURRENT_TAG" "$PREVIOUS_TAG"
if [ "${#TO_BUILD[@]}" -gt 0 ]; then
  log "Building ${TO_BUILD[*]}"
  # IMAGE_TAG for this compose call only - the env file still names the
  # running release until the switch in step 5.
  if ! IMAGE_TAG="$TARGET_TAG" cl_build "${TO_BUILD[@]}"; then
    restore_checkout
    docker image prune -f >/dev/null 2>&1 || true
    cl_prune_build_cache $(( BUILD_CACHE_GB * 1024 ))
    die "The build failed. Nothing was deployed - the site is still running ${CURRENT_COMMIT:0:12}."
  fi
fi
# Unchanged apps: the same image under the new release's name, so the whole
# release is one tag (and a rollback of it is one switch).
for s in "${TO_REUSE[@]}"; do
  docker tag "$(image_ref "$s" "$CURRENT_TAG")" "$(image_ref "$s" "$TARGET_TAG")"
done

# ---------------------------------------------------------------------------
# 4. Back up the database before anything can migrate it.
# ---------------------------------------------------------------------------
BACKUP_FILE=""
if [ "$DO_BACKUP" -eq 1 ]; then
  log "Backing up the database"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/db-$(date +%Y%m%d-%H%M%S)-before-${TARGET_TAG}.sql.gz"
  # --single-transaction: a consistent snapshot without locking the live site.
  if compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' 2>/dev/null | gzip > "$BACKUP_FILE" \
     && [ "$(gzip -cd "$BACKUP_FILE" | head -c 1000 | wc -c)" -gt 0 ]; then
    chmod 600 "$BACKUP_FILE"
    echo "  $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    rm -f "$BACKUP_FILE"
    restore_checkout
    die "The database backup failed, so nothing was deployed. Fix that first, or re-run with --no-backup if you have your own backup."
  fi
  # Oldest first, keep the newest N.
  ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +$(( KEEP_BACKUPS + 1 )) | xargs -r rm -f
fi

# ---------------------------------------------------------------------------
# 5. Switch: new containers, migrations, nginx.
# ---------------------------------------------------------------------------
switch_to() {
  # $1 = image tag; $2.. = services to recreate on it
  local tag="$1"; shift
  cl_env_set IMAGE_TAG "$tag"
  [ "$#" -gt 0 ] || return 0
  compose up -d --no-build --no-deps --force-recreate "$@"
}
is_built() { [ -n "${BUILD[$1]:-}" ]; }

log "Starting the new release"
cl_wait_healthy mysql 120 || die "mysql isn't healthy - check: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs mysql"
# The API first, and migrations straight after it, so the web apps never talk
# to new code on an old schema for longer than it takes to migrate. Apps the
# change doesn't touch are not restarted at all: their containers already
# run the very image this release tags.
if is_built api; then
  switch_to "$TARGET_TAG" api
  log "Running database migrations"
  compose exec -T -w /app/apps/api api node dist/src/database/migrate.js
  log "Refreshing reference data (skills, languages, locations)"
  # Idempotent: updates reference data in place and leaves an existing admin alone.
  compose exec -T -w /app/apps/api \
    -e INITIAL_ADMIN_EMAIL="$(cl_env_get INITIAL_ADMIN_EMAIL)" \
    -e INITIAL_ADMIN_PASSWORD="$(cl_env_get INITIAL_ADMIN_PASSWORD)" \
    -e INITIAL_ADMIN_NAME="$(cl_env_get INITIAL_ADMIN_NAME)" \
    api node dist/src/database/seed-production.js
fi
WEB_APPS=()
for s in web public-web; do is_built "$s" && WEB_APPS+=("$s"); done
switch_to "$TARGET_TAG" "${WEB_APPS[@]}"
if [ "$RESTART_NGINX" -eq 1 ]; then
  compose up -d --no-deps --force-recreate nginx
else
  cl_reload_nginx
fi

# ---------------------------------------------------------------------------
# 6. Healthy? If not, put the previous release back.
# ---------------------------------------------------------------------------
log "Checking the new release"
UNHEALTHY=()
for s in "${CL_BUILT_SERVICES[@]}"; do
  if cl_wait_healthy "$s" 240; then echo "  $s: healthy"; else UNHEALTHY+=("$s"); fi
done
if [ "${#UNHEALTHY[@]}" -gt 0 ]; then
  warn "Not healthy: ${UNHEALTHY[*]}. Logs: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs --tail=100 ${UNHEALTHY[*]}"
  if [ "$AUTO_ROLLBACK" -eq 1 ] && [ -n "$CURRENT_TAG" ]; then
    warn "Putting the previous release (${CURRENT_COMMIT:0:12}) back."
    switch_to "$CURRENT_TAG" api web public-web
    cl_reload_nginx
    restore_checkout
    if [ -n "$MIGRATIONS" ]; then warn "Migrations ($MIGRATIONS) were already applied. If the old release misbehaves with them, restore $BACKUP_FILE (see DEPLOYMENT.md Part 16.3)."; fi
    die "The update was rolled back. The failed release's images are kept as $(image_ref api "$TARGET_TAG") etc. for debugging."
  fi
  die "Left the unhealthy release running (--no-auto-rollback). './update.sh --rollback' puts the previous one back."
fi

if [ -n "$CURRENT_TAG" ] && [ "$CURRENT_TAG" != "$TARGET_TAG" ]; then
  cl_state_save "$TARGET" "$TARGET_TAG" "$CURRENT_COMMIT" "$CURRENT_TAG"
else
  cl_state_save "$TARGET" "$TARGET_TAG" "" ""
fi
if [ -n "$BACKUP_FILE" ]; then echo "LAST_BACKUP=$BACKUP_FILE" >> "$CL_STATE_FILE"; fi

# ---------------------------------------------------------------------------
# 7. Clean up, keeping this release and the one before it.
# ---------------------------------------------------------------------------
log "Cleaning up old images and build cache"
cl_cleanup $(( BUILD_CACHE_GB * 1024 )) "$TARGET_TAG" "$CURRENT_TAG"

log "Deployed ${LABEL} (${TARGET_TAG})"
echo "  Site: $(cl_env_get PUBLIC_WEB_URL || true)"
if [ -n "$CURRENT_TAG" ] && [ "$CURRENT_TAG" != "$TARGET_TAG" ]; then
  echo "  Previous release ${CURRENT_COMMIT:0:12} is kept: './update.sh --rollback' switches back in seconds."
else
  echo "  This is the first release update.sh has recorded here; rollback is available from the next update."
fi
if [ -n "$BACKUP_FILE" ]; then echo "  Database backup taken before migrating: $BACKUP_FILE"; fi
if [ -n "$PR" ]; then echo "  When you're done trying PR #$PR: ./update.sh   (back to main)   or   ./update.sh --rollback"; fi
exit 0
