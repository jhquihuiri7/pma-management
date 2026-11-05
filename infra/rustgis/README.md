# RustGIS Web para el Workspace del Geoportal

Imagen `pma-management/rustgis:<tag>`: la versión fijada de [RustGIS](https://github.com/opengeos/RustGIS)
(`v0.5.0`, commit `a5603d1`) con un parche propio, servida por nginx en el puerto 8080. El nginx
del geoportal la publica en `https://<dominio>/geo/workspace/app/` y la página `/geo/workspace`
la embebe con `?embed` (ver `docs/plan-integracion-rustgis.md`).

## Qué cambia el parche (`patches/0001-sigtar-embed.patch`)

Solo `apps/rustgis-web/src/{embed,web}.rs`, en modo `?embed`:

1. **Asistente preconfigurado.** Arranca con el proveedor «OpenAI-compatible», la dirección
   `<origen de la página>/api-proxy/geo/workspace/ai/v1` y el modelo `sigtar-asistente`
   (`RUSTGIS_EMBED_ASSISTANT_PATH` y `RUSTGIS_EMBED_ASSISTANT_MODEL` al compilar). La clave del
   proveedor vive solo en el servidor; el proxy traduce el alias al modelo real
   (`WORKSPACE_AI_MODEL`), así que cambiar de modelo no exige recompilar. La dirección no se
   puede fijar desde la página que enmarca la app.
2. **Capa activa en el proyecto.** El proyecto que RustGIS envía a la página lleva la capa activa
   (o la capa de teselas seleccionada) en `maps[active_map].sigtar_active`, un cambio de capa
   activa también se envía, y al recibir un proyecto con ese campo la capa vuelve a quedar activa.
   Las versiones sin parche ignoran el campo.
3. **Acuse al abrir un proyecto.** `{"rustgis":"project","id":…,"text":…}` recibe
   `{"rustgis":"result","id":…,"ok":…}`, así la página sabe si el proyecto abrió.

Los archivos modificados llevan comentarios «SIGTAR» y el parche se sirve junto a la app en
`/geo/workspace/app/sigtar-patches/` (Apache-2.0 §4). `LICENSE` y `THIRD-PARTY-LICENSES.txt` de
RustGIS se sirven tal cual.

## Compilar

```bash
infra/rustgis/build.sh          # pma-management/rustgis:prod
infra/rustgis/build.sh dev      # pma-management/rustgis:dev (dev y prod con etiquetas distintas)
```

**No usar `docker build` con `Dockerfile.ci` en el servidor de producción.** El perfil `web` de
RustGIS enlaza con LTO completo y el 2026-11-04 agotó los 11 GB del servidor (la API de Galápagos
Previene falló sus comprobaciones de salud durante unos minutos). `build.sh` compila dentro de un
contenedor con tope de memoria **sin swap** (`RUSTGIS_BUILD_MEMORY`, 4500m por defecto) y de CPU
(`RUSTGIS_BUILD_CPUS`, 2), con LTO «thin»: si no le alcanza, muere el contenedor de compilación,
no los servicios. Un vigilante detiene también la compilación si la memoria disponible del
servidor baja de `RUSTGIS_BUILD_MIN_AVAILABLE_MB` (1200). El paso más exigente es `wasm-bindgen`
sobre el módulo de ~63 MB: pico medido de 3,1 GB (con 3g murió). Las cachés de cargo y del
directorio `target` quedan en volúmenes Docker (`sigtar-rustgis-*`), así que una recompilación
tras cambiar el parche es mucho más rápida: solo se recompila `rustgis-web`.

`Dockerfile.ci` es la compilación completa original (LTO completo, WebAssembly más pequeño) para
una máquina con ≥ 16 GB de RAM.

## Actualizar RustGIS

1. Cambiar `RUSTGIS_REF`/`RUSTGIS_COMMIT` en `build.sh`, `Dockerfile` y `Dockerfile.ci`.
2. Regenerar el parche sobre la nueva versión (o comprobar que `git apply --check` pasa) y revisar
   que `embed.rs` siga aceptando `ui.addUrl`/`ui.openUrl` desde la página.
3. Revisar `apps/api/src/modules/geo/rustgisProject.ts` contra el formato de proyecto nuevo.
4. Repetir las pruebas de `docs/plan-integracion-rustgis.md` §8.1 antes de desplegar.
