# Entorno de compilación de RustGIS Web (Rust + wasm32 + clang + Trunk), igual al del
# Dockerfile oficial de v0.5.0. Solo instala herramientas: la compilación la lanza build.sh
# dentro de un contenedor con límites de memoria y CPU.
FROM rust:1.99.1-slim@sha256:1a939748a7cbab172de91a014e3804a97af1394a8c844faa67fce9401c4e40fb
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates clang curl \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
RUN case "$(uname -m)" in \
      x86_64) arch=x86_64; sum=f2b4680cd239693a646a2795e4633c625328d7b2a044fbe749fa3a2fe9e7036b ;; \
      aarch64) arch=aarch64; sum=b1d8e60e454f7fc182d9a4d95d1506ffbae947d8ba90f8f6f02da93b60f980f9 ;; \
      *) echo "no Trunk release for $(uname -m)" >&2; exit 1 ;; \
    esac \
    && curl -sSfL -o /tmp/trunk.tar.gz "https://github.com/trunk-rs/trunk/releases/download/v0.21.14/trunk-${arch}-unknown-linux-gnu.tar.gz" \
    && echo "${sum}  /tmp/trunk.tar.gz" > /tmp/trunk.sha256 \
    && sha256sum -c /tmp/trunk.sha256 \
    && tar xzf /tmp/trunk.tar.gz -C /usr/local/bin trunk \
    && rm /tmp/trunk.tar.gz /tmp/trunk.sha256
WORKDIR /src
