FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copiar toda la estructura del monorepo
COPY package-lock.json* package.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci --workspace=@pma/api

FROM base AS builder
WORKDIR /app
RUN npm run build --workspace=@pma/api
RUN npm prune --omit=dev --omit=optional --workspace=@pma/api

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copiar solo lo necesario
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# npm may keep workspace-specific versions nested under apps/api/node_modules.
# Mirror that hierarchy next to the compiled workspace so Node's ESM resolver
# sees the exact dependency tree produced by npm ci/prune.
COPY --from=builder /app/apps/api/node_modules ./dist/apps/api/node_modules
COPY --from=builder /app/packages ./packages
# Migration SQL files (not emitted by tsc, copied explicitly)
COPY --from=builder /app/apps/api/src/db/migrations ./dist/apps/api/src/db/migrations
# Canonical RGDT catalog consumed by the authenticated API endpoint.
COPY --from=builder /app/apps/web/public/data/rgdt-residuos.csv ./data/rgdt-residuos.csv

EXPOSE 3001

CMD ["node", "dist/apps/api/src/index.js"]
