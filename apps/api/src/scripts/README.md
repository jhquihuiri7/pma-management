# Scripts de Administración - PMA Management API

Esta carpeta contiene scripts de utilidad para administrar la aplicación.

## Scripts Disponibles

### 1. `seed-admin.ts` - Crear Administrador Interactivo

**Comando:**
```bash
npm run seed:admin
```

**Uso:**
- Crea el primer administrador del sistema
- Solicita email, nombre y contraseña interactivamente
- Asigna automáticamente acceso a todas las aplicaciones (pma, rgdp, pglp, geo)

**Ejemplo:**
```
npm run seed:admin
=== Crear Usuario Administrador ===

Correo electrónico del administrador: jhonatanquihuiri@gmail.com
Nombre del administrador: Jhonatan Quihuiri
Contraseña: ••••••••••

✓ Admin creado: 550e8400-e29b-41d4-a716-446655440000
✓ Usuario creado: 550e8400-e29b-41d4-a716-446655440001
✓ Apps asignadas: pma, rgdp, pglp, geo

✅ Administrador creado exitosamente
```

### 2. `seed-admin-env.ts` - Crear Administrador con Variables de Entorno

**Comando:**
```bash
ADMIN_EMAIL="correo@empresa.com" \
ADMIN_NAME="Tu Nombre" \
ADMIN_PASSWORD="contraseña" \
npm run seed:admin:env
```

**Uso:**
- Crea el administrador sin interacción
- Ideal para CI/CD y deploy automático
- Lee credenciales de variables de entorno

**Ejemplo:**
```bash
export ADMIN_EMAIL="jhonatanquihuiri@gmail.com"
export ADMIN_NAME="Jhonatan Quihuiri"
export ADMIN_PASSWORD="mi-contraseña-segura"
npm run seed:admin:env
```

### 3. `create-user.ts` - Crear Usuario Adicional

**Comando:**
```bash
npm run create:user
```

**Uso:**
- Crea usuarios adicionales en el sistema
- Configurable: rol y apps asignadas
- El usuario recibe email para configurar su contraseña

**Ejemplo:**
```
npm run create:user
=== Crear Nuevo Usuario ===

Email del administrador propietario: jhonatanquihuiri@gmail.com
Email del nuevo usuario: juan@empresa.com
Nombre del usuario: Juan Pérez
Rol (ADMIN/REPORTER/VIEWER) [REPORTER]: REPORTER
Apps (pma,rgdp,pglp,geo) [pma,rgdp]: pma,rgdp

✓ Usuario creado: 550e8400-e29b-41d4-a716-446655440002
✓ Apps asignadas: pma, rgdp

✅ Usuario creado exitosamente

Datos del nuevo usuario:
  Correo: juan@empresa.com
  Nombre: Juan Pérez
  Rol: REPORTER
  Apps: pma, rgdp

⚠️  El usuario debe recibir un email para establecer su contraseña
```

## Flujo de Setup Recomendado

### 1. Ambiente Local

```bash
# Navega a la carpeta api
cd apps/api

# Ejecuta las migraciones
npm run db:migrate

# Crea el administrador
npm run seed:admin

# Inicia el servidor
npm run dev
```

### 2. Deploy Automático (CI/CD)

```bash
# En tu pipeline de GitHub Actions o similar:
- name: Run migrations
  run: npm run db:migrate

- name: Create admin user
  env:
    ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
    ADMIN_NAME: ${{ secrets.ADMIN_NAME }}
    ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
  run: npm run seed:admin:env

- name: Start server
  run: npm run start
```

## Validaciones

Los scripts validan:

✓ Email válido  
✓ Nombre no vacío  
✓ Contraseña ≥ 8 caracteres  
✓ Usuario no duplicado  
✓ Admin existe (para crear usuarios)  
✓ Rol válido (ADMIN, REPORTER, VIEWER)  
✓ Apps válidas (pma, rgdp, pglp, geo)  

## Requisitos Previos

1. **Base de datos PostgreSQL** configurada
2. **Variable de entorno DATABASE_URL** establecida
3. **Migraciones ejecutadas** (npm run db:migrate)
4. **Node.js** y npm instalados

## Variables de Entorno Requeridas

```env
# Conexión a base de datos
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/pma_db

# Para seed:admin:env
ADMIN_EMAIL=correo@empresa.com
ADMIN_NAME=Tu Nombre Completo
ADMIN_PASSWORD=contraseña-segura
```

## Errores Comunes y Soluciones

| Error | Solución |
|-------|----------|
| "DATABASE_URL is not configured" | Configura la variable de entorno DATABASE_URL |
| "El usuario con este correo ya existe" | Usa otro email o resetea la contraseña del existente |
| "La contraseña debe tener al menos 8 caracteres" | Usa una contraseña más larga |
| "No existe un administrador con ese email" | Primero crea un administrador con seed:admin |

## Documentación Adicional

- [USER_MANAGEMENT.md](../USER_MANAGEMENT.md) - Gestión completa de usuarios
- [SEED_ADMIN.md](../SEED_ADMIN.md) - Detalles de creación del administrador
