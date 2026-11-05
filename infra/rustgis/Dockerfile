# Imagen que sirve RustGIS Web (ya compilado por build.sh) para el Workspace del Geoportal.
# Contexto: el directorio que prepara build.sh, con web/ (la app), nginx.conf (el de la imagen
# oficial de RustGIS) y patches/ (el parche aplicado, servido junto a la app: Apache-2.0 §4).
FROM nginxinc/nginx-unprivileged:1.31.7-alpine-slim@sha256:a8cb0f33d51fa107c96fd2bd3a71aaf564ec131e9d2bdf8700944f0ed8b170d7
ARG RUSTGIS_REF=v0.5.0
ARG RUSTGIS_COMMIT=a5603d1b2906b1c204b6b97c2eb01ac094a20adf
LABEL org.opencontainers.image.title="RustGIS web app (SIGTAR)" \
      org.opencontainers.image.description="RustGIS web app con el parche de integración del Geoportal SIGTAR" \
      org.opencontainers.image.source="https://github.com/opengeos/RustGIS" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${RUSTGIS_REF}-sigtar" \
      org.opencontainers.image.revision="${RUSTGIS_COMMIT}"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web /usr/share/nginx/html
COPY patches /usr/share/nginx/html/sigtar-patches
EXPOSE 8080
HEALTHCHECK --timeout=5s CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
