# Deployment

This covers taking `care_platform` from a laptop dev setup to a production
host: what ships (Dockerfiles, `docker-compose.prod.yml`, an nginx reverse
proxy), what you still have to plug in (a domain, TLS, secrets, backups),
and the exact commands to bring it up.

Everything here assumes a single Docker host (one VM/server). It's the
right starting point for this app's actual scale; if you outgrow one box,
the same images work behind a managed load balancer or in Kubernetes -
see "Scaling beyond one host" at the end.

## 1. What's in the box

| Piece | File | Notes |
|---|---|---|
| API (NestJS) | `apps/api/Dockerfile` | Multi-stage, prunes dev deps, non-root user, healthcheck |
| Staff/caregiver app (Next.js) | `apps/web/Dockerfile` | Standalone output, served under `/staff` |
| Public patient/guardian app (Next.js) | `apps/public-web/Dockerfile` | Standalone output |
| Orchestration | `docker-compose.prod.yml` | MySQL + all three apps + nginx |
| Reverse proxy | `deploy/nginx.conf` | Single public origin, routes by path |
| Env template | `.env.production.example` | Copy to `.env.production` and fill in |

All three Dockerfiles are built **from the repo root** (`context: .` in the
compose file), because the API and the public-web app both depend on the
`packages/shared` workspace - a build context scoped to just one app
folder can't see it. Each Dockerfile only copies in the `package.json`s
of the workspaces it actually needs (not the whole monorepo), so each
image only installs and ships that service's own dependency tree.

## 2. First deploy, step by step

### 2.1 Provision a host

Any VM with Docker + the Compose plugin works (2 vCPU / 4 GB RAM is
comfortable for this app's scale). Point a DNS A record at it before you
start - the HTTPS step below needs that in place.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this
```

### 2.2 Get the code and configure secrets

```bash
git clone https://github.com/anjana55/care_platform.git
cd care_platform
cp .env.production.example .env.production
```

Edit `.env.production`:
- Replace every `yourdomain.example` with your real domain.
- Generate secrets - never reuse the values in `.env.example`, those are
  dev-only:
  ```bash
  openssl rand -base64 32   # MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD
  openssl rand -base64 48   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
  ```
- `NEXT_PUBLIC_API_URL` should be `https://yourdomain.example/api` - it's
  baked into the frontend bundles at *build* time (see 2.4), not read at
  container start, because it's a `NEXT_PUBLIC_*` variable that ends up
  in client-side JavaScript.

Keep `.env.production` off the server's shell history and out of git -
it's already covered by `.gitignore`, but a copy left in `~/.bash_history`
from pasting it in isn't. Prefer `scp`-ing the file over, or a secrets
manager (see "Secrets in CI" below) over pasting it into a terminal.

### 2.3 HTTPS

`deploy/nginx.conf` listens on port 80 only - TLS is intentionally left
for you to add, since it depends on how you want to manage certificates.
Two straightforward options:

**A - a managed load balancer in front** (simplest if you're on a cloud
provider): put an ALB/Cloud Load Balancer/etc. in front of the host,
terminate TLS there, and forward plain HTTP to port 80. No changes to
this repo needed.

**B - terminate TLS on the box itself** with Caddy instead of nginx (it
provisions and renews Let's Encrypt certificates automatically with no
extra steps): swap the `nginx` service in `docker-compose.prod.yml` for
a `caddy` service image, replace `deploy/nginx.conf` with a `Caddyfile`
using the same three `location` blocks as path-based reverse-proxy
rules, and publish `443` alongside `80`. Caddy needs to persist its
certificate volume so renewals survive container restarts.

If you'd rather keep nginx: add a `server { listen 443 ssl; ... }` block
with `ssl_certificate`/`ssl_certificate_key` pointing at certificates you
obtained separately (e.g. via a `certbot` container against the `/`
webroot), and redirect port 80 to 443.

### 2.4 Build and start everything

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The `build` step is separate from `up` on purpose the first time:
`NEXT_PUBLIC_API_URL` only takes effect on a rebuild (see 2.2), so if you
ever change it, `build` again before `up`.

### 2.5 Run database migrations

The API image ships the compiled migration runner and the raw `.sql`
files, but doesn't run migrations automatically on boot (auto-migrating
on every container start is a common source of split-brain schema
changes when you scale to more than one API replica). Run them
explicitly, once, after the `mysql` service is healthy:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -w /app/apps/api api node dist/src/database/migrate.js
```

The `-w /app/apps/api` matters: the migration runner resolves the
migrations folder as `./src/database/migrations` relative to the
process's working directory, not relative to the script's own location.

Run this again after every deploy that includes new migration files
(check `apps/api/src/database/migrations/` in the diff).

### 2.6 Verify

```bash
curl -I https://yourdomain.example/            # public-web
curl -I https://yourdomain.example/staff/login # staff app
curl -I https://yourdomain.example/api/api/docs # api (note: /api/api - see below)
```

The API has no path prefix of its own, so nginx's `/api/` location
strips the api mounts nothing separately - meaning the API's own
Swagger docs (`/api/docs`) end up at the public `/api/api/docs`. This is
a minor cosmetic wrinkle worth knowing about rather than a functional
issue: everything the frontends actually call (`/api/auth/login`,
`/api/public/search`, etc.) works exactly as expected.

## 3. Subsequent deploys

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
# then, only if new migration files were added:
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -w /app/apps/api api node dist/src/database/migrate.js
```

`up -d` recreates only the containers whose image actually changed, so
this is safe to run even when only one service changed.

## 4. Backups

Two things need backing up; neither is covered by the compose file
itself:

- **`mysql-data` volume** - the database. Simplest approach, a nightly
  logical dump to somewhere off-box (S3, a backup VM, etc.):
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.production \
    exec mysql sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" care_platform' \
    > "care_platform_$(date +%F).sql"
  ```
  Wire this into a cron job or your host's scheduler, and test restoring
  it at least once - a backup you haven't restored is a hypothesis, not
  a backup.
- **`caregiver-documents` volume** - uploaded qualification/ID/verification
  files. `docker run --rm -v care_platform_caregiver-documents:/data -v $(pwd):/backup alpine tar czf /backup/documents_$(date +%F).tar.gz -C /data .`
  (adjust the volume name to whatever `docker volume ls` shows - compose
  prefixes it with the project name).

Back both up on the same schedule - a database restore that references
documents from after your last file backup (or vice versa) creates
orphaned or missing records.

## 5. Secrets in CI

If you set up CI/CD to build and push these images (GitHub Actions,
etc.), keep the values from `.env.production` in your CI provider's
encrypted secrets store (GitHub Actions "Environments" + secrets, not
repo variables) - never in a committed file, and never printed in build
logs. A minimal pipeline shape:

1. On push to `main`: run `apps/api`'s and each frontend's test suite
   (`npm test` - see README section 4) and `tsc --noEmit`.
2. On a tagged release: build each Docker image, push to a registry
   (GHCR, ECR, etc.), then SSH to the host (or use a deploy action) to
   `docker compose pull && docker compose up -d` with the new tags.
3. Run the migration step (2.5) as an explicit, separate pipeline step
   after the new `api` container is up - never inside the image's `CMD`.

This repo doesn't include a CI workflow file yet - the above is a
starting shape, not a ready-made `.github/workflows/*.yml`.

## 6. Monitoring and logs

Nothing here ships a metrics/log aggregation stack - for a deployment
this size, `docker compose logs -f api` and your host's disk/CPU
alerting will get you a long way before you need more. When you do:
- **Logs**: point Docker's log driver at your aggregator of choice
  (`docker-compose.prod.yml`'s `logging:` key, or a host-level Docker
  daemon config), rather than adding a sidecar container per service.
- **Uptime**: each service's `HEALTHCHECK` (visible in `docker compose
  ps`) is enough for Docker's own restart policy; wire an external
  uptime check (UptimeRobot, a status-page service, etc.) against
  `https://yourdomain.example/` for real user-facing monitoring.
- **Errors**: there's no APM/error-tracking SDK wired into the API or
  either frontend. Adding Sentry (or similar) is a small, contained
  change if/when you want it - it's not included here to avoid baking
  in a vendor choice for you.

## 7. Scaling beyond one host

The API is stateless (JWTs, no in-memory session state), so running
multiple `api` replicas behind nginx's `least_conn`/round-robin is
straightforward if you ever need it - just don't run migrations from
more than one place at once (2.5 already isolates that as a manual
step for exactly this reason). The bigger constraint at that point is
`STORAGE_DRIVER=local`: uploaded documents live on the `api` container's
own volume, so with multiple replicas you'd need either a shared volume
(NFS/EFS) or to switch to an object-storage-backed `StorageService`
implementation (see `apps/api/src/storage/` - the interface is already
factored to support swapping the local driver for one).

## 8. What this deliberately doesn't do

- No automatic image size optimization beyond Next's `output: standalone`
  and `npm prune` for the API - a monorepo-aware pruning tool (Turborepo,
  or per-app lockfiles) would shrink these further if image size becomes
  a real cost.
- No blue/green or zero-downtime deploy orchestration - `docker compose
  up -d` briefly drops connections mid-restart. Acceptable for this
  app's scale; worth revisiting if uptime SLAs tighten.
- No secrets manager integration (Vault, AWS Secrets Manager, etc.) -
  `.env.production` is deliberately the simplest thing that works for a
  single-host deploy.
