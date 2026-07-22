#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
SERVICE="${2:-}"

usage() {
    echo "Uso: $0 {dev|up|down|update|update-dev|rebuild|rebuild-dev|logs|dev-logs|migrate|restart} [servicio]"
    echo ""
    echo "  dev         Levanta en modo desarrollo (puerto 3000, hot reload)"
    echo "  up          Levanta en modo producción con Nginx HTTPS (puertos 80/443)"
    echo "  down        Detiene todos los servicios"
    echo "  update      Reconstruye e inicia producción con el código actual"
    echo "  update-dev  Reconstruye e inicia desarrollo con el código actual"
    echo "  rebuild     Reconstruye imágenes de producción (sin caché)"
    echo "  rebuild-dev Reconstruye imágenes de desarrollo (sin caché)"
    echo "  logs        Logs de producción"
    echo "  dev-logs    Logs de desarrollo"
    echo "  migrate     Ejecuta migraciones"
    echo "  restart     Reinicia un servicio de producción"
    exit 1
}

case "$ACTION" in
    dev)
        echo "🛑 Bajando producción (si está activa) para evitar conflicto de contenedores/puertos..."
        docker compose down --remove-orphans
        echo "🔧 Levantando servicios en modo desarrollo..."
        docker compose -f docker-compose.dev.yml up -d --wait
        echo "✅ Servicios levantados (desarrollo)"
        echo ""
        echo "Acceso:"
        echo "  Web:      http://localhost:3000  (hot reload activo)"
        echo "  API:      http://localhost:3001  (tsx watch activo)"
        echo "  Database: localhost:5432"
        ;;

    up)
        echo "🛑 Bajando desarrollo (si está activo) para evitar conflicto de contenedores/puertos..."
        docker compose -f docker-compose.dev.yml down --remove-orphans
        echo "🚀 Levantando servicios en modo producción..."
        docker compose up -d --wait
        echo "✅ Servicios levantados (producción)"
        echo ""
        echo "Acceso:"
        echo "  Web HTTPS: https://sigtar.gobiernogalapagos.gob.ec"
        echo "  API y base de datos: sólo red interna de Docker"
        ;;

    down)
        echo "🛑 Deteniendo servicios..."
        docker compose down
        docker compose -f docker-compose.dev.yml down
        echo "✅ Servicios detenidos"
        ;;

    update)
        echo "🛑 Bajando desarrollo (si está activo) para evitar conflicto de contenedores/puertos..."
        docker compose -f docker-compose.dev.yml down --remove-orphans
        if [ -n "$SERVICE" ]; then
            echo "🔄 Actualizando $SERVICE (producción)..."
            docker compose up -d --build --wait "$SERVICE"
        else
            echo "🔄 Actualizando todos los servicios (producción)..."
            docker compose up -d --build --wait
        fi
        echo "✅ Actualización completada"
        ;;

    update-dev)
        echo "🛑 Bajando producción (si está activa) para evitar conflicto de contenedores/puertos..."
        docker compose down --remove-orphans
        if [ -n "$SERVICE" ]; then
            echo "🔄 Actualizando $SERVICE (desarrollo)..."
            docker compose -f docker-compose.dev.yml up -d --build --wait "$SERVICE"
        else
            echo "🔄 Actualizando todos los servicios (desarrollo)..."
            docker compose -f docker-compose.dev.yml up -d --build --wait
        fi
        echo "✅ Actualización completada"
        ;;

    rebuild)
        echo "🔨 Reconstruyendo imágenes de producción..."
        docker compose build --no-cache
        echo "✅ Imágenes reconstruidas"
        ;;

    rebuild-dev)
        echo "🔨 Reconstruyendo imágenes de desarrollo..."
        docker compose -f docker-compose.dev.yml build --no-cache
        echo "✅ Imágenes reconstruidas"
        ;;

    logs)
        if [ -n "$SERVICE" ]; then
            docker compose logs -f "$SERVICE"
        else
            echo "📋 Mostrando logs de producción (Ctrl+C para salir)"
            docker compose logs -f
        fi
        ;;

    dev-logs)
        if [ -n "$SERVICE" ]; then
            docker compose -f docker-compose.dev.yml logs -f "$SERVICE"
        else
            echo "📋 Mostrando logs de desarrollo (Ctrl+C para salir)"
            docker compose -f docker-compose.dev.yml logs -f
        fi
        ;;

    migrate)
        echo "🗄️  Ejecutando migraciones..."
        docker compose up -d --wait postgres
        docker compose run --rm --build --no-deps -T migrate
        echo "✅ Migraciones completadas"
        ;;

    restart)
        if [ -n "$SERVICE" ]; then
            echo "🔄 Reiniciando $SERVICE..."
            docker compose restart "$SERVICE"
        else
            echo "❌ Especifica el servicio a reiniciar: ./deploy.sh restart <servicio>"
            exit 1
        fi
        ;;

    *)
        usage
        ;;
esac
