FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copiar toda la estructura del monorepo
COPY package-lock.json* package.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools

RUN npm ci --workspace=@pma/api

FROM base AS builder
WORKDIR /app
RUN npm run build --workspace=@pma/api

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copiar solo lo necesario
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 3001

CMD ["node", "dist/index.js"]
