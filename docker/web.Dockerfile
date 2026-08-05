# syntax=docker/dockerfile:1
#
# Next.js app. Built from the monorepo root:
#   docker build -f docker/web.Dockerfile -t kcx-web .
#
# Corepack is deliberately not used (its bundled status is being unwound in newer Node
# lines); pnpm is pinned explicitly instead.

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat && npm install -g pnpm@11.20.0
WORKDIR /app

# ---- deps: cached on the lockfile alone ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next reads NEXT_PUBLIC_* at build time for client bundles. KCX passes the socket URL
# from a server component as a prop, so it stays a runtime value — nothing to bake here.
RUN pnpm --filter @kcx/web build

# ---- runtime ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S kcx && adduser -S kcx -G kcx

# `output: "standalone"` emits a self-contained server plus only the node_modules it needs.
COPY --from=build --chown=kcx:kcx /app/apps/web/.next/standalone ./
COPY --from=build --chown=kcx:kcx /app/apps/web/.next/static ./apps/web/.next/static
# The bracket makes the source a glob: if public/ is ever absent the COPY resolves to
# nothing instead of failing the build. Next only creates public/ when assets exist.
COPY --from=build --chown=kcx:kcx /app/apps/web/publi[c] ./apps/web/public

# The upload target must exist in the IMAGE, owned by the runtime user, before anything
# mounts over it. Docker seeds a new named volume from whatever is at the mount path —
# including ownership — but only if that path exists. Without this the volume was created
# root:root 755 while the app runs as kcx, so every single upload failed with EACCES:
# contract images and org logos alike. The org logo path swallows the error to keep a missing
# badge from failing a page, so the symptom was a blank square rather than an error anyone
# would see, and it stayed invisible until someone asked why a logo wasn't showing.
RUN mkdir -p /app/uploads && chown kcx:kcx /app/uploads

USER kcx
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
