# Plan técnico: RustGIS Web como Workspace del Geoportal SIGTAR

> **Estado (2026-11-04, 23:54):** plan aprobado con las decisiones de §0.5, implementado en la rama `dev-migration` (sin commit) y **desplegado en producción en modo piloto** (`GEO_WORKSPACE_ENGINE=pilot`). Lo hecho, lo probado y el despliegue están en §11.
>
> **Repositorio analizado:** `pma-management`, rama `dev-migration`, commit `75674fa` (2026-11-04).
> **RustGIS analizado:** `opengeos/RustGIS`, `main` en `98a7201` (2026-11-04) y etiqueta `v0.5.0` (`a5603d1`, 2026-10-31). Entre ambas hay 141 commits. Lectura del código fuente sin compilarlo ni ejecutarlo, más la documentación oficial publicada.
> **Datos reales:** consultas agregadas en una transacción `BEGIN READ ONLY … ROLLBACK` sobre `pma-postgres`, lectura de cabeceras de los COG con `gdalinfo -json` dentro de `pma-worker` y una tesela pedida a la API interna (2026-11-04). No se leyó ni se imprimió ningún secreto.
>
> **Convención usada en todo el documento:**
> - **Disponible en la búsqueda:** el recurso aparece al consultar sus metadatos (nombre, tipo, mapa, extensión, tamaño…). No se descargan sus datos.
> - **Cargado en el mapa:** sus datos se abren en RustGIS para dibujarlos o analizarlos (lecturas `Range` de un COG o de un FlatGeobuf, teselas o una copia descargada).

---

## 0. Recomendación y veredicto

### 0.1 Recomendación

Sustituir **solo** la página `/geo/workspace` por una página anfitriona que embebe **RustGIS Web autoalojado en el mismo origen** (`https://sigtar.gobiernogalapagos.gob.ec/geo/workspace/app/?embed&lang=es`, imagen oficial `0.5.0` fijada por digest) y le añade lo que RustGIS no puede hacer por sí mismo con nuestros datos:

1. **Buscador del catálogo SIGTAR junto al mapa**, en la página anfitriona. Añade capas con el comando público `ui.addUrl` del puente `postMessage`, sin reiniciar el mapa.
2. **Rutas nuevas y autorizadas** en la API (`/geo/workspace/v1/…`): vectores como **FlatGeobuf con índice espacial** y rásteres como **COG con `Range`**, para que RustGIS los lea por partes y el proyecto guarde solo sus URL. Para los 13 COG con compresión WEBP, que RustGIS no decodifica, una alternativa de teselas XYZ servidas por TiTiler.
3. **Proyectos guardados en el servidor** (tabla nueva), creados a partir de un Mapa o importados de un archivo `sigtar-workspace`, que el servidor revisa al abrir: capas eliminadas, nuevas versiones y permisos.
4. **Proxy autenticado en la API Fastify** para MiniMax en NVIDIA, con la clave solo en el servidor.

El editor de cada Mapa (`/geo/maps/[id]/gis`), el visor público y sus rutas no cambian. La prueba de concepto no necesita un fork de RustGIS.

### 0.2 Veredicto de viabilidad: viable, con adaptaciones en el geoportal y sin fork

| | |
|---|---|
| **Funciona con RustGIS tal como está** | Embeberlo en el mismo dominio y bajo una ruta; saber cuándo está listo (`ready`); abrir proyectos (`ui.openUrl` o el mensaje `project`); añadir capas sin reiniciar (`ui.addUrl`); recibir el proyecto después de cada cambio; leer COG y FlatGeobuf por `Range`, con reproyección UTM en el navegador; usar la sesión del geoportal (cookies del mismo origen); asistente «OpenAI-compatible» sin clave apuntando a nuestro proxy; interfaz en español. |
| **Requiere adaptación en el geoportal** | Página anfitriona y puente; búsqueda en el servidor; rutas autorizadas con extensión (`.fgb`, `.tif`) y `Range`; **conversión de cada revisión vectorial a FlatGeobuf** en el worker; alternativa XYZ para los COG WEBP; persistencia y resolución de proyectos; proxy de IA; renovación periódica de la sesión; `frame-ancestors` en nginx; **modelo de permisos** (hoy toda lectura GEO es pública). |
| **Requiere adaptación en RustGIS (opcional)** | Preconfigurar proveedor, dirección y modelo del asistente con `?embed` (sin esta adaptación, el usuario rellena tres campos en cada sesión). Decodificar COG WEBP (propuesta a RustGIS; mientras tanto, la alternativa XYZ). |
| **Mayor incertidumbre** | **Que las capas FlatGeobuf leídas por partes cubran el trabajo del usuario en la web**: estilo por atributo, etiquetas, identificar, tabla de atributos y análisis (en la web el análisis exige descargar la capa entera). Es lo que evita copiar los GeoJSON dentro del proyecto. La prueba P1 lo resuelve y de ella depende la decisión D7. |

### 0.3 Principal bloqueo

RustGIS solo guarda como **referencia** las capas que lee por partes: COG, teselas, FlatGeobuf y GeoParquet. **Un GeoJSON añadido por URL se descarga y sus entidades se copian dentro del proyecto** (`crates/data/src/lib.rs:329-339`), y el puente reenvía el proyecto **entero** a la página tras cada cambio que se estabiliza, desplazamientos del mapa incluidos (`apps/rustgis-web/src/web.rs:413-416`). Además, **no decodifica COG con compresión WEBP** (13 de los 33). Por eso no basta con apuntar RustGIS a las rutas actuales: hay que servir los vectores como FlatGeobuf y dar una salida a los rásteres WEBP.

En lo funcional, el hueco principal es otro: **no existe control de acceso por capa** (todas las lecturas GEO son públicas). «Solo lo que el usuario puede ver» exige decidir primero un modelo de permisos (D1).

### 0.4 Primer paso de implementación

Fase 0, paso 1 (2-3 días): en un entorno de pruebas con una **base de datos desechable**, levantar `ghcr.io/opengeos/rustgis:0.5.0` en `/geo/workspace/app/`, una página anfitriona mínima con el puente y tres rutas de prueba con `Range`: el FlatGeobuf de la capa «puerto villa» (generado a mano con `ogr2ogr`), el MDT `Float32` y la ortofoto JPEG de 2023. Así se validan las cookies del mismo origen, la lectura por partes, la reproyección y el JSON real que devuelve el puente, que servirá de plantilla para el generador de proyectos (§8).

### 0.5 Decisiones tomadas (2026-11-04)

| Decisión | Resuelta así | Dónde está |
|---|---|---|
| D1 Permisos | Visibilidad por mapa `public` (valor por defecto, como hoy) · `internal` · `restricted` (administradores, autor y usuarios elegidos), heredada por capas y rásteres | Migración `0037`; `modules/geo/access.ts`; diálogo «Acceso del mapa» en la tarjeta del mapa |
| D2 Ajustes del asistente | **Preconfigurado.** Imagen propia `pma-management/rustgis` con un parche mínimo: con `?embed` el asistente arranca como «OpenAI-compatible», con la dirección `<origen>/api-proxy/geo/workspace/ai/v1` y el modelo `sigtar-asistente`. Las credenciales se ponen **solo en el servidor** (`WORKSPACE_AI_API_KEY`); el navegador no las ve ni tiene que escribir nada | `infra/rustgis/patches/0001-sigtar-embed.patch`; `modules/geo/workspaceAi.ts` |
| D3 Proveedor de IA | **MiniMax (`minimaxai/minimax-m3.1-flash`) en NVIDIA, aceptado por el responsable** para el uso actual: un único usuario de pruebas. Riesgo aceptado: NVIDIA presenta su catálogo gratuito como de evaluación y prototipado (§4.6). Se cambia de modelo o de proveedor con `WORKSPACE_AI_MODEL` / `WORKSPACE_AI_BASE_URL` / `WORKSPACE_AI_ALLOWED_HOSTS`, sin recompilar RustGIS (el navegador solo conoce el alias) | `.env` del servidor; §4.4 |
| D4 Exportador PDF del CGREG | **No se necesita en el Workspace.** El editor de cada Mapa lo conserva | — |
| D5 Acceso sin sesión | Sesión obligatoria en el nuevo Workspace; el visor público de Mapas no cambia | `routes/geo/workspaceV1.ts` |
| D6 COG WEBP | Alternativa de teselas XYZ (TiTiler). Tras la prueba en el navegador, también para los COG JPEG YCbCr de 3 bandas, que RustGIS muestra con colores falsos (§2.8) | `rasterTilesReason` en `modules/geo/rustgisProject.ts`; ruta `…/tiles/{z}/{x}/{y}.png` |
| D7 Vectores | FlatGeobuf con índice espacial por defecto; copia GeoJSON solo a petición («Copia») | `jobs/flatgeobuf.ts`; `modules/geo/layerArtifacts.ts` |
| Nuevo: capa activa | **Se guarda y se restaura.** El parche añade la capa activa (o la capa de teselas seleccionada) al proyecto como `maps[active_map].sigtar_active` y la vuelve a activar al abrirlo. El servidor la conserva al guardar y la limpia si esa capa ya no está disponible. Un RustGIS sin parche ignora el campo, así que los proyectos siguen siendo compatibles | Parche (`embed.rs`, `web.rs`); `resolveProject` en `rustgisProject.ts` |

---

## 1. Diagnóstico del geoportal actual

### 1.1 Stack y despliegue

| Pieza | Qué es | Evidencia |
|---|---|---|
| Web | Next.js 14.2 (App Router), React 18, Leaflet 1.9 y `maplibre-gl` 5 para los fondos vectoriales | `apps/web/package.json`; `apps/web/components/geo/gis/GisMap.tsx:112` (`L.maplibreGL`) |
| API | Fastify 5 + Drizzle + PostgreSQL 16; colas con pg-boss | `apps/api/package.json`; `apps/api/src/index.ts:83` registra GEO con prefijo `/geo` |
| Worker | Node + GDAL 3.6.2; convierte rásteres a COG | `docker-compose.yml:146-188`; `gdalinfo --version` en `pma-worker` |
| TiTiler 0.19.2 | Servidor interno de teselas; sin puerto publicado; NAS en solo lectura | `docker-compose.yml:190-203` |
| nginx 1.27 (contenedor) | `/api-proxy/*` → `api:3001` quitando el prefijo; `/storage/*` → API; `/` → Next.js | `nginx/conf.d/sigtar.gobiernogalapagos.gob.ec.conf:36-80` |
| Almacenamiento | NAS Synology montado en `/data/storage` (api, worker, titiler) | `docker-compose.yml:95`, `:182`, `:202` |
| Dominio | `https://sigtar.gobiernogalapagos.gob.ec` | `server_name` en la configuración de nginx |

El navegador llama a la API a través de `/api-proxy/…` (`apps/web/lib/api-client.ts:10-12`), que nginx reescribe hacia la API (`…conf:36-38`). Las cookies de sesión son `pma_access` (JWT de 15 min, `apps/api/src/lib/env.ts:13`) y `pma_refresh` (7 días), `httpOnly`, `SameSite=Lax`, `path=/` (`apps/api/src/routes/auth.ts:57-60`).

### 1.2 Dónde está el Workspace y cómo arranca

| Pregunta | Respuesta con evidencia |
|---|---|
| Ruta | `/geo/workspace` → `apps/web/app/geo/(dashboard)/workspace/page.tsx:14-25`, que monta `GisEditor` con `mode="workspace"`, sin `mapId`, con `canEdit` y `canDelete` fijos en `true` y centro inicial en Galápagos. |
| Entrada desde el geoportal | Botón «Workspace» del panel: `apps/web/app/geo/(dashboard)/dashboard/page.tsx:228-234`. La barra lateral GEO no tiene enlace propio (`apps/web/components/layout/SidebarGeo.tsx:10`). |
| Componente | `apps/web/components/geo/gis/GisEditor.tsx` (1 636 líneas). **Es el mismo componente** que el editor de cada mapa, `/geo/maps/[id]/gis` (`apps/web/app/geo/(dashboard)/maps/[id]/gis/page.tsx:91-104`), al que se llega desde cada tarjeta de mapa (`apps/web/components/geo/GeoMapCard.tsx:174`). |
| Proyecto activo | El Workspace **no recibe ningún proyecto**: sin `mapId` se marca como hidratado sin cargar nada (`GisEditor.tsx:311-315`). Solo el editor de mapa carga las capas de su mapa al abrir (`GisEditor.tsx:316-339`). |
| Autenticación | `/geo` es público en el middleware (`apps/web/middleware.ts:41`), así que el Workspace se abre sin sesión. Todo lo que lee el Workspace son rutas públicas de la API (`apps/api/src/routes/geo/index.ts:106-122`). |
| Guardado | No hay guardado en el servidor. «Descargar configuración JSON» genera `sigtar-workspace-AAAA-MM-DD.json` (`GisEditor.tsx:874-898`); «Cargar Workspace» lo vuelve a leer, con un máximo de 2 MB (`GisEditor.tsx:989-1002`, `workspace.ts:7`). Los avisos de cambios sin descargar están en `GisEditor.tsx:1021-1022` y `:1283-1288`. |

**Mapa del Workspace actual:**

```
/geo/dashboard ──botón «Workspace»──▶ /geo/workspace (público)
                                        └─ GisEditor mode="workspace" (sin mapId, empieza vacío)
                                             ├─ «Agregar capas» → WorkspaceLayerCatalogModal
                                             │     └─ GET /api-proxy/geo/workspace/catalog?categoryId=…   (público; todo el catálogo de la categoría)
                                             │           └─ filtro de texto en el navegador
                                             ├─ vector elegido → GET …/geo/maps/:id/layers/:layerId/data/:rev  (GeoJSON completo, gzip)
                                             │     └─ Leaflet L.geoJSON (estilo, etiquetas y leyenda calculados en el navegador)
                                             ├─ ráster elegido → L.tileLayer …/geo/maps/:id/raster-layers/:id/tiles/{z}/{x}/{y}.png
                                             │     └─ API → TiTiler interno → COG en el NAS
                                             ├─ herramientas: identificar, medir, consultar punto, tabla, visualizaciones, exportar PDF
                                             └─ «Descargar configuración JSON» / «Cargar Workspace» (sigtar-workspace v2, ≤ 2 MB, en el equipo)

/geo/maps/[id]/gis ── el mismo GisEditor con mapId: carga las capas del Mapa y guarda estilo/orden/vista en el servidor
```

### 1.3 Semántica actual: «Mapa», «Workspace» y «proyecto»

El término «proyecto» no existe en el código GEO (búsqueda sin resultados en `apps/web/components/geo`, `apps/web/app/geo`, `apps/api/src/modules/geo` y `apps/api/src/routes/geo`). Hoy hay dos unidades con semánticas distintas:

| | **Mapa** (`geo_maps`) | **Workspace** (archivo `sigtar-workspace` v2) |
|---|---|---|
| Dónde vive | PostgreSQL + NAS | En el equipo del usuario, como archivo JSON |
| Relación con las capas | Las **posee**: `geo_map_layers.map_id` y `geo_raster_layers.map_id` con `ON DELETE CASCADE` (`apps/api/src/db/schema/geo.ts:37-39`, `:134-136`) | Las **referencia** por `{mapId, layerId}`; pueden venir de mapas distintos (`apps/web/components/geo/gis/workspace.ts:15-36`) |
| Estado que guarda | Estilo, visibilidad y orden en la fila de cada capa (compartido por todos los usuarios); centro y zoom en `geo_maps` (`schema/geo.ts:13-15`, `:53-55`; `PATCH /maps/:id/viewport` en `routes/geo/index.ts:157-161`) | Nombre, visibilidad, orden, estilo y visualizaciones por referencia; centro, zoom y mapa base (`workspace.ts:38-48`, `:54-105`) |
| Lo que no guarda | Mapa base, capa activa, filtros | Capa activa, revisión de los datos, filtros |
| Dónde se abre | `/geo/maps/[id]/gis` | `/geo/workspace` + «Cargar Workspace» |

**Interpretación usada en este plan.** «Abrir un proyecto existente» se resuelve en dos casos: (1) abrir un **Mapa** del geoportal, cuyas capas le pertenecen, y (2) abrir un **proyecto de Workspace guardado en el servidor**, entidad nueva que referencia capas del catálogo igual que el archivo `sigtar-workspace`, más el estado propio de RustGIS. Los archivos `sigtar-workspace` v1/v2 ya descargados por los usuarios se importan una vez a esa entidad (§3.2 y §7).

### 1.4 Recorrido de una capa vectorial

1. **Registro.** `UploadModal` convierte en el navegador un Shapefile (`.zip` o `.shp`) a GeoJSON EPSG:4326 con `shpjs` (`apps/web/components/geo/gis/UploadModal.tsx:6`, `:186-213`) y lo envía por `POST /geo/maps/:id/layers` (`routes/geo/index.ts:196-291`). La API valida un `FeatureCollection` de un solo tipo de geometría, ≤ 75 MB y ≤ 500 000 entidades, recalcula el `bbox` (`routes/geo/index.ts:80-82`, `:786-836`) y lo guarda **comprimido con gzip** en el NAS (`apps/api/src/modules/geo/layersModule.ts:89-100`). `size_bytes` es el tamaño sin comprimir (`layersModule.ts:122`). Las cargas masivas (`scripts/pbm-igm/load.mjs:11-16`, `:76-97`) usan los mismos módulos `createMap`/`createLayer`.
2. **Catálogo.** `GET /geo/workspace/catalog?categoryId=` (`routes/geo/index.ts:119-122` → `apps/api/src/modules/geo/workspaceModule.ts:11-103`) devuelve todos los mapas (opcionalmente de una categoría) con sus capas vectoriales (estilo, revisión, `bbox`, número de entidades) y sus rásteres procesados. No pide sesión, no pagina, no busca por texto y no expone rutas de almacenamiento. El propio módulo se describe como «catálogo público ligero usado por el Workspace temporal» (`workspaceModule.ts:6-10`).
3. **Mapa.** `fetchLayerData` (`apps/web/components/geo/gis/persistence.ts:61-63`) pide `GET /geo/maps/:id/layers/:layerId/data[/:revision]` (`routes/geo/index.ts:170-192`): el GeoJSON completo se transmite con `Content-Encoding: gzip` (la ruta con revisión es `immutable`; la otra, `no-cache`). Leaflet lo dibuja con `L.geoJSON` (`GisMap.tsx:246`) y el estilo se calcula en el navegador.
4. **Versiones.** Añadir una entidad crea una revisión inmutable (`schema/geo.ts:65-91`; `routes/geo/index.ts:310-316`), guardada como `GEO/maps/{mapId}/layers/{layerId}/revisions/{rev}-{nonce}.geojson.gz` (`apps/api/src/storage/index.ts:120-128`).

### 1.5 Recorrido de un ráster

1. **Registro.** `POST /geo/maps/:id/raster-layers` transmite un `.tif` o un `.zip` al NAS sin cargarlo en memoria (`routes/geo/index.ts:407-588`; límite `RASTER_MAX_UPLOAD_BYTES`, `env.ts:24`) y encola el trabajo.
2. **Proceso.** El worker ejecuta `gdalinfo` y `gdal_translate -of COG` **en el CRS de origen**, con bloques de 512, `BIGTIFF=YES`, sin predictor y vistas generales internas (`apps/api/src/jobs/processRaster.ts:32-34`; `apps/api/src/jobs/gdal.ts:181-195`). La compresión la decide `chooseCompression`: **WEBP** si hay canal alfa o ≥ 4 bandas, **JPEG** si son 3 bandas y **DEFLATE** en el resto (`gdal.ts:170-174`). Guarda `bbox` en EPSG:4326, `srid`, `crs`, dimensiones y bandas en `geo_raster_layers` (`schema/geo.ts:118-170`).
3. **Catálogo.** Solo los rásteres `processed` (`workspaceModule.ts:57-60`).
4. **Mapa.** Teselas XYZ públicas: `GET /geo/maps/:id/raster-layers/:layerId/tiles/{z}/{x}/{y}.png`; la API resuelve el COG y llama a TiTiler (`cog/tiles/WebMercatorQuad`) inyectando la ruta en el servidor (`routes/geo/index.ts:367-405`), con `Cache-Control: public, max-age=31536000, immutable`. Leaflet las pinta en un panel propio (`GisMap.tsx:148`, `:208`). **El navegador nunca recibe el COG ni valores de píxel.**
5. **Archivo COG.** Solo se obtiene por `/storage/GEO/…`, con sesión y acceso a la app `geo`, como descarga completa y **sin soporte de `Range`** (`apps/api/src/routes/storage.ts:46-56`, `:97-116`).

### 1.6 Capa del catálogo frente a instancia en un proyecto

- **Capa del catálogo:** una fila de `geo_map_layers` o `geo_raster_layers`. Pertenece a exactamente un mapa; no hay relación N:M. Su estilo, visibilidad y `z_index` son la presentación **del mapa**, compartida por todos (`schema/geo.ts:53-55`, `:159-161`).
- **Instancia en el Workspace:** un `GisLayer` o `RasterLayer` con `id = "vector:{mapId}:{layerId}"` (`workspace.ts:50-52`), `persisted: false` y `workspaceSource` (`apps/web/components/geo/gis/types.ts:25-51`, `:66-80`). Al añadirla se copia el estilo del catálogo y desde ahí es independiente (`GisEditor.tsx:804-819`). Se evita duplicarla por la clave (`GisEditor.tsx:865-872`; `workspace.ts:149-151`).

### 1.7 Autenticación y permisos

- Roles `ADMIN`, `REPORTER`, `VIEWER` y acceso por aplicación (`user_apps`) (`apps/api/src/db/schema/enums.ts:3-5`). `requireApp("geo")` deja pasar al ADMIN de forma implícita (`apps/api/src/auth/middleware.ts:57-64`). `authenticate` acepta la cookie `pma_access` (con prioridad) o un `Bearer`, y recarga rol y aplicaciones desde la base en cada petición (`middleware.ts:16-48`, `:66-72`).
- **Las lecturas GEO son públicas por diseño** (`routes/geo/index.ts:106-118`, `:361`): catálogo, mapas, capas, datos vectoriales, lista de rásteres y teselas.
- Escrituras: cualquier usuario con la app `geo` (también `VIEWER`) crea y edita mapas y capas; capturar entidades exige `ADMIN` o `REPORTER`; borrar, `ADMIN` (`routes/geo/index.ts:112-114`).
- **No existe un control de acceso por mapa ni por capa.** Hoy «las capas para las que el usuario tiene permiso» son todas. Para que la prueba «una capa sin permiso no aparece ni puede descargarse por URL» tenga sentido hay que introducir primero un modelo de restricción **y** cerrar para esos recursos las rutas públicas actuales; si no, seguirían descargándose por su URL de siempre (§3.4).

### 1.8 Búsqueda existente

| Búsqueda | Qué hace | Evidencia |
|---|---|---|
| Panel GEO | Filtra mapas por título, descripción o etiqueta en el navegador | `dashboard/page.tsx:238-245` |
| Catálogo del Workspace | Obliga a elegir una categoría, descarga su catálogo y filtra en el navegador por `nombre de capa + título del mapa + temática` | `WorkspaceLayerCatalogModal.tsx:35-61` |
| Dentro del mapa | Busca texto en los atributos de la capa activa | `GisEditor.tsx:1012-1016` |

No hay búsqueda en el servidor, ni entre categorías, ni por extensión geográfica, ni paginación. Lo reutilizable es la consulta de `listWorkspaceCatalog`, que ya selecciona metadatos sin rutas internas y que este plan amplía (§3.3).

### 1.9 Inventario real (2026-11-04, solo lectura)

| Recurso | Cifras |
|---|---|
| Mapas | 73, en 7 categorías (la mayor, `fisico-ambiental`, con 26) |
| Capas vectoriales | 679, **todas EPSG:4326**: 440 polígonos, 151 puntos, 88 líneas. Tamaño sin comprimir: total 1,08 GB, media 1,6 MB, máximo 57,3 MB (466 < 1 MB, 190 de 1–10 MB, 22 de 10–50 MB, 1 ≥ 50 MB). Máximo 55 338 entidades en una capa; hasta 40 capas en un mismo mapa |
| Revisiones y captura | 0 capas con revisión > 1 y 0 con captura manual habilitada |
| Visualizaciones guardadas | 2 |
| Rásteres | 33 procesados (todos con `processed_at`) y 1 con error; CRS: 22 en EPSG:32715, 10 en EPSG:32716 y 1 en EPSG:3857 |
| Usuarios con app `geo` | 2 ADMIN y 3 VIEWER (más los ADMIN, que tienen acceso implícito) |
| Columna `geo_maps.layers` | Vacía en los 73 mapas (heredada; no se usa) |
| Extensiones de PostgreSQL | `unaccent` y `pg_trgm` disponibles y sin instalar; PostGIS no existe en la imagen |

Estructura de los 33 COG (todos `LAYOUT=COG`, BigTIFF, bloques 512 × 512, con 1 a 13 vistas generales internas):

| Tipo | Compresión | Nº | Ejemplos |
|---|---|---|---|
| Ortofotos y vistas coloreadas RGBA 8 bits | WEBP | 13 | La mayor: 2,76 GB, 88 295 × 75 987 px (EPSG:3857) |
| Ortofotos RGB 8 bits | JPEG YCbCr, sin máscara interna | 2 | 2,31 GB (146 880 × 118 034 px) y 1,38 GB |
| MDT `Float32` de 1 banda (nodata −10000 o −9999) | DEFLATE | 12 | El mayor: 4,91 GB (43 512 × 42 905 px) |
| Monobanda `Byte` (nodata 255 o 0) | DEFLATE | 6 | Entre 48 KB y 6,4 MB |

Consecuencia directa: ningún vector supera los límites de descarga de RustGIS Web, pero los rásteres grandes **no pueden descargarse enteros** en el navegador: solo pueden leerse por partes (§2.8, §3.5).

### 1.10 Capacidades que se perderían o cambiarían

| Capacidad actual del Workspace o del editor | Evidencia | Con RustGIS en el Workspace |
|---|---|---|
| Guardar y restaurar como archivo JSON local | `GisEditor.tsx:874-1002` | **Cambia**: guardado en el servidor e importación única de los `sigtar-workspace` existentes |
| Restauración tolerante (avisa de capas que ya no existen) | `GisEditor.tsx:900-987` | **Se reimplementa** en el servidor (§3.2) |
| Simbología: único, por categoría y por cantidad (intervalos iguales, cuantiles y cortes naturales), opacidad, grosor, tamaño y etiquetas | `apps/web/components/geo/gis/LayersPanel.tsx:107-215`; `types.ts:10-23` | **Cambia**: la simbología pasa a ser la de RustGIS (único, categorías, graduado, proporcional); el estilo del catálogo se traduce solo al generar un proyecto (§3.2) |
| Leyenda | `GisEditor.tsx:1481-1560` | **Cambia**: leyenda del panel de capas y diseños de RustGIS |
| Visualizaciones por capa (10 tipos de gráfico) | `DashboardsPanel.tsx`; `geo_layer_visualizations` (2 registros) | **Se pierde en el Workspace**; se conserva en `/geo/maps/[id]/gis` |
| Tabla de atributos, identificar, medir, consultar punto (DMS/UTM) | `GisEditor.tsx:1382`, `:1567`; `geo-point.ts:9-81` | **Cambia**: herramientas nativas de RustGIS. Sobre capas en streaming, pendiente de prueba (P1) |
| Captura de entidades validada en el servidor, con esquema y revisiones | `AddFeaturePanel.tsx`; `routes/geo/index.ts:299-321` | **No existe en RustGIS integrado**: RustGIS edita en local. Se mantiene en el editor de mapa (hoy ninguna capa la tiene habilitada) |
| Subir Shapefiles y ortofotos a un mapa | `UploadModal.tsx`; `GisEditor.tsx:1305-1320` | Nunca estuvo en el Workspace; sigue en el editor de mapa. En RustGIS, un archivo local queda copiado en el proyecto pero **no se publica** en el catálogo |
| Exportación a PDF con plantillas del CGREG | `GisEditor.tsx:1322-1354`; `apps/web/components/geo/export/*` | **Se pierde tal cual**: clona el DOM de Leaflet y necesita el GeoJSON en la página (`ExportMapPreview.tsx:42-73`). Ver D4 |
| Exportar CSV | Botón sin implementar (`GisEditor.tsx:1600`) | **Mejora**: exportación nativa de RustGIS |
| Filtros por atributo | No existen en el Workspace (solo búsqueda en la capa activa) | **Mejora**: consultas de definición y selección de RustGIS |
| MDT `Float32` visibles | Hoy se ven como silueta negra (§3.5) | **Mejora**: RustGIS los estira en gris al leerlos por partes |
| Uso sin sesión | `middleware.ts:41`; `workspace/page.tsx:22-23` | **Cambia**: el nuevo Workspace exige sesión (IA, guardado y permisos); el visor público de cada mapa sigue igual |

### 1.11 Dependencias con el resto del geoportal

- `GisEditor` es compartido: el reemplazo debe limitarse a `workspace/page.tsx` y no tocar `/geo/maps/[id]/gis`.
- `/geo/workspace/catalog` lo usan el modal y la restauración (`GisEditor.tsx:901`; `WorkspaceLayerCatalogModal.tsx:42-44`) y lo prueban `apps/api/src/tests/geoWorkspaceCatalog.integration.test.ts` y `apps/web/tests/geo-workspace.test.ts`. Se conserva mientras exista el Workspace anterior.
- Las rutas públicas de datos y teselas (`routes/geo/index.ts:164-192`, `:362-405`) las usa el visor público de mapas: **no se pueden cerrar sin afectar al geoportal público**. Por eso el plan crea rutas nuevas y autorizadas para el Workspace (§3.4).
- Mapas base en `apps/web/components/geo/gis/gis-data.ts:17-23` y `apps/web/lib/basemaps.ts` (OpenFreeMap vectorial, Esri, OpenTopoMap, OSM). En la red local, OSM da SERVFAIL y Esri solo tiene teselas hasta z17.
- El exportador PDF y la ruta `/api/geo/territories` (`apps/web/app/api/geo/territories/route.ts`, servicio DPA del INEC) los usa el editor de mapa.
- El cliente de IA de PG2030 (`apps/api/src/modules/pg2030/ia/cliente.ts:22-57`) y sus variables `NVIDIA_*` (`env.ts:69-75`) son reutilizables, pero hoy la clave solo llega al **worker** (`docker-compose.yml:170-175`; comentario en `env.ts:69-70`). El proxy de la API cambia esa decisión y debe hacerse de forma explícita (§4.1).
- La regla de compresión del worker (`gdal.ts:170-174`) hace que **toda ortofoto futura con canal alfa** salga en WEBP, que RustGIS no lee (§2.8, D6).

---

## 2. Cómo se puede integrar RustGIS Web (verificado en su código)

### 2.1 Versión y política de fijación

- RustGIS cambia muy deprisa: cinco etiquetas entre el 2026-10-12 (`v0.1.0`) y el 2026-10-31 (`v0.5.0`) y 141 commits entre `v0.5.0` y `98a7201` (2026-11-04).
- Todo lo que usa este plan existe ya en `v0.5.0`: el puente `?embed` (`apps/rustgis-web/src/embed.rs`, sin cambios desde `cf4d8fa`, 2026-10-13), `ui.addUrl` (`crates/ui-egui/src/lib.rs:2433` en `v0.5.0`), el formato de proyecto, el cliente HTTP del asistente y la gestión de ajustes en memoria (idénticos en `v0.5.0` según `git show v0.5.0:`).
- Entre `v0.5.0` y `98a7201` hay correcciones útiles: los GeoTIFF/COG demasiado grandes pasan a ser errores en vez de bloqueos (`d805be1`) y se rechazan proyectos demasiado grandes para reabrirse antes de guardarlos (`1f6d315`).
- **Recomendación:** fijar la imagen oficial publicada `ghcr.io/opengeos/rustgis:0.5.0` **por digest** (variante amd64 `sha256:0e555232…08e5b`, comprobada con `docker manifest inspect`) y pasar a la siguiente versión publicada que incluya esas correcciones solo después de repetir las pruebas de §8.1. Nunca `latest`/`edge`.

### 2.2 Autoalojamiento en el mismo dominio y en la ruta del Workspace

- La documentación oficial de instalación permite autoalojar el ZIP estático o la imagen Docker, **también bajo una ruta** (`https://example.com/rustgis/`, con barra final), porque la aplicación usa URL relativas; el proxy inverso debe reenviar «sin la ruta». La versión autoalojada no lleva analítica (solo el despliegue oficial la inyecta, `Dockerfile:9-11`).
- La imagen oficial es nginx sin privilegios en el puerto 8080; marca como inmutables los `.js`/`.wasm` con hash y el resto como `no-cache`; añade `X-Content-Type-Options` y **no** añade `X-Frame-Options` a propósito, para poder ir dentro de un marco (`packaging/docker/nginx.conf:7-10`, `:32-35`). No define COOP/COEP: no usa hilos ni `SharedArrayBuffer`.
- El *service worker* no se registra con `?embed` (`apps/rustgis-web/index.html:66-70`) y, cuando existe, no intercepta teselas, datos ni peticiones del asistente (`apps/rustgis-web/sw.js:10-11`, `:63-65`).
- Llamadas externas al arrancar: icono y logotipo desde `https://assets.rustgis.app` (`index.html:7`, `:15`, `:47`) y la lista de bloqueo de complementos de `plugins.rustgis.app`, **también con `?embed`** (`crates/ui-egui/src/pluginsui.rs:278-280`, `:300-314`). Una CSP estricta debe permitir `'wasm-unsafe-eval'` y el script en línea de la página (según el análisis del código; se comprueba en la fase 0).
- **Propuesta:** servir la imagen en `https://sigtar.gobiernogalapagos.gob.ec/geo/workspace/app/` (nginx → `http://rustgis:8080/`) y añadir en esa `location` `Content-Security-Policy: frame-ancestors 'self'`, para que solo el geoportal pueda enmarcarla. Mismo origen que la API: los `fetch` de RustGIS llevan las cookies de sesión y no hay CORS.
- **Por qué el mismo origen y no un subdominio:** los `fetch` de datos y del asistente no fijan `credentials` (`apps/rustgis-web/src/web.rs:619-650`, `:895-906`), así que el navegador aplica `same-origin`. En `rustgis.gobiernogalapagos.gob.ec` las cookies **no** viajarían a `sigtar.…`, aunque sea el mismo sitio.

### 2.3 Modo `?embed` y puente `postMessage`

Comprobado en `embed.rs` y `web.rs` (`98a7201`, idéntico en `v0.5.0`):

| Aspecto | Comportamiento | Evidencia |
|---|---|---|
| Arranque | Proyecto en blanco, ajustes en memoria (no `localStorage`), sin aviso al cerrar | `embed.rs:4-7`; `web.rs:104-107`, `:140`, `:997-1005` |
| De la página a RustGIS | `{"rustgis":"project","text":<JSON>}` reemplaza el proyecto (`project.openText`); `{"rustgis":"run","id":…,"command":…,"params":{…}}` ejecuta un comando | `embed.rs:9-12`, `:42-52`; `web.rs:396-412` |
| Comandos permitidos | Solo los que empiezan por `ui.`; `layer.addData`, `project.open` o `map.addTiles` se rechazan | `embed.rs:54-57`, prueba en `:151-156` |
| De RustGIS a la página | `{"rustgis":"ready"}` al arrancar; `{"rustgis":"project","text"}` cuando el proyecto cambia (edición o desplazamiento), tras 600 ms sin cambios y sin devolver nunca el proyecto que envió la página; `{"rustgis":"result","id","ok","value"\|"error"}` | `embed.rs:14-18`, `:29-30`, `:99-125`; `web.rs:413-420` |
| Detección de «listo» | `ready` se envía una sola vez con destino `"*"` al crear la app | `web.rs:369-370` |
| Validación del origen | Solo acepta mensajes cuyo `source` sea la ventana padre; fija como origen válido el del **primer** mensaje aceptado y solo responde a ese origen | `web.rs:346-364`, `:385-390` |
| Qué estado devuelve | El JSON **completo** del proyecto, datos incrustados incluidos (`serde_json::to_string(&app.session.project)`); la «clave» de cambio combina la revisión, el mapa activo y la cámara | `web.rs:414-416`; `embed.rs:74-81` |

Consecuencias para la página anfitriona:

- Registrar el oyente de `message` **antes** de asignar el `src` del `iframe`, o se pierde `ready`.
- Filtrar `event.source === iframe.contentWindow` y `event.origin === location.origin`. RustGIS no tiene lista de orígenes permitidos (confía en el primero), así que la protección real es `frame-ancestors 'self'` (§2.2).
- El `result` de un comando asíncrono confirma que **empezó**, no que terminó (§2.5).
- El tamaño de cada mensaje `project` depende de lo que esté incrustado: con capas leídas por URL es pequeño; con copias de datos crece con ellas y se reenvía en cada desplazamiento.

### 2.4 Abrir un proyecto

- `?project=<url>` abre al arrancar un proyecto nativo por su dirección, «o cualquier dirección que responda con el JSON de un proyecto, como una API que lo construye al vuelo» (documentación oficial de instalación). Internamente ejecuta `ui.openUrl` (`web.rs:162-181`).
- `ui.openUrl` es un comando `ui.*`, así que **también se puede ejecutar desde el puente** después de arrancar: descarga el proyecto fuera del ciclo de dibujo y lo abre al llegar; un proyecto nativo reemplaza al actual (`crates/ui-egui/src/lib.rs:2567-2589`). Como el proyecto descargado no es «el de la página», RustGIS lo devuelve después con un mensaje `project`, lo que sirve de **confirmación** (pendiente de prueba).
- Alternativa: enviar el JSON con el mensaje `project` (`web.rs:398-401`). **No tiene acuse**: si el JSON es inválido, RustGIS solo muestra un aviso dentro de la app.
- **Efectos de reemplazar el proyecto** (`crates/engine/src/cmd/project.rs:151-173`): se borra el historial de deshacer, la capa activa pasa a ser la primera, la herramienta vuelve a la de exploración y se descartan las descargas de `ui.addUrl` pendientes. Las cachés de teselas, cabeceras COG y partes de FlatGeobuf, indexadas por dirección, **se conservan** (según el análisis del código; se comprueba en la prueba P2).

### 2.5 Añadir capas sin reiniciar el mapa

- **Sí es posible con la interfaz pública.** `ui.addUrl` es un comando `ui.*` (ejecutable desde la página) que añade datos por su dirección al proyecto **actual** (`lib.rs:2614-2752`). Lo que guarda depende del formato:

| Dirección | Qué hace RustGIS | Qué queda en el proyecto | Evidencia |
|---|---|---|---|
| `….fgb`, `….parquet`, `….geoparquet` | Lee por `Range`, vista a vista | **La URL** (`Layer.source.path`) | `crates/data/src/source/mod.rs:391-398`; `lib.rs:2646-2692` |
| `….tif`/`….tiff` (o sin extensión si resulta ser GeoTIFF) | Sondea y, si es un COG con teselas, lo lee en sitio como capa de teselas | **La URL** (`Map.tiles[]`, `kind: "cog"`) | `crates/engine/src/cmd/layer.rs:3347-3376` |
| `….tif` con `"whole": true` | Descarga el ráster entero | **Los bytes**, en base64 | Documentación oficial de formatos; análisis del código |
| Cualquier otra (GeoJSON, KML, CSV…) | Descarga entera en segundo plano | **Las entidades**, incrustadas | `lib.rs:2729-2752`; `crates/data/src/lib.rs:329-339` |

- Acepta `name`, `zoom`, `crs`, `layer` y otros parámetros de lectura (`lib.rs:2694-2716`). La página arranca así los enlaces `?data=` (`web.rs:195-204`).
- Otros comandos `ui.*` alcanzables desde la página: `ui.openUrl`, `ui.searchOpenData`, `ui.stacLink`, `ui.addService`, `ui.pane.*` (incluido `ui.pane.assistant {"ask": …}`), `ui.identify`, `ui.exportMap`. **No** alcanzables: `layer.remove`, `layer.select` (capa activa), `layer.zoomTo`, `map.addTiles` (capas XYZ) y `project.open`.
- **Limitaciones:** el `result` solo indica que la descarga empezó; la llegada se confirma con el siguiente mensaje `project`. `ui.addUrl` necesita una dirección absoluta (`layer.rs:3355-3361`) y decide el formato por la extensión. Una capa XYZ solo puede entrar en el JSON del proyecto o con `?tiles=` al arrancar (`web.rs:218-234`).
- **Riesgo de contrato:** la documentación de `embed.rs` describe `run` como comandos de interfaz («paneles, idioma, tema», `embed.rs:20-23`), pero el filtro acepta cualquier `ui.*`. RustGIS podría restringirlo en una versión futura. Mitigación: fijar la versión, pedir a RustGIS que documente `ui.addUrl`/`ui.openUrl` como parte del contrato del puente y, si se restringe, recurrir a `?project=` y al mensaje `project`, que sí son contrato.

### 2.6 ¿Buscar dentro de RustGIS o junto a él?

| Herramienta de RustGIS | Qué busca | ¿Sirve para nuestro catálogo? | Evidencia |
|---|---|---|---|
| Búsqueda de comandos | Comandos, herramientas y paneles | **No**: no es un buscador de datos | `crates/ui-egui/src/chrome.rs:676-710` (según el análisis) |
| Search Open Data | Portales CKAN (`/api/3/action/package_search`), Socrata, ArcGIS Hub y portales ArcGIS | **Sí, con un adaptador**: un endpoint compatible con CKAN en nuestra API, abierto desde el puente con `ui.searchOpenData {"portal":"ckan","url":…,"query":…}`. Sus peticiones llevarían la cookie, así que los resultados respetarían los permisos | `crates/tiles/src/portal.rs:354-357`; `crates/ui-egui/src/opendataui.rs:305-333` |
| STAC Search | API STAC con búsqueda por GET o catálogos estáticos | Posible para COG; más trabajo y pensado para imágenes | Documentación oficial `web-data` |
| From Service | WMS, WMTS, WFS, WCS, OGC API, ArcGIS y búsqueda CSW | Posible con OGC API Features o CSW; lista servicios más que buscar | `lib.rs:2770-2790` (según el análisis) |
| Complementos WebAssembly | Lo que programe el complemento | Poco práctico con `?embed`: la instalación pide confirmación y no se recuerda | Documentación oficial `plugins` |

**Decisión: mantener el buscador del geoportal junto al mapa** como vía principal, porque controla permisos, metadatos y textos en español; sabe qué capas ya están en el proyecto (evita duplicados); aplica la alternativa XYZ a los COG WEBP, que un diálogo interno no sabría hacer; y no depende de diálogos de RustGIS que cambian a diario. El endpoint compatible con CKAN es un complemento barato para después del piloto: permitiría buscar también desde dentro de RustGIS sin fork. Cómo añade RustGIS un recurso CKAN que apunta a nuestros `.fgb`/`.tif` queda pendiente de prueba.

### 2.7 Formato de proyecto y estado que se conserva

Estructuras `serde` en JSON, sin `deny_unknown_fields` (los campos desconocidos se ignoran): `Project` (`crates/engine/src/project.rs:260-326`), `Map` (`crates/map/src/lib.rs:1215-1280`), `Layer` (`lib.rs:113-270`), `TileLayer` (`crates/map/src/tiles.rs:93-201`) y `Camera` (`crates/map/src/camera.rs:35-48`).

| Estado | ¿Se conserva? | Dónde | Evidencia |
|---|---|---|---|
| Orden | Sí | `Map.layers` (índice 0 arriba); `Map.tiles` (índice 0 arriba; `over` para intercalar una capa de teselas sobre una capa vectorial) | `lib.rs:1222-1228`; `tiles.rs:128-132` |
| Visibilidad y opacidad | Sí | `Layer.visible`, `Layer.transparency` (0 opaca … 100 invisible); `TileLayer.visible`, `TileLayer.opacity` (0–1) | `lib.rs:117-122` |
| Estilo vectorial | Sí | `Renderer`: único, categorías (por campo o expresión), graduado (cortes y método), proporcional | `crates/map/src/symbology.rs:679-760` |
| Etiquetas, filtros y escala | Sí | `labels`, `definition_query` (WHERE SQL), `min_scale`/`max_scale` | `lib.rs:120-131` |
| Estilo ráster | Parcial | En rásteres descargados enteros (`RasterStyle`); un COG leído en sitio guarda bandas y rango en el fragmento `#bands=…&range=…` de su URL | `crates/map/src/raster.rs:597`; `crates/tiles/src/cog.rs:56-133` |
| Leyenda y grupos | Sí | Clases del estilo, `TileLayer.legends`, `Map.groups` | `lib.rs:1147-1170` |
| Extensión del mapa | Sí, como cámara | Centro y resolución en Web Mercator, rumbo e inclinación; no guarda un `bbox` | `camera.rs:35-48` |
| Capa activa | **No** | Al abrir pasa a ser la primera, y el puente no puede fijarla (`layer.select` no es `ui.*`) | `crates/engine/src/cmd/project.rs:160` |
| Datos | Según el tipo | Por URL o incrustados (§2.5) | `crates/data/src/lib.rs:329-339` |
| Versión del formato | — | `format: 1`; un formato mayor se rechaza; sin migraciones por pasos; tamaño máximo 512 MiB | `project.rs:56-59` |

Consecuencias:

- El generador y el resolvedor del servidor (§3.2) solo tocan campos estables: `maps[].layers[].source.path`, `maps[].tiles[].url`, la inserción o retirada de entradas, la cámara y un estilo básico. Se parte de una **plantilla real** capturada del puente en la fase 0 y se vuelve a probar en cada actualización de RustGIS.
- Las URL de teselas y de datos deben ser **absolutas**: una relativa se descarta al abrir con solo un aviso en la consola (`tiles.rs:536-561`, según el análisis). El servidor las escribe con `FRONTEND_ORIGIN` y las reescribe al abrir, lo que además resiste un cambio de dominio.
- Si el usuario añade archivos propios o copias de datos, quedan dentro del proyecto. Se fija un tope de tamaño al guardar (p. ej. 50 MB) y la página avisa antes.

### 2.8 Datos en el navegador: formatos, compresiones, reproyección y valores de píxel

| Caso | RustGIS Web | Evidencia |
|---|---|---|
| Cookies | Mismo origen: sí, por defecto. Con un inicio de sesión de «Conexiones»: se omiten | `web.rs:619-650` |
| Lectura de COG | Cabecera y teselas de la vista general necesaria por `Range`; exige respuestas `206` | `crates/tiles/src/cog.rs:1-11`; `web.rs:614-618`, `:681-737` |
| BigTIFF (`BIGTIFF=YES` en `gdal.ts:188`) | Reconocido por el lector | `crates/data/src/raster/cog.rs:301`; `geotiff.rs:587-616` |
| COG JPEG YCbCr RGB (2) | **Lo decodifica, pero con colores falsos** (comprobado en la prueba del 2026-11-04). La librería `tiff` 0.11.3 desactiva a propósito la conversión de color de JPEG y entrega YCbCr. RustGIS lo pinta como RGB: el blanco sale rosado y la tierra, verde azulada. Por eso se sirve por teselas, como los WEBP (§11.4); conviene reportarlo a RustGIS | `cog.rs:321`; `tiff-0.11.3/src/decoder/image.rs:592-597` |
| COG WEBP RGBA (13) | **No**: no está entre las compresiones admitidas (Deflate, LZW, PackBits, JPEG y Zstandard) y el decodificador `tiff` 0.11.3 que usa RustGIS no depende de ningún decodificador WebP | `data.md:1001-1004`; `Cargo.lock` (dependencias de `tiff`) |
| COG DEFLATE `Float32` (12) y `Byte` (6) | **Sí.** El nodata se vuelve transparente. En lectura por partes solo se dibuja en gris estirado (percentiles 2–98) o con un rango fijo; sin rampa de color ni sombreado | `cog.rs:579-585` (según el análisis); `crates/tiles/src/cog.rs:5-11` |
| Reproyección UTM 15S/16S → mapa | En el navegador (proj4rs, malla de 16 px por tesela) | `crates/tiles/src/cog.rs:924-963` (según el análisis) |
| Valor de píxel o identificar | **No** sobre COG ni XYZ: la identificación los omite; solo sobre rásteres descargados enteros | `crates/engine/src/cmd/select.rs:388-393` |
| GeoJSON por URL | Descarga entera (≤ 256 MiB) e incrustada. El `Content-Encoding: gzip` lo resuelve el navegador; un `.gz` sin esa cabecera no se reconoce | Documentación oficial de formatos; `crates/data/src/io.rs:153-193` |
| FlatGeobuf con índice | Por `Range`, vista a vista; en la web, una vista con más de 30 000 entidades muestra una muestra repartida; el proyecto guarda la URL. Las herramientas de geoproceso necesitan la capa descargada | Documentación oficial de formatos |
| Errores al abrir | Un fallo de teselas o COG produce un aviso y el proyecto abre igual; las capas por partes conservan su error; solo un JSON inválido o `format > 1` rechaza el proyecto | Análisis del código (`mapview.rs:1278-1282`) |

### 2.9 Licencia y atribución

- RustGIS es **Apache-2.0** (`LICENSE`; `Cargo.toml:9`). Sus dependencias están limitadas a licencias permisivas (`deny.toml`); no hay GPL, LGPL, AGPL, MPL ni licencias no comerciales.
- La compilación web copia `LICENSE` y `THIRD-PARTY-LICENSES.txt` junto a la app (`apps/rustgis-web/index.html:11-12`): deben seguir servidos.
- Si se aplica el parche opcional del asistente: marcar los archivos modificados (Apache-2.0 §4.b) y no presentar la imagen propia como la versión oficial (la licencia no concede uso de marcas, §6).
- Otros avisos: datos EPSG bajo los términos de IOGP; fuentes de la interfaz con licencias Ubuntu Font y OFL (`ATTRIBUTION.md`); los términos de cada proveedor de mapas base (Esri, OSM/ODbL, OpenFreeMap). El logotipo e iconos de `assets.rustgis.app` no indican licencia: confirmarla antes de alojarlos nosotros. Las herramientas GeoLibre se descargan de jsDelivr solo si el usuario las pide.
- **Conclusión:** la licencia no impide autoalojar la versión oficial ni una con el parche; solo exige conservar los avisos.

---

## 3. Carga inicial y búsqueda del catálogo

### 3.1 Recursos del geoportal y cómo cargarlos en RustGIS

| Recurso | Formato actual | Acceso actual | Soporte en RustGIS Web | Estrategia de carga | Limitaciones |
|---|---|---|---|---|---|
| **Vectores** (679) | GeoJSON EPSG:4326 comprimido con gzip; ≤ 57 MB sin comprimir y ≤ 55 338 entidades | Ruta pública sin extensión | GeoJSON por URL: **se copia** en el proyecto. FlatGeobuf con índice: **por partes y por URL** (§2.5) | Generar en el worker un **FlatGeobuf con índice por revisión** y servirlo en `…/geo/workspace/v1/vectors/:layerId/r/:rev/data.fgb` con `Range`; `ui.addUrl` con esa URL. El GeoJSON queda como «copia para analizar», a petición | Por partes: muestra de 30 000 entidades por vista. Geoprocesos y tabla completa exigen descargar la capa (copia en el proyecto). Pendiente de prueba: estilo por atributo, etiquetas, identificar y tabla (P1) |
| **COG WEBP RGBA** (13: ortomosaicos y vistas coloreadas de MDT) | COG WEBP, EPSG:32715/32716/3857, hasta 2,76 GB | Teselas XYZ de TiTiler | **No decodificable** (§2.8) | **Alternativa XYZ**: teselas de TiTiler por una ruta autorizada `…/rasters/:rasterId/v/:version/tiles/{z}/{x}/{y}.png`, como capa de teselas del proyecto | Solo visualizar. Añadirla después del arranque exige reemplazar el proyecto (§3.3) |
| **COG JPEG YCbCr RGB** (2 ortofotos) | COG JPEG, hasta 2,31 GB y 146 880 × 118 034 px | Teselas XYZ | Se lee por partes, pero **con colores falsos** (§2.8) | **Alternativa XYZ**, como los WEBP. Todo ráster de 3 bandas que procese el worker queda en este caso (`chooseCompression`) | Solo visualizar |
| **MDT `Float32`** (12) | COG DEFLATE de 1 banda, nodata −10000 o −9999, hasta 4,91 GB | Teselas XYZ (hoy, silueta negra) | **Sí**, por partes, en gris | `ui.addUrl` con `…/cog.tif` (con `#range=` si se acepta, pendiente); o XYZ coloreado por TiTiler con `colormap_name` y `rescale` | Sin valores de píxel ni sombreado; recorte para analizar (§3.5) |
| **Monobanda `Byte`** (6) | COG DEFLATE, nodata 255 o 0, ≤ 6,4 MB | Teselas XYZ | **Sí**, por partes o descargado entero | `ui.addUrl` con `…/cog.tif`; con `"whole": true` si se quiere analizar | La copia descargada viaja dentro del proyecto |
| **Mapas base** | Estilos MapLibre de OpenFreeMap; XYZ de Esri, OpenTopoMap y OSM (`gis-data.ts:17-23`) | Directo desde el navegador | Estilos y XYZ como capas de teselas (`kind: "style"`/`"raster"`), solo dentro del proyecto | Incluirlos en el proyecto generado, o usar los fondos propios de RustGIS | En la red local OSM falla y Esri llega hasta z17 |
| **Servicio DPA del INEC** (ArcGIS FeatureServer) | ArcGIS REST | Ruta Next `/api/geo/territories`, usada por el exportador | RustGIS lee servicios ArcGIS y OGC API desde «From Service…» | No se migra | — |

### 3.2 Recorrido A: el usuario abre un proyecto guardado (o un Mapa)

> **Implementado con una variante (§11):** `…/open` devuelve el JSON ya resuelto con sus avisos, y la página lo envía a RustGIS con el mensaje `project` y un `id`. El parche contesta con `result`, así que no hace falta `projectUrl` ni `ui.openUrl`. La capa activa se conserva (`sigtar_active`).

1. **Entrada.** El usuario llega a `/geo/workspace` con su sesión. Sin sesión, la página muestra un enlace `<a href="/login?next=/geo/workspace">`. La página pide `GET /geo/workspace/v1/config`, registra el oyente de mensajes, monta el `iframe` `…/geo/workspace/app/?embed&lang=es` y espera `ready`.
2. **Elección.** «Abrir» lista los proyectos del usuario (`GET /geo/workspace/v1/projects`) y los Mapas que puede leer.
3. **Resolución en el servidor.** `POST /geo/workspace/v1/projects/:id/open` (o `…/maps/:mapId/open` para un Mapa) devuelve `{ projectUrl, notices }`:
   - **Mapa:** el servidor genera el proyecto desde `geo_map_layers` y `geo_raster_layers` con la plantilla de §2.7: capas vectoriales con `source.path` = su `.fgb` y `dataset.fields` vacío (RustGIS toma los campos del archivo); COG legibles como `tiles[]` `kind: "cog"`; COG WEBP como `tiles[]` `kind: "raster"` con la plantilla XYZ; orden por `z_index` descendente; `visible`; `transparency = round((1 − opacity) × 100)`; estilo único traducido de `LayerStyle` (color, opacidad, grosor, tamaño, etiquetas); cámara desde `center`/`zoom` (x = 6 378 137·λ, y = 6 378 137·ln tan(π/4 + φ/2), resolución = 156 543,034 / 2^zoom m/px). Las clasificaciones por categoría o cantidad se traducen en la fase 1.
   - **Proyecto guardado:** parte del JSON de RustGIS almacenado y de `layer_refs` (lista `{tipo, id, revisión o versión}` extraída al guardar).
   - **Comprobaciones por referencia:** que existe; que el usuario puede leerla (`canReadGeoMap`); la revisión vigente de cada vector y su FlatGeobuf disponible; que cada ráster siga `processed` y su versión (`processed_at`).
   - **Capa eliminada o sin permiso:** se retira del proyecto y se informa como «ya no está disponible», con el mismo texto en ambos casos para no revelar que existe.
   - **Nueva versión:** se reescribe la URL a la revisión vigente y se avisa «actualizada a la revisión N», igual que hoy el Workspace, que al restaurar descarga los datos vigentes (`GisEditor.tsx:945`). «Mantener la versión» puede añadirse después: las revisiones son inmutables.
   - **Copias incrustadas de capas del catálogo** (si el usuario pidió «copia para analizar»): se reconocen por el nombre de archivo único que lleva su URL; se retiran si el usuario perdió el permiso y, si no, se mantienen con el aviso «copia del día D» (no se actualizan).
   - El JSON resuelto se guarda unos minutos y se publica en `projectUrl` (`…/projects/:id/resolved/:token.rgis`).
4. **Apertura.** La página ejecuta `run ui.openUrl {"url": projectUrl}` (dirección absoluta). RustGIS lo descarga con la cookie, lo abre y, al terminar, lo devuelve con un mensaje `project`, que confirma la apertura. Recupera orden, visibilidad, opacidad, estilos, etiquetas, filtros y cámara; la capa activa, solo con el parche SIGTAR (§0.5). Sin el parche pasa a ser la primera (§2.7). Los datos se leen por partes a medida que la vista los necesita.
5. **Cambios y guardado.** Cada mensaje `project` marca «cambios sin guardar». «Guardar» envía `PUT /geo/workspace/v1/projects/:id` con `{ rustgisProject, baseRevision }`. El servidor valida el JSON (`format: 1`) y el tamaño, extrae `layer_refs` de las URL del catálogo y responde 409 si otro guardado se adelantó (la página ofrece «guardar como copia»).

**No se guardan enlaces que caduquen.** Las URL solo contienen identificadores; la autorización va en la cookie de cada petición. No hay URL firmadas en el geoportal y el diseño no introduce ninguna. Una URL guardada sigue sirviendo mientras exista el recurso y el usuario tenga permiso, y una revocación surte efecto en la siguiente petición (`authenticate` recarga rol y aplicaciones en cada una, `apps/api/src/auth/middleware.ts:27-42`).

### 3.3 Recorrido B: el usuario busca una capa que no estaba en el proyecto

1. **Consulta.** El panel llama a `GET /geo/workspace/v1/catalog/search?q=…&kind=vector|raster&categoryId=…&mapId=…&bbox=…&limit=20&cursor=…`. La consulta une `geo_map_layers` y `geo_raster_layers` (solo `processed`) con `geo_maps`, compara sin acentos nombre de capa, título del mapa, temática y categoría (`unaccent`), filtra por permiso, por `bbox` (columna numérica) y por tipo. Con 712 recursos no hace falta un índice de texto.
2. **Metadatos mostrados.** Nombre; tipo; Mapa y categoría de origen; en vectores, geometría, número de entidades y tamaño; en rásteres, bandas, resolución, dimensiones, CRS y tamaño; fecha y revisión; **modo de carga** («por partes», «teselas XYZ» o «solo copia»). El estado «En el mapa» sale de las URL presentes en el último mensaje `project`.
3. **Añadir, según el tipo:**
   - **Vector:** `{"rustgis":"run","id":n,"command":"ui.addUrl","params":{"url":"https://…/data.fgb","name":"…","zoom":true}}`. Se añade **al proyecto actual**, sin reiniciar nada (§2.5).
   - **COG DEFLATE (1 o 2 bandas):** lo mismo con la URL `…/cog.tif`.
   - **COG WEBP o JPEG YCbCr:** la página toma el último JSON recibido, inserta arriba de `maps[activo].tiles` una capa `{"kind":"raster","url":"https://…/tiles/{z}/{x}/{y}.png",…}` y lo envía con el mensaje `project`. Efectos conocidos (§2.4): se borra el historial de deshacer, la capa activa vuelve a la primera y se descartan las descargas pendientes, así que la página **espera a que no haya ninguna en curso**. Se conservan la cámara (viene en el JSON) y las cachés.
   - **Copia para analizar** (acción explícita y con aviso de tamaño): `ui.addUrl` con `…/data.geojson` o con `…/cog.tif` y `"whole": true` para rásteres pequeños.
4. **Confirmación.** La capa se da por añadida cuando el siguiente `project` contiene su URL; si no llega en un tiempo razonable, la página avisa.
5. **Sin duplicados.** El panel deshabilita «Añadir» para claves presentes (`vector:<layerId>`, `raster:<rasterId>`), igual que hoy (`GisEditor.tsx:865-872`).
6. **Capa publicada mañana.** La búsqueda consulta PostgreSQL en cada petición: una capa aparece en cuanto existe su fila y, en vectores, su FlatGeobuf (lo genera el worker al publicarla; mientras tanto se muestra «preparando»), o en cuanto su ráster llega a `processed`. No hay catálogo estático que regenerar ni cambio alguno en RustGIS.

### 3.4 Autorización de la búsqueda y de la descarga

- **Un único punto de decisión:** `canReadGeoMap(user, map)` lo usan la búsqueda, el generador y el resolvedor de proyectos y todas las rutas de datos (`.fgb`, `.geojson`, `.tif`, teselas). Las rutas solo reciben identificadores; la ruta de almacenamiento la resuelve el servidor, como ya hace la API (`workspaceModule.ts:6-10`).
- **Las rutas públicas actuales siguen abiertas para los mapas públicos.** Si se introduce la visibilidad por mapa, deben responder 404 para un mapa restringido a quien no tenga acceso; si no, una capa «sin permiso» seguiría descargándose por su URL de siempre (`routes/geo/index.ts:170-192`) o por sus teselas (`:371-405`). Esas teselas hoy son `Cache-Control: public, immutable`; para mapas restringidos deben ser `private`.
- **Coste por petición.** Cada lectura `Range` pasa por `authenticate`, que consulta la base. Para no multiplicar consultas al desplazar el mapa, se puede cachear en memoria la decisión `(usuario, recurso)` durante 60 s; el retraso máximo de una revocación queda documentado.
- **Modelo de permisos (decisión D1):** visibilidad por mapa (`public`; `internal` para usuarios con app `geo`; `restricted` con lista de usuarios o roles), heredada por sus capas. Es el mínimo que permite la prueba P4.

### 3.5 Rásteres grandes, vectores y conversiones

- **El formato actual de los rásteres ya permite lecturas parciales.** Los 33 COG tienen `LAYOUT=COG`, bloques de 512 × 512 y vistas generales internas (§1.9).
- **Lo que falta es servirlos con `Range`.** Hoy el COG solo sale por `/storage`, completo (§1.5). Ruta nueva: `GET|HEAD /geo/workspace/v1/rasters/:rasterId/v/:version/cog.tif` con `Accept-Ranges: bytes`, `Content-Length`, `Content-Type: image/tiff`, respuestas `206` y `ETag`. En producción la API autoriza y responde con `X-Accel-Redirect: /_nas_cog/<ruta>`, y nginx (con el NAS montado en solo lectura) sirve los bytes con `Range` y `sendfile`; en la prueba de concepto basta una lectura `Range` en Fastify. `version` (de `processed_at`) cambia si el ráster se reprocesa (el reintento reescribe el mismo `cog/cog.tif`), así que la caché nunca mezcla versiones. Los `.fgb` se sirven igual.
- **Visualizar frente a analizar.**
  - *Visualizar:* lectura por partes de los COG legibles. Para los MDT es una mejora: con la ruta de teselas actual, el MDT `Float32` de «Mina Cerro Pelado» se dibuja como una silueta negra sin relieve (tesela `15/8101/16469` pedida el 2026-11-04), porque TiTiler reescala sin `rescale`.
  - *Analizar valores de píxel:* RustGIS Web no identifica sobre COG ni XYZ (§2.8). Las herramientas ráster necesitan el ráster descargado entero (≤ 256 MiB, y la copia viaja en el proyecto), y la lectura de una ventana (`bbox`) está rechazada por ahora en la web. Solo los 6 rásteres `Byte` (≤ 6,4 MB) y el MDT de 1,1 MB caben enteros.
  - *Analizar rásteres grandes (fase posterior):* `GET /geo/workspace/v1/rasters/:rasterId/window.tif?bbox=…&res=…`, que pide a TiTiler un recorte GeoTIFF (`/cog/bbox/{minx},{miny},{maxx},{maxy}.tif`, disponible en la 0.19.2 instalada) con un tope pequeño (p. ej. 16 MB, porque la copia se reenvía con cada cambio) y que la página añade con `ui.addUrl` y `"whole": true`. TiTiler también ofrece `/cog/point/{lon},{lat}` y `/cog/statistics`.
- **Conversiones necesarias:**
  1. **Vectores → FlatGeobuf con índice espacial**, una vez por revisión. Dónde: en el worker, con el GDAL 3.6.2 que ya tiene (`ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES salida.fgb /vsigzip/entrada.geojson.gz`). Cuándo: tras `createLayer` y `appendFeature` (trabajo de pg-boss) y una carga inicial de las 679 capas existentes (1,08 GB de GeoJSON). Es **imprescindible** para no copiar los vectores dentro de cada proyecto; GeoParquet también se lee por partes, pero solo con una columna de cobertura `bbox`, y no aporta nada más aquí.
  2. **COG WEBP (13)** — decisión D6: (a) alternativa XYZ con TiTiler (recomendada para el piloto: solo visualizar, sin conversión); (b) proponer a RustGIS que decodifique WebP dentro del TIFF (ya decodifica teselas WebP sueltas con el navegador); (c) recodificar a una compresión legible (Zstandard o DEFLATE sin pérdida; aumenta mucho el tamaño); (d) cambiar `chooseCompression` (`gdal.ts:170-174`) para las ortofotos futuras con alfa.
  3. **MDT coloreados:** sin conversión. Si hace falta color, teselas XYZ de TiTiler con `colormap_name` y `rescale`; las vistas coloreadas ya existentes son WEBP (caso 2).

---

## 4. Proxy de IA para NVIDIA y MiniMax

### 4.1 Qué se reutiliza y qué cambia

- **Ya existe un cliente NVIDIA en el backend**: `llamarNvidia` (`apps/api/src/modules/pg2030/ia/cliente.ts:22-57`), con `NVIDIA_BASE_URL` (por defecto `https://integrate.api.nvidia.com/v1`), `NVIDIA_API_KEY`, `NVIDIA_MODEL` y un `AbortController` con tiempo límite (`apps/api/src/lib/env.ts:69-75`). Es de uso único (un prompt → un texto, sin herramientas, sin streaming, `temperature: 0`), así que no sirve como proxy, pero sí su configuración y su patrón de tiempo límite y errores.
- **La API Fastify basta; no hace falta otro servicio.** Ya autentica por cookie (`authenticate`, `requireApp("geo")`), está en el mismo origen detrás de `/api-proxy/` y tiene un limitador compartido en PostgreSQL (`consumeSharedRateLimit`, `apps/api/src/auth/rateLimit.ts:99-147`). Un servicio aparte solo se justificaría para aislar la carga o la salida a Internet de la IA, algo innecesario con cinco usuarios GEO.
- **Cambio de decisión que hay que aprobar.** Hoy la clave NVIDIA llega **solo al worker** (`docker-compose.yml:170-175`; `env.ts:69-70`: «only the worker calls the model»). El proxy exige una clave en el contenedor `api`. Se recomienda una variable **distinta**, `WORKSPACE_AI_API_KEY` (otra clave u otro proyecto de NVIDIA), para separar cuotas, poder revocarla sin afectar a PG2030 y no ampliar la exposición de la clave existente. Se gestiona como las demás: en el `.env` del servidor, fuera del repositorio, inyectada solo en `api` por compose, nunca en variables `NEXT_PUBLIC_*` ni en respuestas.

### 4.2 Qué llama RustGIS realmente (verificado en el código)

| Hecho | Evidencia (RustGIS `98a7201`, igual en `v0.5.0`) |
|---|---|
| El proveedor «OpenAI-compatible» es el preset `custom`, **sin clave obligatoria** (`keyless: true`) | `crates/assistant/src/provider.rs:121-132` |
| Llama a `POST {dirección}/chat/completions` | `provider.rs:1070` |
| `GET {dirección}/models` solo cuando el usuario pulsa ↻ | `provider.rs:1582-1588`; `crates/ui-egui/src/assistantpane.rs:969-976` |
| Nunca usa `/responses` (solo el preset ChatGPT, oculto en la web) ni `/completions` | `provider.rs:1184`; `assistantpane.rs:898-901` |
| Cuerpo: `{"model","messages","stream":true}`, `tools` si hay; `reasoning_effort:"none"` solo tras un 400 que lo mencione. No envía `max_tokens`, `temperature` ni `tool_choice` | `provider.rs:1030-1065` |
| Mensajes de herramientas: el asistente reenvía `tool_calls` (`id`, `function.name`, `function.arguments` como texto) y cada resultado como `{"role":"tool","tool_call_id","content"}`; conserva `reasoning_content` | `provider.rs:1035-1050`, `:1112-1116` |
| Cabeceras: `Content-Type: application/json`, `Accept: text/event-stream` y `Authorization` **solo si hay clave** | `provider.rs:1066-1069` |
| En la web, `fetch` sin `credentials` (por defecto `same-origin`: lleva cookies si el proxy está en el mismo origen que el iframe) y con `redirect: "error"` | `apps/rustgis-web/src/web.rs:895-906` |
| La dirección debe ser absoluta y `https://` (o `http://` local) | `provider.rs:512-553`; `web.rs:891-893` |
| Pide streaming pero **la web lee la respuesta completa** (`array_buffer`): no hay texto en vivo; acepta SSE o JSON | `web.rs:930-935`; `provider.rs:730-737`; documentación oficial del asistente |
| Un flujo SSE solo está completo con `data: [DONE]` o un `finish_reason`; si no, error `incomplete_stream` sin reintento | `provider.rs:746-773` |
| Reintenta **como máximo 3 veces** por petición, en 408, 429, 500, 502, 503, 504 y 529; nunca si `error.code` es `insufficient_quota` o similar; respeta `retry-after-ms`/`retry-after` hasta 120 s (si es mayor, no reintenta); sin cabecera espera 2, 4 y 8 s; un fallo de `fetch` en el navegador (CORS) no se reintenta | `provider.rs:370-415`; `crates/assistant/src/agent.rs:30-32` |
| Hasta 16 rondas de herramientas por mensaje del usuario, una petición a la vez | `agent.rs:11-12` |
| En la web no hay tiempo límite de la petición; **«Detener» no aborta el `fetch`**: NVIDIA sigue generando | `web.rs:884-936`; `assistantpane.rs:1566-1574` |

**Dirección base que se configura en RustGIS:** `https://sigtar.gobiernogalapagos.gob.ec/api-proxy/geo/workspace/ai/v1`. **Modelo:** `minimaxai/minimax-m3.1-flash`. **Clave:** vacía.

### 4.3 Sesión del geoportal y ajustes que se repiten

- **La sesión sí se aprovecha.** Con RustGIS servido en el mismo origen, sus `fetch` al proxy llevan `pma_access` sin configurar nada. Pero ese token dura 15 minutos y RustGIS no sabe renovarlo: la página anfitriona debe llamar a `auth.refresh()` (`apps/web/lib/api-client.ts:435`) cada ~10 minutos mientras el Workspace esté abierto. Si aun así llega un 401, el proxy responde JSON (nunca una redirección, que RustGIS convertiría en fallo de red) y la página anfitriona ofrece reconectar.
- **Ajustes que el usuario repetiría en cada sesión.** En `?embed` los ajustes viven solo en memoria (`web.rs:997-1005`) y ningún comando `ui.*` fija proveedor, dirección o modelo (el único del asistente es `ui.pane.assistant {"ask": …}`, `crates/ui-egui/src/lib.rs:3215-3222`, que abre el panel y envía un texto). Por tanto, **en cada carga** hay que elegir «OpenAI-compatible», escribir la dirección y escribir el modelo (la clave no). La conversación también se pierde al recargar.
- **Opciones:**
  1. *Prueba de concepto:* aceptar esos tres pasos y documentarlos en la propia página.
  2. *Parche mínimo* en `services()` de `apps/rustgis-web/src/web.rs` (líneas 997-1005): sembrar el mapa en memoria con `assistant_provider = "custom"`, `assistant_url_custom = <location.origin>/api-proxy/geo/workspace/ai/v1` y `assistant_model_custom = "minimaxai/minimax-m3.1-flash"` (claves leídas en `assistantpane.rs:134-141` y escritas en `:338-341`). La dirección debe salir de `location.origin` o de una constante de compilación, **nunca** de un parámetro de URL o de un mensaje: cualquier página puede enmarcar la app (`embed.rs:20-22`) y podría desviar el asistente. Se propondría a RustGIS como opción de compilación; mientras no se acepte, exige construir una imagen propia.
  3. *Sin parche:* no usar `?embed` y escribir `localStorage["rustgis.assistant_*"]` desde la página anfitriona (mismo origen). Pierde el puente `postMessage` (§2.3), así que se descarta.

### 4.4 Contrato del proxy

**Rutas** (registradas bajo `/geo`, publicadas en `/api-proxy/geo/workspace/ai/v1/…`):

- `POST /geo/workspace/ai/v1/chat/completions`
- `GET /geo/workspace/ai/v1/models` → respuesta fija `{"object":"list","data":[{"id":"minimaxai/minimax-m3.1-flash","object":"model","owned_by":"nvidia"}]}`, sin llamar a NVIDIA.

**Antes de reenviar:**

1. `authenticate` + `requireApp("geo")` + interruptor `WORKSPACE_AI_ENABLED` + lista del piloto. Si llega `Origin`, debe ser `FRONTEND_ORIGIN`.
2. `bodyLimit` propio de 4 MiB (la API tiene 50 MiB global, `apps/api/src/index.ts:28`). RustGIS resume el historial al pasar de 400 000 bytes (`crates/assistant/src/compact.rs:16`).
3. `model` debe estar en `WORKSPACE_AI_MODELS` (por defecto solo `minimaxai/minimax-m3.1-flash`); si no, 400 `model_not_allowed`. **El resto del cuerpo pasa intacto**: `messages` con `tool_calls`, `tool_call_id` y `reasoning_content`, `tools`, `stream` y `reasoning_effort`. Solo se añade `max_tokens` si el cuerpo no lo trae y existe `WORKSPACE_AI_MAX_TOKENS`.
4. **Destino fijo**: `WORKSPACE_AI_BASE_URL` (validado al arrancar: `https` y host en lista, `integrate.api.nvidia.com`) + la ruta fija `/chat/completions`. Las cabeceras salientes se construyen desde cero (`Authorization: Bearer <clave del servidor>`, `Content-Type`, `Accept`); nunca se reenvían `Cookie` ni `Authorization` del navegador. Así la ruta no puede usarse como proxy abierto.

**Respuesta:** se reenvían el estado, `content-type`, `retry-after`, `retry-after-ms` y `x-request-id`, y el cuerpo se canaliza sin tocarlo (SSE `data:` … `[DONE]`). El `proxy_read_timeout 600s` de nginx (`…conf:46`) ya cubre generaciones largas. nginx no reintenta un `POST` en otro servidor (no hay `non_idempotent` en `proxy_next_upstream`, `…conf:32-34`).

**Errores (forma OpenAI `{"error":{"message","type","code"}}`), elegidos según cómo reacciona RustGIS:**

| Caso | Respuesta del proxy | Qué hace RustGIS |
|---|---|---|
| Sin sesión o sesión caducada | 401 `session_expired` | No reintenta; muestra el mensaje |
| Sin app `geo` o fuera del piloto | 403 `forbidden` | No reintenta |
| Modelo no permitido | 400 `model_not_allowed` | Muestra el mensaje |
| Límite por minuto del usuario | 429 `rate_limit_exceeded` + `Retry-After` ≤ 120 s | Reintenta (≤ 3) tras esperar lo indicado |
| Cuota diaria agotada | 429 `insufficient_quota` | No reintenta (`provider.rs:387-395`) |
| NVIDIA responde 401/403 (clave o modelo del servidor) | 503 `upstream_auth` + `Retry-After: 3600` | No reintenta: un `Retry-After` mayor de 120 s significa «no pronto» (`provider.rs:397-411`). No se devuelve 401 para no confundirlo con la sesión |
| NVIDIA responde 429 | 429 con su `Retry-After`; si no trae, el proxy añade uno (p. ej. 20 s) | Reintenta respetando la espera, en vez de 2/4/8 s |
| NVIDIA 5xx o conexión fallida | Mismo estado (502 si no hubo respuesta) | Reintenta (≤ 3) |
| Sin cabeceras de NVIDIA en `WORKSPACE_AI_HEADERS_TIMEOUT_MS` (p. ej. 30 s) o sin terminar en `WORKSPACE_AI_TIMEOUT_MS` (p. ej. 180 s) | 504 `upstream_timeout` + `Retry-After: 3600` | No reintenta (evita repetir una petición grande); el usuario reenvía |

**El proxy no reintenta nunca**: RustGIS ya hace hasta cuatro intentos por petición y nginx no reintenta `POST`.

**Cancelación y límites:**

- Si el navegador cierra la conexión (recarga o cierre del iframe), el proxy aborta la llamada a NVIDIA (`AbortController` ligado al cierre del socket). «Detener» de RustGIS no cierra la conexión, así que se limita el daño con **una petición en vuelo por usuario** y el tiempo total.
- Límites en `consumeSharedRateLimit` con claves `sha256(["workspace-ai", userId, ventana])`: por usuario, p. ej. 20 por minuto (un mensaje puede encadenar 17 peticiones) y 400 por día; global, por debajo del límite real de la cuenta NVIDIA y con un máximo de peticiones simultáneas.
- Registro: usuario, modelo, estado, latencia, bytes y `usage` si viene. **Nunca** el contenido ni la clave.

**Privacidad:** el asistente envía al proveedor los nombres de capas, campos, extensión y las filas que lee con sus herramientas (documentación oficial, sección *Privacy*). Además, si un usuario aprueba `layer.addUrl` hacia la API del geoportal, esa petición lleva sus cookies y los datos pueden acabar en la conversación (las acciones de red requieren aprobación, `crates/assistant/src/tools.rs:156-214`). Qué datos pueden salir hacia un proveedor externo es una decisión institucional previa a producción (D3).

### 4.5 CORS frente a 429

- **CORS** es una política del navegador. El preflight desde `https://web.rustgis.app` a `integrate.api.nvidia.com` no recibió `Access-Control-Allow-Origin`, así que el navegador bloqueó la petición antes de que RustGIS pudiera leer nada. RustGIS lo muestra como «couldn't reach the provider…» (`web.rs:907-915`) y no reintenta. Ocurre en **todas** las peticiones desde cualquier página web y no tiene arreglo en el cliente: la documentación oficial lista los proveedores que aceptan llamadas desde el navegador y NVIDIA no está entre ellos. Con el proxy en el mismo origen **no hay preflight ni CORS**.
- **429** es el límite de frecuencia de NVIDIA, aplicado cuando la petición ya llegó. La FAQ de NIM indica que el catálogo es una experiencia de prueba para evaluación y prototipado, que el límite varía por modelo y por usuarios concurrentes y que se consulta en la cuenta de build.nvidia.com; la cifra de 40 peticiones por minuto que circula procede de foros, no de documentación oficial. El proxy **no** elimina el 429: concentra a todos los usuarios en una sola clave, por eso necesita los límites de §4.4.
- **Trampa de diagnóstico:** si NVIDIA responde un 429 (o cualquier error) **sin** cabeceras CORS, el navegador lo presenta también como error de CORS. Para distinguirlos hay que mirar el código de estado de la petición en la pestaña Red. Tras el proxy, el 429 llega a RustGIS como tal, con su `Retry-After` legible.
- Por qué aparece el 429: cada petición reenvía el prompt de sistema, los esquemas de 11 herramientas y todo el historial (unos 12 KB fijos, estimación del análisis), y un mensaje puede encadenar varias rondas en menos de un minuto.

### 4.6 Piloto técnico frente a producción

| | Piloto técnico | Producción |
|---|---|---|
| Proveedor | Catálogo de NVIDIA (`integrate.api.nvidia.com`), endpoint de prueba | Contrato con nivel de servicio: NVIDIA AI Enterprise (la FAQ lo exige para producción), NIM propio u otro proveedor |
| Límites | Los de la cuenta de prueba, variables por modelo | Cuotas contratadas y dimensionadas |
| Usuarios | Lista cerrada del piloto | Usuarios GEO o un rol específico |
| Datos | Solo capas sin restricciones; aviso visible al usuario | Acuerdo de tratamiento de datos, retención y ubicación; revisión de qué pueden enviar las herramientas |
| Clave | `WORKSPACE_AI_API_KEY` en `.env` | Gestor de secretos, rotación y claves distintas por entorno |
| Observabilidad | Registros y contadores | Métricas, alertas por 429/5xx e informes de consumo |
| Continuidad | Asistente opcional | Interruptor de apagado y modelo alternativo |

### 4.7 Dos recorridos de red distintos

| | IA | Capas y rásteres |
|---|---|---|
| Camino | RustGIS → `/api-proxy/geo/workspace/ai/v1/chat/completions` → API → NVIDIA | RustGIS → `/api-proxy/geo/workspace/v1/vectors/…` o `/rasters/…` → API → NAS (o nginx con `X-Accel-Redirect`) |
| Autenticación | Cookie de sesión; clave NVIDIA solo en el servidor | Cookie de sesión; autorización por recurso |
| Requisitos propios | Forma de errores, límites, tiempo límite | URL absoluta con extensión (`.fgb`, `.tif`), `Content-Length`, `HEAD`, `Accept-Ranges` y respuestas `206`, sin redirecciones a `/login` |
| Lo que **no** resuelve el otro | El proxy de IA no sirve datos ni `Range` | Servir datos no evita el CORS de NVIDIA |

Si alguna capa siguiera en otro dominio (por ejemplo, un TiTiler público o un servicio externo), haría falta CORS con credenciales y, para COG y FlatGeobuf, permitir la cabecera `Range` y exponer `Content-Range`, `Accept-Ranges` y `Content-Length`. Servir todo desde el mismo origen evita esos requisitos.

---

## 5. Arquitectura propuesta

```
Navegador del usuario (sesión SIGTAR: cookies pma_access/pma_refresh, SameSite=Lax, path=/)
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ /geo/workspace  · página anfitriona Next.js («WorkspaceShell»)                       │
│ ┌──────────────────────────┐   postMessage, mismo origen     ┌──────────────────────┐│
│ │ Catálogo SIGTAR          │ ─ run ui.addUrl / ui.openUrl ──▶ │ <iframe>             ││
│ │ buscar · metadatos ·     │ ─ project (solo XYZ de WEBP) ──▶ │ /geo/workspace/app/  ││
│ │ añadir · abrir · guardar │ ◀── ready · project · result ── │ ?embed&lang=es       ││
│ │ renovación de sesión     │                                  │ RustGIS Web (WASM)   ││
│ └────────────┬─────────────┘                                  └──────────┬───────────┘│
└──────────────┼───────────────────────────────────────────────────────────┼────────────┘
               │ ① metadatos y proyectos                                    │ ② datos: Range de .fgb y .tif, teselas XYZ
               │    (fetch con cookies)                                     │ ③ IA: /chat/completions
               ▼                                                            ▼  fetch del mismo origen: lleva cookies
nginx · sigtar.gobiernogalapagos.gob.ec
   /geo/workspace/app/  ──▶ contenedor «rustgis» (imagen oficial fijada por digest; solo estáticos; frame-ancestors 'self')
   /api-proxy/          ──▶ api:3001
   /_nas_cog/ (internal)──▶ NAS en solo lectura (lo activa la API con X-Accel-Redirect; nginx resuelve Range)
   /                    ──▶ web:3000
api · Fastify (rutas nuevas bajo /geo/workspace/v1, todas con sesión y app «geo»)
   GET  config, catalog/search                          ① metadatos autorizados (PostgreSQL)
   GET  vectors/:layerId/r/:rev/data.fgb                ② FlatGeobuf con índice (Range)
   GET  vectors/:layerId/r/:rev/<id>-r<rev>.geojson     ② copia completa, solo a petición
   GET  rasters/:rasterId/v/:ver/cog.tif                ② autoriza → X-Accel-Redirect (Range)
   GET  rasters/:rasterId/v/:ver/tiles/{z}/{x}/{y}.png  ② alternativa XYZ (TiTiler) para COG WEBP
   POST maps/:mapId/open · projects/:id/open            ① genera o resuelve el proyecto → projectUrl + avisos
   CRUD projects · legacy.json · importación            ① proyectos guardados (PostgreSQL)
   POST ai/v1/chat/completions                          ③ proxy ──▶ https://integrate.api.nvidia.com/v1
   GET  ai/v1/models                                    ③ lista fija, sin llamada externa
worker · pg-boss + GDAL 3.6.2
   tras createLayer/appendFeature: GeoJSON de la revisión → FlatGeobuf con índice (NAS)
```

Tres recorridos de red independientes: **①** metadatos y proyectos (página anfitriona ↔ API), **②** datos geográficos (RustGIS ↔ API/nginx) y **③** IA (RustGIS ↔ proxy ↔ NVIDIA). Resolver ③ no resuelve ②: cada ruta de datos tiene que aceptar la sesión, devolver los tipos y longitudes correctos y responder a `Range`.

---

## 6. Alternativas consideradas

| Alternativa | Qué implica | A favor | En contra | Decisión |
|---|---|---|---|---|
| **A. RustGIS embebido en el mismo origen, con el buscador del geoportal al lado** | `iframe` con `?embed` bajo `/geo/workspace/app/`; catálogo en la página anfitriona; capas añadidas con `run ui.addUrl`; proyectos en el servidor; proxy de IA en la API | Sin fork. Las cookies viajan solas y no hay CORS. Los permisos se aplican en nuestra API. No depende de los diálogos internos de RustGIS | Dos zonas de interfaz. El generador de proyectos se acopla al formato de RustGIS. Exige convertir los vectores a FlatGeobuf. Sin parche, los ajustes del asistente se repiten en cada sesión | **Elegida** |
| B. RustGIS solo, en la ruta del Workspace, sin página anfitriona | Solo estáticos; abrir con `?project=<API>` y añadir con los diálogos de RustGIS | Mínimo código | Sin búsqueda del catálogo, guardar = descargar un archivo, sin renovación de sesión | Insuficiente para los objetivos 1 y 2 |
| C. Endpoint compatible con CKAN para «Search Open Data» de RustGIS | `GET …/ckan/api/3/action/package_search` en la API; se abre con `ui.searchOpenData` | Búsqueda dentro de RustGIS, sin fork y con permisos (lleva la cookie) | No marca duplicados ni gestiona los COG WEBP; interfaz y comportamiento de RustGIS; añadido de recursos pendiente de prueba | Complemento tras el piloto |
| D. Fork con un panel «Catálogo SIGTAR» dentro de RustGIS | Desarrollo en Rust/egui y una imagen propia | La mejor integración visual | Mantener un fork de un proyecto con ~35 commits diarios (141 entre `v0.5.0` y `98a7201`, en cuatro días) | Solo si A y C fallan |
| E. Embeber `https://web.rustgis.app` (alojado por terceros) | `iframe` de otro origen | Sin despliegue | Sus `fetch` no llevarían nuestras cookies, habría que abrir CORS con credenciales en todas las rutas de datos, el sitio incluye analítica y el CORS de NVIDIA seguiría igual | Descartada |
| F. Mantener el Workspace de Leaflet y añadirle IA | Sin RustGIS | Sin migración | No cumple el objetivo | Línea base para comparar |

**Por qué A en este repositorio:** el geoportal ya sirve todo bajo un único origen detrás de nginx (`…conf:36-80`), usa cookies `SameSite=Lax` que RustGIS reenvía sin cambios a su mismo origen, tiene el catálogo y los permisos en Fastify, donde es fácil ampliarlos, y ya dispone de un worker con GDAL para generar los FlatGeobuf. El puente `?embed` existe desde el 2026-10-13 (`cf4d8fa`) sin cambios hasta `v0.5.0` y `98a7201`. El único cambio en RustGIS que aporta valor real (preconfigurar el asistente) es opcional y de pocas líneas.

---

## 7. Archivos, módulos y endpoints que se crean o modifican

### 7.1 Web (`apps/web`)

| Archivo | Acción | Propósito |
|---|---|---|
| `app/geo/(dashboard)/workspace/page.tsx` | Modificar | Leer `GET /geo/workspace/v1/config`; montar `RustgisWorkspace` a los usuarios del piloto y redirigir al resto a `clasico` |
| `app/geo/(dashboard)/workspace/clasico/page.tsx` | Crear | El Workspace actual, sin cambios (§9) |
| `components/geo/rustgis/RustgisWorkspace.tsx` | Crear | Página anfitriona: panel de catálogo, `iframe`, barra con proyecto, guardar y abrir, avisos y estado de sesión. Sin sesión muestra un `<a href="/login?next=…">` (no `Link`, para no cachear la redirección) |
| `components/geo/rustgis/bridge.ts` | Crear | Puente tipado: espera `ready`, `run(command, params)` con `id` → promesa y tiempo límite, envío de `project`, recepción de `project`/`result`, cola que impide reemplazar el proyecto con descargas pendientes. Acepta solo `event.source === iframe.contentWindow` y `event.origin === location.origin` |
| `components/geo/rustgis/CatalogSearchPanel.tsx` | Crear | Búsqueda, filtros, metadatos, modo de carga, estado «En el mapa» y «Añadir» |
| `components/geo/rustgis/projectRefs.ts` | Crear | Extraer del JSON del proyecto las URL del catálogo (`maps[].layers[].source.path`, `maps[].tiles[].url`) e insertar capas XYZ para los COG WEBP |
| `components/geo/rustgis/ProjectsDialog.tsx` | Crear | Abrir un Mapa o un proyecto guardado, guardar, guardar como e importar un `sigtar-workspace` |
| `lib/session-keepalive.ts` | Crear | Llamar a `auth.refresh()` cada ~10 min mientras el Workspace esté abierto |
| `next.config.mjs` | Modificar | Solo desarrollo: reescritura `/geo/workspace/app/:path*` → contenedor `rustgis` (en producción lo hace nginx) |
| `tests/rustgis-bridge.test.ts`, `tests/rustgis-project-refs.test.ts` | Crear | Origen y fuente de los mensajes, correlación de `id`, extracción de referencias e inserción XYZ |

### 7.2 API y worker (`apps/api`)

| Archivo | Acción | Propósito |
|---|---|---|
| `src/routes/geo/workspaceV1.ts` | Crear | Rutas `/geo/workspace/v1/*`: `config`, `catalog/search`, `vectors/…/data.fgb` y `….geojson`, `rasters/…/cog.tif` y `…/tiles/…`, `maps/:mapId/open`, `projects` (CRUD, `open`, `resolved/:token.rgis`, `legacy.json`, importación) |
| `src/routes/geo/index.ts` | Modificar | Registrar las rutas nuevas; si se aprueba la visibilidad por mapa, aplicar la misma comprobación a las lecturas públicas existentes (`:119-192`, `:362-405`) |
| `src/modules/geo/access.ts` | Crear | `canReadGeoMap(user, map)`: única función de autorización para búsqueda, datos, teselas y proyectos |
| `src/modules/geo/catalogSearch.ts` | Crear | Consulta paginada (texto sin acentos, tipo, categoría, mapa, `bbox`) que amplía `listWorkspaceCatalog` sin exponer rutas |
| `src/modules/geo/rustgisProject.ts` | Crear | Generar el proyecto RustGIS de un Mapa y resolver uno guardado (§3.2). Única pieza acoplada al formato de RustGIS: versionada y con pruebas sobre la plantilla capturada |
| `src/modules/geo/workspaceProjects.ts` | Crear | Persistencia con control optimista (`revision`), extracción de `layer_refs`, tope de tamaño, importación y exportación `sigtar-workspace` |
| `src/modules/geo/fileDelivery.ts` | Crear | Servir `.fgb` y `.tif`: `X-Accel-Redirect` en producción; lectura `Range` propia (206, `Content-Range`, `Accept-Ranges`, `HEAD`) para la prueba de concepto y desarrollo |
| `src/jobs/buildFlatGeobuf.ts` + `src/jobs/gdal.ts` | Crear / modificar | Trabajo de pg-boss que ejecuta `ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES` por revisión |
| `src/modules/geo/layersModule.ts` | Modificar | Encolar el FlatGeobuf tras `createLayer` (`:76`) y `appendFeature` (`:227`) |
| `src/scripts/backfill-flatgeobuf.ts` | Crear | Generar una vez los FlatGeobuf de las 679 capas existentes; reanudable |
| `src/storage/index.ts` | Modificar | Ruta del artefacto, p. ej. `GEO/maps/{mapId}/layers/{layerId}/revisions/{rev}-{nonce}.fgb` |
| `src/routes/geo/workspaceAi.ts` + `src/modules/geo/workspaceAi.ts` | Crear | Proxy de IA (§4.4): validación, límites, reenvío en streaming, tiempos límite, cancelación y errores |
| `src/lib/env.ts` | Modificar | `GEO_WORKSPACE_ENGINE`, `GEO_WORKSPACE_PILOT_USER_IDS`, `WORKSPACE_AI_ENABLED`, `WORKSPACE_AI_API_KEY`, `WORKSPACE_AI_BASE_URL`, `WORKSPACE_AI_MODELS`, `WORKSPACE_AI_MAX_TOKENS`, `WORKSPACE_AI_TIMEOUT_MS`, `WORKSPACE_AI_HEADERS_TIMEOUT_MS`, límites por usuario y globales, `GEO_FILE_ACCEL_PREFIX`, `GEO_WORKSPACE_MAX_PROJECT_BYTES` |
| `src/db/schema/geo.ts` | Modificar | Tablas `geo_workspace_projects` (id, título, propietario, `source_map_id`, `rustgis_project` jsonb, `layer_refs` jsonb, `rustgis_version`, `revision`, `size_bytes`, fechas) y `geo_layer_artifacts` (capa, revisión, tipo `fgb`, ruta, tamaño, estado); si se aprueba, `geo_maps.visibility` con valor por defecto `public` |
| `src/db/migrations/00NN_geo_workspace.sql` + `meta/_journal.json` | Crear/modificar | Migración aditiva escrita a mano (nunca `db:generate`), incluida `CREATE EXTENSION IF NOT EXISTS unaccent` |
| `src/tests/geoWorkspaceSearch.integration.test.ts`, `geoWorkspaceData.integration.test.ts`, `geoWorkspaceProjects.integration.test.ts`, `workspaceAiProxy.test.ts`, `rustgisProject.test.ts` | Crear | Permisos (no aparece, 404 por URL), `Range`/`HEAD`, conflictos de guardado, generación y resolución de proyectos, contrato del proxy con un NVIDIA simulado. Contra una base desechable, nunca la compartida |

### 7.3 Infraestructura

| Archivo | Acción | Propósito |
|---|---|---|
| `docker-compose.yml` | Modificar | Servicio `rustgis` (imagen oficial fijada por digest, sin puertos publicados); variables nuevas solo en `api`; montaje del NAS **en solo lectura** en `nginx` para `X-Accel-Redirect` |
| `docker-compose.dev.yml` | Modificar | El mismo servicio `rustgis` para desarrollo |
| `nginx/conf.d/sigtar.gobiernogalapagos.gob.ec.conf` | Modificar | `location = /geo/workspace/app` → 301 a la barra final; `location /geo/workspace/app/` → `http://rustgis:8080/` con `Content-Security-Policy: frame-ancestors 'self'`; `location /_nas_cog/ { internal; alias /data/storage/; }` |
| `.env.example`, `README.md` | Modificar | Nombres de variables (sin valores) y operación |
| (Opcional) imagen propia de RustGIS | Crear | Solo si se adopta el parche del asistente (§4.3): compilada desde el `Dockerfile` oficial con el parche, los avisos de licencia conservados y etiquetas distintas para dev y prod |

---

## 8. Plan por fases

Esfuerzo en días-persona de una persona que ya conoce el repositorio; no incluye el tiempo de calendario del piloto.

| Fase | Contenido | Depende de | Esfuerzo | Riesgos | Criterio de aceptación |
|---|---|---|---|---|---|
| **0. Prueba de concepto** | RustGIS fijado tras nginx (o la reescritura de Next en desarrollo); página anfitriona mínima con puente; búsqueda simple; rutas `.fgb` (generado a mano) y `.tif` con `Range` y teselas XYZ para un WEBP; captura de la plantilla de proyecto; generación del proyecto de un Mapa; guardar y reabrir en una **base desechable**; visibilidad por mapa mínima; proxy de IA mínimo | D1, D3, D5 | 14-17 | Capas FlatGeobuf insuficientes en la web; formato de proyecto; respuestas de MiniMax con herramientas | P1-P8 pasan y quedan documentadas |
| **1. Catálogo y carga inicial** | Búsqueda completa (paginación, filtros, sin acentos), metadatos, duplicados, URL con extensión; trabajo FlatGeobuf y carga de las 679 capas; `X-Accel-Redirect`; ETag y caché privada; alternativa XYZ para WEBP; traducción de estilos por categoría y cantidad | Fase 0, D6, D7 | 12-15 | Muchas peticiones `Range` autenticadas; tiempo de la carga inicial | Cualquier capa autorizada se encuentra y se añade en < 3 clics sin perder el mapa; una capa publicada después aparece sin tocar RustGIS |
| **2. Persistencia de proyectos** | CRUD con control optimista, reapertura con avisos (borrada, nueva versión, sin permiso), copias incrustadas, importación `sigtar-workspace` v1/v2, exportación `legacy.json`, tope de tamaño | Fase 1 | 6-8 | Cambios del formato de proyecto entre versiones | Guardar y reabrir conserva capas, orden, visibilidad, estilos y vista; los tres casos de capa no disponible se informan sin revelar si existe |
| **3. Asistente de IA** | Contrato completo del proxy, límites y cuotas, registro, aviso de privacidad, experiencia de configuración; parche opcional de RustGIS | Fase 0 (en paralelo a 1-2), D2, D3 | 4-6 (+2-3 con parche e imagen propia) | 429 del endpoint de prueba; diferencias del formato de MiniMax | 20 tareas de prueba sin errores de formato; 401/403/429 se comportan como en §4.4; la clave no aparece en el navegador |
| **4. Piloto** | 2-5 usuarios durante 2-4 semanas, métricas y correcciones | Fases 1-3 | 3-5 | Memoria del navegador con rásteres grandes; rotación de sesión | Sin incidencias bloqueantes; los usuarios completan sus tareas habituales |
| **5. Sustitución** | `GEO_WORKSPACE_ENGINE=rustgis` para todos; `clasico` disponible un tiempo; documentación y formación | Piloto aprobado, D4 | 2-3 | Flujos que dependían del exportador PDF o de las visualizaciones | Uso estable; retirada del Workspace clásico aprobada |

### 8.1 Pruebas de la prueba de concepto

Datos reales (consultados en solo lectura el 2026-11-04):

- **Proyecto inicial:** Mapa «Mina Cerro Pelado» (`540b2a9a-…`): vector «puerto villa» (1 603 polígonos, 1,7 MB), MDT `Float32` «…_dsm» (COG DEFLATE de 1,49 GB) y ortomosaico «…transparent_mosaic_group1» (COG **WEBP** RGBA de 161 MB, EPSG:32715).
- **Tercera capa (otro mapa):** ortofoto «ort_pto_baquerizo_moreno_2023_30cm_01» (COG JPEG YCbCr, 1,38 GB, 146 954 × 105 387 px, EPSG:32716).

| Prueba | Pasos | Resultado esperado |
|---|---|---|
| P1 Abrir un Mapa | Abrir «Mina Cerro Pelado» desde la página anfitriona | El vector llega como FlatGeobuf por partes y admite estilo por atributo, etiquetas, identificar y tabla; el MDT se ve en gris en su sitio (UTM 15S); el ortomosaico WEBP se ve por la alternativa XYZ. En la pestaña Red solo hay respuestas `206` para `.fgb` y `.tif` (nunca un archivo entero) |
| P2 Buscar y añadir | Buscar «baquerizo 2023» y pulsar «Añadir»; después añadir un WEBP | La ortofoto JPEG aparece encima sin recargar ni perder las capas anteriores y se marca «En el mapa». El WEBP entra por reemplazo del proyecto sin nuevas descargas de lo ya cargado |
| P3 Guardar y reabrir | Guardar, recargar la página y abrir el proyecto | Mismas capas, orden, visibilidad, estilo y vista; la capa activa es la misma que al guardar (`sigtar_active`, §0.5) |
| P4 Permisos | Marcar como restringido el mapa de la ortofoto para un usuario de prueba | No aparece en la búsqueda; su `cog.tif`, sus teselas (nuevas y públicas) y sus datos responden 404; al reabrir P3 se avisa de «1 capa ya no está disponible» |
| P5 MiniMax | Configurar el asistente con la dirección del proxy y pedir «haz zoom a puerto villa y colorea por un campo» | Se ejecutan herramientas reales sobre el mapa; las peticiones van solo a nuestro origen; ninguna lleva la clave |
| P6 Sesión | Dejar el Workspace abierto 20 minutos y seguir trabajando | Ni los datos ni la IA reciben 401 |
| P7 Errores | Bajar el límite del proxy y forzar un 429 y una cuota diaria agotada | El 429 se reintenta respetando `Retry-After`; la cuota agotada se muestra sin reintentos |
| P8 Coste del puente | Medir el tamaño y la frecuencia de los mensajes `project` al desplazar, primero con capas por partes y después con una copia GeoJSON de 57 MB | Con capas por partes, mensajes de pocos KB; con la copia, coste medido y documentado para fijar el tope de §2.7 |

---

## 9. Habilitación gradual y vuelta atrás

1. **Interruptor en tiempo de ejecución, no de compilación.** `GET /geo/workspace/v1/config` devuelve `{ engine: "legacy" | "rustgis", aiEnabled }` según variables de entorno (`GEO_WORKSPACE_ENGINE`, `GEO_WORKSPACE_PILOT_USER_IDS`, `WORKSPACE_AI_ENABLED`). Cambiar de motor no exige reconstruir la web.
2. **Rutas.** El Workspace actual se mueve sin cambios a `/geo/workspace/clasico` (mismo `GisEditor` en modo `workspace`). `/geo/workspace` muestra RustGIS a los usuarios del piloto y redirige a `clasico` al resto. El botón del panel (`dashboard/page.tsx:228-234`) no cambia.
3. **Datos.** La migración es aditiva: tablas nuevas y, si se aprueba, la visibilidad por mapa con valor por defecto `public`. No se modifican `geo_maps`, `geo_map_layers` ni `geo_raster_layers`. Los FlatGeobuf son archivos adicionales junto a los GeoJSON, que no cambian. Los archivos `sigtar-workspace` se **copian** al importarlos; el original no se toca. Como dev y prod comparten la misma base, la migración debe ser compatible con el código anterior y escribirse a mano con su entrada en `_journal.json`.
4. **Vuelta atrás inmediata.** Poner `GEO_WORKSPACE_ENGINE=legacy` y recrear solo `api` (`docker compose up -d --wait api`). El contenedor `rustgis` y su `location` en nginx pueden quedarse o retirarse; las rutas nuevas quedan inertes. Los proyectos guardados permanecen en la base.
5. **Conservar el trabajo al volver atrás.** `GET /geo/workspace/v1/projects/:id/legacy.json` exporta un proyecto como `sigtar-workspace` v2 a partir de `layer_refs` (capa, visibilidad, orden y opacidad). La simbología de RustGIS no se traduce de vuelta: esas capas toman el estilo del catálogo. Así el Workspace clásico puede abrir cualquier proyecto creado durante el piloto.
6. **Actualizar RustGIS.** Imagen fijada por digest (`ghcr.io/opengeos/rustgis@sha256:…`). Cada actualización repite las pruebas de §8.1 en el entorno de pruebas antes de cambiar el digest en producción; volver atrás es restaurar el digest anterior. El proyecto publica versiones muy seguidas (cinco etiquetas en tres semanas), así que no se usa `latest`.
7. **Operación.** Desplegar servicios concretos con `docker compose up -d --build --wait <servicio>` (no `./deploy.sh update`, que baja todo el stack) y mantener nombres de imagen distintos para dev y prod si se construye una imagen propia de RustGIS.

---

## 10. Estado de verificación y fuentes

### 10.1 Confirmado en el repositorio (commit `75674fa`)

| # | Hecho | Evidencia |
|---|---|---|
| R1 | El Workspace es `GisEditor` en modo `workspace`, arranca vacío y solo guarda en un JSON local | `workspace/page.tsx:14-25`; `GisEditor.tsx:311-315`, `:874-1002`; `workspace.ts:5-48` |
| R2 | «Proyecto» no existe; el Mapa posee sus capas y el Workspace las referencia | `schema/geo.ts:37-39`, `:134-136`; `workspace.ts:15-36` |
| R3 | Lecturas GEO públicas; sin control de acceso por mapa ni por capa | `routes/geo/index.ts:106-122`, `:361`; `apps/web/middleware.ts:41` |
| R4 | Vectores GeoJSON EPSG:4326 comprimidos con gzip, servidos con `Content-Encoding: gzip` por rutas sin extensión | `layersModule.ts:89-100`; `routes/geo/index.ts:170-192` |
| R5 | Rásteres convertidos a COG (BigTIFF, sin predictor) en su CRS de origen; WEBP si hay alfa; el navegador solo ve teselas XYZ de TiTiler; el COG no se sirve con `Range` | `gdal.ts:170-195`; `routes/geo/index.ts:367-405`; `routes/storage.ts:97-116` |
| R6 | El catálogo no busca en el servidor y exige elegir categoría | `workspaceModule.ts:11-103`; `WorkspaceLayerCatalogModal.tsx:35-61` |
| R7 | Sesión por cookies `httpOnly`, `SameSite=Lax`, `path=/`; acceso de 15 min y refresco rotatorio | `routes/auth.ts:57-60`, `:148-163`; `env.ts:13` |
| R8 | Cliente NVIDIA existente en PG2030; la clave solo llega al worker | `pg2030/ia/cliente.ts:22-57`; `env.ts:69-75`; `docker-compose.yml:170-175` |
| R9 | Limitador de frecuencia compartido en PostgreSQL reutilizable | `auth/rateLimit.ts:99-147` |
| R10 | nginx: `/api-proxy/` con 600 s de lectura; no reintenta `POST`; no monta el NAS | `…conf:32-46`; `docker inspect pma-nginx` |
| R11 | Inventario: 679 vectores (≤ 57 MB), 33 COG (13 WEBP, 2 JPEG YCbCr sin máscara, 12 `Float32` DEFLATE, 6 `Byte` DEFLATE) | Consultas de solo lectura y `gdalinfo -json` (§1.9) |
| R12 | Un MDT `Float32` por la ruta de teselas actual se ve como silueta negra | Tesela `15/8101/16469` del ráster `95c603fb…` (§3.5) |
| R13 | TiTiler 0.19.2 ofrece recortes `.tif` por `bbox`, `/point` y `/statistics` | Código de `titiler.core` en `pma-titiler` |
| R14 | `unaccent` y `pg_trgm` disponibles; PostGIS no; GDAL 3.6.2 en el worker | `pg_available_extensions`; `gdalinfo --version` |

### 10.2 Confirmado en RustGIS (`98a7201`; igual en `v0.5.0` salvo donde se indica)

| # | Hecho | Evidencia |
|---|---|---|
| G1 | Puente `?embed`: `project`/`run` de entrada, `ready`/`project`/`result` de salida; `run` limitado a `ui.*`; origen fijado por el primer mensaje | `apps/rustgis-web/src/embed.rs:1-125`; `web.rs:340-421` |
| G2 | `ui.openUrl` y `ui.addUrl` son `ui.*`: abrir un proyecto por URL y añadir datos por URL sin reiniciar | `crates/ui-egui/src/lib.rs:2567-2752`; `web.rs:162-204` |
| G3 | Los `fetch` no fijan `credentials` (cookies solo en el mismo origen); `Range` y `HEAD`; 30 s sin datos aborta | `web.rs:540-880`, `:884-936` |
| G4 | GeoJSON por URL se incrusta en el proyecto; FlatGeobuf/GeoParquet y COG quedan por URL | `crates/data/src/lib.rs:329-339`; `crates/data/src/source/mod.rs:391-398`; `crates/engine/src/cmd/layer.rs:3347-3376` |
| G5 | Compresiones TIFF admitidas: Deflate, LZW, PackBits, JPEG (YCbCr «como RGB», pero en la práctica sin convertir: §2.8) y Zstandard; **no WebP**; BigTIFF reconocido | `docs/user-guide/data.md:1001-1004`; `crates/data/src/raster/cog.rs:301`, `:345`; `Cargo.lock` |
| G6 | Sin identificación ni valores de píxel sobre COG o XYZ | `crates/engine/src/cmd/select.rs:388-393` |
| G7 | Reemplazar el proyecto borra el historial, reinicia la capa activa y descarta descargas pendientes; el mensaje `project` no tiene acuse | `crates/engine/src/cmd/project.rs:151-173`; `web.rs:398-401` |
| G8 | Formato de proyecto `format: 1`, ≤ 512 MiB; orden, visibilidad, estilos, etiquetas, filtros y cámara se guardan; la capa activa no (la añade el parche SIGTAR, §0.5) | `crates/engine/src/project.rs:56-59`; `crates/map/src/lib.rs:113-131`; `crates/map/src/camera.rs:35-48` |
| G9 | Búsqueda de datos alcanzable desde el puente: CKAN, Socrata y ArcGIS con `ui.searchOpenData` | `crates/tiles/src/portal.rs:354-357`; `crates/ui-egui/src/opendataui.rs:305-333` |
| G10 | Asistente: preset OpenAI-compatible sin clave; `POST /chat/completions`; `GET /models` solo con ↻; respuesta leída entera; ≤ 3 reintentos; sin tiempo límite; «Detener» no aborta | `crates/assistant/src/provider.rs:121-132`, `:370-415`, `:1030-1071`, `:1582-1588`; `agent.rs:11-12`, `:30-32`; `web.rs:884-936` |
| G11 | Con `?embed` los ajustes viven en memoria y no hay comando para fijar el asistente | `web.rs:997-1005`; `lib.rs:3215-3222` |
| G12 | Autoalojamiento bajo una ruta; imagen `0.5.0` publicada; sin `X-Frame-Options` ni COOP/COEP; *service worker* desactivado con `?embed`; lista de bloqueo de complementos pedida en cada arranque | Documentación oficial de instalación; `packaging/docker/nginx.conf`; `index.html:66-70`; `pluginsui.rs:278-314`; `docker manifest inspect` |
| G13 | Apache-2.0; dependencias permisivas; la web sirve `LICENSE` y `THIRD-PARTY-LICENSES.txt` | `LICENSE`; `deny.toml`; `index.html:11-12` |
| G14 | Interfaz en español (`?lang=es`) | `crates/ui-egui/src/i18n/mod.rs:97` |

### 10.3 Pendiente de prueba

| # | Qué falta comprobar | Prueba que lo resuelve | Decisión que depende |
|---|---|---|---|
| T1 | Que las peticiones del `iframe` lleven la cookie | En la pestaña Red, cabecera `Cookie` y `Sec-Fetch-Site: same-origin` en `.fgb`, `.tif` y `/chat/completions` | Arquitectura de mismo origen |
| T2 | Capas FlatGeobuf por partes: estilo por atributo, etiquetas, identificar, tabla y muestra de 30 000 entidades con la capa de 55 338 | P1 con «puerto villa» y con la capa más grande | D7 (FlatGeobuf frente a copias GeoJSON) |
| T3 | Que un COG WEBP falle de forma controlada y la alternativa XYZ funcione dentro del proyecto | P1/P2 con el ortomosaico de «Mina Cerro Pelado» | D6 |
| T4 | Lectura por partes de nuestros BigTIFF y ubicación correcta en EPSG:32715, 32716 y 3857 | P1/P2 superpuestos a un vector conocido | — |
| T5 | Que `ui.openUrl` acepte un proyecto generado (`….rgis`) y lo devuelva con un mensaje `project` | P1 | Forma de abrir proyectos (§2.4) |
| T6 | Que el generador produzca un proyecto válido a partir de la plantilla capturada | P1 y pruebas de `rustgisProject.ts` | Fase 1 |
| T7 | Coste del mensaje `project` y fluidez al desplazar | P8 | Tope de tamaño de §2.7 |
| T8 | Que reemplazar el proyecto reutilice las cachés (sin nuevas descargas) | P2, pestaña Red | Alternativa XYZ por reemplazo (§3.3) |
| T9 | Formato de MiniMax en NVIDIA: `reasoning_content` reenviado, `<think>` en el texto, `[DONE]`/`finish_reason`, `tool_calls` estructurados, `max_tokens` por defecto y cabeceras del 429 | P5 registrando (sin contenido sensible) dos peticiones y una respuesta SSE en el proxy | Si el proxy debe filtrar campos |
| T10 | «Detener» frente a recarga: si el proxy ve el cierre de la conexión | P5 pulsando «Detener» y luego recargando | Límites de concurrencia |
| T11 | Que la reescritura de Next reenvíe `Range` y `206` en desarrollo | Prueba local en la fase 0 | Entorno de desarrollo |
| T12 | Cómo añade RustGIS un recurso CKAN que apunta a `.fgb`/`.tif` | Endpoint CKAN mínimo y `ui.searchOpenData` | Alternativa C |
| T13 | Si `ui.addUrl` acepta el fragmento `#range=` para fijar el estiramiento de un MDT | P1 | Estilo de los MDT |
| T14 | Si RustGIS mantendrá `ui.addUrl`/`ui.openUrl` en el puente | Consulta en el repositorio de RustGIS | Riesgo de contrato (§2.5) |
| T15 | Tamaño de los cuerpos que llegan al proxy en sesiones largas | Registrar `Content-Length` durante el piloto | `bodyLimit` de 4 MiB |
| T16 | Memoria del navegador con varios COG grandes y capas por partes | Piloto en los equipos reales | Recomendaciones de uso |
| T17 | CSP exacta que necesita la página de RustGIS | Inspeccionar el `index.html` de la imagen fijada | Cabeceras de nginx |
| T18 | Licencia del logotipo e iconos de `assets.rustgis.app` | Consulta al proyecto | Solo si se alojan nosotros |

### 10.4 Decisiones que debe tomar el responsable

> **Todas resueltas el 2026-11-04** (tabla de §0.5). La tabla queda como registro de las opciones que se consideraron.

| Decisión | Opciones | Recomendación | Bloquea |
|---|---|---|---|
| D1 Modelo de permisos | Todo público (como hoy) · visibilidad por mapa · lista por usuario o rol | Visibilidad por mapa (`public`/`internal`/`restricted`), heredada por las capas | Prueba P4 |
| D2 Ajustes del asistente | Reconfigurar en cada sesión · parche mínimo en una imagen propia · propuesta a RustGIS | Reconfigurar en la prueba de concepto; proponer el parche a RustGIS y decidir antes del piloto | Fase 3 |
| D3 Clave y datos de IA | Que la API llame a NVIDIA con `WORKSPACE_AI_API_KEY` propia; qué datos pueden salir | Clave separada y, en el piloto, solo capas sin restricciones | Prueba P5 |
| D4 Exportación PDF del CGREG | Diseños de RustGIS · mantener el exportador del editor de Mapa | Usar el editor de Mapa para salidas oficiales mientras se evalúan los diseños de RustGIS | Fase 5 |
| D5 Acceso sin sesión | Mantener un Workspace público · exigir sesión | Exigir sesión en el nuevo Workspace; el visor público de Mapas no cambia | Fase 0 |
| D6 COG WEBP | Alternativa XYZ · propuesta de WebP a RustGIS · recodificar · cambiar la compresión de las futuras | Alternativa XYZ en el piloto y propuesta a RustGIS en paralelo | Fase 1 |
| D7 Vectores | FlatGeobuf por partes (por defecto) · copias GeoJSON en el proyecto | FlatGeobuf por defecto y copia GeoJSON solo a petición, si T2 confirma la cobertura | Fase 1 |

### 10.5 Fuentes

- RustGIS, código: <https://github.com/opengeos/RustGIS> — `main` en `98a72012a8a897a95513295c93678937cd8802e9` (2026-11-04) y etiqueta `v0.5.0` (`a5603d1`, 2026-10-31).
- RustGIS, instalación (autoalojamiento, `?embed`, `?project=`): <https://rustgis.app/installation/>
- RustGIS, formatos de datos (COG, FlatGeobuf, descargas, límites de la web): <https://rustgis.app/user-guide/data-formats/>
- RustGIS, asistente (proveedores, privacidad, reintentos, streaming en el navegador): <https://rustgis.app/user-guide/assistant/>
- RustGIS, imagen Docker: `ghcr.io/opengeos/rustgis:0.5.0`.
- NVIDIA, FAQ de NIM (catálogo de prueba para evaluación y prototipado; producción con NVIDIA AI Enterprise; límites variables por modelo): <https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317>
- TiTiler 0.19.2 (`titiler.core`), inspeccionado en el contenedor `pma-titiler`.

---

## 11. Implementación (2026-11-04)

**Estado:** código en la rama `dev-migration` (sin commit). Se probó con una base desechable (`sigtar-rustgis-test-db`) y copias de dos mapas reales (§11.3 y §11.4), y se **desplegó en producción el 2026-11-04 a las 23:54, en modo piloto** (§11.5).

### 11.1 Qué se implementó

| Área | Qué hace | Archivos |
|---|---|---|
| RustGIS | `v0.5.0` fijada + parche SIGTAR (asistente preconfigurado, capa activa, acuse del mensaje `project`); imagen `pma-management/rustgis:<tag>` (nginx sin privilegios, puerto 8080) | `infra/rustgis/` (`build.sh`, `patches/`, `Dockerfile*`, `README.md`) |
| Base de datos | Migración aditiva `0037_geo_workspace`: extensión `unaccent`, `geo_maps.visibility` (`public` por defecto), `geo_map_access`, `geo_layer_artifacts`, `geo_workspace_projects`; y su vuelta atrás | `db/migrations/0037_geo_workspace.sql`, `rollback/0037_down.sql`, `meta/_journal.json`, `schema/geo.ts` |
| Permisos (D1) | Visibilidad por mapa en la búsqueda, los datos, las teselas, los proyectos **y las rutas públicas existentes**; un mapa `public` se sirve igual que hoy. Diálogo «Acceso del mapa» (solo ADMIN) | `modules/geo/access.ts`, `mapAccessModule.ts`, `routes/geo/index.ts`; `components/geo/MapAccessDialog.tsx`, `GeoMapCard.tsx` |
| Catálogo | Búsqueda en el servidor sobre todo lo legible (vectores y rásteres procesados), sin acentos, con filtros (tipo, categoría, mapa, extensión) y paginada; una capa publicada después aparece sin reindexar | `modules/geo/catalogSearch.ts` |
| Datos para RustGIS | FlatGeobuf con índice espacial por revisión, generado en el worker (`ogr2ogr`) al crear o cambiar una capa y por un reconciliador (40 capas cada 2 min); rutas con extensión y `Range` (206/416/304, ETag) para `.fgb` y `cog.tif`; copia GeoJSON; teselas para COG WEBP y JPEG YCbCr; `X-Accel-Redirect` para que nginx sirva los bytes desde el NAS | `jobs/flatgeobuf.ts`, `jobs/gdal.ts`, `jobs/boss.ts`, `worker.ts`, `modules/geo/layerArtifacts.ts`, `fileDelivery.ts`, `workspaceUrls.ts` |
| Proyectos | Proyecto generado desde un Mapa (cámara, simbología, mapa base, capa activa); CRUD con revisión optimista (409); reapertura con avisos (no disponible, actualizada, preparándose, teselas); importación `sigtar-workspace` v1/v2 y exportación `legacy.json` | `modules/geo/rustgisProject.ts`, `workspaceProjects.ts`, `routes/geo/workspaceV1.ts` |
| Proxy de IA | `POST /geo/workspace/ai/v1/chat/completions` y `GET …/models`: sesión, comprobación de `Origin`, alias de modelo, clave solo en el servidor, cuotas por usuario (minuto y día), concurrencia, tiempos límite, errores con forma OpenAI y `Retry-After` | `modules/geo/workspaceAi.ts`, `routes/geo/workspaceV1.ts` |
| Interruptor | `GEO_WORKSPACE_ENGINE` (`legacy`/`pilot`/`rustgis`) y `GEO_WORKSPACE_PILOT_USERS`, leídos por `GET /geo/workspace/v1/config` | `modules/geo/workspaceAccess.ts` |
| Web | `/geo/workspace` con RustGIS embebido: puente, buscador, Abrir / Guardar / Guardar como, avisos, botón del asistente y renovación de la sesión cada 10 min. El Workspace anterior queda en `/geo/workspace/clasico` | `app/geo/(dashboard)/workspace/`, `components/geo/rustgis/` |
| nginx y compose | `/geo/workspace/app/` → contenedor `rustgis` con `frame-ancestors 'self'`; ubicación interna `/_nas_files/` (NAS en solo lectura) para `X-Accel-Redirect`; servicio `rustgis`; variables nuevas en `api` | `nginx/conf.d/…conf`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example` |

### 11.2 Configuración

Solo nombres; los valores secretos van únicamente en el `.env` del servidor, que no está en el repositorio.

| Variable | Por defecto | Para qué |
|---|---|---|
| `GEO_WORKSPACE_ENGINE` | `legacy` | `pilot`: RustGIS solo para `GEO_WORKSPACE_PILOT_USERS`; `rustgis`: para todos |
| `GEO_WORKSPACE_PILOT_USERS` | vacío | Ids o correos separados por comas |
| `GEO_FILE_ACCEL_PREFIX` | `/_nas_files/` (compose) | nginx sirve los `.fgb`/`.tif` y sus `Range`; vacío = los sirve la API |
| `GEO_WORKSPACE_MAX_PROJECT_BYTES` | 50 MiB | Tope del proyecto guardado |
| `WORKSPACE_AI_ENABLED` | `false` | Activa el proxy y el botón «Asistente» |
| `WORKSPACE_AI_API_KEY` | vacío → `NVIDIA_API_KEY` | **Secreto.** Clave del proveedor |
| `WORKSPACE_AI_BASE_URL` / `WORKSPACE_AI_ALLOWED_HOSTS` | `https://integrate.api.nvidia.com/v1` / `integrate.api.nvidia.com` | Proveedor (solo HTTPS y hosts permitidos) |
| `WORKSPACE_AI_MODEL` / `WORKSPACE_AI_MODEL_ALIAS` | `minimaxai/minimax-m3.1-flash` / `sigtar-asistente` | El alias debe coincidir con el de la imagen (`RUSTGIS_EMBED_ASSISTANT_MODEL`) |
| `WORKSPACE_AI_USER_PER_MINUTE` / `_PER_DAY` / `_MAX_CONCURRENT` | 20 / 500 / 4 | Límites |
| `WORKSPACE_AI_MAX_TOKENS` | 0 (sin tope) | Tope de respuesta opcional |

### 11.3 Pruebas realizadas

| Prueba | Resultado |
|---|---|
| API, `tsc --noEmit` | Sin errores |
| API, unitarias (`src/tests/geoWorkspaceRustgis.test.ts`) | 16/16 |
| API, integración contra la base desechable (`src/tests/geoWorkspaceRoutes.integration.test.ts`): búsqueda, `Range`, permisos, proyectos y proxy de IA con proveedor simulado | 7/7 |
| Web (`tests/rustgis-workspace.test.ts`), `tsc --noEmit`, ESLint | 6/6, sin errores |
| `nginx -t` con la configuración nueva | Correcto |
| Worker real sobre las 26 capas de prueba | 26 FlatGeobuf listos (p. ej., «puerto villa»: 1 603 MultiPolygon). Ocupan el 60 % del GeoJSON sin comprimir: para los 1,08 GB del catálogo, unos 0,65 GB más en el NAS |
| Navegador (Playwright) | §11.4 |
| Pruebas Rust del parche (`embed.rs`) | **No ejecutadas en este servidor**: compilarlas para el host exige otra compilación completa. El parche compila a WebAssembly y su comportamiento se probó en el navegador |

### 11.4 Prueba en el navegador

**Montaje (2026-11-04).** Todo escuchando solo en `127.0.0.1`:

- La imagen compilada `pma-management/rustgis:prod`.
- La API real contra la base desechable, sin `.env` y con secretos de desarrollo.
- Un TiTiler de prueba con el NAS en solo lectura.
- Next en modo desarrollo; su reescritura hizo de nginx.
- Chromium sin pantalla (Playwright), con WebGL2 por software, y dos usuarios de prueba: ADMIN y VIEWER con acceso al Geoportal.
- El proveedor de IA **simulado** dentro de la API: no salió ninguna petición hacia NVIDIA.

Los datos fueron copias de «Mina Cerro Pelado» y de «Puerto Baquerizo Moreno - Ortofoto 2023 y elevación».

| Prueba | Resultado |
|---|---|
| P1 Abrir un Mapa | **Pasa.** «Mina Cerro Pelado» abre con sus 24 capas (21 vectores, MDT, ortomosaico WEBP y mapa base). Los vectores se dibujan con los estilos del catálogo; la primera capa queda activa. Red: 94 lecturas `.fgb`, todas `Range` → 206; el MDT `Float32` de 1,49 GB se lee por bloques (64 KB de cabecera y luego ~0,6 MB); **ningún archivo entero**. El WEBP va por teselas, con su aviso. Fuera de la extensión del ráster las teselas dan 404 (normal en TiTiler); dentro, 200 |
| P2 Buscar y añadir | **Pasa.** «baquerizo 2023» encuentra la ortofoto de otro mapa; «Añadir» la pone encima en 1,6 s, sin recargar ni perder capas, acerca el mapa a su extensión y la marca «En el mapa». Lectura por `Range` de un archivo de 1,38 GB. **Hallazgo:** se veía con colores falsos (fondo blanco → rosado). La causa y la corrección están en §2.8 |
| P3 Guardar y reabrir | **Pasa.** Se eligió «puerto villa» como capa activa en el panel de RustGIS, se guardó, se recargó la página y se reabrió el proyecto. Cámara, orden, visibilidad, simbología, etiquetas y **capa activa** son idénticas; RustGIS confirma «puerto villa» en su sesión al publicar el siguiente cambio. Al reabrir, la ortofoto JPEG se convirtió sola de COG a teselas y se ve con sus colores reales. El proyecto pesa 32 KB con 25 capas: ninguna entidad copiada |
| P4 Permisos | **Pasa** con el usuario visor y la versión real de cada ráster. Mapa restringido: búsqueda de 9 a 0 resultados; `cog.tif`, teselas, `.fgb` y la ruta clásica del mapa → 404; el ADMIN sigue leyendo (206). Al reabrir un proyecto del visor que tenía la ortofoto: «ya no está disponible», capa y capa activa retiradas. Mapa interno: el visor del Geoportal lee (206) y la ruta pública sin sesión da 404. Un usuario no puede abrir proyectos de otro (404) |
| P5 Asistente | **Pasa con el proveedor simulado.** El panel arranca como «Compatible con OpenAI · sigtar-asistente», sin escribir nada. El navegador llama a nuestro origen con la cookie y **sin** `Authorization`; el proxy cambia el alias por `minimaxai/minimax-m3.1-flash`, pone la clave del servidor y envía las 11 herramientas de RustGIS. Una pregunta con herramienta funciona de punta a punta: `list_layers` se ejecuta y su resultado (con la capa activa) vuelve por el proxy. Falta repetirla con MiniMax real (necesita la clave) |
| P7 Errores | **Pasa** con el cliente real de RustGIS. Límite por minuto → 429 con `Retry-After: 54`; RustGIS avisa y reintenta a los 54 s con éxito. Cupo diario agotado → 429 `insufficient_quota`; RustGIS muestra el mensaje en español y no reintenta |
| P8 Coste del puente | Con capas por referencia, un desplazamiento o zoom produce **un** mensaje `project` de ~29 KB (25 capas). Una copia GeoJSON de 9 entidades lo sube a 33 KB |
| Otras | Exportación `legacy.json` (`sigtar-workspace` v2, 24 capas con estilos) e importación en un proyecto nuevo, con avisos. Búsqueda sin acentos ni mayúsculas, con `_` y `%` literales. Modo «Copia». Diálogo «Abrir» (mis proyectos y mapas). Workspace en blanco con la vista de Galápagos. La reescritura de Next reenvía `Range` y 206 (T11) |
| P6 Sesión de 20 min | **No probada.** La renovación cada 10 min está implementada; se comprobará en el piloto |

**Defectos que encontró la prueba (corregidos):**

1. **El Workspace no habría arrancado en ningún navegador.** El puente guardaba `setTimeout` y lo llamaba como método (`this.set(…)`). En el navegador eso lanza «Illegal invocation», así que la espera de `ready` fallaba al instante; las pruebas no lo vieron porque Node lo permite. Se corrigió en `bridge.ts` y hay una prueba que imita al navegador; con el código anterior falla.
2. **Arranque lento.** Un equipo lento o sin GPU puede tardar más de 2 minutos en cargar los ~47 MB de WebAssembly. Antes la página mostraba un error permanente aunque RustGIS terminara de cargar. Ahora, a los 45 s avisa «está tardando» con enlace al Workspace clásico y sigue esperando hasta 15 min.
3. **COG JPEG YCbCr con colores falsos** (§2.8). `rasterTilesReason` los manda a teselas: todo ráster de 3 bandas que procese el worker. Al reabrir un proyecto que los tenía por partes, se convierten a teselas con aviso.
4. **Avisos duplicados** («se muestra con teselas: Se muestra con teselas…»): el detalle del servidor ahora solo completa la frase.

En el Chromium sin pantalla del servidor, con WebGL por software, RustGIS anunció `ready` entre 2,4 y 4,8 s con el WebAssembly ya en caché, y dibujó a 3–7 fps. En equipos con GPU debería ir bastante más fluido.

### 11.5 Puesta en marcha

**Despliegue del 2026-11-04 (23:54).** Lo hizo otra sesión de Claude Code a pedido del responsable, desde un worktree idéntico al árbol de trabajo (incluidas las correcciones de §11.4) y con los pasos de abajo.

- **Respaldo previo:** `~/Documentos/pma_db-backup-20261104-234752-pre-rustgis-0037.sql`. Es SQL plano de 3,3 MB, con 66 tablas, y termina con «dump complete».
- **Migración:** `migrate` aplicó `0037` («Migrations complete.»).
- **Servicios:** `pma-rustgis` y `pma-api` sanos; `pma-web`, `pma-worker` y `pma-nginx` arriba.
- **`.env`:** `GEO_WORKSPACE_ENGINE=pilot`, con las dos cuentas del responsable en `GEO_WORKSPACE_PILOT_USERS`; `WORKSPACE_AI_ENABLED=true` y la clave en `WORKSPACE_AI_API_KEY`.
- **MiniMax real** respondió por el proxy: 200 en 4 s, según la sesión que desplegó.
- **FlatGeobuf:** el worker los está generando; había 25 listos al terminar.
- **Pendiente de comprobar:** las lecturas 206 por `X-Accel-Redirect` (logs de nginx) cuando el responsable abra el Workspace. Si fallan, se deja `GEO_FILE_ACCEL_PREFIX` vacío y se recrea `api`: la API sirve los `Range` ella misma.

Pasos seguidos (y para repetir en otro despliegue):

1. **Respaldo** de la base compartida (dev y prod usan la misma): `pg_dump` por `docker exec` a un archivo fuera del repositorio.
2. **Imagen de RustGIS:** `infra/rustgis/build.sh prod`. La primera vez tarda unos 20 min; las siguientes, solo `rustgis-web`.
3. **Desplegar solo este cambio** desde un worktree limpio (para no arrastrar otros cambios locales): construir `api`, `worker` y `web` con `docker compose -p pma-management --env-file <repo>/.env build …` y levantar con `up -d --no-build --wait rustgis api worker web nginx`. **`api` depende de `migrate`, así que levantarla aplica `0037`.** La migración es aditiva y el código anterior la tolera. nginx se recrea porque cambia su configuración y monta el NAS en solo lectura. No usar `./deploy.sh update`, que baja todo el stack.
4. **Variables** en el `.env` del servidor: `GEO_WORKSPACE_ENGINE=pilot`, `GEO_WORKSPACE_PILOT_USERS=<correo del usuario de pruebas>`, `WORKSPACE_AI_ENABLED=true` y `WORKSPACE_AI_API_KEY=<clave>` (o `NVIDIA_API_KEY`). Después, recrear `api`.
5. **Primera generación de FlatGeobuf:** el reconciliador del worker recorre las 679 capas a 40 cada 2 min (unos 35 min o más). Mientras tanto, la búsqueda las marca «se está preparando» y se pueden añadir como copia.
6. **Comprobar** con el usuario de pruebas: abrir un Mapa, buscar y añadir una capa de otro mapa, guardar, recargar y reabrir (capas, orden, estilo, vista y capa activa), y una pregunta al asistente.
7. **Vuelta atrás:** `GEO_WORKSPACE_ENGINE=legacy` y recrear `api`. La migración puede quedarse (es aditiva). `rollback/0037_down.sql` la deshace del todo, pero borra los proyectos guardados y las listas de acceso.

### 11.6 Incidencia durante la implementación

El 2026-11-04, entre las 21:30 y las 21:37 (hora de Galápagos), la primera compilación de RustGIS agotó los 11 GB del servidor: LTO completo, 6 procesos y sin tope de memoria. Durante esos 7 minutos, la API de Galápagos Previene falló sus comprobaciones de salud; se recuperó sola. Los contenedores `pma-*` no se reiniciaron. Se detuvo la compilación. Desde entonces `build.sh` compila en un contenedor con tope de memoria sin swap (4,5 GB), 2 CPU, LTO «thin» y 2 procesos, con un vigilante que la detiene si el servidor baja de 1,2 GB disponibles. Con un tope de 3 GB, el paso `wasm-bindgen` (pico medido de 3,1 GB) murió dentro de su contenedor sin afectar a ningún servicio. Con 4,5 GB y el vigilante, la compilación terminó sin incidencias: 5 min de Rust (solo `rustgis-web`, con las cachés), `wasm-opt` y la imagen. Resultado: 93,6 MB de imagen y 46,6 MB de WebAssembly (antes de optimizar, 63 MB).

### 11.7 Pendiente

- Comprobar las lecturas 206 por `X-Accel-Redirect` en el primer uso del piloto (§11.5).
- Seguir la generación de FlatGeobuf hasta cubrir las 679 capas. Mientras tanto, las que falten aparecen «se está preparando» y se pueden añadir como copia.
- La clave de IA ya está configurada y MiniMax responde. Falta P5 completo con MiniMax real (herramientas sobre el mapa) y T9 (formato de sus respuestas y cabeceras de su 429). El recorrido por el proxy y los reintentos ante nuestro 429 ya se probaron con el proveedor simulado (§11.4).
- P6 (20 min de trabajo continuo con la renovación de sesión) en el piloto.
- Pruebas Rust del parche en una máquina con ≥ 16 GB (`cargo test -p rustgis-web`).
- T16 (memoria del navegador con varios COG grandes) en los equipos reales.
- Reportar a RustGIS dos cosas: los COG JPEG YCbCr se ven con colores falsos (§2.8), y el aviso de reintento del asistente («The provider returned HTTP 429; trying again in … s») no está traducido.
