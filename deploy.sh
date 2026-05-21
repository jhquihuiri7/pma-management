#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
SERVICE="${2:-}"

usage() {
    echo "Uso: $0 {dev|up|down|rebuild|rebuild-dev|logs|dev-logs|migrate|restart} [servicio]"
    echo ""
    echo "  dev         Levanta en modo desarrollo (puerto 3000, hot reload)"
    echo "  up          Levanta en modo producción  (puerto 8000)"
    echo "  down        Detiene todos los servicios"
    echo "  rebuild     Reconstruye imágenes de producción"
    echo "  rebuild-dev Reconstruye imágenes de desarrollo"
    echo "  logs        Logs de producción"
    echo "  dev-logs    Logs de desarrollo"
    echo "  migrate     Ejecuta migraciones"
    echo "  restart     Reinicia un servicio de producción"
    exit 1
}

case "$ACTION" in
    dev)
        echo "🔧 Levantando servicios en modo desarrollo..."
        docker compose -f docker-compose.dev.yml up -d
        echo "✅ Servicios levantados (desarrollo)"
        echo ""
        echo "Acceso:"
        echo "  Web:      http://localhost:3000  (hot reload activo)"
        echo "  API:      http://localhost:3001  (tsx watch activo)"
        echo "  Database: localhost:5432"
        ;;

    up)
        echo "🚀 Levantando servicios en modo producción..."
        docker compose up -d
        echo "✅ Servicios levantados (producción)"
        echo ""
        echo "Acceso:"
        echo "  Web:      http://localhost:8000"
        echo "  API:      http://localhost:3001"
        echo "  Database: localhost:5432"
        ;;

    down)
        echo "🛑 Deteniendo servicios..."
        docker compose down
        docker compose -f docker-compose.dev.yml down
        echo "✅ Servicios detenidos"
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
        docker compose exec api npm run db:migrate --workspace=@pma/api
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
