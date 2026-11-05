#!/usr/bin/env bash
# Compila RustGIS Web (versión fijada + patches/) y crea la imagen pma-management/rustgis:<tag>.
#
#   infra/rustgis/build.sh            # etiqueta prod
#   infra/rustgis/build.sh dev        # etiqueta dev (dev y prod llevan imágenes distintas)
#
# Por qué un contenedor con límites: el perfil `web` de RustGIS enlaza con LTO completo y el
# 2026-11-04 agotó los 11 GB del servidor, donde corre producción. Aquí la compilación tiene un
# tope de memoria (sin swap) y de CPU: si no le alcanza, muere el contenedor de compilación, no
# los servicios. Además se usa LTO «thin» (WebAssembly algo mayor, compilación mucho más ligera).
# El paso más exigente es wasm-bindgen sobre el módulo de ~63 MB (pico medido: 3,1 GB), de ahí
# el tope de 4500m. Un vigilante detiene además la compilación si la memoria disponible del
# servidor baja de RUSTGIS_BUILD_MIN_AVAILABLE_MB, aunque el contenedor no haya llegado a su tope.
#
# Variables: RUSTGIS_BUILD_DIR (trabajo; por defecto infra/rustgis/.build), RUSTGIS_BUILD_MEMORY
# (4500m), RUSTGIS_BUILD_CPUS (2), RUSTGIS_BUILD_MIN_AVAILABLE_MB (1200),
# RUSTGIS_EMBED_ASSISTANT_PATH, RUSTGIS_EMBED_ASSISTANT_MODEL.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tag="${1:-prod}"
ref="${RUSTGIS_REF:-v0.5.0}"
commit="${RUSTGIS_COMMIT:-a5603d1b2906b1c204b6b97c2eb01ac094a20adf}"
work="${RUSTGIS_BUILD_DIR:-$here/.build}"
memory="${RUSTGIS_BUILD_MEMORY:-4500m}"
cpus="${RUSTGIS_BUILD_CPUS:-2}"
min_available="${RUSTGIS_BUILD_MIN_AVAILABLE_MB:-1200}"
assistant_path="${RUSTGIS_EMBED_ASSISTANT_PATH:-/api-proxy/geo/workspace/ai/v1}"
assistant_model="${RUSTGIS_EMBED_ASSISTANT_MODEL:-sigtar-asistente}"

mkdir -p "$work"

echo "==> Fuente RustGIS $ref ($commit)"
if [ ! -d "$work/src/.git" ]; then
  git clone --depth 1 --branch "$ref" https://github.com/opengeos/RustGIS "$work/src"
fi
git -C "$work/src" fetch --depth 1 origin "refs/tags/$ref:refs/tags/$ref" 2>/dev/null || true
git -C "$work/src" checkout --force --detach "$commit"
git -C "$work/src" reset --hard "$commit"
git -C "$work/src" clean -fdx -e dist
test "$(git -C "$work/src" rev-parse HEAD)" = "$commit"

echo "==> Parches"
for patch in "$here"/patches/*.patch; do
  git -C "$work/src" apply --check "$patch"
  git -C "$work/src" apply "$patch"
  echo "    $(basename "$patch")"
done

echo "==> Entorno de compilación"
docker build -q -t sigtar-rustgis-builder:1 -f "$here/Dockerfile.builder" "$here" >/dev/null

echo "==> Compilación (memoria $memory sin swap, $cpus CPU; se detiene si el servidor baja de ${min_available} MB disponibles)"
rm -rf "$work/src/dist" 2>/dev/null || docker run --rm -v "$work/src":/src alpine:3.20 rm -rf /src/dist
build_name="sigtar-rustgis-build-$$"
watchdog() {
  while sleep 2; do
    avail="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)"
    if [ "$avail" -lt "$min_available" ]; then
      echo "!!  El servidor tiene ${avail} MB disponibles (< ${min_available} MB): se detiene la compilación" >&2
      docker kill "$build_name" >/dev/null 2>&1 || true
      return
    fi
  done
}
watchdog &
watchdog_pid=$!
trap 'kill "$watchdog_pid" 2>/dev/null || true' EXIT
# BINARYEN_CORES / RAYON_NUM_THREADS: wasm-opt y wasm-bindgen abren un hilo por CPU del servidor
# (--cpus solo limita el tiempo de CPU) y cada hilo suma memoria.
docker run --rm --name "$build_name" \
  --memory "$memory" --memory-swap "$memory" --cpus "$cpus" \
  -e CARGO_BUILD_JOBS=2 \
  -e BINARYEN_CORES=2 \
  -e RAYON_NUM_THREADS=2 \
  -e CARGO_PROFILE_WEB_LTO=thin \
  -e CARGO_PROFILE_WEB_CODEGEN_UNITS=16 \
  -e RUSTGIS_EMBED_ASSISTANT_PATH="$assistant_path" \
  -e RUSTGIS_EMBED_ASSISTANT_MODEL="$assistant_model" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$work/src":/src \
  -v sigtar-rustgis-cargo:/usr/local/cargo/registry \
  -v sigtar-rustgis-target:/src/target \
  -v sigtar-rustgis-trunk:/root/.cache/trunk \
  sigtar-rustgis-builder:1 \
  bash -c 'set -e
    cd /src/apps/rustgis-web && trunk build --release --locked --public-url ./
    cd /src && cargo xtask web-pwa dist/web
    chown -R "$HOST_UID:$HOST_GID" /src/dist'
kill "$watchdog_pid" 2>/dev/null || true

echo "==> Imagen pma-management/rustgis:$tag"
rm -rf "$work/image"
mkdir -p "$work/image"
cp -a "$work/src/dist/web" "$work/image/web"
cp "$work/src/packaging/docker/nginx.conf" "$work/image/nginx.conf"
cp -a "$here/patches" "$work/image/patches"
docker build -t "pma-management/rustgis:$tag" \
  --build-arg RUSTGIS_REF="$ref" --build-arg RUSTGIS_COMMIT="$commit" \
  -f "$here/Dockerfile" "$work/image"
echo "==> Lista: pma-management/rustgis:$tag"
