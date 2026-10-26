# syntax=docker/dockerfile:1

# Built from the monorepo root (see docker-compose.prod.yml's `context: .`)
# because apps/api depends on the packages/shared workspace - a build
# context scoped to apps/api alone can't resolve that dependency.
#
#   docker build -f apps/api/Dockerfile -t care-platform-api .

FROM node:20-alpine AS builder
WORKDIR /repo

# Only the two workspaces this image actually needs (api + the shared
# package it depends on) are copied in - not apps/web or apps/public-web.
# npm's workspace resolution only looks at package.json files that are
# actually present on disk, so `npm ci` here installs exactly api's
# dependency graph rather than the whole monorepo's.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/shared packages/shared
# shared FIRST: its package.json points `main` at dist/, so the API's own
# compile has to be able to read dist/index.d.ts. Built as CommonJS because
# this image runs `node dist/src/main.js` with no transpiler - Node loads
# packages/shared/dist/index.js directly.
RUN npm run build -w @care-platform/shared
RUN npm run build -w @care-platform/api
# Strips devDependencies (typescript, jest, ts-node, ...) from node_modules
# without needing a second, separate `npm ci --omit=dev` pass (which would
# otherwise redo dependency resolution from scratch).
RUN npm prune --omit=dev
# npm puts a package in apps/api/node_modules instead of the root when another
# workspace pins a different version of it (sharp: Next.js wants one version,
# the API another). Those nested packages are the API's own runtime
# dependencies, so the runtime image needs that folder too. Created here so the
# COPY below never fails when nothing happens to be nested.
RUN mkdir -p apps/api/node_modules

# ---- runtime image ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init \
  && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
# Without this, anything npm nested under apps/api is missing at runtime and
# the API dies at boot with "Cannot find module" (it did, for sharp).
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/packages/shared ./packages/shared
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
# Migrations run as a container command against the compiled dist (see
# apps/api/package.json's db:migrate and DEPLOYMENT.md), so the SQL files
# need to ship too - they're plain .sql, not compiled by `nest build`.
# migrate.js resolves them relative to CWD as `./src/database/migrations`,
# so this path (matching apps/api/'s own layout) must be run from
# /app/apps/api - see the CMD note in DEPLOYMENT.md's migration step.
COPY --from=builder /repo/apps/api/src/database/migrations ./apps/api/src/database/migrations
# seed-production.js (run the same way, see DEPLOYMENT.md's seed step)
# reads locations.csv relative to __dirname instead - i.e. relative to
# itself once compiled - so this copies to dist/src/database/seed-data,
# not src/database/seed-data like the migrations above.
COPY --from=builder /repo/apps/api/src/database/seed-data ./apps/api/dist/src/database/seed-data

# Create the local-storage root owned by the runtime user, before dropping
# privileges. STORAGE_LOCAL_ROOT (docker-compose.prod.yml) mounts a named
# volume over this path, and an empty named volume inherits its uid/gid from
# the image path it first covers - so this directory's ownership is what the
# volume gets. Left root-owned (the default), the volume came up 0755
# root:root while the app runs as uid=100(app), and every upload died with
# "EACCES: permission denied, mkdir" - see DEPLOYMENT.md.
RUN mkdir -p /storage/caregiver-documents && chown -R app:app /storage
USER app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/docs',(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["dumb-init", "node", "apps/api/dist/src/main.js"]
