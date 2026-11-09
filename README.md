# BarberQueue

Fila virtual para una barbería: Next.js App Router, Supabase Realtime y WhatsApp
mediante Baileys. Incluye vista pública y panel `/admin` protegido por PIN en sus
operaciones y en el acceso al QR.

## Ejecutar

1. Usa Node.js 26 (también se admiten las versiones especificadas en package.json).
2. Ejecuta `npm ci`.
3. Copia `.env.example` a `.env.local` y completa las variables:
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública anon del proyecto.
   - `SUPABASE_SERVICE_ROLE_KEY`: clave privada, exclusivamente en el servidor.
   - `ADMIN_PIN`: PIN largo y aleatorio; no uses el ejemplo 1234.
   - `NEXT_PUBLIC_DEFAULT_SHOP_ID`: UUID de la barbería. La migración crea el valor
     predeterminado indicado en `.env.example`.
   - `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`: 1 para RD/NANP. Para números internacionales
     el cliente debe introducir `+` o `00` con su código de país.
4. Aplica en Supabase, en orden, `supabase/migrations/001_initial_schema.sql`,
   `supabase/migrations/002_queue_operations.sql` y
   `supabase/migrations/003_repair_api_access.sql`. Si ya aplicaste 001 y 002,
   aplica únicamente 003. Las dos primeras migraciones requieren un proyecto nuevo;
   no las vuelvas a aplicar sobre tablas ya creadas. La tercera repara permisos y
   políticas ausentes y se puede repetir.
5. Ejecuta `npm run dev` y abre `http://localhost:3000`.
6. En `/admin`, introduce tu PIN y escanea el QR desde Dispositivos vinculados en
   WhatsApp. La aplicación guarda credenciales y llaves en `whatsapp_sessions`.

No hay datos ficticios ni credenciales incluidas. Sin configuración de Supabase,
la interfaz muestra un error recuperable y deshabilita las operaciones.

## Producción

### Publicar en Render

1. Crea un repositorio **privado** en GitHub y sube este proyecto. No subas
   `.env.local`: contiene claves privadas y está excluido por `.gitignore`.
2. En Render, elige **New > Blueprint**, conecta ese repositorio y selecciona
   `render.yaml`. El archivo configura un único servicio Node, compilación y
   `/api/health` como comprobación de salud.
3. Render pedirá las variables de `render.yaml`. Copia sus valores desde tu
   `.env.local` a los campos privados del panel de Render. Mantén
   `SUPABASE_SERVICE_ROLE_KEY` y `ADMIN_PIN` fuera del repositorio. Usa el mismo
   proyecto Supabase para conservar barberos, filas y sesión de WhatsApp.
4. Al terminar el despliegue, abre la URL `https://...onrender.com` que entregue
   Render. Comprueba `/api/health`, entra en `/admin`, verifica WhatsApp y prueba
   una inscripción y una cancelación. El botón para compartir usa esa URL pública
   automáticamente.

El Blueprint empieza con el plan gratuito para una prueba. Render puede suspender
el servicio después de 15 minutos sin tráfico; durante la suspensión no se reciben
mensajes de WhatsApp. Para atender clientes de manera continua, cambia el servicio
a un plan que no se suspenda. Mantén **una sola instancia** para evitar sockets
duplicados de WhatsApp.

```text
npm ci
npm run typecheck
npm test -- --coverage
npm run build
npm run start
```

El servidor personalizado `server.ts` debe permanecer ejecutándose como servicio
Node: no usar exportación estática, `next start` ni funciones serverless para alojar
el socket. Desplegar una sola réplica por barbería/sesión WhatsApp. `globalThis`
comparte el socket en un proceso, no entre varias réplicas.

En un servicio Node de Render, configura el build como `npm ci && npm run build`,
el inicio como `npm run start`, las variables de entorno y el health check
`/api/health`. El proceso escucha en `0.0.0.0` y respeta `PORT`.
Puedes configurar un servicio externo de monitorización para consultar
`https://tu-dominio/api/health`. El endpoint no programa peticiones por sí mismo ni
garantiza evitar las políticas de suspensión del proveedor. No se ha creado
ningún cron externo automáticamente.

Usa HTTPS en el despliegue. El PIN se envía en `x-admin-pin`, permanece en memoria
del navegador y se elimina al cerrar sesión o recargar. El turno propio y su token
de cancelación se guardan en localStorage según los requisitos de la vista pública.

## Comportamiento de la fila

- Un teléfono normalizado solo puede tener un turno waiting/serving por barbería.
- Todas las operaciones de cola toman un bloqueo de la barbería en PostgreSQL.
- Avanzar completa el turno actual, pasa el primero a serving y deja el segundo
  en waiting. Se envía aviso de sillón al primero y pre-aviso al segundo.
- El avance incluye los IDs que el barbero estaba viendo. Si la fila cambió,
  responde 409 en lugar de avanzar dos turnos por una pulsación repetida.
- Las banderas notified_turn/notified_upcoming se guardan al enviar correctamente.
- Si WhatsApp falla, la operación de fila permanece confirmada y el barbero ve la
  advertencia para avisar manualmente. No hay outbox durable ni reenvío automático
  de mensajes pendientes tras reiniciar el proceso.
- No-Show del turno actual avanza la fila. No-Show de un cliente esperando solo
  retira ese turno. Cancelar desde web requiere su token privado; CANCELAR por
  WhatsApp solo retira turnos waiting del número remitente.
- Abrir/cerrar controla nuevas inscripciones; se puede seguir atendiendo la fila
  existente cuando está cerrada.
- Realtime refresca shops y queue_entries. Hay recuperación al volver a la pestaña
  y consultas cada 15 segundos como respaldo. El panel consulta el QR cada 3 segundos.

## Seguridad y verificación

El acceso público a queue_entries tiene permisos por columna: teléfonos y hashes
de cancelación no son seleccionables. El cliente debe usar PUBLIC_QUEUE_COLUMNS,
nunca `select('*')`. Las sesiones WA no tienen políticas públicas ni publicación
Realtime. Las escrituras pasan por API/funciones SQL con service_role.

Los límites de solicitudes son en memoria y se reinician con el proceso. Los
intentos fallidos de PIN comparten un límite para esta instancia. Las funciones
SQL no están habilitadas para anon/authenticated.

Para permitir el emparejamiento se cambió Baileys del pin 6.7.3 del documento de
arquitectura a 6.7.22: la versión anterior devolvía 405 antes de generar el QR.
El socket consulta la versión vigente de WhatsApp Web antes de conectar. Esta
actualización también corrige el aviso de suplantación de mensajes conocido en
6.7.3. `npm audit` todavía reporta dependencias vulnerables; consulta
`dependency-audit.json` antes de publicar el servicio.

Las pruebas usan PostgreSQL embebido para el SQL y dobles controlados para
Supabase/WhatsApp. No sustituyen una prueba real de REST, Realtime y emparejamiento
en el proyecto Supabase del despliegue.
