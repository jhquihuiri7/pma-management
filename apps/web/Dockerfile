FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copiar toda la estructura del monorepo
COPY package-lock.json* package.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools

RUN npm ci --workspace=@pma/web

FROM base AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@pma/web

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
