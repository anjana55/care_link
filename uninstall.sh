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
# Safe to re-run: both modes are idempotent and report what they find.
#
# Usage:
#   ./uninstall.sh [--purge] [-y|--yes] [--dry-run]
#
# Options:
#   -p, --purge        Delete data volumes, images, the certificate, and
#                      .env.production as well. Cannot be undone.
#   -y, --yes          Don't prompt for confirmation. Only meaningful
#                      together with --purge; the default mode never
#                      prompts at all.
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

usage() {
  cat <<EOF
Usage: $0 [--purge] [-y|--yes] [--dry-run]

Removes the CareLink deployment created by setup.sh.

  (no options)   Stop and remove containers + network. Data volumes, the
                 TLS certificate, Docker images and $ENV_FILE are all
                 KEPT, so setup.sh can recreate the site at any time.

  --purge        Also delete, permanently: all volumes (MySQL database and
                 every caregiver document ever uploaded), all Docker images,
                 the TLS certificate, $ENV_FILE, and the generated
                 $GENERATED_CONF. THIS CANNOT BE UNDONE.
  -y, --yes       Skip the confirmation prompt (implies --purge is what you
                 already decided).
  -n, --dry-run   Show what would be removed without removing anything.
  -h, --help      Show this help.

The automatic certificate-renewal cron entry is removed in both modes: it
would otherwise keep firing against a deployment that no longer exists.
EOF
}

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    -p|--purge)   PURGE=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    -n|--dry-run) DRY_RUN=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) die "Unknown option: $arg (see --help)" ;;
  esac
done

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
  certificate), Docker images, $ENV_FILE, and the renewal cron entry.

  Nothing from this project remains on the host. The repo itself is still
  here - delete the directory if you are finished with it.
EOF
fi
