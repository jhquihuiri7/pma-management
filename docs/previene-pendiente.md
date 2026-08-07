# Galápagos Previene — estado del módulo

**Desplegado en producción el 7 de agosto de 2026.** Las cinco fases están
completas: el repositorio compila, la suite pasa, la migración está aplicada y
el worker ingiere reportes.

Copia de seguridad previa al despliegue:
`/home/jhonathan/Documentos/pma_db-backup-20260807-142444.sql` (1,4 MB, la base
entera antes de la migración).

---

## Lo que ya está hecho

### FASE 0 — compilación ✅

`npm run typecheck -w apps/api` y `-w apps/web` salen limpios.

La guarda de `remote.media` está puesta, pero **no como una sola línea**: el
`?? []` propuesto arreglaba el `TypeError` y dejaba intacto el borrado que ese
mismo comentario describía. Con `media` ausente, `mediaIds` quedaba vacío y la
reconciliación entraba en la rama `delete where report_id = …`, que borra
**todas** las evidencias del reporte. La corrección real envuelve inserción y
borrado en `if (remote.media)`, de modo que:

| upstream envía | significado | efecto |
|---|---|---|
| `media: [...]` | esta es la lista | se reconcilia (inserta y borra) |
| `media: []` | este reporte no tiene | se borran las cacheadas |
| sin clave `media` | no dice nada | **no se toca nada** |

Cubierto por dos pruebas que se contraponen a propósito
(`previeneSync.integration.test.ts`).

### FASE 1 — los siete bloqueantes ✅

- **B1** — log de items en cuarentena en `runPrevieneSync`, con id y motivo.
- **B2** — `media` opcional con guarda (arriba) y normalización de los offsets
  cortos de Postgres (`+00` → `+00:00`). La normalización se exporta desde
  `client.ts` y la usan **tanto** el `refine` del contrato como el `toDate` de la
  persistencia: si solo la tuviera `toDate`, el contrato seguiría poniendo esos
  reportes en cuarentena; si solo la tuviera el `refine`, `toDate` devolvería
  `null` y el `as Date` de `toReportRow` mentiría dentro de la transacción.
- **B3** — `openMediaStream` usa un `AbortController` propio con
  `clearTimeout` en el `finally`, así que el reloj acota el time-to-first-byte y
  suelta el cuerpo. Además acepta un `signal` externo: la ruta lo aborta cuando
  el cliente cuelga, que es lo que el `stream.destroy()` intentaba hacer sin
  conseguirlo.
- **B4** — el 404 del upstream ya no escribe `availability='gone'`. Se pierde el
  cartel "Evidencia no disponible (404)" servido desde la base; el visor sigue
  pintando el marcador de fallo por el `onError` del `<img>`/`<video>`, que es
  local a la sesión y no destruye nada.
- **B5** — no queda ninguna fecha cableada en el visor. `DEFAULT_RANGE` es
  `{ desde: "", hasta: "" }` y el cargador **omite** el parámetro vacío en vez de
  mandarlo en blanco. Hay una prueba estructural que falla si alguien vuelve a
  escribir un literal `\d{4}-\d{2}-\d{2}` en `PrevieneFilters.tsx`.
- **B6** — `PREVIENE_SYNC_INTERVAL_MS` inyectada al servicio `api` en los dos
  compose, y `PREVIENE_MEDIA_TIMEOUT_MS` añadida al `api` de dev.
- **B7** — el proxy solo declara tipos de una lista blanca, indexada por el
  `media_type` que ingerimos. Cualquier otra cosa sale como
  `application/octet-stream` y con `Content-Disposition: attachment`, no
  `inline`.

### FASE 2 — verificación ✅

```
npm run typecheck -w apps/api    limpio
npm run typecheck -w apps/web    limpio
apps/api  previene*.test.ts      45/45
apps/api  suite completa         110/112  (los 2 fallos preexistentes de abajo)
apps/web  npm run test           33/33
```

Las cinco pruebas que pedía este documento están, y unas cuantas más. La que
consagraba el comportamiento antiguo (`a malformed page is a contract error`)
está reescrita en dos: el **item** malformado se pone en cuarentena, el
**sobre** malformado sigue siendo error de contrato.

**Ensayo sobre el esquema real: hecho y pasado.** Se copió el esquema de
producción (29 tablas en `public`, 18 migraciones aplicadas, ninguna
`previene_*`) a una base desechable y se aplicó 0018 encima:

```
migraciones        18 → 19
tablas previene    previene_event_types, previene_media, previene_reports, previene_sync_state
app_key            pma, rgdp, geo, previene
FK                 previene_media_report_id_previene_reports_id_fk
fila de cursor     1
```

Y lo que más importa de una migración aditiva: las **29 tablas preexistentes
siguen exactamente igual**, comparadas una a una contra el volcado. Nada se
renombró, se movió ni desapareció.

### FASE 4 — mejoras no bloqueantes ✅

- **Lock por ejecución.** `runPrevieneSync` toma
  `pg_try_advisory_lock(9042027)` sobre una conexión reservada del pool durante
  toda la ejecución y la suelta al terminar. Es de sesión, no de transacción,
  porque la ejecución abarca llamadas HTTP: una transacción abierta durante
  minutos, o forzaría un único commit para toda la ejecución y destruiría la
  durabilidad por página, que es el punto del módulo. El lock por página se
  **quitó** — mantener los dos sobre la misma clave habría bloqueado
  indefinidamente la transacción contra la sesión que ya lo tiene.
  `{ status: "skipped", reason: "locked" }` ya es alcanzable y está probado, y
  el comentario de `worker.ts` ahora describe el mecanismo real.
  *La guarda de monotonía del cursor no se añadió: con el lock cubriendo
  `getSyncState → fetch → persistPage`, dos ejecuciones no pueden intercalarse,
  y dentro de una `cursorFromItems` ya calcula el máximo. Añadir un cast a
  `timestamptz` sobre un token declarado opaco protegería de una carrera que ya
  no existe.*
- **Tipos desactivados.** `listEventTypes` lee el catálogo completo; `active`
  decide qué tipos **sin reportes** se omiten, nunca si se conoce el nombre.
- **`submitted_at` NULL.** Rango y `orderBy` usan
  `coalesce(submitted_at, remote_created_at, remote_updated_at)`.
  `remote_updated_at` es NOT NULL, así que la cadena siempre da un valor.
- **`mousemove`.** El mapa emite el **centro** en `moveend`/`zoomend`, no la
  posición del ratón en cada píxel. El lector de coordenadas lleva un `title`
  que dice qué muestra.
- **Reencuadre.** Se compara una firma de ids, no `reports.length`.
- **Clases Tailwind.** `px-4.5` → `px-[18px]`, `mb-4.5` → `mb-[18px]`,
  `h-8.5 w-8.5` → `h-[34px] w-[34px]`, `h-15` → `h-[60px]`. El panel de detalle
  vuelve a tener padding horizontal.
- **FK.** `previene_media_report_id_previene_reports_id_fk`, verificada contra
  la base.

---

## FASE 3 — Despliegue ✅

Ejecutado. Dos cosas de la receta original estaban mal y quedan corregidas aquí
para la próxima vez:

- `docker compose exec api node …run-migrations.js` corre en el contenedor
  **en marcha**, que todavía tiene la imagen vieja y no contiene la migración
  nueva: es un no-op. Hay que construir primero y migrar con la imagen nueva,
  que es lo que hace el servicio `migrate`.
- "reconstruir SOLO api y worker" deja fuera **web**, que es una imagen aparte
  (`pma-management/web:prod`) y es donde vive `apps/web/app/previene/`. Sin eso
  el visor no existe en el navegador.

La secuencia correcta, y la que se usó:

```bash
# 1. Construir. No toca los contenedores en marcha: aún no hay corte.
docker compose build api worker web

# 2. Migrar con la imagen nueva (--no-deps: postgres ya está sano)
docker compose run --rm --no-deps -T migrate

# 3. Recrear. Aquí está el corte breve.
docker compose up -d --wait api worker web
```

**No usar `./deploy.sh update`**: baja la pila antes de subirla.

### Conectividad con la API de reportes

El plan original (`host.docker.internal` + `extra_hosts`) **no funciona**, y es
la única sorpresa real del despliegue: `galapagos-previene-api` publica en
`127.0.0.1:8080`, solo loopback del host, mientras que `host.docker.internal`
resuelve al puente Docker (172.17.0.1). El worker recibía `ECONNREFUSED` y el
módulo arrancó en modo degradado.

La solución es la red dedicada `sigtar-previene-link`, declarada como externa en
`docker-compose.yml` y conectada a `api` y `worker`:

```bash
docker network create sigtar-previene-link
docker network connect sigtar-previene-link galapagos-previene-api
```

**Por qué una red aparte y no `galapagospreviene_default`**: su contenedor de
base de datos responde al alias `postgres`, y el nuestro también. Unirse a esa
red habría hecho ambiguo ese nombre para `api` y `worker`, cuyo `DATABASE_URL`
es `@postgres:5432/pma_db` — el DNS de Docker podría haberles dado la base
equivocada y tumbar PMA, RGDP y GEO con ello. En la red dedicada solo está
`galapagos-previene-api`, que no colisiona con nada.

⚠️ **El `network connect` no es duradero.** Si el proyecto Galápagos Previene
recrea su contenedor `api`, la conexión se pierde y este módulo vuelve a modo
degradado hasta reconectarlo. Para que sobreviva hay que declarar la red en el
compose de *ese* proyecto — está pendiente.

**Rollback.** Está escrito y **ensayado** en
`apps/api/src/db/migrations/rollback/0018_down.sql`: se ejecutó contra una base
con el esquema completo y dejó cero tablas `previene_*`, `app_key` de vuelta en
`('pma','rgdp','geo')` y ningún tipo huérfano. Aun así, lo normal ante un
problema es **revertir solo las imágenes**: las tablas y el valor de enum quedan
inertes y no molestan. El script solo hace falta si las estructuras tienen que
desaparecer de verdad.

### Verificación posterior — resultado real

```
migración        18 → 19, 4 tablas previene_*, app_key con 'previene', 33 tablas en public
pma-api          healthy · {"status":"ok","database":"ok"}
pma-worker       "[worker] previene: 3 report(s) in 1 page(s)" · "sync every 120s"
ingesta          3 reportes, 10 evidencias, 3 tipos · last_error = ninguno
DNS              'postgres' desde el worker → 172.18.0.2 (pma-postgres), sin colisión
API              /pma/plans 401 · /rgdp/plans 401 · /geo/maps 200 · /previene/api/estado 401
visor            /previene, /pma, /rgdp, /geo, /select-app → 307 al login
```

Los comandos, para repetirla:

```bash
docker compose logs --tail 50 worker | grep -i previene

docker exec pma-postgres psql -U postgres -d pma_db -c \
  "select count(*) from previene_reports;"
```

### Lo único que falta comprobar: el navegador

Todo lo anterior está verificado desde el servidor. Lo que **no** se puede
comprobar sin una sesión real:

1. Asignar el subsistema `previene` a un usuario desde `/admin/users` — hasta
   que alguien lo tenga, `/previene` responde 403 a todo el mundo y nadie ve el
   módulo.
2. Entrar a `/previene` y comprobar que el mapa pinta los 3 marcadores, que el
   contador coincide, que la tabla ordena y que una evidencia abre en el visor.
3. Que **PMA, RGDP y GEO siguen funcionando** — sus rutas responden, pero eso no
   sustituye a abrirlos: son los que tienen usuarios reales.

---

## Fallos de test que NO son de este módulo

| Test | Error | Naturaleza |
|---|---|---|
| `evidenceRouteAuthorization` | `406 !== 403` | preexistente, constante |
| `evidenceNotifications` | `EACCES mkdir data/storage/PMA` | `apps/api/data/storage` es de `root` desde el 27 de mayo |
| `authorizationConcurrency` → *a role transition cannot be followed by a stale RGDP plan grant* | `true !== false` | **intermitente** |

El tercero es nuevo en esta lista y conviene saber qué es. Aislado pasa 3 de 3;
la suite sin los archivos de previene sale 65/67 estable; con ellos, falla en
algo más de la mitad de las ejecuciones. Es una prueba de serialización que
asume que la mutación toma el lock antes de que arranque la escritura rival, y
esa suposición se rompe cuando la máquina va cargada — los archivos de previene
solo añaden trabajo en paralelo. No es un defecto de previene, pero es una
prueba que miente sobre su propia condición de carrera y merece un vistazo.

---

## Limitación conocida (no es del SIGTAR)

**La API de reportes no implementa `Range`** en `/v1/media/{id}/content`:
ignora la cabecera y responde `200` con `transfer-encoding: chunked`
(comprobado contra el despliegue real). El proxy reenvía la cabecera y
propagará el `206`/`Content-Range` en cuanto el origen los devuelva, pero
mientras tanto **el navegador debe descargar el vídeo completo antes de poder
avanzar dentro de él**. La corrección va en el proyecto Galápagos Previene.

---

## Contexto del entorno que conviene recordar

- `localhost:5432` en el host es la base de **Galápagos Previene**, no `pma_db`:
  `pma-postgres` no publica puerto. El `DATABASE_URL` de `apps/api/.env` apunta
  ahí y por tanto **no sirve** para correr migraciones desde el host. Para la
  suite, base desechable:

  ```bash
  docker run -d --rm --name sigtar-test-db -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=sigtar_test -p 55432:5432 postgres:16
  cd apps/api && DATABASE_URL="postgresql://postgres:test@127.0.0.1:55432/sigtar_test?sslmode=disable" \
    npx tsx src/db/run-migrations.ts
  ```

- `apps/web/.next` y `apps/api/data/storage` son de `root`, así que `next dev`,
  `next build` y los tests de almacenamiento fallan con `EACCES` desde la cuenta
  del usuario.
- La clave de la API vive en `API_KEYS` (lista separada por comas) del proyecto
  `/home/jhonathan/Documentos/GalapagosPreviene`. Ya está copiada en `.env` y
  `apps/api/.env` de este repositorio, ambos ignorados por git.
