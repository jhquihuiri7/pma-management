param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('up', 'down', 'rebuild', 'logs', 'migrate', 'restart')]
    [string]$action,

    [string]$service = ''
)

switch($action) {
    'up' {
        Write-Host "🚀 Levantando servicios..." -ForegroundColor Green
        docker-compose up -d
        Write-Host "✅ Servicios levantados" -ForegroundColor Green
        Write-Host ""
        Write-Host "Acceso:" -ForegroundColor Cyan
        Write-Host "  Web HTTPS: https://sigtar.gobiernogalapagos.gob.ec" -ForegroundColor White
        Write-Host "  Web local: http://localhost:8000" -ForegroundColor White
        Write-Host "  API local: http://localhost:3001" -ForegroundColor White
        Write-Host "  Database:  localhost:5432" -ForegroundColor White
    }

    'down' {
        Write-Host "🛑 Deteniendo servicios..." -ForegroundColor Yellow
        docker-compose down
        Write-Host "✅ Servicios detenidos" -ForegroundColor Green
    }

    'rebuild' {
        Write-Host "🔨 Reconstruyendo imágenes..." -ForegroundColor Yellow
        docker-compose build --no-cache
        Write-Host "✅ Imágenes reconstruidas" -ForegroundColor Green
    }

    'logs' {
        if ($service) {
            docker-compose logs -f $service
        } else {
            Write-Host "📋 Mostrando logs (Ctrl+C para salir)" -ForegroundColor Cyan
            docker-compose logs -f
        }
    }

    'migrate' {
        Write-Host "🗄️  Ejecutando migraciones..." -ForegroundColor Yellow
        docker-compose exec api node dist/apps/api/src/db/run-migrations.js
        Write-Host "✅ Migraciones completadas" -ForegroundColor Green
    }

    'restart' {
        if ($service) {
            Write-Host "🔄 Reiniciando $service..." -ForegroundColor Yellow
            docker-compose restart $service
        } else {
            Write-Host "❌ Especifica el servicio: up, down, rebuild, logs, migrate, restart" -ForegroundColor Red
        }
    }
}
