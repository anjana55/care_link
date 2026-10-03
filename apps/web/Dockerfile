# syntax=docker/dockerfile:1

# Built from the monorepo root (see docker-compose.prod.yml's `context: .`)
# because apps/web depends on the packages/shared workspace - the Locale type
# its i18n provider and location hooks import.
#
#   docker build -f apps/web/Dockerfile -t care-platform-web .

FROM node:20-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/shared packages/shared
# See apps/public-web/Dockerfile - same NEXT_PUBLIC_* build-time caveat.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w @care-platform/web

# ---- runtime image ----
FROM node:20-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

USER app
EXPOSE 3000

# basePath is '/staff' (next.config.js), so the healthcheck and any reverse
# proxy routing must include it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/staff/login',(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
