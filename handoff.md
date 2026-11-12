# BarberQueue — Documento de Handoff

> **Última actualización:** 11 de Noviembre de 2026  
> **Estado del proyecto:** En producción y operativo (Migrado a App-Only / Web Push)  
> **Rama principal:** `master` en [GitHub Pocapox/Barberqueu](https://github.com/Pocapox/Barberqueu)  
> **Despliegue activo:** [barberqueu.onrender.com](https://barberqueu.onrender.com/)  
> **Tests:** 126/126 pruebas aprobadas (`npm test`)

---

## 1. Resumen del Proyecto

**BarberQueue** es una plataforma de gestión de turnos y filas virtuales en tiempo real para barberías. Permite a los clientes tomar turno y seguir la fila desde su teléfono (web o PWA instalada) recibiendo notificaciones en vivo y Web Push directo en su dispositivo. A los barberos les permite gestionar su fila, llamar turnos con "1-Tap", configurar tiempos de corte y compartir su enlace junto con guías visuales de instalación para Android e iOS.

---

## 2. Puntos Clave de la Arquitectura

### Frontend & PWA
* **Framework:** Next.js 16 (App Router) + React 19 + TypeScript.
* **Estilos:** Tailwind CSS v4 + estilos personalizados en [`src/app/globals.css`](./src/app/globals.css).
* **Sincronización en vivo:** Supabase Realtime (`postgres_changes` en `queue_entries` y `shops`) a través del hook [`useQueue`](./src/lib/use-queue.ts).
* **PWA Instalable:** Manifiesto web en [`src/app/manifest.ts`](./src/app/manifest.ts), soporte offline en [`public/offline.html`](./public/offline.html) y Service Worker en [`public/sw.js`](./public/sw.js).
* **Notificaciones Web Push:** Suscripción del dispositivo con claves VAPID mediante [`src/app/push-control.tsx`](./src/app/push-control.tsx) y [`src/lib/push-client.ts`](./src/lib/push-client.ts). Los clientes reciben avisos al aproximarse su turno y al ser llamados al sillón; los barberos reciben alertas cuando un cliente se une o cancela.
* **Guía de Instalación:** Componente [`src/app/install-guide.tsx`](./src/app/install-guide.tsx) y generación dinámica de tarjetas gráficas en [`/api/install-card`](./src/app/api/install-card/route.ts) para facilitar que los clientes instalen la app en Android y iPhone.

### Backend & API
* **Base de datos:** Supabase PostgreSQL con RLS y migraciones en [`supabase/migrations/`](./supabase/migrations/).
* **Web Push Worker:** En [`src/lib/push-worker.ts`](./src/lib/push-worker.ts) se procesan los trabajos encolados (`push_jobs`) cada 5 segundos con reintentos y caducidad automática de avisos obsoletos.
* **Desacople total de WhatsApp:** Se eliminó la automatización y dependencias de Baileys por inestabilidad de conexiones en hosting efímero. La comunicación ahora se realiza 100% a través de la aplicación instalable y notificaciones del sistema operativo.
* **Autenticación del Barbero:** Cookies HTTP-Only de 12 horas ([`src/app/api/barbers/session/route.ts`](./src/app/api/barbers/session/route.ts)) con PIN hasheado en base de datos.
* **Copia de seguridad:** Todo el código y datos previos a la eliminación de WhatsApp están archivados de forma privada en `backups/pre-app-only-20261111/`.

---

## 3. Registro de Cambios Recientes

### `APP-ONLY RELEASE` — Desacople de WhatsApp y Notificaciones Web Push (11-Nov-2026)
* **Eliminación de WhatsApp:** Se retiraron Baileys, qrcode, pino y endpoints `/api/whatsapp/*`.
* **Notificaciones Push VAPID:** Suscripción nativa de dispositivos y worker de entregas en segundo plano (`push_jobs` y `push_subscriptions`).
* **Tarjetas e Instrucciones de Instalación:** Compartir enlace con imagen explicativa para instalar la PWA en Android y iPhone.
* **Cancelación en el sillón:** El cliente puede cancelar su turno directamente desde la app en cualquier momento.
* **Migración SQL 011:** Preparada en [`supabase/migrations/011_app_notifications.sql`](./supabase/migrations/011_app_notifications.sql) para retirar tablas de WhatsApp y habilitar colas de Web Push.
* **Respaldo previo:** Instantánea de seguridad generada en `backups/pre-app-only-20261111/`.

### `b21bd11` — Notificaciones nativas en la app y permisos (11-Nov-2026)
* Solicitud de permisos en la vista pública (cliente) y panel de control (barbero).
* Alertas sonoras y visuales locales en el dispositivo.

### `0dd525e` — Web App Instalable (PWA) (10-Nov-2026)
* Manifiesto standalone, pantalla offline e íconos para Android e iOS.

---

## 4. Comandos de Verificación y Desarrollo

```bash
# Ejecutar suite de pruebas unitarias
npm test

# Verificación de tipos TypeScript
npm run typecheck

# Compilación de producción
npm run build

# Servidor de desarrollo local
npm run dev
```

---

## 5. Variables de Entorno Requeridas

* `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto Supabase.
* `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Llave anónima pública de Supabase.
* `SUPABASE_SERVICE_ROLE_KEY`: Llave privada con permisos administrativos (solo servidor).
* `NEXT_PUBLIC_DEFAULT_SHOP_ID`: UUID de la barbería/fila por defecto (`00000000-0000-0000-0000-000000000001`).
* `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`: Código de país por defecto (ej. `1`).
* `ADMIN_PIN`: PIN maestro del dueño de la barbería.
* `VAPID_PUBLIC_KEY`: Clave pública VAPID para suscripción de notificaciones Web Push.
* `VAPID_PRIVATE_KEY`: Clave privada VAPID para firma de notificaciones desde el servidor.
* `VAPID_SUBJECT`: Identificador / URL base para VAPID (`https://barberqueu.onrender.com`).
* `PORT`: Puerto del servidor (`3001` local / asignado por Render en producción).

---

## 6. Siguientes Pasos
1. **Aplicar migración 011 en Supabase:** Ejecutar [`supabase/migrations/011_app_notifications.sql`](./supabase/migrations/011_app_notifications.sql) en el SQL Editor del panel de Supabase.
2. **Pruebas en dispositivos reales:** Probar instalación y recepción de notificaciones en Android (Chrome) e iPhone (Safari -> Compartir -> Añadir a pantalla de inicio).
