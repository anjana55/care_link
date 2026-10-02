#!/bin/sh
# Runs after a successful `certbot renew`. Reloads nginx so the new
# certificate is actually served - certbot replaces the files on disk,
# but the running nginx keeps the old certificate in memory until it
# re-reads them. Without this, a renewed cert is not used until the
# container next restarts.
#
# Wired in via the certbot service's volumes in docker-compose.prod.yml,
# which mounts this file into certbot's renewal-hooks/deploy/ directory.
# certbot runs every script it finds there after a renewal, and only
# after one that actually issued something.
#
# --quiet does not suppress this, and that is intended: there is nothing
# to report on the many runs where no certificate was due.
set -e
cd "$(dirname "$0")/.."
docker compose -f docker-compose.prod.yml --env-file .env.production exec nginx nginx -s reload
