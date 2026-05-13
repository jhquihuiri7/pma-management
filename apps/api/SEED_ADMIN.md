# Creación del Usuario Administrador

Este documento describe cómo crear un usuario administrador en PMA-Management.

## Opciones de Inicialización

### Opción 1: Interactivo (Recomendado para desarrollo local)

```bash
npm run seed:admin
```

Este script te pedirá:
- **Correo electrónico**: Tu email (ej: jhonatanquihuiri@gmail.com)
- **Nombre**: Tu nombre completo
- **Contraseña**: Una contraseña de mínimo 8 caracteres

**Ejemplo:**
```
=== Crear Usuario Administrador ===

Correo electrónico del administrador: jhonatanquihuiri@gmail.com
Nombre del administrador: Jhonatan Quihuiri
Contraseña: ••••••••

✓ Admin creado: 550e8400-e29b-41d4-a716-446655440000
✓ Usuario creado: 550e8400-e29b-41d4-a716-446655440001
✓ Apps asignadas: pma, rgdp, pglp, geo

✅ Administrador creado exitosamente

Datos de acceso:
  Correo: jhonatanquihuiri@gmail.com
  Rol: ADMIN
  Apps: pma, rgdp, pglp, geo
```

### Opción 2: Variables de Entorno (Recomendado para CI/CD)

```bash
ADMIN_EMAIL=jhonatanquihuiri@gmail.com \
ADMIN_NAME="Jhonatan Quihuiri" \
ADMIN_PASSWORD="mi-contraseña-segura" \
npm run seed:admin:env
```

O en Windows PowerShell:
```powershell
$env:ADMIN_EMAIL="jhonatanquihuiri@gmail.com"
$env:ADMIN_NAME="Jhonatan Quihuiri"
$env:ADMIN_PASSWORD="mi-contraseña-segura"
npm run seed:admin:env
```

## Requisitos Previos

1. **Base de datos configurada**: La variable de entorno `DATABASE_URL` debe estar configurada
2. **Migraciones ejecutadas**: Las migraciones de base de datos deben estar aplicadas

```bash
npm run db:migrate
```

## Características del Administrador Creado

- **Rol**: ADMIN
- **Acceso a todas las aplicaciones**: PMA, RGDP, PGLP, GEO
- **Contraseña**: Hasheada con bcrypt (12 rounds)
- **Estado**: Contraseña establecida (puede iniciar sesión inmediatamente)

## Validaciones

El script valida:
- ✓ Email debe ser válido
- ✓ Nombre no puede estar vacío
- ✓ Contraseña debe tener mínimo 8 caracteres
- ✓ El usuario no debe existir previamente

## Errores Comunes

### "DATABASE_URL is not configured"
Asegúrate de que la variable de entorno `DATABASE_URL` está configurada:
```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/pma_db"
```

### "El usuario con este correo ya existe"
El email ya está registrado en el sistema. Usa otro email o usa el comando de reseteo de contraseña.

### "La contraseña debe tener al menos 8 caracteres"
Ingresa una contraseña más larga (mínimo 8 caracteres).

## Reseteo de Contraseña

Si necesitas cambiar la contraseña del administrador:
1. Accede a la plataforma
2. Ve a "Olvidé mi contraseña" en la página de login
3. Recibe el enlace de reseteo en tu email
4. Establece una nueva contraseña

## Múltiples Administradores

Cada administrador puede crear otros usuarios en el sistema. El rol y las aplicaciones asignadas determinan qué pueden hacer.

Para crear otro administrador, ejecuta nuevamente el script con un email diferente.
