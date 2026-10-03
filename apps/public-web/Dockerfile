# syntax=docker/dockerfile:1

# Built from the monorepo root (see docker-compose.prod.yml's `context: .`)
# because apps/public-web depends on the packages/shared workspace.
#
#   docker build -f apps/public-web/Dockerfile -t care-platform-public-web .

FROM node:20-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/public-web/package.json apps/public-web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/public-web apps/public-web
COPY packages/shared packages/shared
# shared FIRST: its package.json points `main`/`exports` at dist/, so Next
# resolves @care-platform/shared to dist/index.js. Only the build outputs
# matter here - the "./i18n" subpath still points at the raw .tsx source,
# which is what lets Next apply the 'use client' directive.
RUN npm run build -w @care-platform/shared
# NEXT_PUBLIC_* values are baked into the client bundle at build time, not
# read at container start - they must be supplied as build args, and the
# image rebuilt whenever the API's public URL changes.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w @care-platform/public-web

# ---- runtime image ----
# `output: 'standalone'` (next.config.js) traces only the files each page
# actually imports into .next/standalone, instead of shipping the full
# node_modules tree - .next/static and any public/ assets are emitted
# separately and have to be copied in alongside it by hand.
FROM node:20-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Because this is an npm workspace, standalone output preserves the
# monorepo layout: the server entrypoint is at apps/public-web/server.js,
# not at the copy's root.
COPY --from=builder /repo/apps/public-web/.next/standalone ./
COPY --from=builder /repo/apps/public-web/.next/static ./apps/public-web/.next/static

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/public-web/server.js"]
