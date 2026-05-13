# Gestión de Usuarios - PMA Management

Este documento describe cómo crear y gestionar usuarios en PMA-Management.

## Arquitectura de Usuarios

El sistema tiene una jerarquía de dos niveles:

```
Administrador (Admin)
    ├── Usuario ADMIN (puede crear otros usuarios)
    ├── Usuario REPORTER (puede reportar y crear evidencias)
    └── Usuario VIEWER (solo lectura)
```

## Flujo de Creación de Usuarios

### 1. Primer Administrador (Bootstrap)

Ejecuta este comando UNA SOLA VEZ para crear el primer administrador del sistema:

```bash
npm run seed:admin
```

**Proceso interactivo:**
```
Correo electrónico del administrador: jhonatanquihuiri@gmail.com
Nombre del administrador: Jhonatan Quihuiri
Contraseña: [ingresa tu contraseña]
```

**Resultado:**
- ✓ Se crea un registro en tabla `admins`
- ✓ Se crea un usuario con rol `ADMIN`
- ✓ Se asignan todas las apps (pma, rgdp, pglp, geo)
- ✓ La contraseña se hashea y guarda inmediatamente
- ✓ Puedes iniciar sesión en la plataforma

### 2. Usuarios Adicionales desde CLI

Para crear más usuarios usando la línea de comandos:

```bash
npm run create:user
```

**Proceso interactivo:**
```
Email del administrador propietario: jhonatanquihuiri@gmail.com
Email del nuevo usuario: usuario@empresa.com
Nombre del usuario: Juan Pérez
Rol (ADMIN/REPORTER/VIEWER) [REPORTER]: REPORTER
Apps (pma,rgdp,pglp,geo) [pma,rgdp]: pma,rgdp
```

**Resultado:**
- ✓ Se crea un nuevo usuario SIN contraseña
- ✓ El usuario debe recibir un email para establecer su contraseña
- ✓ Se asignan las apps especificadas

### 3. Usuarios desde el Sistema Web (Recomendado)

Una vez que el administrador inicia sesión:

1. **Navegar a Usuarios** en el dashboard
2. **Hacer clic en "Crear Usuario"**
3. **Completar el formulario:**
   - Email
   - Nombre
   - Rol (ADMIN, REPORTER, VIEWER)
   - Apps asignadas
4. **Enviar invitación**

El nuevo usuario recibe un email con un enlace para establecer su contraseña.

## Roles y Permisos

### ADMIN
- ✓ Crear y gestionar usuarios
- ✓ Acceder a todos los módulos
- ✓ Ver reportes completos
- ✓ Editar configuraciones

### REPORTER
- ✓ Crear evidencias
- ✓ Reportar hallazgos
- ✓ Ver datos del proyecto
- ✗ No puede crear usuarios
- ✗ No puede acceder a reportes completos

### VIEWER
- ✓ Ver datos en lectura
- ✗ No puede crear o editar
- ✗ No puede crear usuarios

## Aplicaciones Disponibles

Cada usuario puede tener acceso a una o más aplicaciones:

- **PMA** - Plan de Manejo Ambiental
- **RGDP** - Registro de Generación de Residuos Peligrosos
- **PGLP** - Plan de Gestión de Residuos Peligrosos
- **GEO** - Sistema de Información Geográfica

## Configuración de Contraseñas

### Primera Vez
- El administrador establece una contraseña al ejecutar `seed:admin`
- Los usuarios nuevos reciben un email con enlace de configuración

### Recuperación de Contraseña
1. Ir a "Olvidé mi contraseña" en la página de login
2. Ingresar el email
3. Recibir email con enlace de reseteo
4. Establecer nueva contraseña (válido por 1 hora)

## Procedimiento Recomendado de Setup

### Para desarrollo local:

```bash
# 1. Ejecutar migraciones
npm run db:migrate

# 2. Crear administrador
npm run seed:admin

# 3. Iniciar el servidor
npm run dev
```

### Para producción (CI/CD):

```bash
# 1. Ejecutar migraciones
npm run db:migrate

# 2. Crear administrador con variables de entorno
ADMIN_EMAIL="admin@empresa.com" \
ADMIN_NAME="Administrador" \
ADMIN_PASSWORD="contraseña-segura" \
npm run seed:admin:env

# 3. Crear usuarios adicionales (optional)
npm run create:user
```

## Administración de Usuarios Existentes

### Listar usuarios
Desde la interfaz web:
1. Dashboard → Usuarios
2. Ver tabla con todos los usuarios

### Modificar usuario
1. Dashboard → Usuarios
2. Hacer clic en el usuario
3. Editar: nombre, rol, apps asignadas
4. Guardar cambios

### Desactivar/Eliminar usuario
1. Dashboard → Usuarios
2. Hacer clic en el menú de opciones
3. Seleccionar "Desactivar" o "Eliminar"

## Troubleshooting

### Error: "DATABASE_URL is not configured"
```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/pma_db"
```

### Error: "El usuario con este correo ya existe"
- Usa otro email
- O resetea la contraseña del usuario existente

### El usuario no recibe email
- Verificar configuración SMTP en `.env`
- Revisar logs del servidor: `MAIL_DEBUG=true npm run dev`
- Verificar que el email es correcto

### Olvidé la contraseña del administrador
Si no puedes acceder:
1. Conectarse a la base de datos directamente
2. Eliminar el usuario de la tabla `users`
3. Ejecutar `npm run seed:admin` nuevamente

## Variables de Entorno Necesarias

```env
# Base de datos
DATABASE_URL=postgresql://user:password@localhost:5432/pma_db

# Email (para confirmación de usuarios)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=tu-email@gmail.com
MAIL_PASS=tu-password
MAIL_FROM=noreply@pma-management.com

# Frontend
FRONTEND_ORIGIN=http://localhost:3000

# JWT
JWT_SECRET=tu-secret-aleatorio-muy-largo-aqui

# Cookies
COOKIE_DOMAIN=localhost
```

## APIs de Creación de Usuarios

### Endpoint: POST /api/users (Admin)

Crear usuario desde código:

```bash
curl -X POST http://localhost:3000/api/pma/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "email": "user@empresa.com",
    "name": "Nuevo Usuario",
    "role": "REPORTER",
    "apps": ["pma", "rgdp"]
  }'
```

### Respuesta
```json
{
  "id": "uuid-del-usuario",
  "email": "user@empresa.com",
  "name": "Nuevo Usuario",
  "role": "REPORTER",
  "apps": ["pma", "rgdp"],
  "emailSent": true
}
```

## Seguridad

- ✓ Las contraseñas se hashean con bcrypt (12 rounds)
- ✓ Los tokens JWT tienen expiración
- ✓ Las sesiones se pueden revocar
- ✓ Cada usuario tiene acceso solo a sus apps asignadas
- ✓ Los emails con enlaces de reseteo expiran en 1 hora
