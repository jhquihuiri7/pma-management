#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
SERVICE="${2:-}"

usage() {
    echo "Uso: $0 {up|down|rebuild|logs|migrate|restart} [servicio]"
    exit 1
}

case "$ACTION" in
    up)
        echo "🚀 Levantando servicios..."
        docker-compose up -d
        echo "✅ Servicios levantados"
        echo ""
        echo "Acceso:"
        echo "  Web:      http://localhost:3000"
        echo "  API:      http://localhost:3001"
        echo "  Database: localhost:5432"
        ;;

    down)
        echo "🛑 Deteniendo servicios..."
        docker-compose down
        echo "✅ Servicios detenidos"
        ;;

    rebuild)
        echo "🔨 Reconstruyendo imágenes..."
        docker-compose build --no-cache
        echo "✅ Imágenes reconstruidas"
        ;;

    logs)
        if [ -n "$SERVICE" ]; then
            docker-compose logs -f "$SERVICE"
        else
            echo "📋 Mostrando logs (Ctrl+C para salir)"
            docker-compose logs -f
        fi
        ;;

    migrate)
        echo "🗄️  Ejecutando migraciones..."
        docker-compose exec api npm run db:migrate
        echo "✅ Migraciones completadas"
        ;;

    restart)
        if [ -n "$SERVICE" ]; then
            echo "🔄 Reiniciando $SERVICE..."
            docker-compose restart "$SERVICE"
        else
            echo "❌ Especifica el servicio a reiniciar: ./deploy.sh restart <servicio>"
            exit 1
        fi
        ;;

    *)
        usage
        ;;
esac
