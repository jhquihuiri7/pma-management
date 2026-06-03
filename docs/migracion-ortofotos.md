# Migración: soporte de ortofotos pesadas (COG + TiTiler)

> Plan de implementación **por fases**, pensado para avanzar **una fase a la vez**.
> Cada fase tiene objetivo, checklist de tareas, archivos a tocar y criterio de "Hecho".
> Estado del diagnóstico: **completado**. No empezar una fase sin cerrar la anterior.

---

## 0. Contexto y decisiones cerradas

**Stack actual**
- Monorepo npm workspaces: `apps/web` (Next.js 14 + Leaflet en crudo), `apps/api` (Fastify 4 + Drizzle + Postgres 16, ESM/TS), `packages/types`.
- Vectores: shapefile se parsea **en el navegador** (shpjs + JSZip) → GeoJSON → `POST /geo/maps/:id/layers`. Geometría **no** va a la BD; se guarda GeoJSON gzip en el NAS. La tabla `geo_map_layers` solo guarda catálogo + presentación.
- NAS Synology montado por SMB: host `/mnt/synology_smb/sistema-ambiental` → contenedor `/data/storage` (`STORAGE_ROOT`). Provider `SynologySmbStorage` (anti path-traversal).
- Despliegue: docker-compose (postgres, api, web). Tags de imagen **distintos** dev/prod (no mezclar). Nuevas deps ⇒ **rebuild de imagen**.
- Hoy **no** hay: Redis, worker, GDAL, Python.

**Por qué las ortofotos NO reutilizan el flujo de shapefiles**
Un `.tif` de varios GB no se puede parsear en el navegador ni bufferizar en RAM en la API (hoy `part.toBuffer()` carga todo en memoria). Las ortofotos exigen: subida en streaming + procesamiento asíncrono en servidor con GDAL + servicio de tiles (TiTiler) + render como capa XYZ en Leaflet.

**Estrategia elegida:** COG (Cloud Optimized GeoTIFF) + **TiTiler** en red interna, detrás de un **proxy de tiles del API**. Cola con **pg-boss** (sobre el Postgres existente, sin Redis) + **worker Node separado** que invoca **GDAL CLI**.

### Parámetros finalizados (host 11 GB RAM, ortofotos ≤ 5 GB, varias/semana)

| Parámetro | Valor |
|---|---|
| Límite de subida (`@fastify/multipart fileSize`) | 5.5 GB (`RASTER_MAX_UPLOAD_BYTES=5905580032`) |
| Modo de subida | Streaming a NAS (`part.file` → `createWriteStream`), **nunca `toBuffer()`** |
| Worker concurrencia | **1** (pg-boss `teamConcurrency: 1`) |
| `GDAL_CACHEMAX` | 1024 (MB) |
| `mem_limit` worker | ~3 GB |
| Reparto RAM (11 GB) | postgres ~1.5 · api ~1 · web ~0.5 · titiler ~1.5 · worker ~3 · resto OS/cache |
| Disco tmp por job | ≥ 10–15 GB libres |
| CRS | Autodetectar con `gdalinfo`; COG en CRS **nativo**; TiTiler reproyecta a 3857 on-the-fly; `gdalwarp` solo si falta/rompe CRS |
| Endpoint de tiles | **Público** (sin auth), como `…/layers/:id/data` |
| Mutaciones ráster (POST/PATCH/DELETE) | `adminOnly` (sesión + rol ADMIN) |
| TLS / `COOKIE_SECURE` | Sin Nginx → `COOKIE_SECURE=false`; tiles por HTTP plano |
| Caché de tiles | `Cache-Control: public, max-age=31536000, immutable` (navegador). Disco opcional |
| Retención original | `RASTER_KEEP_ORIGINAL=true` (configurable) |

### Arquitectura objetivo

```
                         NAVEGADOR (Next.js + Leaflet)
                          │                    │
            (1) sube .tif │        (8) tiles XYZ PNG (range/cache)
       multipart STREAM   │                    │  /geo/maps/:id/raster-layers/:lid/tiles/{z}/{x}/{y}.png
                          ▼                    ▼
   ┌───────────────────────────────────────────────────────────┐
   │                    Fastify API (Node/TS)                     │
   │  - upload streaming → NAS tmp/original                       │
   │  - inserta geo_raster_layers (status=uploaded) + encola job  │
   │  - PROXY tiles: layerId → cog_path (DB) → TiTiler interno     │
   │    (inyecta ?url=file://… ; el navegador NUNCA ve la ruta)    │
   └───────┬───────────────────────┬───────────────────┬─────────┘
           │ metadatos              │ proxy interno      │ lee/escribe
           ▼                        ▼                    ▼
   ┌──────────────┐        ┌─────────────────┐   ┌──────────────────────┐
   │ PostgreSQL 16│  jobs  │  TiTiler (py)    │   │   NAS (SMB montado)   │
   │ geo_maps     │◀─pgboss│  SOLO red interna│──▶│ /data/storage/GEO/... │
   │ geo_map_layers│       │  file:///data/…  │   └──────────┬───────────┘
   │ geo_raster_… │        └─────────────────┘              │
   └──────────────┘                                          ▼
           ▲    gdalinfo → [gdalwarp] → gdal_translate -of COG
   ┌───────┴──────────────────────────────────────────────────────┐
   │      WORKER (Node/TS + GDAL CLI)  — contenedor aparte          │
   │  valida → COG → overviews → mueve a cog/ → processed | error   │
   └───────────────────────────────────────────────────────────────┘

   Orden de render:  [basemap] < [ortofoto ráster] < [shapefiles/vectores]
   (panes Leaflet: pane 'rasters' zIndex 250 < overlayPane 400)
```

### Estructura NAS (bajo el árbol del mapa, para que el borrado lo limpie)

```
GEO/maps/{mapId}/layers/{layerId}/data.geojson.gz                 ← vectores (ya existe)
GEO/maps/{mapId}/rasters/{rasterLayerId}/original/<n>.tif (+ sidecars)
GEO/maps/{mapId}/rasters/{rasterLayerId}/cog/<n>_cog.tif
GEO/maps/{mapId}/rasters/{rasterLayerId}/tmp/                     ← transitorio
GEO/maps/{mapId}/rasters/{rasterLayerId}/processing.log
```

---

## Fase 1 — Diagnóstico del sistema actual ✅ (COMPLETADA)

Documentado arriba. No requiere código.

---

## Fase 2 — Modelo de datos para capas ráster ✅ (COMPLETADA)

**Objetivo:** tabla `geo_raster_layers` + migración + helpers de ruta NAS. Cambio contenido y reversible.

**Decisión:** tabla **separada** (no unificar con `geo_map_layers`): ciclo de vida (estados async), rutas (original + COG), metadatos ráster y camino de render son distintos.

**Tareas**
- [x] En `apps/api/src/db/schema/geo.ts` añadir `geoRasterLayers` (Drizzle). **`size_bytes` es `bigint`** (`mode: "number"`; la tabla vector usa `integer`, que desborda en >2 GB).
- [x] Campos: `id, map_id(fk→geo_maps cascade), name, status('uploaded'|'processing'|'processed'|'error'), error_message, original_filename, original_path, cog_path, file_type, size_bytes(bigint), srid, crs, bbox(jsonb [minX,minY,maxX,maxY] en 4326), width_px, height_px, band_count, has_alpha, resolution_x, resolution_y, min_zoom, max_zoom, aux_files(jsonb), opacity(default 1), visible(default true), z_index(default 0), created_by, created_at, updated_at, processed_at`.
- [x] Índice `geo_raster_layers_map_idx` sobre `map_id`.
- [x] Migración **escrita a mano** `0006_geo_raster_layers.sql` + entrada en `meta/_journal.json` (idx 6). **No** se usó `db:generate`: el repo solo tiene `meta/0000_snapshot.json`, así que las migraciones 0001+ se mantienen a mano (el runner `drizzle-orm/migrator` solo usa los `.sql` + journal, no los snapshots).
- [x] En `apps/api/src/storage/index.ts` añadir helpers: `buildGeoRasterDir`, `buildGeoRasterOriginalDir`, `buildGeoRasterOriginalPath`, `buildGeoRasterCogPath`, `buildGeoRasterTmpDir`, `buildGeoRasterLogPath`. Rutas **por UUID** (traversal-safe); el filename del original se sanitiza con `safeFileName()`.

**Archivos:** `apps/api/src/db/schema/geo.ts`, `apps/api/src/db/migrations/0006_geo_raster_layers.sql`, `apps/api/src/db/migrations/meta/_journal.json`, `apps/api/src/storage/index.ts`.

**Hecho cuando:** ✅ `npm run typecheck -w apps/api` pasa; ✅ `npm run db:migrate -w apps/api` aplicó la 0006 sin error (6 → 7 migraciones); ✅ verificado en BD: 29 columnas con tipos/defaults correctos, FKs `map_id`→cascade y `created_by`→set null, índice `geo_raster_layers_map_idx`.

> Nota de despliegue: la imagen prod `pma-management/api:prod` lleva las migraciones **horneadas**. La 0006 ya se aplicó a la BD `pma_db` desde el host; al reconstruir la imagen prod (en una fase posterior) incluirá el `.sql` para entornos nuevos. La Fase 2 no requiere rebuild porque ningún código en ejecución consulta aún la tabla nueva.

---

## Fase 3 — Upload de `.tif/.tiff` (+ sidecars) en streaming ✅ (COMPLETADA)

**Objetivo:** recibir el archivo sin bufferizar en RAM, guardarlo en NAS, crear la fila `uploaded`.

**Tareas**
- [x] `StorageProvider.uploadStream(path, readable): Promise<number>` con `pipeline(readable, createWriteStream)` (sin bufferizar); implementado en `SynologySmbStorage`, devuelve bytes escritos.
- [x] Nuevo `apps/api/src/modules/geo/rasterLayersModule.ts`: `listRasterLayers`, `createRasterLayer` (insert con id provisto + `status='uploaded'`), `updateRasterLayer`, `deleteRasterLayer` (`deleteDir` + borra fila). `rowToApi` **omite** `original_path`/`cog_path` (no exponer rutas NAS).
- [x] En `apps/api/src/routes/geo/index.ts`:
  - [x] `POST /maps/:id/raster-layers` (`adminOnly`): valida que el mapa exista (antes de streamear GB), genera UUID, itera `req.parts({ limits: { fileSize: RASTER_MAX_UPLOAD_BYTES } })`, streamea el `.tif` y sidecars a `…/original/`, inserta fila. Rollback (`deleteDir`) si algo falla.
  - [x] `GET /maps/:id/raster-layers` (**público**).
  - [x] `PATCH /maps/:id/raster-layers/:layerId` (`adminOnly`): `name/opacity/visible/zIndex` (zod).
  - [x] `DELETE /maps/:id/raster-layers/:layerId` (`adminOnly`).
- [x] Validación: allowlist `classifyRasterFile` (main `.tif/.tiff`; sidecars `.tfw/.wld/.prj/.ovr/.cpg/.tab/.xml` — cubre `.aux.xml`/`.tif.ovr`); rechazo de extensión, archivo faltante, múltiples `.tif` y truncado (>límite → 413).
- [x] Límite por‑request vía `req.parts({ limits })` (deepmerge sobre el plugin) — **no** se tocó el límite global de `index.ts`, así que las demás rutas conservan su tope.
- [x] `apps/api/.env` y `apps/api/.env.example`: `RASTER_MAX_UPLOAD_BYTES=5905580032`, `RASTER_KEEP_ORIGINAL=true` (defaults también en `env.ts`).

**Archivos:** `apps/api/src/storage/{index.ts,synology-smb.ts}`, `apps/api/src/modules/geo/rasterLayersModule.ts`, `apps/api/src/routes/geo/index.ts`, `apps/api/src/lib/env.ts`, `apps/api/.env(.example)`.

**Hecho cuando:** ✅ typecheck pasa; ✅ prueba end-to-end (API dev en :4000, token ADMIN, mapa real): POST de `.tif`+`.tfw`+`.prj` → 201 `status:'uploaded'`, archivos en `…/original/`, fila en BD (`size_bytes` bigint, `aux_files` jsonb); GET público lista la capa; PATCH actualiza opacity/visible; DELETE borra archivos + fila; validaciones `.txt`→400, sin archivo→400, sin sesión→401.

> Nota de entorno: al probar la API dev como usuario host contra `apps/api/data/storage` falla con `EACCES` porque el dir `GEO/` fue creado por el contenedor (root) — mismo patrón de [[docker-dev-node-modules-baked]]. Se probó con `STORAGE_ROOT=/tmp/...`. En producción no aplica (la API corre en el contenedor que sí escribe en el NAS).

---

## Fase 4 — Cola (pg-boss) + worker de procesamiento ✅ (COMPLETADA)

**Objetivo:** infraestructura de jobs sobre Postgres y proceso worker separado (aún sin GDAL real).

**Tareas**
- [x] Dependencia `pg-boss@^10.4.2` en `apps/api` (recordar: nueva dep ⇒ rebuild de imagen).
- [x] `apps/api/src/jobs/boss.ts`: singleton `getBoss()` (start + `createQueue` idempotente), `enqueueRasterProcessing`, `stopBoss`. Cola `RASTER_QUEUE = "process-raster"`, `{ schedule: false }`.
- [x] Tras crear la fila ráster, la ruta POST **encola** `{ mapId, rasterLayerId }` (best-effort: si falla el encolado se loguea y la fila queda `uploaded` para reintento, sin perder el archivo).
- [x] `apps/api/src/worker.ts`: arranca pg-boss, `boss.work(RASTER_QUEUE, { batchSize: WORKER_CONCURRENCY }, …)`, procesa el batch en serie, marca `status='processing'` (stub). Apagado limpio en SIGINT/SIGTERM (`stopBoss`).
- [x] Setters en `rasterLayersModule.ts`: `markRasterProcessing` (false si la capa ya no existe) y `markRasterError` (para Fase 5).
- [x] Scripts: `worker` (tsx), `worker:watch` (tsx watch), `worker:start` (`node dist/apps/api/src/worker.js`, prod).
- [x] `env.ts`: `WORKER_CONCURRENCY` (default 1).

> **Nota v10**: pg-boss v10 NO tiene `teamConcurrency`; la concurrencia se controla con `batchSize` y el handler recibe un **array** de jobs (los proceso en serie, así nunca corren dos GDAL a la vez). Las colas son particiones → `createQueue` (idempotente) es obligatorio antes de `send`/`work`.

**Archivos:** `apps/api/package.json`, `apps/api/src/jobs/boss.ts`, `apps/api/src/worker.ts`, `apps/api/src/modules/geo/rasterLayersModule.ts`, `apps/api/src/routes/geo/index.ts`, `apps/api/src/lib/env.ts`.

**Hecho cuando:** ✅ typecheck pasa; ✅ prueba end-to-end (worker + API dev): POST `.tif` → fila `uploaded`; el worker tomó el job en ~3 s y la fila pasó a `processing`; job pg-boss `completed`; apagado de procesos limpio. (El stub deja la capa en `processing`; la Fase 5 la moverá a `processed`/`error`.)

---

## Fase 5 — Generación de COG con GDAL ✅ (COMPLETADA)

**Objetivo:** convertir el original a COG y persistir metadatos/estado reales. **GDAL 100% dockerizado** (imagen del worker), nada instalado en el host.

**Tareas**
- [x] **Imagen del worker con GDAL**: `apps/api/Dockerfile.worker` (Debian bookworm + `gdal-bin` → GDAL 3.6.2 con drivers COG/JPEG/WEBP). Servicios `worker` añadidos a `docker-compose.yml` (prod, `worker:prod`) y `docker-compose.dev.yml` (dev, `worker:dev`, hot-reload). *(Adelanto de la Fase 12.)*
- [x] `apps/api/src/jobs/gdal.ts`: `runGdal` (spawn + log + timeout `RASTER_JOB_TIMEOUT_MS` + `GDAL_CACHEMAX`), `gdalInfo` (parsea size/geoTransform/wkt→EPSG/`wgs84Extent`→bbox4326/bandas/alpha/nodata), `chooseCompression`, `buildCog`.
- [x] `apps/api/src/jobs/processRaster.ts`:
  - [x] `gdalinfo -json` → CRS/bandas/nodata/tamaño/resolución/bbox.
  - [x] Sin CRS → `status='error'` con mensaje claro (no se reintenta).
  - [x] `gdal_translate -of COG` en CRS **nativo** a `…/tmp/`: JPEG (3 bandas) · WEBP (alpha/≥4 bandas) · DEFLATE (resto); comunes `BLOCKSIZE=512 OVERVIEW_RESAMPLING=AVERAGE BIGTIFF=YES NUM_THREADS=ALL_CPUS` (+`QUALITY=85`).
  - [x] Mover COG a `…/cog/cog.tif`; limpiar `…/tmp/`.
  - [x] `bbox` en EPSG:4326 desde `wgs84Extent`. (`min/max_zoom` se poblarán en Fase 6 con TiTiler.)
  - [x] `status='processed'`, `processed_at`, `cog_path` + metadatos. Si `RASTER_KEEP_ORIGINAL=false`, borra el original.
  - [x] stdout/stderr a `…/processing.log`; timeout por job; fallo → `status='error'` (worker) + reintento pg-boss.
- [x] Reproyección a 3857 **no** se hace (TiTiler reproyecta on-the-fly); solo COG nativo. `gdalwarp` queda disponible para Fase 6 si algún CRS lo requiere.
- [x] Expiración de job pg-boss a 4 h (`createQueue`/`updateQueue` + per-send) para que un COG largo no se re-despache.

**Archivos:** `apps/api/src/jobs/{gdal.ts,processRaster.ts,boss.ts}`, `apps/api/src/worker.ts`, `apps/api/src/modules/geo/rasterLayersModule.ts` (`getRasterRow`, `markRasterProcessed`), `apps/api/src/storage/{index.ts,synology-smb.ts}` (`resolve`), `apps/api/src/lib/env.ts` (`GDAL_CACHEMAX`, `RASTER_JOB_TIMEOUT_MS`), `apps/api/Dockerfile.worker`, `docker-compose*.yml`.

**Hecho cuando:** ✅ typecheck pasa; ✅ imagen `pma-management/worker:dev` construida (GDAL 3.6.2); ✅ end-to-end **dockerizado**: GeoTIFF real (EPSG:32717, 3 bandas) subido por la API → worker en contenedor lo procesó → `cog/cog.tif` es COG válido (`LAYOUT=COG`, JPEG, 512×512) → BD `processed` con `crs=EPSG:32717`, `srid=32717`, `bbox` 4326, 256×256, 3 bandas, `resolution=10`, `cog_path`/`processed_at` poblados → GET público NO expone rutas NAS → `processing.log` registra los comandos.

> Nota: GDAL **solo** vive en la imagen del worker (verificado: el host no tiene GDAL; todo se ejecutó vía `docker run`/contenedor). El servicio `worker` en compose comparte el mismo montaje NAS y la BD (pg-boss); falta que el despliegue real lo levante (`docker compose up -d worker`), parte de la Fase 12.

---

## Fase 6 — TiTiler + proxy de tiles en el API ✅ (COMPLETADA)

**Objetivo:** servir tiles XYZ sin exponer TiTiler ni rutas del NAS.

**Tareas**
- [x] Servicio `titiler` (imagen `ghcr.io/developmentseed/titiler:0.19.2`) en `docker-compose.yml` y `docker-compose.dev.yml`, **sin puerto al host**, volumen NAS `:ro`, `PORT=8000`.
- [x] `env.ts`: `TITILER_INTERNAL_URL` (`http://titiler:8000`) y `TITILER_DATA_ROOT` (`/data/storage`, ruta del COG como la ve TiTiler).
- [x] `getProcessedCogPath(mapId, layerId)` en el módulo: 404 si no es de ese mapa, **409** si no está `processed`.
- [x] `GET /maps/:id/raster-layers/:layerId/tiles/:z/:x/:y` (**público**): valida coords (`:y` absorbe `.png` vía `parseInt`), resuelve `cog_path`, hace `fetch` a `${TITILER_INTERNAL_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=<TITILER_DATA_ROOT/cogPath>` y reenvía el PNG. 404 de TiTiler (fuera de cobertura) se pasa tal cual; otros → 502.
- [x] `Cache-Control: public, max-age=31536000, immutable`.
- [x] (Descartado tilejson: el front arma el `tileUrl` y usa `bbox` de la capa para los `bounds`.)

**Archivos:** `apps/api/src/routes/geo/index.ts`, `apps/api/src/modules/geo/rasterLayersModule.ts` (`getProcessedCogPath`), `apps/api/src/lib/env.ts`, `docker-compose*.yml`.

**Hecho cuando:** ✅ verificado con TiTiler real (contenedor): ruta `/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png` confirmada (HTTP 200 + PNG); chain completo subida→worker(COG)→**tile por el proxy del API** = HTTP 200 `image/png` con `Cache-Control immutable`, **sin cookie** (público); capa inexistente→404, coords inválidas→400, sin rutas NAS en los headers. TiTiler `PORT=8000` respeta la env (valida el compose).

> Seguridad confirmada: `GET /cog/info?url=/etc/passwd` contra TiTiler devuelve 500 (lo *intentaría* abrir) — por eso TiTiler queda **sin puerto público** y el API es el único que le pasa el `url`.

---

## Fase 7 — Integración en el visor GIS (Leaflet) ✅ (COMPLETADA)

**Objetivo:** pintar la ortofoto como capa XYZ, debajo de los vectores.

**Decisión:** en vez de una unión discriminada `kind` (que obligaría a refactorizar todo el código vectorial — estilos, dashboards, identify, charts), se usa un **tipo `RasterLayer` y un array `rasterLayers` SEPARADO**, renderizado en su propio pane. Cero riesgo para los vectores existentes.

**Tareas**
- [x] `types.ts`: tipo `RasterLayer { id, name, status, errorMessage, opacity, visible, zIndex, bbox, tileUrl }` (`GisLayer` intacto).
- [x] `persistence.ts`: `fetchRasterLayers`, `updateRasterRemote`, `deleteRasterRemote`, `RasterLayerManifest`, y `rasterTileUrl(mapId, layerId)` → `${API_BASE}/geo/maps/.../tiles/{z}/{x}/{y}.png` (mismo proxy `/api-proxy` que el resto). *(createRasterRemote = Fase 8, upload UI.)*
- [x] `GisMap.tsx`: `map.createPane('rasters')` con `zIndex 250` (entre tilePane 200 y overlayPane 400); efecto que reconcilia `rasterLayers` — solo `processed` + `visible` se dibujan con `L.tileLayer(tileUrl, { pane:'rasters', opacity, zIndex, bounds })`; opacidad/orden/visibilidad in-place.
- [x] `GisEditor.tsx`: carga `fetchRasterLayers` en la hidratación, los mapea a `RasterLayer` y los pasa a `GisMap`.

**Archivos:** `types.ts`, `persistence.ts`, `GisMap.tsx`, `GisEditor.tsx`.

**Hecho cuando:** ✅ `typecheck` de web y api limpios; ✅ el dato que consume el front (tile por el proxy) verificado en Fase 6 (PNG 200); los rásters se dibujan en el pane 250, **debajo** de los vectores (overlayPane 400). *(Render visual en navegador no automatizable aquí; el camino de datos y el orden de panes están verificados.)*

> Nota: los **controles** de ráster en el panel (badge de estado, slider de opacidad, reintento) y el **upload `.tif` desde la UI** + polling son la **Fase 8**. En Fase 7 los rásters ya `processed` se cargan y renderizan; aún no hay UI para subir/controlar desde el navegador.

---

## Fase 8 — Panel de capas: estado, opacidad, orden, visibilidad ✅ (COMPLETADA)

**Objetivo:** controles ráster en el panel y manejo de estados.

**Tareas**
- [x] `persistence.ts`: `createRasterRemote` (XHR con **barra de progreso** para multi-GB) y `retryRasterRemote`.
- [x] `UploadModal.tsx`: acepta `.tif/.tiff` (+ sidecars) y `multiple`; detecta el ráster por extensión y lo **sube crudo** (sin parsear en cliente) con progreso `%`; shapefiles siguen igual. Requiere `mapId` (avisa "guarda el mapa antes").
- [x] `LayersPanel.tsx`: sección "Ortofotos" con `RasterItem` — **badge de estado** (`En cola/Procesando…/Listo/Error`), slider de **opacidad** (solo `processed`), visibilidad deshabilitada hasta `processed`, `error_message` inline + botón **reintentar**, y borrar.
- [x] `GisEditor.tsx`: handlers `handleRasterUploaded/updateRaster/removeRaster/retryRaster` (guardado debounced) + **polling** cada 3 s mientras haya `uploaded/processing` (merge que respeta opacidad/visibilidad local).
- [x] Backend de apoyo: `POST …/raster-layers/:lid/retry` (`adminOnly`) que resetea a `uploaded` y re-encola.

**Archivos:** `UploadModal.tsx`, `LayersPanel.tsx`, `persistence.ts`, `GisEditor.tsx`, `apps/api/src/routes/geo/index.ts`, `apps/api/src/modules/geo/rasterLayersModule.ts`.

**Hecho cuando:** ✅ typecheck web+api; ✅ endpoints verificados (subida, retry, polling vía `fetchRasterLayers`); el render visual del panel no se automatiza aquí pero el flujo de datos está probado. Flujo `error→retry` verificado end-to-end (ver Fase 9).

---

## Fase 9 — Seguridad, validaciones y control de acceso ✅ (COMPLETADA)

**Objetivo:** cerrar los huecos antes de pruebas pesadas.

**Tareas**
- [x] TiTiler **sin puerto público** + volumen `:ro` (compose); el `?url=` lo inyecta **solo** el API. Verificado en Fase 6 (`?url=/etc/passwd` no es alcanzable desde el navegador).
- [x] Allowlist de extensión (`classifyRasterFile`) **+ validación magic-byte TIFF** (`isTiffFile`, II*/MM* y BigTIFF) antes de registrar; `gdalinfo` en el worker es la validación profunda (un TIFF sin CRS → `error` con mensaje).
- [x] Rutas por UUID + `absolute()` de `SynologySmbStorage` (anti traversal) — sin cambios, ya estaba.
- [x] Mutaciones (POST/PATCH/DELETE/retry) `adminOnly`; tiles y `GET list` públicos. Verificado.
- [x] Tope de subida por-request (`RASTER_MAX_UPLOAD_BYTES`) con rechazo temprano (413).
- [x] El navegador nunca recibe rutas NAS: `rowToApi` omite `original_path`/`cog_path`; el tile proxy resuelve la ruta server-side.

**Hecho cuando:** ✅ verificado: `.tif` con bytes no-TIFF → **400**; subida > límite → **413**; POST/retry/delete **sin sesión → 401**; TIFF sin CRS → worker `error` + `errorMessage` claro → **retry admin → 200**; TiTiler no accesible desde el navegador (Fase 6).

---

## Fase 10 — Pruebas con ortofotos grandes

**Objetivo:** validar el pipeline con casos reales y límite.

**Tareas**
- [ ] Probar `.tif` de ~1 GB, ~3 GB y ~5 GB (tope).
- [ ] CRS faltante → `error` con mensaje claro.
- [ ] RGBA / con transparencia (alpha/nodata) → WEBP, se ve la transparencia.
- [ ] Multibanda inusual → manejo o error controlado.
- [ ] Medir RAM/CPU del worker (concurrencia 1) y disco tmp; confirmar que no se cae el host (11 GB).
- [ ] Verificar tiles a varios zooms y el orden ráster < vectores.

**Hecho cuando:** las 11 criterios de aceptación (abajo) pasan con archivos reales.

---

## Fase 11 — Optimización y documentación

**Tareas**
- [ ] Afinar caché de tiles (`Cache-Control`; disco opcional).
- [ ] Registrar tiempos (`processed_at - created_at`) y tamaños; revisar `processing.log`.
- [ ] (Opcional) política de retención del original.
- [ ] Actualizar `README.md` / `deploy.sh` (comandos del worker/titiler/migración).
- [ ] (Futuro, no obligatorio) subida resumible (tus) y/o Nginx con caché si hiciera falta.

---

## Fase 12 — Despliegue ✅ (COMPLETADA en dev; pasos prod documentados)

> El servicio `titiler` se necesita desde la Fase 6 y el `worker`+GDAL desde la Fase 5; ambos quedaron definidos en los dos compose.

**Tareas**
- [x] Servicio **`titiler`** (`ghcr.io/developmentseed/titiler:0.19.2`), **sin** `ports`, volumen NAS `:ro`, `PORT=8000` — en `docker-compose.yml` y `docker-compose.dev.yml`.
- [x] Servicio **`worker`** (`apps/api/Dockerfile.worker`, Node + `gdal-bin`): NAS `rw`, `DATABASE_URL`, `GDAL_CACHEMAX`, `WORKER_CONCURRENCY`; prod arranca `node dist/.../worker.js`, dev `worker:watch`.
- [x] Tags de imagen distintos dev/prod (`worker:dev` / `worker:prod`).
- [x] Imagen worker construida (`worker:dev`, GDAL 3.6.2 vía `node:20-bookworm-slim` + `gdal-bin`).
- [x] **Aplicado al stack dev en marcha** (proyecto `pma-management`): `docker compose -f docker-compose.dev.yml up -d titiler worker` (aditivo, sin recrear postgres/api/web; api/web ya tenían el código por hot-reload).
- [ ] `mem_limit` por servicio en prod (api ~1g, web ~512m, titiler ~1.5g, **worker ~3g**, postgres ~1.5g) — pendiente de añadir cuando se despliegue a prod.

**Hecho cuando:** ✅ verificado end-to-end en el **stack real dev**: subida por el API `:3001` → `pma-worker` generó el COG → tile por el API → `pma-titiler` = **HTTP 200 PNG**; `pma-api/web/postgres` intactos.

### Pasos para el servidor de producción (cuando se despliegue allí)
```bash
# 1) Reconstruir imágenes (api/web por el código nuevo; worker es nuevo)
docker compose build api web worker          # worker:prod incluye GDAL
# 2) Aplicar la migración 0006 (crea geo_raster_layers) en la BD de prod
docker compose run --rm api node dist/apps/api/src/db/run-migrations.js
# 3) Levantar todo (incluye titiler + worker)
docker compose up -d
# 4) (Opcional) añadir mem_limit por servicio y TLS/Nginx delante si aplica
```
> Nota: el `.env` de prod debe traer `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (el worker también los recibe para pasar la validación de entorno, aunque no hace auth). El NAS se monta en `api`, `worker` (rw) y `titiler` (ro) en `/data/storage`.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Archivos hasta 5 GB | Upload streaming (no `toBuffer`); `size_bytes` **bigint**; tmp ≥10–15 GB; concurrencia 1 |
| Falta de CRS | `gdalinfo`; aceptar sidecar `.prj/.tfw`; si falta → `error` con mensaje |
| NAS lento (SMB) | COG (bloques+overviews) + `Cache-Control: immutable` |
| Permisos lectura TiTiler | Volumen `:ro` con usuario correcto; verificar en Fase 9 |
| TiTiler LFI/SSRF (`?url=`) | TiTiler sin puerto público; el API inyecta `?url=file://…`; volumen `:ro` |
| Procesamiento bloqueante | Worker en contenedor aparte + pg-boss; API nunca corre GDAL |
| RAM alta (host 11 GB) | `GDAL_CACHEMAX=1024`, `mem_limit` worker 3 GB, concurrencia 1 |
| Tiles lentos | Caché navegador + overviews |
| Incompatibilidad mapa | Bajo: Leaflet ya usa `L.tileLayer` XYZ; usar panes |
| Reproyección | COG nativo + reproyección on-the-fly de TiTiler; warp solo si falta CRS |
| Transparencia/multibanda | RGBA → WEBP; manejar nodata; validar `band_count` |
| `integer` desborda >2 GB | `bigint` en `size_bytes` |

## Criterios de aceptación

1. El admin (con sesión) sube `.tif/.tiff` (+ sidecars) desde el visor, sin parseo en navegador.
2. El original se guarda en `…/rasters/{id}/original/` en el NAS.
3. El worker genera un COG válido en `…/cog/`.
4. La fila refleja `uploaded → processing → processed` (o `error` + mensaje).
5. El frontend muestra el estado y **no** permite ver una ortofoto en `processing`.
6. Al terminar, la ortofoto aparece en el panel con opacidad/visibilidad/orden.
7. La ortofoto se renderiza como `L.tileLayer` (XYZ), **debajo** de los vectores.
8. Los shapefiles existentes siguen funcionando y se superponen encima.
9. El navegador **no** descarga el `.tif`; solo consume tiles.
10. No se exponen rutas absolutas del NAS; TiTiler no es accesible desde el host.
11. Errores de procesamiento se manejan y muestran (con reintento).
