# syntax=docker/dockerfile:1
#
# The persistent worker: socket.io gateway + pg-boss jobs + UEX ingest.
#   docker build -f docker/server.Dockerfile -t kcx-server .
#
# Runs TypeScript directly via tsx. The workspace packages are consumed as TS source
# (`main: src/index.ts`), so a tsc build step would mean emitting and rewiring all of them
# for no runtime benefit — tsx keeps one source of truth.

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat && npm install -g pnpm@11.20.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
# --ignore-scripts: no native builds needed here, and it keeps the image reproducible.
RUN pnpm install --frozen-lockfile --filter @kcx/server... --ignore-scripts

FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S kcx && adduser -S kcx -G kcx

COPY --from=deps --chown=kcx:kcx /app/node_modules ./node_modules
COPY --from=deps --chown=kcx:kcx /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps --chown=kcx:kcx /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps --chown=kcx:kcx /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --chown=kcx:kcx package.json pnpm-workspace.yaml ./
COPY --chown=kcx:kcx apps/server ./apps/server
COPY --chown=kcx:kcx packages ./packages

USER kcx
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
