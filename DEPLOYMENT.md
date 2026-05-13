# Deployment con Docker Compose

## Requisitos
- Docker
- Docker Compose

## Configuración

1. **Copia el archivo de variables de entorno:**
```bash
cp .env.example .env
```

2. **Edita `.env` con tus valores reales:**
```bash
nano .env
```

## Levantar los servicios

### Desarrollo
```bash
docker-compose up -d
```

### Ver logs
```bash
# Todos los servicios
docker-compose logs -f

# Un servicio específico
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f postgres
```

## Acceso

- **Web:** http://localhost:3000
- **API:** http://localhost:3001
- **PostgreSQL:** localhost:5432

## Comandos útiles

```bash
# Detener servicios
docker-compose down

# Eliminar datos (volumen)
docker-compose down -v

# Reconstruir imágenes
docker-compose build --no-cache

# Ejecutar migraciones de BD
docker-compose exec api npm run db:migrate

# Reiniciar un servicio
docker-compose restart api
```

## En producción

Cambia en `docker-compose.yml`:
- Puertos: usa variables de entorno o expone solo en IP específica
- Volúmenes: usa almacenamiento persistente (AWS EBS, DigitalOcean Volumes, etc)
- Secrets: usa Docker Secrets o AWS Secrets Manager
- Networking: configura Nginx como reverse proxy

Ejemplo para Nginx reverse proxy:
```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - web
      - api
```
