# Plan de integración: SIMAT-GAL como módulo del SIGTAR

**Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos**

> **Estado (2026-11-17):** **implementado y verificado contra una base desechable.** Falta solo el despliegue a producción (respaldo + migración de la base compartida). Resumen en §12. La lluvia observada en vivo la aporta **IERSE (U. del Azuay)**, una API abierta descubierta después de redactar el plan (§2.5); INAMHI cuenta ahora con conexión directa usando las cabeceras del visor público (actualización al inicio de este documento).
>
> **Origen:** `SIMAT-GAL-Web-rediseno.zip` (rediseño con el estilo del Geoportal, 22 archivos, Flask + JS sin dependencias), desplegado hoy en `simat-gal.vercel.app`.
> **Repositorio:** `pma-management`, rama `dev-migration`, commit `218e935`.
> **Fuentes de datos:** cada una se consultó el 2026-11-17 entre las 09:00 y las 09:15 (hora de Galápagos), desde el host y **desde dentro de `pma-worker`**, el contenedor que hará la sincronización. Solo se hicieron lecturas públicas y no se saltó ninguna restricción de acceso.


### Actualización: conexión directa de INAMHI

La decisión del operador sustituye las condiciones de autorización y oficio del plan original que sigue debajo. Se habilitan las series con `Origin: https://inamhi.gob.ec` y `Referer: https://inamhi.gob.ec/info/`. La consulta real respondió HTTP 200 sin token. El worker consulta lluvia horaria de las estaciones activas cada 15 minutos, solicita un rango de fechas y conserva únicamente las últimas 72 horas. Las fechas de las series llevan `Z` y se guardan en UTC. Se rechazan precipitaciones negativas, fechas sin zona y valores futuros; los errores dejan de ocultarse como sincronizaciones exitosas. `SIMAT_INAMHI_SERIES=0` permite desactivarlo.

Esta modificación del código está pendiente de despliegue junto con SIMAT; no implica que el worker actualmente publicado ya la ejecute.

---

## 0. Resumen

### 0.1 Recomendación

Crear el módulo **SIMAT-GAL** (`app_key` `simat`, ruta `/simat`) **portando** la aplicación al stack del SIGTAR, sin embeber el Flask:

- **Backend en la API Fastify y el worker:** conectores en TypeScript que guardan en Postgres, con sincronización periódica en `worker.ts` (el mismo patrón de Previene y PG2030). Se portan la lógica de ventanas de lluvia (`series()`), la matriz de riesgo (`riesgo.py`) y los parsers de INOCAR, IOC y FCD.
- **Web en Next.js:** las dos vistas del rediseño (*Vista general* y *Riesgo y nivel del mar*) más una vista nueva, **Estaciones y fuentes**, que muestra cada conexión, su último dato y su último error. Se conservan el diseño, los gráficos SVG propios y el mapa IGM del zip.
- **Sin datos simulados:** se eliminan las estaciones `SIM-01..03` y el aviso «Entorno de demostración». Cada dato indica de dónde viene: observado, preliminar, predicción o modelo.

### 0.2 Estado real de las conexiones (verificado el 2026-11-17)

| Fuente | Qué aporta | Estado desde `pma-worker` |
|---|---|---|
| **IERSE · Red Galápagos** (U. del Azuay) | **Lluvia y clima observados en vivo** (~5 min) en 2 estaciones de Santa Cruz: Militar y Santa Rosa | ✅ API abierta, sin candado de origen. Último punto a minutos de la prueba |
| **IOC / INOCAR: mareógrafos** Santa Cruz (`sant`) y Baltra (`balt`) | Nivel del mar observado cada minuto | ✅ 200. Último dato a las 15:06 UTC, minutos antes de la prueba |
| **INOCAR: tablas de mareas** (Santa Cruz `cp=30`, Baltra `cp=385`) | Pleamar y bajamar predichas, 3 días | ✅ 200 desde Node (ver §2.2 sobre el certificado) |
| **INAMHI: inventario de estaciones** (`api_visor/station_information`) | 24 estaciones de Galápagos y la hora del último dato de cada variable | ✅ 200 |
| **INAMHI: series de las estaciones** (`station_data_automaticas/*`) | Lluvia, temperatura, humedad, viento, presión y radiación por hora | ⛔ **403 `origin_not_allowed`**: «Este endpoint solo acepta peticiones desde el visor de INAMHI» |
| **Open-Meteo** | Lluvia estimada actual y pronóstico de 24 h (**modelo, no estación**) | ✅ 200 |
| **FCD: CSV climatológico** | Lluvia diaria de Puerto Ayora (hasta 2026-06-03) y de Bellavista (hasta 2019-09-16) | ✅ 200 (series históricas, no tiempo real) |
| **METAR SEST** (aeropuerto de San Cristóbal) | Temperatura, viento y presión cada hora (sin cantidad de lluvia) | ✅ 200 por `tgftp.nws.noaa.gov` (opcional) |
| **GSC-USFQ** (`weathergsc.usfq.edu.ec`) | 5 estaciones en San Cristóbal cada 5 min | ❌ Es una app R Shiny sin API; los datos se piden por correo. 4 de esas estaciones también figuran en el inventario de INAMHI |

### 0.3 Principal bloqueo: las series de INAMHI

Las **5 estaciones automáticas que hoy transmiten** en Galápagos publican sus series solo a través del visor de INAMHI, que **rechaza las peticiones de otros orígenes**:

| `id_estacion` | Código | Estación | Propietario | Último dato (inventario) |
|---|---|---|---|---|
| 64210 | M0191 | Charles Darwin 1 (Puerto Ayora) | INAMHI | 2026-11-17 13:00/14:00 −05 |
| 63782 | M0221 | San Cristóbal - Galápagos | INAMHI | 2026-11-17 13:00 −05 |
| 66957 | M5300 | USFQ - San Cristóbal, Las Merceditas | USFQ | 2026-11-17 14:00 −05 |
| 66958 | M5301 | USFQ - San Cristóbal, El Junco | USFQ | transmitiendo |
| 66960 | M5303 | USFQ - San Cristóbal, El Mirador | USFQ | transmitiendo |

(66959 M5302 Cerro Alto figura como «no transmitiendo»; las otras 18 son convencionales o manuales.)

**No se falseará el origen** para imitar al visor. Para tener lluvia observada en tiempo real hace falta la **autorización de INAMHI** (decisión D1). Mientras llega:

- el conector de series queda programado y **desactivado** (`SIMAT_INAMHI_SERIES=0`), con pruebas sobre el formato documentado en el código del visor;
- el inventario sí funciona: el módulo muestra las 5 estaciones, sus variables y la **hora de su última transmisión** (estado «al día» o «atrasada»);
- la lluvia de referencia viene de Open-Meteo, **rotulada como modelo**, y la histórica de FCD.

**Consecuencia para la matriz de riesgo:** la evaluación automática exige una ventana de lluvia observada y completa de 5 a 720 min. Sin las series de INAMHI, la evaluación devuelve «Información insuficiente» (es el comportamiento del zip, que se mantiene). La consulta manual y la simulación de la matriz siguen disponibles.

### 0.4 Primer paso

Fase 1 (§9): migración `0040`, conectores de IOC, INOCAR, inventario de INAMHI, FCD y Open-Meteo con sus fixtures, y la sincronización en el worker. Al terminarla, la vista **Estaciones y fuentes** ya muestra datos reales.

---

## 1. Qué trae el zip

| Archivo | Contenido | Destino en el SIGTAR |
|---|---|---|
| `app.py` | Flask para Vercel: SQLite comprimido en un Blob privado, con control por ETag; cron diario; proxy del mareógrafo | Se sustituye por rutas Fastify + Postgres + worker |
| `simat_core.py` | Esquema SQLite, sesiones propias (3 cuentas compartidas), ventanas de lluvia (`series`), importación CSV, sincronización, siembra de estaciones simuladas | Se portan `series`, `import_rain` (validaciones) y `synchronize`. **No** se portan las sesiones ni la siembra |
| `riesgo.py` | Matriz lluvia × mar (Normal / Precaución / Alerta / Emergencia), puertos por isla, `evaluate`, `build_criteria` | Se porta completo a `modules/simat/riesgo.ts` |
| `integraciones.py` | Lista de hosts permitidos, sin redirecciones, solo IP públicas, límite de 16 MB; parsers de FCD e INOCAR; calibración 70/30 | Se portan la lista de hosts y los parsers. La calibración queda fuera (su pantalla se retiró en el rediseño) |
| `mareografos.py` | Parser de la tabla IOC (sensor `ras(m)`), serie de 12 h | Se porta |
| `lluvia_pronostico.py` | Open-Meteo: estimación actual y 24 h | Se porta, con caché de 5 min en la API |
| `ui.js`, `risk-ui.js` | Las dos vistas, en HTML generado como cadenas | Se reescriben como componentes React |
| `graficos.js`, `mapa.js` | Gráficos SVG accesibles (lluvia, dial, marea, nivel observado, pronóstico) y mapa en canvas de las islas IGM | Se convierten a módulos TS montados con `ref`, sin cambiar el dibujo |
| `style.css`, `hero-galapagos.jpg`, `islas-igm.geojson.gz` | Estilo del rediseño, foto del encabezado y capa IGM (ODbL 1.0, 1,5 MB) | `components/simat/simat.css` con alcance `.simat`; `public/simat/` |
| `conectores.json`, `fuentes.json` | 6 conectores predefinidos e inventario de fuentes | Conectores fijos en código (§4); el inventario de fuentes aparece en la vista *Estaciones y fuentes* |

**Datos del despliegue actual** (`/api/state` público, 2026-11-17): 3 estaciones simuladas, 38 predicciones de INOCAR, 0 criterios de riesgo, 0 reportes, y los conectores de FCD nunca sincronizados. **No hay nada que migrar:** el módulo arranca vacío y se llena con los conectores.

---

## 2. Fuentes: detalle técnico

### 2.1 INAMHI (`https://inamhi.gob.ec/api_visor`)

Endpoints tomados del código del visor (`main-RMUGRHID.js`, configuración `id_aplicacion: "vs_1h_inh"`):

| Endpoint | Método | Acceso |
|---|---|---|
| `/station_information/estaciones/visores/?id_aplicacion=vs_1h_inh` | GET | Público: 1.898 estaciones del país (770 KB). Se filtran las de Galápagos por `id_provincia = "20"` o por caja geográfica (hay 3 con provincia «NO DELIMITADA») |
| `/station_information/estaciones/parametros/?id_estacion=…&id_aplicacion=vs_1h_inh` | GET | Público: variables con `nemonico` y `fecha_ultimo_dato`. Lluvia horaria `017140801h` y diaria `017140801d` |
| `/station_data_automaticas/get_data_hour/` `{id_estacion, table_names, fecha_desde, fecha_hasta}` | POST | ⛔ 403 desde fuera del visor |
| `/station_data_automaticas/get_precipitation/` `{id_estacion, start_date, end_date}` | POST | ⛔ 403 desde fuera del visor |
| `/forecast/wrf/estacion/?id_estacion=…&codigos_wrf=017,029` | GET | Público, pero la última corrida es del **2026-09-27**: no se usa |

Las horas de INAMHI vienen en −05:00 (Ecuador continental). Se guardan en UTC y se muestran en hora de Galápagos (−06:00).

### 2.2 INOCAR y el certificado

La cadena de `www.inocar.mil.ec` termina en la raíz **SSL.com TLS RSA Root CA 2022**, que no está en el almacén de certificados del sistema Debian (por eso `curl` y Python fallan con *self-signed certificate in certificate chain*). **Node 20 trae sus propias raíces y la acepta**, tanto en el host como en `pma-worker`. Hay que tenerlo en cuenta: no se debe activar `--use-openssl-ca` ni `NODE_OPTIONS` que cambien a las raíces del sistema, porque INOCAR dejaría de funcionar. Una prueba del conector lo vigila.

### 2.3 IOC (mareógrafos)

`bgraph.php?code=sant|balt&output=tab&period=0.5` devuelve una tabla HTML con `Time (UTC)` y `ras(m)`. El dato es **preliminar, sin control de calidad**, y está en una **referencia instrumental sin datum publicado** (lo dice el propio zip). Esto importa para la matriz (D4).

### 2.4 Red local

Durante las pruebas, el DNS falló de forma intermitente (`tgftp.nws.noaa.gov` y `aviationweather.gov` no resolvieron una vez; el WFS de FCD agotó el tiempo de espera). Por eso los conectores reintentan con espera creciente, nunca borran el último dato bueno y la interfaz muestra su antigüedad.

---

## 3. Arquitectura

```
                 ┌──────────────── pma-worker (setInterval, uno a la vez) ────────────────┐
 IOC  ──────────▶│ ioc        cada 5 min   ─┐                                              │
 INOCAR ────────▶│ inocar     diario 00:10 ─┤                                              │
 INAMHI ────────▶│ inamhi-inv cada 30 min  ─┼─▶ red.ts (hosts permitidos, sin redirección, ─┼─▶ Postgres
 INAMHI* ───────▶│ inamhi-ser cada 15 min  ─┤     IP pública, límite de tamaño, timeout)   │   simat_*
 FCD  ──────────▶│ fcd        diario       ─┤                                              │
 METAR (opc.) ──▶│ metar      cada 30 min  ─┘   → simat_sincronizaciones (estado y error)  │
                 └─────────────────────────────────────────────────────────────────────────┘
 Open-Meteo ◀── pma-api /simat/estaciones/:id/pronostico (bajo demanda, caché 5 min)
                pma-api /simat/* ──▶ pma-web /simat (Vista general · Riesgo · Estaciones y fuentes)
 * desactivado hasta la autorización de INAMHI
```

**Por qué portar en lugar de levantar el Flask como contenedor aparte:** el Flask trae su propio sistema de usuarios (3 cuentas compartidas), una base SQLite guardada como archivo en Vercel Blob y un cron diario. Integrarlo tal cual duplicaría la autenticación y los permisos del SIGTAR y dejaría los datos fuera de Postgres y de sus respaldos. La lógica que de verdad hay que conservar (parsers, ventanas y matriz) ocupa unas 600 líneas de Python y se porta con pruebas que comparan su resultado con el del original.

---

## 4. Conectores

Todos viven en `apps/api/src/modules/simat/conectores/`, comparten `red.ts` (port de `check_url`/`get_data`: solo HTTPS, hosts permitidos, sin redirecciones, IP pública, límite de bytes, `User-Agent: SIGTAR-SIMAT/1.0`) y registran cada intento en `simat_sincronizaciones`.

| Conector | Frecuencia | Guarda | Notas |
|---|---|---|---|
| `ioc` | 5 min | `simat_nivel_mar` (tipo *Nivel observado*, calidad *preliminar*) | Últimas 12 h; inserción idempotente por `(puerto, instante)` |
| `inocar` | Diario a las 00:10 de Galápagos, con reintento cada hora si falla | `simat_nivel_mar` (tipo *Predicción astronómica*, referencia MLWS) | La tabla trae ayer, hoy y mañana; las horas publicadas se guardan como texto, igual que en el zip |
| `inamhi-inventario` | 30 min | `simat_estaciones` + `ultimo_dato` por variable | Alta y actualización de estaciones; nunca borra |
| `inamhi-series` | 15 min | `simat_observaciones` (lluvia horaria y, si se decide, temperatura, humedad, viento y presión) | **Desactivado** (`SIMAT_INAMHI_SERIES=0`). Se activa con el mecanismo que INAMHI defina: lista de orígenes o IP, o una credencial en `SIMAT_INAMHI_TOKEN`. Siempre con nuestro origen real |
| `fcd` | Diario | `simat_observaciones` (lluvia diaria, marcada *histórica*) | Puerto Ayora y Bellavista; valida que el CSV conserve las columnas `observation_date` y `precipitation` |
| `metar` (opcional, D6) | 30 min | `simat_observaciones` (temperatura, viento, presión; lluvia sí/no según los códigos RA/SHRA) | SEST; SEGS si resuelve |
| Open-Meteo | Bajo demanda | No se guarda | Caché de 5 min en la API. Atribución CC BY 4.0. El navegador ya no lo llama directo (el zip sí lo hacía) |

**Aviso de caídas:** si un conector acumula más de 6 h sin éxito (24 h en los diarios), se encola un correo al administrador en el `mailOutbox` existente, una vez por incidente.

---

## 5. Modelo de datos (migración `0040_simat_module.sql`)

Migración escrita a mano, con su entrada en `_journal.json` (`when` > `1792277600000`) y `rollback/0040_down.sql`. El `app_key` `simat` se añade al enum `app_key` en la misma migración.

| Tabla | Columnas principales | Clave |
|---|---|---|
| `simat_estaciones` | `id` (`INAMHI-64210`, `FCD-PA`, `METAR-SEST`), `fuente`, `codigo`, `nombre`, `isla`, `lat`, `lon`, `altitud`, `paso_min`, `propietario`, `captor`, `estado_transmision`, `ultimo_dato jsonb`, `activa`, `actualizado_en` | `id` |
| `simat_observaciones` | `estacion_id`, `variable` (`precipitacion`, `temperatura`, `humedad`, `viento_vel`, `viento_dir`, `presion`, `radiacion`), `instante timestamptz`, `valor`, `calidad` (`válido`/`sospechoso`/`inválido`), `fuente`, `uso` | `(estacion_id, variable, instante)` |
| `simat_nivel_mar` | `puerto`, `tipo` (`Predicción astronómica`/`Nivel observado`), `instante timestamptz` o `hora_publicada text`, `valor`, `unidad`, `referencia`, `fase`, `calidad`, `fuente`, `registrado_por` | única `(puerto, tipo, fuente, instante, hora_publicada)` |
| `simat_criterios` | Los campos de `build_criteria` (`estacion_id`, `isla`, `puerto`, `datum`, `sector`, `respaldo`, `ventana_min`, `vigencia_min`, `desfase_min`, `lluvia_mm_h`, `mar_m`, `activo`), `actualizado_por`, `actualizado_en`, `version` | única `(estacion_id, puerto, sector)` |
| `simat_sincronizaciones` | `conector`, `ultimo_intento`, `ultimo_exito`, `resultado`, `registros`, `error`, `fallos_seguidos`, `aviso_enviado` | `conector` |

**Retención:** nivel del mar observado a resolución de 1 min durante 90 días (unas 130.000 filas por mareógrafo) y después se elimina; las observaciones de las estaciones se guardan sin límite (horarias o diarias, volumen bajo).

**Base compartida:** dev y prod usan el mismo Postgres, así que la migración se aplica sobre datos reales. Antes de desplegar se respalda con `pg_dump` vía `docker exec`. Las tablas son nuevas y la migración solo añade un valor al enum; no toca datos existentes.

---

## 6. API (`apps/api/src/routes/simat/index.ts`, prefijo `/simat`)

Lógica en `apps/api/src/modules/simat/`: `ventanas.ts` (port de `series`), `riesgo.ts` (port de `riesgo.py`), `estado.ts`, `conectores/*`, `red.ts`. Los esquemas y tipos compartidos van en `packages/types/src/simat.ts`.

| Ruta | Acceso | Qué hace |
|---|---|---|
| `GET /simat/estado` | Lectura (D2) | Estaciones, estado de cada conector, puertos, evaluaciones de riesgo vigentes |
| `GET /simat/estaciones/:id/lluvia` | Lectura | Ventanas de 5 min a 72 h y serie reciente (misma salida que `/api/rain/` del zip) |
| `GET /simat/estaciones/:id/pronostico` | Lectura | Open-Meteo, caché de 5 min |
| `GET /simat/mareografos/:codigo` | Lectura | Serie de 12 h y último nivel, desde la base |
| `GET /simat/mareas?puerto=` | Lectura | Predicciones de INOCAR del día y del siguiente |
| `PUT /simat/criterios` | Sesión + `simat`, ADMIN o REPORTER | `build_criteria` con Zod; control de versión |
| `POST /simat/nivel-observado` | Sesión + `simat`, ADMIN o REPORTER | Registro manual de un nivel validado (la acción «Registrar nivel observado» del zip) |
| `POST /simat/sincronizar/:conector` | Sesión + `simat`, ADMIN | Fuerza una sincronización y devuelve su resultado |

**Roles:** Administrador → `ADMIN`, Técnico → `REPORTER`, Observador → `VIEWER` (solo lectura).

---

## 7. Web (`apps/web`)

- `app/simat/layout.tsx` con `SimatShell` (barra lateral del rediseño: marca SIMAT-GAL, reloj de Galápagos, estado de conexión, «Auto» cada 60 s) y tres páginas:
  - `app/simat/page.tsx`: **Vista general** (mapa IGM en el encabezado, KPI, panel de riesgo, precipitación reciente, lluvia antecedente, estaciones).
  - `app/simat/riesgo/page.tsx`: **Riesgo y nivel del mar** (evaluación del sector, simulación de la matriz, mareógrafo, curva de marea, pronóstico de lluvia, formulario de criterio).
  - `app/simat/fuentes/page.tsx`: **Estaciones y fuentes** (nueva): tabla de conectores con su último éxito, su último error y su número de registros; las estaciones de INAMHI con la hora de su última transmisión; el inventario de `fuentes.json` con licencias y pendientes.
- `components/simat/`: componentes React que sustituyen el HTML de `ui.js` y `risk-ui.js`; `lib/simat/graficos.ts` y `lib/simat/mapa.ts` (los módulos del zip pasados a TS, montados con `useEffect` sobre un `ref`); `simat.css` con alcance `.simat`, como `protocolo-limpieza.css`.
- **Cambios sobre el zip:** sin aviso de demostración ni estaciones simuladas; el KPI «Estado interno», que dependía de las notificaciones retiradas, pasa a mostrar el nivel más alto de la matriz entre los sectores evaluados (D5); cada valor lleva su rótulo: *Observado*, *Preliminar sin control de calidad*, *Predicción INOCAR* o *Modelo Open-Meteo*.
- **Puntos de integración** (los mismos que tocó el módulo Protocolo de limpieza): `packages/types` (`AppKey`), `apps/api/src/auth/jwt.ts`, `db/schema/enums.ts`, `routes/users.ts`, `scripts/seed-admin*.ts`, `app/(auth)/select-app/page.tsx` (tarjeta nueva), `lib/app-homes.ts` (`simat: "/simat"`), `app/admin/users/page.tsx`, `components/login-form.tsx`, `lib/auth-context.tsx`, `lib/api-client.ts`, `middleware.ts` (si D2 es público) y `tests/app-homes.test.ts`.

---

## 8. Lo que no se porta

- Las pantallas que el propio rediseño retiró y sus rutas: visor territorial, reportes comunitarios y su revisión, notificaciones, registros técnicos (observadores, puntos seguros, escenarios, protocolos, simulacros), calibración de indicadores, configuración de conectores desde la interfaz, bitácora y respaldos. Si se necesitan más adelante, los reportes ciudadanos ya tienen un hogar en Galápagos Previene.
- Las sesiones propias, las 3 cuentas compartidas, SQLite, Vercel Blob y el cron de Vercel.
- La capa WFS de FCD (agotó el tiempo de espera): se usa la capa IGM incluida en el zip.

---

## 9. Fases

| Fase | Contenido | Estimación | Resultado verificable |
|---|---|---|---|
| **F0** | Decisiones D1–D6; oficio a INAMHI (borrador en el Anexo A) | — | Solicitud enviada |
| **F1** | Migración `0040`; `red.ts`; conectores IOC, INOCAR, inventario de INAMHI, FCD y Open-Meteo; fixtures capturados el 2026-11-17; sincronización en el worker | 1,5 días | `simat_sincronizaciones` con todos los conectores en verde |
| **F2** | `ventanas.ts` y `riesgo.ts` con pruebas que contrastan su salida con el Python original; rutas de la API; pruebas de integración en una base desechable (no `localhost:5432`, que es la de Previene) | 1,5 días | Pruebas en verde |
| **F3** | `SimatShell`, las tres vistas, gráficos y mapa portados, CSS | 2 días | Revisión en el navegador (Playwright), capturas de cada vista, en claro y en oscuro |
| **F4** | Integración del `app_key`, usuarios y tarjeta; despliegue desde un worktree limpio (para no arrastrar los cambios de RustGIS que están sin commit) | 0,5 días | `/simat` en producción con datos reales |
| **F5** | Al llegar la autorización de INAMHI: activar `inamhi-series`, cargar el histórico reciente y, con el equipo técnico, configurar los primeros criterios de riesgo | 0,5 días + calibración | Matriz evaluando automáticamente |

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| INAMHI tarda o niega el acceso | El módulo funciona sin esas series (mar, mareas, inventario, modelo); la matriz queda en «Información insuficiente» con el motivo a la vista. Alternativa: pedir los datos de las 4 estaciones USFQ a GSC |
| INOCAR o IOC cambian el HTML | Los parsers fallan con un error explícito (no guardan basura); la vista de fuentes lo muestra y se avisa por correo |
| Certificado de INOCAR | Node trae la raíz; una prueba del conector lo vigila (§2.2) |
| DNS intermitente | Reintentos, último dato bueno conservado, antigüedad visible |
| Umbrales sin calibrar | La matriz no emite niveles mientras no haya criterios configurados por el equipo técnico; los criterios guardan quién los cambió y cuándo |
| Licencias | Atribución visible: IGM (ODbL 1.0), FCD (cita), IOC/INOCAR, Open-Meteo (CC BY 4.0). Las condiciones de redistribución de INOCAR se consultan en la misma solicitud |

---

## 11. Decisiones pendientes

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | Acceso a las series de INAMHI | Solicitar por oficio la autorización del dominio `sigtar.gobiernogalapagos.gob.ec` (o de la IP del servidor), o una credencial, para las 5 estaciones de §0.3. No falsear el origen |
| **D2** | Visibilidad | **Lectura pública** (como el Geoportal y Gestión de residuos): es un sistema de alerta temprana. Configurar criterios y registrar niveles exige sesión con la app `simat` |
| **D3** | Nombre y ruta | `/simat`, `app_key` `simat`; tarjeta «Monitoreo Hidrometeorológico y Alerta Temprana», con el nombre completo en el encabezado del módulo |
| **D4** | Nivel del mar en la matriz | El zip solo acepta niveles **validados** y con datum. El dato de IOC es preliminar y sin datum, así que no puede activar la matriz por sí solo. Recomendado: mantener esa regla y mostrar el dato de IOC como referencia; el técnico registra el nivel validado, o se define con INOCAR un desfase al MLWS |
| **D5** | KPI «Estado interno» | Sustituirlo por el nivel más alto de la matriz (las notificaciones manuales de las que dependía se retiraron) |
| **D6** | METAR de San Cristóbal | Incluirlo como complemento (temperatura, viento, presión y lluvia sí/no): cuesta poco y es la única observación horaria pública hoy |

---

## 12. Estado de implementación (2026-11-17)

Construido en la rama `dev-migration`, **sin commit** y **sin desplegar**. Verificado contra una base Postgres desechable (`sigtar-simat-test-db`), no contra la de producción.

**Backend (`apps/api`)**
- Migración `0040_simat_module.sql` + rollback + entrada en `_journal.json`; aplica limpia sobre las 39 anteriores y agrega `simat` al enum `app_key`.
- Esquema Drizzle `db/schema/simat.ts` (5 tablas) y tipos compartidos `packages/types/src/simat.ts`.
- `modules/simat/`: `red.ts` (allowlist, sin redirecciones, reintentos ante DNS/timeout), `ventanas.ts` (acumulados con cobertura ≥ 90 %), `riesgo.ts` (matriz portada de `riesgo.py`), conectores `ierse`, `ioc`, `inocar`, `inamhiInventario`, `inamhiSeries` (apagado), `fcd`, `metar`, `openMeteo`, y la orquestación/estado/criterios/nivel.
- Rutas `/simat/*` (lectura pública; criterios y nivel observado con sesión `simat`; sincronizar con ADMIN) y el tick en `worker.ts`, gateado por `SIMAT_SYNC_ENABLED` (encendido para el worker de producción en `docker-compose.yml`).
- Pruebas `tests/simat.test.ts` (12, con fixtures reales de INOCAR e IOC): **12/12 en verde**.

**Resultado de correr los conectores una vez (datos reales, base desechable):**

| Conector | Resultado |
|---|---|
| ierse | 2 estaciones (Militar, Santa Rosa) · ~1.370 observaciones |
| ioc | 2 mareógrafos · ~1.430 lecturas (serie de 12 h) |
| inocar | 2 puertos · 24 predicciones |
| inamhi-inventario | 6 estaciones automáticas con hora de última transmisión |
| inamhi-series | desactivado (sin autorización) |
| fcd | Puerto Ayora · ~890 días (histórico) |
| metar | SEST · temperatura, viento, presión |

Prueba HTTP de extremo a extremo: `GET /simat/estado`, `/lluvia`, `/mareografos`, `/mareas` responden; `PUT /criterios` sin sesión da 401; con sesión ADMIN, crear un criterio + registrar un nivel observado hace que la matriz evalúe (**Precaución**: mar 1,8 m ≥ umbral 1,5 m, lluvia 0 < 5 mm/h).

**Web (`apps/web`)**
- Ruta `/simat` (pública, D2) con `SimatShell` y tres vistas: Vista general (tablero + mapa Leaflet + gráficos recharts), Riesgo y nivel del mar (dial, mareógrafo, mareas, pronóstico, formularios de criterio y nivel para técnicos) y Estaciones y fuentes.
- Enganches: `app_key` `simat` en tipos/auth/usuarios/seed, tarjeta en select-app, `app-homes`, prefijo público en `middleware.ts`, cliente de API. `tsc --noEmit` limpio; `tests/app-homes.test.ts` en verde.

**Pendiente de despliegue (§9 F4):** respaldo con `pg_dump`, build desde worktree limpio (hay cambios de RustGIS sin commit que no deben irse), migración de la base compartida y `up -d`.

---

## Anexo A. Borrador de solicitud a INAMHI

> Asunto: Solicitud de acceso a datos horarios de estaciones automáticas de Galápagos para el SIGTAR
>
> El Consejo de Gobierno del Régimen Especial de Galápagos integra en su Sistema de Información (SIGTAR, `https://sigtar.gobiernogalapagos.gob.ec`) el Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos. Solicitamos autorización para consultar desde nuestro servidor, cada 15 minutos, los datos horarios (precipitación y, de ser posible, temperatura, humedad relativa, viento y presión) de las estaciones automáticas M0191 Charles Darwin 1, M0221 San Cristóbal - Galápagos, M5300 Las Merceditas, M5301 El Junco y M5303 El Mirador, mediante los servicios `station_data_automaticas` del visor hidrometeorológico o el mecanismo que INAMHI disponga (credencial, lista de orígenes o IP). Los datos se mostrarán citando a INAMHI como fuente, con la calidad que INAMHI indique, y se usarán para la evaluación del riesgo por lluvia y nivel del mar en los sectores costeros.
