# PMA Management

Sistema de gestión ambiental (PMA, RGDP, GEO) construido como monorepo con Next.js y Fastify.

## Arquitectura

```
pma-management/
├── apps/
│   ├── web/          Next.js 14 — frontend (puerto 3000 en dev / 8000 en Docker prod)
│   └── api/          Fastify + Drizzle + Postgres (puerto 4000 en dev local / 3001 en Docker)
└── packages/
    └── types/        Tipos TypeScript compartidos
```

## Requisitos

- Node.js >= 20
- npm >= 9
- Docker y Docker Compose (solo para despliegue en contenedor)
- PostgreSQL 16 (solo para desarrollo local sin Docker)

---

## Desarrollo local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno de la API

```bash
cp apps/api/.env.example apps/api/.env
```

Editar `apps/api/.env` con los valores correctos:

```env
NODE_ENV=development
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000

JWT_ACCESS_SECRET=<mínimo 32 caracteres>
JWT_REFRESH_SECRET=<mínimo 32 caracteres>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pma_db

STORAGE_ROOT=./data/storage
STORAGE_PUBLIC_BASE_URL=http://localhost:4000/storage

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="PMA Management <no-reply@example.com>"
```

Generar secretos seguros para producción:
```bash
openssl rand -base64 48
```

### 3. Levantar PostgreSQL con Docker (recomendado)

```bash
docker compose up postgres -d
```

O apuntar `DATABASE_URL` a una instancia de PostgreSQL existente.

### 4. Ejecutar migraciones

```bash
# Generar archivos SQL desde el schema de Drizzle
npm run db:generate -w apps/api

# Aplicar migraciones a la base de datos
npm run db:migrate -w apps/api
```

### 5. Crear usuario administrador

```bash
npm run seed:admin -w apps/api
```

El script pedirá correo, nombre y contraseña de forma interactiva.

### 6. Iniciar los servidores de desarrollo

En terminales separadas:

```bash
# Terminal 1 — API (hot reload)
npm run dev:api

# Terminal 2 — Web (hot reload)
npm run dev:web
```

| Servicio    | URL                        |
|-------------|----------------------------|
| Web         | http://localhost:3000      |
| API         | http://localhost:4000      |
| API Health  | http://localhost:4000/health |

---

## Base de datos — comandos de migraciones

Todos los comandos se ejecutan desde la raíz del monorepo.

```bash
# Generar nuevos archivos de migración SQL desde el schema
npm run db:generate -w apps/api

# Aplicar todas las migraciones pendientes
npm run db:migrate -w apps/api

# Sincronizar el schema directamente a la DB (solo desarrollo, sin generar archivos)
npm run db:push -w apps/api

# Abrir Drizzle Studio (UI visual de la base de datos)
npm run db:studio -w apps/api
```

### Usuarios y seeds

```bash
# Crear administrador de forma interactiva (pide datos por consola)
npm run seed:admin -w apps/api

# Crear administrador desde variables de entorno (automatizado)
npm run seed:admin:env -w apps/api
```

Los demás usuarios se crean desde el panel de administración (`/admin/users`),
que también genera la invitación para establecer contraseña.

---

## Despliegue con Docker

### Variables de entorno para Docker

Crear el archivo `.env` en la raíz del proyecto (donde está `docker-compose.yml`):

```bash
cp .env.example .env
```

Editar `.env` con los valores correctos:

```env
DB_NAME=pma_db
DB_USER=postgres
DB_PASSWORD=cambia_esto_en_produccion

JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>

FRONTEND_ORIGIN=http://localhost:8000
STORAGE_PUBLIC_BASE_URL=http://localhost:3001/storage
COOKIE_SECURE=false
```

En producción con HTTPS, usar `COOKIE_SECURE=true` y ajustar `FRONTEND_ORIGIN` /
`STORAGE_PUBLIC_BASE_URL` al dominio público real.

### Levantar todos los servicios

```bash
docker compose up -d
```

| Servicio    | URL                        |
|-------------|----------------------------|
| Web         | http://localhost:8000      |
| API         | http://localhost:3001      |
| PostgreSQL  | localhost:5432             |

### Ejecutar migraciones en el contenedor

```bash
docker compose exec api node dist/apps/api/src/db/run-migrations.js
```

### Crear administrador en el contenedor

```bash
docker compose exec -it api node dist/apps/api/src/scripts/seed-admin.js
```

### Ver logs

```bash
# Todos los servicios
docker compose logs -f

# Un servicio específico
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres
```

### Otros comandos de Docker

```bash
# Detener todos los servicios
docker compose down

# Detener y eliminar volúmenes (borra la base de datos)
docker compose down -v

# Reconstruir imágenes desde cero
docker compose build --no-cache

# Reiniciar un servicio
docker compose restart api

# Ver estado de los servicios
docker compose ps
```

---

## Build de producción (sin Docker)

```bash
# Compilar todos los workspaces
npm run build

# O individualmente
npm run build:api
npm run build:web
```

---

## Verificación de tipos y lint

```bash
# Typecheck de todos los workspaces
npm run typecheck

# Lint de todos los workspaces
npm run lint
```
