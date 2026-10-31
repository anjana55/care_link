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
#   4. runs migrations, swaps in the new containers, reloads nginx,
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
#   ./update.sh --follow            # watch a running (or the last) update
#
# Once you confirm, the update runs in the background: closing the terminal
# or losing the SSH connection does not stop it. Your terminal shows its log
# as it goes; Ctrl-C only stops watching. The log is kept in .deploy/logs/.
#
# Run it from the repo root on the server, as the same user that ran setup.sh.

set -euo pipefail

ORIG_ARGS=("$@")

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
ALLOW_LOW_MEMORY=0
ASSUME_YES=0
FOREGROUND=0
FOLLOW=0
# Set when this is the background run a terminal started (see confirm_and_detach).
DETACHED="${CL_UPDATE_DETACHED:-0}"

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
  --allow-low-memory Build even with under 4 GB of memory + swap. The build can run
                     the server out of memory and take MySQL - and the site - down
                     with it; add swap instead if you can.
  --dry-run          Show the plan and change nothing.
  -y, --yes          Don't ask before deploying.
  --foreground       Run in this terminal instead of the background (the update
                     then stops if the terminal disconnects).
  --follow           Watch the update running now, or show the last one's log.
  -h, --help         Show this help.

Once you confirm, the update carries on in the background even if your SSH
connection drops. Ctrl-C only stops watching; './update.sh --follow' resumes.
EOF
}

log()  { printf '\n\033[1;34m==>\033[0m %s \033[2m(%s)\033[0m\n' "$1" "$(date +%H:%M:%S)"; }
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
    --allow-low-memory) ALLOW_LOW_MEMORY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --foreground) FOREGROUND=1 ;;
    --follow|--log) FOLLOW=1 ;;
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

# ---------------------------------------------------------------------------
# Running in the background
# ---------------------------------------------------------------------------
UPDATE_LOG_DIR="$CL_STATE_DIR/logs"
UPDATE_PID_FILE="$CL_STATE_DIR/update.pid"
KEEP_LOGS=20

# Shows a log until the run writing it ends, then reports how it ended and
# exits with its status. Ctrl-C stops watching only - the run carries on.
watch_log() {
  local logfile="$1" pid="$2"
  trap 'printf "\n\nStopped watching. The update carries on in the background.\n  Watch again: ./update.sh --follow\n  Log: %s\n" "$logfile"; exit 0' INT
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    tail -n +1 -f --pid="$pid" "$logfile"
  else
    cat "$logfile"
  fi
  trap - INT
  local status
  status="$(cat "$logfile.status" 2>/dev/null || true)"
  echo
  case "$status" in
    0) echo "The update finished successfully." ;;
    "") echo "The update stopped without recording how it ended (was the server restarted?). See the log above." ;;
    *) echo "The update failed (exit $status) - see the log above." ;;
  esac
  echo "  Log: $logfile"
  [ -n "$status" ] || exit 1
  exit "$status"
}

if [ "$FOLLOW" -eq 1 ]; then
  [ -e "$UPDATE_LOG_DIR/latest.log" ] || die "No update has run in the background here yet."
  watch_log "$(readlink -f "$UPDATE_LOG_DIR/latest.log")" "$(cat "$UPDATE_PID_FILE" 2>/dev/null || true)"
fi

# Asks to go ahead (unless --yes), then hands the rest of the update to a
# background run in its own session - so a dropped SSH connection can't stop
# it - and follows its log here. The background run re-runs this script with
# the same options, pinned to the commit the plan just showed, so what you
# confirmed is what deploys even if the branch moves meanwhile. It inherits
# the lock, so nothing else can start in between.
confirm_and_detach() {
  local question="$1"
  if [ "$ASSUME_YES" -ne 1 ] && [ "$DETACHED" != 1 ]; then
    read -r -p "$question [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted."
  fi
  if [ "$DETACHED" = 1 ] || [ "$FOREGROUND" -eq 1 ]; then return 0; fi
  if ! command -v setsid >/dev/null 2>&1; then
    warn "setsid isn't available, so the update runs in this terminal - keep it connected until it finishes."
    return 0
  fi
  mkdir -p "$UPDATE_LOG_DIR"
  local logfile
  logfile="$UPDATE_LOG_DIR/update-$(date +%Y%m%d-%H%M%S).log"
  : > "$logfile"
  ln -sfn "$(basename "$logfile")" "$UPDATE_LOG_DIR/latest.log"
  # Keep the newest KEEP_LOGS logs. Never a reason to stop the update.
  { ls -1t "$UPDATE_LOG_DIR"/update-*.log 2>/dev/null | tail -n +$(( KEEP_LOGS + 1 )) | while read -r old; do rm -f "$old" "$old.status"; done; } || true
  CL_UPDATE_DETACHED=1 CL_UPDATE_TARGET="${TARGET:-}" CL_UPDATE_LOG="$logfile" \
    setsid nohup "$SCRIPT_DIR/update.sh" "${ORIG_ARGS[@]}" --yes </dev/null >"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$UPDATE_PID_FILE"
  # The background run holds the lock now (it inherited it): let go of ours.
  exec 9>&-
  log "Updating in the background (pid $pid) - safe to disconnect"
  echo "  Log:   $logfile"
  echo "  Watch: ./update.sh --follow   (Ctrl-C stops watching, not the update)"
  echo
  watch_log "$logfile" "$pid"
}

# The background run records how it ended, for whoever is watching.
if [ "$DETACHED" = 1 ] && [ -n "${CL_UPDATE_LOG:-}" ]; then
  trap 'echo $? > "$CL_UPDATE_LOG.status"' EXIT
  echo "update.sh started $(date '+%Y-%m-%d %H:%M:%S %Z') by $(id -un): ${ORIG_ARGS[*]:-(latest main)}"
fi

# The background run already holds the lock: it inherited it from the
# terminal that started it.
[ "$DRY_RUN" -eq 1 ] || [ "$DETACHED" = 1 ] || cl_lock
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
  confirm_and_detach "Roll back?"
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
if [ -n "${CL_UPDATE_TARGET:-}" ]; then
  # The background run: deploy exactly the commit the terminal showed and you
  # confirmed. No second fetch - it may need credentials that left with you.
  git cat-file -e "${CL_UPDATE_TARGET}^{commit}" 2>/dev/null || die "The commit to deploy (${CL_UPDATE_TARGET:0:12}) isn't in this checkout."
  TARGET="$CL_UPDATE_TARGET"
  if [ -n "$PR" ]; then LABEL="PR #$PR"; else REF="${REF:-main}"; LABEL="$REF"; fi
elif [ -n "$PR" ]; then
  log "Fetching from $REMOTE"
  git fetch -q "$REMOTE" "pull/${PR}/head" || die "Couldn't fetch pull request #$PR from $REMOTE - check the number, and that $REMOTE is the GitHub repo."
  TARGET="$(git rev-parse FETCH_HEAD)"
  LABEL="PR #$PR"
else
  log "Fetching from $REMOTE"
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
if [ "${#TO_BUILD[@]}" -gt 0 ]; then
  cl_detect_memory
  echo "  Memory:     ${CL_MEM_MB} MB RAM + ${CL_SWAP_MB} MB swap - $([ "$CL_LOW_MEMORY" -eq 1 ] && echo "building one image at a time" || echo "building side by side")"
fi
for n in "${NOTES[@]}"; do warn "$n"; done
# A package-lock.json that isn't valid JSON - nearly always a merge conflict
# resolved by hand or in GitHub's web editor - makes every image's `npm ci`
# stop with the misleading "can only install with an existing
# package-lock.json". Check it here, before anything is built, with the same
# Node the images build with (the server itself may have no Node at all).
if [ "${#TO_BUILD[@]}" -gt 0 ]; then
  if ! git show "$TARGET:package-lock.json" | docker run --rm -i node:20-alpine node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const l = JSON.parse(s); if (!l.lockfileVersion || !l.packages) throw new Error("no packages"); }
      catch (e) { console.error(e.message); process.exit(1); }
    });' >/dev/null; then
    die "package-lock.json in ${TARGET_TAG} is not a valid lockfile (above), so every build would fail at 'npm ci'. This usually comes from a merge conflict resolved by hand or in GitHub's editor: take one side's lockfile, run 'npm install', and commit the result. Nothing was changed."
  fi
fi
# The build runs beside the live site. Short of memory, the kernel kills the
# biggest process to make room - MySQL - and the site is down before anything
# has been deployed. Refuse here, while nothing has changed.
if [ "${#TO_BUILD[@]}" -gt 0 ] && [ "$ALLOW_LOW_MEMORY" -eq 0 ] && ! cl_build_memory_ok; then
  warn "This server has ${CL_MEM_MB} MB of RAM and ${CL_SWAP_MB} MB of swap. Building beside the running site"
  warn "needs swap on a server under 6 GB of RAM, and about 4 GB of RAM + swap together - otherwise"
  warn "the kernel can kill MySQL to make room, and the site goes down mid-update."
  echo "  Add a swap file (it uses disk space - check 'df -h /' first), then run this again:" >&2
  cl_swap_howto 4096 >&2
  die "Not enough memory to build safely. Nothing was changed. (--allow-low-memory builds anyway.)"
fi
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
confirm_and_detach "Deploy?"

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
if ! cl_wait_healthy mysql 120; then
  # Most often it isn't running at all: stopped by hand, or killed for lack of
  # memory and not yet back. Starting it is safe - its data lives in the
  # mysql-data volume - and saves a second run of this script.
  warn "mysql isn't healthy - starting it"
  compose up -d --no-build mysql >/dev/null 2>&1 || true
  if ! cl_wait_healthy mysql 180; then
    cl_explain_unhealthy mysql >&2
    restore_checkout
    die "mysql isn't healthy, so nothing was deployed - the current release (${CURRENT_COMMIT:0:12}) is unchanged. See above; full logs: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs mysql"
  fi
  echo "  mysql: healthy again"
fi
# Migrations and reference data run first, in a throwaway container on the new
# image, while the current release keeps serving. They used to run inside the
# freshly started API with `exec`: when that API crash-looped, MySQL was left
# half-migrated (its DDL can't be rolled back) and every later run tripped over
# the leftover tables. Now a failed migration stops here with the old release
# untouched. The API is switched straight after, so it only meets the new
# schema for the seconds this takes - migrations add, they don't remove.
# Apps the change doesn't touch are not restarted at all: their containers
# already run the very image this release tags.
run_new_api() { IMAGE_TAG="$TARGET_TAG" compose run --rm --no-deps -T -w /app/apps/api "$@"; }
if is_built api; then
  log "Running database migrations"
  run_new_api api node dist/src/database/migrate.js \
    || die "Migrations failed; the current release is still running. MySQL can't undo table changes, so a migration that stopped part-way may have left some of its tables behind - see the error above before retrying."
  log "Refreshing reference data (skills, languages, locations)"
  # Idempotent: updates reference data in place and leaves an existing admin alone.
  run_new_api \
    -e INITIAL_ADMIN_EMAIL="$(cl_env_get INITIAL_ADMIN_EMAIL)" \
    -e INITIAL_ADMIN_PASSWORD="$(cl_env_get INITIAL_ADMIN_PASSWORD)" \
    -e INITIAL_ADMIN_NAME="$(cl_env_get INITIAL_ADMIN_NAME)" \
    api node dist/src/database/seed-production.js \
    || die "Refreshing reference data failed; the current release is still running."
  switch_to "$TARGET_TAG" api
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
  for s in "${UNHEALTHY[@]}"; do cl_explain_unhealthy "$s" >&2; done
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
