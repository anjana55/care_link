# shellcheck shell=bash
#
# deploy/lib.sh - helpers shared by setup.sh and update.sh. Sourced, never run.
#
# The caller defines log / warn / die and sets COMPOSE_FILE and ENV_FILE
# before sourcing this, and runs from the repo root.

# The three images this repo builds. mysql, nginx and certbot are pulled.
CL_BUILT_SERVICES=(api web public-web)

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# The compose project name, derived the way compose derives it from the
# directory name (lowercase; only a-z 0-9 _ -). It labels every container
# and volume of this deployment, and prefixes its image names.
cl_project_name() {
  basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

# Read / write one KEY=value line of the env file, leaving every other line alone.
cl_env_get() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
cl_env_set() {
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}

# The image tag for what is checked out: the commit, so every release's
# images are named after the code in them. Uncommitted edits to tracked
# files get a timestamp on the end, so they never overwrite the image of the
# commit they started from (which may be what a rollback goes back to).
cl_image_tag() {
  local sha
  sha="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
  if [ -z "$sha" ]; then
    date +%Y%m%d%H%M%S
  elif [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    echo "${sha}-dirty-$(date +%Y%m%d%H%M%S)"
  else
    echo "$sha"
  fi
}

# Free space, in MB, on the filesystem Docker keeps its data on.
cl_docker_free_mb() {
  local root
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  [ -d "$root" ] || root="/"
  df -Pm "$root" 2>/dev/null | awk 'NR==2 {print $4}'
}

# How much build cache to keep between deploys, in GB, when not chosen with
# --build-cache. Keeping some makes the next build reuse the npm installs
# (minutes faster); on a small disk the space matters more. A 20 GB+ disk
# keeps 3 GB, an 8-16 GB one keeps 1 GB.
cl_default_build_cache_gb() {
  local root total_gb
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  [ -d "$root" ] || root="/"
  total_gb="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print int($2/1024/1024)}')"
  if [ -n "$total_gb" ] && [ "$total_gb" -lt 18 ]; then echo 1; else echo 3; fi
}

# Memory, for deciding whether to build one image at a time (see setup.sh 1b).
cl_detect_memory() {
  CL_MEM_MB="$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  CL_LOW_MEMORY=0
  if [ "${CL_MEM_MB:-0}" -gt 0 ] && [ "$CL_MEM_MB" -lt 3800 ]; then CL_LOW_MEMORY=1; fi
}

# Build the given services. On a small server one at a time, with a Node heap
# limit that can use swap - all three side by side need ~4 GB.
cl_build() {
  [ "$#" -gt 0 ] || return 0
  cl_detect_memory
  if [ "$CL_LOW_MEMORY" -eq 1 ]; then
    export NODE_BUILD_HEAP_MB=2048
    local s
    for s in "$@"; do
      echo "  Building $s ..."
      compose build "$s"
    done
  else
    compose build "$@"
  fi
}

# ---------------------------------------------------------------------------
# Disk cleanup.
#
# Why a re-run used to fill the disk - each of these grows with every build:
#
#  1. Build cache. Every build of a changed app writes new layers - a fresh
#     `next build` output for web and public-web, a fresh `npm ci` for all
#     three whenever package-lock.json changes - and BuildKit keeps all of the
#     old ones. `docker image prune` does not touch the build cache at all.
#     This is the biggest one: gigabytes after a handful of deploys.
#  2. Old images. A rebuild moves the tag to the new image, and the old one
#     becomes untagged ("dangling"). setup.sh pruned dangling images right
#     after building, while the running containers still used the old images
#     - so they were skipped, and every deploy left the last release behind.
#  3. Container logs, with no size limit (now capped in docker-compose.prod.yml).
#  4. Anonymous volumes and stopped containers left by one-off `compose run`s.
# ---------------------------------------------------------------------------

# Prune the build cache down to KEEP_MB (0 = all of it). The flag changed
# name in Docker 28 (--keep-storage became --max-used-space), so ask the CLI
# which one it has rather than guess from version numbers.
cl_prune_build_cache() {
  local keep_mb="${1:-0}"
  if [ "$keep_mb" -le 0 ]; then
    docker builder prune -af >/dev/null 2>&1 || true
    return 0
  fi
  local help
  help="$(docker builder prune --help 2>/dev/null || true)"
  if printf '%s' "$help" | grep -q -- '--max-used-space'; then
    docker builder prune -af --max-used-space "${keep_mb}mb" >/dev/null 2>&1 || true
  elif printf '%s' "$help" | grep -q -- '--keep-storage'; then
    docker builder prune -af --keep-storage "${keep_mb}mb" >/dev/null 2>&1 || true
  else
    docker builder prune -af >/dev/null 2>&1 || true
  fi
}

# Remove this deployment's built images except the tags in KEEP (space-separated),
# plus the untagged names compose gave them before images were tagged by commit.
# An image a container still uses refuses to go, which is exactly right.
cl_remove_old_images() {
  local keep=" $* " prefix legacy svc ref
  prefix="$(cl_env_get IMAGE_PREFIX)"
  prefix="${prefix:-$(cl_project_name)}"
  legacy="$(cl_project_name)"
  for svc in "${CL_BUILT_SERVICES[@]}"; do
    while read -r ref; do
      [ -n "$ref" ] || continue
      case "$keep" in *" ${ref##*:} "*) continue ;; esac
      docker rmi "$ref" >/dev/null 2>&1 || true
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=${prefix}-${svc}" 2>/dev/null)
    # Before images were tagged by commit, compose named them <project>-<service>:latest.
    case "$keep" in *" latest "*) ;; *) docker rmi "${legacy}-${svc}:latest" >/dev/null 2>&1 || true ;; esac
  done
}

# Everything above, after a deploy. KEEP_TAGS are the image tags to keep
# (the release now running and the one before it, for rollback); BUILD_CACHE_MB
# is how much build cache to keep so the next build stays quick.
cl_cleanup() {
  local cache_mb="$1"; shift
  local before after project
  before="$(cl_docker_free_mb)"
  project="$(cl_project_name)"

  # Stopped one-off containers of this project only (a `compose run` without
  # --rm, a crashed build step) - never anyone else's.
  docker container prune -f --filter "label=com.docker.compose.project=${project}" >/dev/null 2>&1 || true
  # Untagged images nothing uses any more - safe now that containers were recreated.
  docker image prune -f >/dev/null 2>&1 || true
  cl_remove_old_images "$@"
  # Anonymous volumes only: their names are 64 hex characters. Named volumes
  # (the database, uploaded documents, the certificate) are never touched -
  # `docker volume prune` on Docker before 23 would have removed unused named
  # ones too, which is why this does not use it.
  local v
  for v in $(docker volume ls -q --filter dangling=true 2>/dev/null | grep -E '^[0-9a-f]{64}$' || true); do
    docker volume rm "$v" >/dev/null 2>&1 || true
  done
  cl_prune_build_cache "$cache_mb"

  after="$(cl_docker_free_mb)"
  if [ -n "$before" ] && [ -n "$after" ]; then
    echo "  Free disk: ${before} MB before cleanup, ${after} MB after (build cache kept: up to ${cache_mb} MB)."
  fi
}

# Before a build: if the disk is short, clear what can be cleared first,
# rather than failing half way with "no space left on device".
cl_make_room() {
  local need_mb="$1"; shift
  local free
  free="$(cl_docker_free_mb)"
  [ -n "$free" ] && [ "$free" -lt "$need_mb" ] || return 0
  warn "Only ${free} MB free for Docker; a build needs about ${need_mb} MB. Clearing old images and the build cache first."
  docker image prune -f >/dev/null 2>&1 || true
  cl_remove_old_images "$@"
  cl_prune_build_cache 0
  free="$(cl_docker_free_mb)"
  if [ -n "$free" ] && [ "$free" -lt "$need_mb" ]; then
    warn "Still only ${free} MB free. The build may fail with 'no space left on device' - see what is using"
    warn "the disk with: sudo du -xh / --max-depth=2 | sort -h | tail -20   and   docker system df"
  fi
}

# Wait until a service's container is healthy (or just running, if its image
# has no healthcheck). Returns non-zero after TIMEOUT seconds.
cl_wait_healthy() {
  local service="$1" timeout="${2:-180}" waited=0 cid state
  while [ "$waited" -lt "$timeout" ]; do
    cid="$(compose ps -q "$service" 2>/dev/null | head -1)"
    if [ -n "$cid" ]; then
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "$cid" 2>/dev/null || true)"
      case "$state" in healthy|running) return 0 ;; esac
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# nginx resolves api / web / public-web once, when it starts. A service
# recreated on its own gets a new address, and nginx would keep sending
# traffic to the old one (502s) until reloaded. A reload is graceful.
cl_reload_nginx() {
  compose exec -T nginx nginx -s reload >/dev/null 2>&1 \
    || compose up -d --force-recreate --no-deps nginx >/dev/null 2>&1 \
    || warn "Couldn't reload nginx - if the site shows 502, run: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE restart nginx"
}

# What is deployed: .deploy/state holds the commit and image tag of the
# release now running and of the one before it.
CL_STATE_DIR=".deploy"
CL_STATE_FILE="$CL_STATE_DIR/state"
cl_state_get() { grep "^$1=" "$CL_STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
cl_state_save() {
  # DEPLOYED_COMMIT IMAGE_TAG PREVIOUS_COMMIT PREVIOUS_IMAGE_TAG
  mkdir -p "$CL_STATE_DIR"
  cat > "$CL_STATE_FILE.tmp" <<EOF
DEPLOYED_COMMIT=$1
IMAGE_TAG=$2
PREVIOUS_COMMIT=$3
PREVIOUS_IMAGE_TAG=$4
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  mv "$CL_STATE_FILE.tmp" "$CL_STATE_FILE"
}

# One deploy at a time: setup.sh and update.sh both take this lock.
cl_lock() {
  mkdir -p "$CL_STATE_DIR"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$CL_STATE_DIR/lock"
    flock -n 9 || die "Another setup.sh or update.sh is already running here. Wait for it to finish."
  fi
}
