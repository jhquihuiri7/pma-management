# PMA Management

Sistema de gestión ambiental (PMA, RGDP, GEO, Galápagos Previene) construido como
monorepo con Next.js y Fastify.

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
# Debe ser una identidad verificada en SES (dominio o correo verificado).
SMTP_FROM="PMA Management <no-reply@tudominio.com>"
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

FRONTEND_ORIGIN=https://sigtar.gobiernogalapagos.gob.ec
STORAGE_PUBLIC_BASE_URL=https://sigtar.gobiernogalapagos.gob.ec/storage
COOKIE_SECURE=true

NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
NGINX_SSL_CERT_DIR=/etc/ssl/cgreg
```

El contenedor de Nginx monta los certificados desde `NGINX_SSL_CERT_DIR`.
Para `sigtar.gobiernogalapagos.gob.ec` espera estos archivos en el servidor:
`star_gobiernogalapagos_gob_ec.crt` y `gobiernogalapagos_wildcard.key`.

### Levantar todos los servicios

```bash
docker compose up -d
```

| Servicio    | URL                        |
|-------------|----------------------------|
| Nginx HTTPS | https://sigtar.gobiernogalapagos.gob.ec |
| Web/API     | Sólo mediante Nginx HTTPS  |
| PostgreSQL  | Sólo red interna de Docker |

`./deploy.sh up` ejecuta el mismo compose de producción y levanta Nginx junto
con web, api, postgres, worker y titiler. Si el Nginx del host sigue usando los
puertos 80/443, detenerlo antes de levantar el contenedor o cambiar
`NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT`.

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

## Galápagos Previene — reportes ciudadanos

Cuarto subsistema (`previene`). Muestra en un mapa los reportes de emergencias y
eventos naturales que la población envía por un bot de Telegram, con foto o
video, ubicación GPS y descripción.

### Por qué necesita backend

La API de reportes es de solo lectura, escucha en el loopback del servidor, no
tiene CORS y exige `Authorization: Bearer <clave>` en todas sus rutas. Nada de
eso funciona desde el navegador: la clave quedaría expuesta, la petición sería
bloqueada por CORS y una etiqueta `<img>` no puede enviar cabeceras. El SIGTAR
actúa de intermediario:

```
navegador ──► SIGTAR (caché + proxy + streaming) ──► API de reportes ──► Telegram
   sesión                                            127.0.0.1:8080
```

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PREVIENE_API_BASE_URL` | `http://127.0.0.1:8080` | Base de la API de reportes |
| `PREVIENE_API_KEY` | *(vacía)* | Clave Bearer. Vacía = módulo en modo desconectado |
| `PREVIENE_SYNC_INTERVAL_MS` | `120000` | Cada cuánto sincroniza el worker |
| `PREVIENE_PAGE_SIZE` | `200` | Tamaño de página (máximo admitido por la API) |
| `PREVIENE_MAX_PAGES_PER_RUN` | `100` | Tope de páginas por ciclo |
| `PREVIENE_SYNC_TIMEOUT_MS` | `20000` | Timeout de las llamadas de sincronización |
| `PREVIENE_MEDIA_TIMEOUT_MS` | `30000` | Timeout hasta el primer byte de una evidencia |

**En Docker la URL no puede ser `127.0.0.1`.** Dentro de un contenedor el
loopback es el propio contenedor, no el host. `docker-compose.yml` y
`docker-compose.dev.yml` declaran `extra_hosts: host.docker.internal:host-gateway`
en `api` y `worker`, así que el valor correcto es:

```env
PREVIENE_API_BASE_URL=http://host.docker.internal:8080
PREVIENE_API_KEY=<la clave, fuera del repositorio>
```

La clave se lee solo en el servidor. No aparece en plantillas, bundles ni
respuestas JSON, y el cliente HTTP evita registrarla en los logs.

### Puesta en marcha

```bash
# 1. Migración (crea previene_reports, previene_media, previene_event_types,
#    previene_sync_state y añade 'previene' al enum app_key)
npm run db:migrate -w apps/api

# 2. Configurar las variables y levantar api + worker
docker compose up -d --build --wait api worker

# 3. Dar acceso al subsistema desde /admin/users (los ADMIN ya lo tienen)
```

La ingesta corre dentro del worker; no hay que lanzarla a mano. Para forzar un
ciclo, un ADMIN puede pulsar **Reintentar** en el visor, que llama a
`POST /previene/api/sync`.

### Cómo funciona la ingesta

El worker recorre `/v1/reports` con su cursor incremental (`since` + `cursor_id`)
hasta que `next` es `null`, y guarda **la página y su cursor en la misma
transacción**. Si el proceso muere a mitad, el cursor sigue apuntando a la última
página confirmada: el siguiente ciclo vuelve a leerla (el upsert por `id` lo
absorbe) en lugar de saltársela. Un 502/503 aborta el ciclo sin avanzar; un
400/401/422 se registra en `previene_sync_state.last_error` y alimenta el banner
rojo del visor.

### Evidencias

Las fotos y videos no se guardan: viven en los servidores de Telegram y se
transmiten en streaming por `GET /previene/media/{id}`, que reenvía la cabecera
`Range` y propaga el `206`/`Content-Range` (sin eso el `<video>` no permite
buscar). Un `404` del origen —Telegram dejó de conservar el archivo— se registra
en la caché y el panel lo muestra como *Evidencia no disponible (404)*.

> Consecuencia operativa: **una evidencia caducada en Telegram se pierde de forma
> definitiva.** Si en el futuro se necesita conservarlas, hay que añadir una copia
> propia en el NAS durante la ingesta.

### Privacidad

La API entrega un `reporter_id` anónimo por persona. El módulo no lo almacena:
la tabla `previene_reports` no define esa columna, de modo que ninguna consulta,
serializador o exportación futura puede filtrarlo. Hay pruebas que lo verifican
en los dos límites, el de ingesta y el de lectura.

### Pruebas del módulo

```bash
# Contratos del cliente (sin base de datos ni red)
npm run test -w apps/api -- src/tests/previeneContracts.test.ts

# Ingesta y proxy (requieren DATABASE_URL con las migraciones aplicadas)
npm run test -w apps/api -- src/tests/previeneSync.integration.test.ts
npm run test -w apps/api -- src/tests/previeneMediaProxy.integration.test.ts
```

> **No apuntes las pruebas de integración a una base con datos reales.** Para
> aislarse, borran filas de `previene_event_types` y ponen a cero el cursor de
> `previene_sync_state`. Contra la base de producción eso obligaría a releer el
> catálogo completo en el siguiente ciclo. Usa una base desechable:
>
> ```bash
> docker run -d --rm --name sigtar-test-db -e POSTGRES_PASSWORD=test \
>   -e POSTGRES_DB=sigtar_test -p 55432:5432 postgres:16
> ```

### Limitación conocida: búsqueda en los videos

La API de reportes **no implementa `Range`** en `/v1/media/{id}/content`
(comprobado contra el despliegue: ignora la cabecera y responde `200` con
`transfer-encoding: chunked`). El proxy del SIGTAR reenvía la cabecera y
propaga `206`/`Content-Range` en cuanto el origen los devuelva, pero mientras
no lo haga el navegador debe descargar el video completo antes de poder
avanzar dentro de él. La corrección corresponde a la API de reportes, no al
visor.

## Verificación de tipos y lint

```bash
# Typecheck de todos los workspaces
npm run typecheck

# Lint de todos los workspaces
npm run lint
```
