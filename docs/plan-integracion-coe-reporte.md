# Plan de integración: Reporte territorial diario del COE como módulo del SIGTAR

**COE Provincial de Galápagos · Programación (corte 08h00) y resultados (corte 19h00) de las actividades territoriales**

> **Estado (2026-11-26):** **implementado y verificado** contra una base desechable (pruebas unitarias y de integración, y recorrido en navegador en escritorio, móvil y con sesión). Sin commit y **sin desplegar**: falta el respaldo y la migración 0049 en la base compartida (§7). Las decisiones de §8 las tomó el usuario el 2026-11-26.
>
> **Origen:** `COE_Galapagos_Proyecto.zip` (15 archivos). Es una app de Vercel sin framework: HTML + JS sin dependencias en `public/`, funciones serverless en `api/` y `lib/`, y todos los datos en **Vercel Blob** como archivos JSON (sin base de datos).
> **Repositorio:** `pma-management`, rama `dev-migration`.

---

## 0. Resumen

Crear el módulo **Reporte territorial COE** (`app_key` `coe_reporte`, ruta `/coe-reporte`) **portando** la app al stack del SIGTAR, sin embeber el código de Vercel:

- **API Fastify + Postgres** en lugar de Vercel Blob: tablas propias, validación con zod, escritura idempotente y avisos por correo a través de la cola existente `mail_outbox_jobs`, que ya procesa el worker.
- **Web Next.js** con dos secciones, igual que el módulo Gestión de Riesgos:
  - **Reporte** (público, sin cuenta): pestañas *08h00 · Programación* y *19h00 · Resultados*, y *Mi historial*.
  - **Tablero** (con sesión del SIGTAR): indicadores, anillo de estados, barras por isla, diagrama de conexiones evento → institución → isla, detalle, CSV, destinatarios de correo y directorio de delegados.
- **Se elimina el acceso propio del administrador** (correo fijo en el código, enlace de activación por token, contraseña scrypt en un blob y cookie firmada). Lo sustituyen los usuarios del SIGTAR y `user_apps`.

---

## 1. Qué hace la app original

### 1.1 Flujo de reporte (público)

| Paso | Qué hace | Archivo |
|---|---|---|
| Código de historial | Al abrir la página se genera un código aleatorio de 43 caracteres (32 bytes en base64url) que se guarda en `localStorage`. Sirve de identidad anónima: la API guarda solo su SHA-256. Desde *Mi historial* se copia o se recupera en otro dispositivo. | `public/app.js` (`memberCode`) |
| Evento | Se elige uno o se crea con un nombre. El código es `EVT-<año>-<16 hex del SHA-256 del nombre normalizado>`, así que el mismo nombre en el mismo año da el mismo evento. | `lib/reports.js` (`createEvent`) |
| Programación (08h00) | Evento, fecha, isla (5 + «Otra isla»), sector, institución (42 en 7 grupos + «OTRO»), instancia de coordinación (MTT 1–7, GT 1–3 o acción directa) y descripción. Queda con estado `pending`. | `saveRow` |
| Resultado (19h00) | Para cada actividad pendiente: ¿se cumplió? Sí → `done`; No → `partial` o `missed` con motivo obligatorio. Descripción del resultado e indicadores numéricos (indicador, cantidad ≥ 0, unidad; hasta 16). Una vez registrado, no se puede cambiar. | `saveResult` |
| No programada | Actividad que se registra ya con su resultado (`extra`). | `saveRow` con `status: "extra"` |
| Evidencias | Fotos y videos (hasta 5, 15 MB cada uno) **programados pero desactivados**: `api/reports.js` responde 403 a cualquier carga. | `uploadLinks` |

### 1.2 Tablero de administración

- **Filtros:** fecha, evento, isla, estado, institución.
- **Indicadores:** actividades, cumplidas sobre programadas, pendientes y % de cumplimiento (cumplidas / programadas; las no programadas no cuentan).
- **Gráficos:** anillo de estados (`conic-gradient`), barras por isla y un diagrama SVG de tres columnas (evento → institución → isla) con la tabla de cantidades debajo. La tabla permite filtrar por evento.
- **Detalle** de cada actividad, **CSV** (BOM UTF-8 y protección contra inyección de fórmulas) y actualización automática cada 30 s.
- **Destinatarios** de los avisos (hasta 250 correos).
- **Usuarios y accesos:** en realidad es un **directorio de delegados** (nombre, correo, institución) **sin acceso** al tablero.

### 1.3 Avisos por correo

Cada programación o resultado guardado se encola en el blob y se envía a todos los destinatarios por Resend o Gmail SMTP. Un cron diario de Vercel (`/api/mail`, 15:00 UTC) reintenta con espera exponencial. El asunto es `[COE Galápagos] Programación|Resultado · <evento>` y el cuerpo es texto plano con todos los campos y el enlace al tablero.

### 1.4 Lo que no se porta

- `@vercel/blob`, `@vercel/functions`, `vercel.json`, `api/mail.js` (cron) y `lib/gmail-environment.js`.
- El acceso del administrador (`api/admin.js` y `lib/dashboard-data.js`), con su correo fijo en el código, `COE_SETUP_HASH`, `COE_SETUP_EXPIRES` y `COE_SESSION_SECRET`. **Ese correo no debe llegar al repositorio, que es público.**
- Los dominios fijos (`coe-galapagos-reporte-demo.vercel.app`, `reportecoe.vercel.app`) y las comprobaciones de `Origin`/`Host` asociadas. Se sustituyen por `assertPublicWriteOrigin`.
- Las cargas de evidencias, porque el original ya las tenía desactivadas (ver D5).

---

## 2. Arquitectura en el SIGTAR

```
 Navegador (sin cuenta)                       Navegador (sesión SIGTAR + coe_reporte)
 /coe-reporte/reporte                         /coe-reporte/tablero
   │  X-Codigo-Historial: <43 chars>            │  cookie pma_access
   ▼                                            ▼
 API Fastify  /coe-reporte/public/*           API Fastify  /coe-reporte/*  [authenticate, requireApp("coe_reporte")]
   │  zod · assertPublicWriteOrigin · enforceAuthRateLimit
   ▼
 Postgres: coe_eventos · coe_actividades · coe_destinatarios · coe_delegados
   │  (misma transacción)
   ▼
 mail_outbox_jobs ──► worker (processPendingMail, ya existe) ──► SMTP
```

- El código de historial viaja en una cabecera propia, `X-Codigo-Historial`, y no en `Authorization: Bearer`. Así no se confunde con el token del SIGTAR. Se guarda solo `sha256(código)` y nunca se registra en los logs.
- El aviso se encola **en la misma transacción** que la actividad. El original podía dejar la actividad guardada sin aviso (*«Pulsa Guardar otra vez para preparar el aviso»*); aquí eso no puede pasar.
- Los reintentos los hace el worker, que ya vacía `mail_outbox_jobs`. No hace falta cron nuevo, así que **el worker no se reconstruye**: el mensaje se arma completo en la API.

---

## 3. Base de datos (migración 0049)

`0049_coe_reporte_module.sql`, con `when` **1793277600000** (la última es la 0048, 1793177600000), más `rollback/0049_down.sql` y su entrada en `meta/_journal.json`. Se escribe a mano: **no se usa `db:generate`**.

```sql
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'coe_reporte';

CREATE TABLE coe_eventos (
  id          text PRIMARY KEY,               -- EVT-2026-XXXXXXXXXXXXXXXX
  titulo      text NOT NULL,                  -- ≤ 150, espacios colapsados
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coe_actividades (
  id            uuid PRIMARY KEY,             -- lo genera el navegador: reintentos idempotentes
  propietario   char(64) NOT NULL,            -- sha256 del código de historial
  evento_id     text NOT NULL REFERENCES coe_eventos(id),
  dia           date NOT NULL,
  isla          text NOT NULL,                -- ≤ 90
  sector        text NOT NULL,                -- ≤ 120
  institucion   text NOT NULL,                -- ≤ 150 (nombre oficial si coincide normalizado)
  instancia     text NOT NULL CHECK (instancia IN ('MTT','GT','Directa')),
  equipo        text NOT NULL DEFAULT '',     -- 'MTT 1'..'MTT 7' | 'GT 1'..'GT 3' | ''
  descripcion   text NOT NULL,                -- ≤ 2500
  metas         jsonb NOT NULL DEFAULT '[]',  -- [{indicador, cantidad, unidad}] ≤ 16
  estado        text NOT NULL CHECK (estado IN ('pending','done','partial','missed','extra')),
  resultado     text,                         -- ≤ 2500
  motivo        text,                         -- obligatorio en partial/missed
  numeros       jsonb NOT NULL DEFAULT '[]',
  envio_id      uuid,                         -- idempotencia del registro de resultado
  creado_en     timestamptz NOT NULL DEFAULT now(),
  completado_en timestamptz,
  CHECK (equipo = '' OR equipo ~ '^(MTT [1-7]|GT [1-3])$')
);
CREATE INDEX coe_actividades_propietario_idx ON coe_actividades (propietario, dia DESC);
CREATE INDEX coe_actividades_dia_idx ON coe_actividades (dia DESC, evento_id);

CREATE TABLE coe_destinatarios (
  email      text PRIMARY KEY,                -- minúsculas
  creado_por uuid REFERENCES users(id) ON DELETE SET NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coe_delegados (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  email       text NOT NULL UNIQUE,
  institucion text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
```

Las cantidades se guardan como texto numérico, igual que en el original («2.5» sigue siendo «2.5»), validado como finito y ≥ 0.

---

## 4. API (`apps/api/src/routes/coeReporte/index.ts`, prefijo `/coe-reporte`)

| Método y ruta | Acceso | Equivale a |
|---|---|---|
| `GET /public/catalogos` | público, caché 5 min | `groups`, `teams` y las islas de `app.js` |
| `GET /public/eventos` | público | `scope=events` |
| `POST /public/eventos` `{titulo}` | código + origen + límite | `createEvent` (idempotente por código) |
| `GET /public/mis-actividades` | `X-Codigo-Historial` | `scope=member` |
| `POST /public/actividades` | `X-Codigo-Historial` + origen + límite | `saveRow` (programada o `extra`); idempotente por `id` |
| `POST /public/actividades/:id/resultado` | `X-Codigo-Historial` + origen + límite | `saveResult`; idempotente por `envio` y 409 si ya tiene resultado |
| `GET /actividades?dia&evento&isla&estado&institucion` | sesión + `coe_reporte` | `scope=admin` |
| `GET /directorio` | sesión + `coe_reporte` | destinatarios, delegados y si hay SMTP configurado (`/api/admin` GET + `/api/mail` GET) |
| `POST /destinatarios` · `DELETE /destinatarios` `{email}` | rol ADMIN o REPORTER con acceso | `addRecipient` / `removeRecipient` |
| `POST /delegados` · `DELETE /delegados/:id` | rol ADMIN o REPORTER con acceso | `addUser` (quitar es nuevo) |

El CSV se arma en el navegador con las filas filtradas, igual que en el original (BOM UTF-8 y protección contra fórmulas); no hay endpoint de exportación.

Módulos en `apps/api/src/modules/coeReporte/`: `catalogos.ts`, `modelo.ts` (esquemas zod con los mismos límites del original), `actividadesModule.ts` (eventos y actividades), `avisosModule.ts` (arma el texto y el HTML del correo y llama a `enqueueMail`) y `directorioModule.ts`.

**Límites de los formularios públicos** (`enforceAuthRateLimit`, ventana de 24 h): crear evento, 20 por código y 100 por origen; registrar actividad o resultado, 300 por código y 2000 por origen. Si el COE trabaja desde una sola IP, el límite por origen se sube.

---

## 5. Web (`apps/web`)

| Ruta | Contenido |
|---|---|
| `/coe-reporte` | redirige a `/coe-reporte/reporte` |
| `/coe-reporte/reporte` (pública) | Pestañas Programación / Resultados, formulario de evento, resultado por actividad, no programadas, diálogo *Mi historial* |
| `/coe-reporte/tablero` (sesión) | Filtros, indicadores, anillo, barras por isla, diagrama de conexiones con su tabla, detalle, CSV, refresco cada 30 s, destinatarios y delegados |

- `components/coe-reporte/`: `CoeReporteShell` (cabecera con `logo-coe-galapagos.webp`, igual que `RiesgosShell`), `ReporteVista` (pestañas, resultados del día y diálogo *Mi historial*), `FormularioActividad`, `CamposResultado`, `TarjetaActividad`, `TableroVista` (filtros, indicadores, anillo, barras, detalle, destinatarios y delegados), `DiagramaConexiones` y `estilos.tsx`.
- `lib/coeReporte.ts`: cliente de API, código de historial (misma clave `coe.historial.codigo.v1` del original) y CSV.
- **Metas en la programación (añadido):** el original ya mostraba «Meta N unidad» al registrar el resultado, pero su formulario de programación nunca permitía cargarlas (enviaba `metrics: []`). Se añadió el bloque opcional «Metas» para que ese camino funcione.
- Los gráficos se portan **tal cual** (CSS `conic-gradient` y SVG propio), sin recharts. Los colores de estado y del diagrama se copian de `style.css`.
- Sin `components/ui/tabs`, que se ve roto con Tailwind 3.4: las pestañas son botones con `aria-pressed`, como en el original.
- La pestaña Tablero sin sesión es un `<a href>` y no un `<Link>`, para evitar el bucle de login que se vio en Riesgos.
- La fecha de hoy y el año del evento se calculan en `Pacific/Galapagos`.

---

## 6. Registro del módulo (puntos que se tocan)

Igual que con `protocolo_limpieza` y `simat`:

- `packages/types/src/index.ts` (`AppKey`) y un `packages/types/src/coeReporte.ts` nuevo con los tipos compartidos.
- `apps/api/src/db/schema/enums.ts` (`appKeyEnum`), `db/schema/coeReporte.ts` y su exportación en el índice del esquema.
- `apps/api/src/routes/users.ts` (las cuatro listas de apps; `.max(9)` → `.max(10)`), `auth/jwt.ts`, `modules/shared/assignmentPolicy.ts`, `modules/shared/usersModule.ts`, `scripts/seed-admin.ts` y `seed-admin-env.ts`.
- `apps/api/src/index.ts`: `app.register(coeReporteRoutes, { prefix: "/coe-reporte" })`.
- `apps/web/middleware.ts`: `/coe-reporte` y `/coe-reporte/reporte` en `PUBLIC_EXACT_PATHS` (no como prefijo, para no exponer el tablero).
- `apps/web/lib/app-homes.ts` (`coe_reporte: "/coe-reporte/tablero"`), `app/(auth)/select-app/page.tsx` (tarjeta), `lib/auth-context.tsx`, `lib/api-client.ts`, `app/admin/users/page.tsx` y `tests/app-homes.test.ts`.

---

## 7. Pruebas y despliegue

1. **Pruebas:** reglas del modelo (unitarias) y `coeReporteRoutes.integration.test.ts` contra una **base desechable** (no `localhost:5432`, que es la de Previene). Casos: idempotencia de actividad, evento y resultado; resultado ya registrado → 409; motivo obligatorio; otro código no ve ni completa actividades ajenas; 401/403 en el tablero; correo encolado en la misma transacción. Datos ficticios: el repositorio es público.
2. **Navegador (Playwright):** flujo completo sin sesión y tablero con sesión, en escritorio y móvil.
3. **Despliegue** (pide el «despliega» explícito): `pg_dump` previo, porque dev y prod comparten Postgres. Comprobar que nada pendiente tenga un `when` menor que 0049. Reconstruir y recrear solo `migrate`, `api` y `web` con `docker compose up -d --build --wait` (no `./deploy.sh update`). Antes, verificar en un contenedor temporal en :3999.
4. **Commit** en `dev-migration`, sin el ZIP ni el correo del administrador original.

---

## 8. Decisiones (tomadas el 2026-11-26)

| # | Decisión | Opciones | Elegida |
|---|---|---|---|
| D1 | ¿Quién reporta? | (a) público con código de historial, como el original; (b) solo usuarios del SIGTAR | **(a)** |
| D2 | Avisos por correo | (a) uno por cada actividad o resultado, como el original; (b) un resumen por corte (08h00 y 19h00) | **(a)** |
| D3 | Directorio de delegados | (a) tabla propia, como el original; (b) mostrar los *Delegados al COE* que ya registra Riesgos | **(a)** |
| D4 | Datos actuales en Vercel Blob | (a) empezar de cero; (b) migrar | **(a)** |
| D5 | Evidencias (fotos y videos) | (a) desactivadas, como el original; (b) activarlas con el almacenamiento del SIGTAR | **(a)** (por defecto; no se preguntó) |
