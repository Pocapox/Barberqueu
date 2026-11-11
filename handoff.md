# BarberQueue — Documento de Handoff

> **Última actualización:** 11 de Noviembre de 2026  
> **Estado del proyecto:** En producción y operativo  
> **Rama principal:** `master` en [GitHub Pocapox/Barberqueu](https://github.com/Pocapox/Barberqueu)  
> **Despliegue activo:** [barberqueu.onrender.com](https://barberqueu.onrender.com/)  
> **Tests:** 134/134 pruebas aprobadas (`npm test`)

---

## 1. Resumen del Proyecto

**BarberQueue** es una plataforma de gestión de turnos y filas virtuales en tiempo real para barberías. Permite a los clientes tomar turno y seguir la fila desde su teléfono (web o PWA instalada) recibiendo notificaciones tanto por WhatsApp como por la propia aplicación web. A los barberos les permite gestionar su fila, llamar turnos con "1-Tap", configurar tiempos de corte y recibir alertas sonoras y visuales cuando un cliente se anota o cancela.

---

## 2. Puntos Clave de la Arquitectura

### Frontend & PWA
* **Framework:** Next.js 16 (App Router) + React 19 + TypeScript.
* **Estilos:** Tailwind CSS v4 + estilos personalizados en [`src/app/globals.css`](./src/app/globals.css).
* **Sincronización en vivo:** Supabase Realtime (`postgres_changes` en `queue_entries` y `shops`) a través del hook [`useQueue`](./src/lib/use-queue.ts).
* **PWA Instalable:** Manifiesto web en [`src/app/manifest.ts`](./src/app/manifest.ts), soporte offline en [`public/offline.html`](./public/offline.html) y Service Worker en [`public/sw.js`](./public/sw.js).
* **Notificaciones de la App:** Módulo [`src/lib/notifications.ts`](./src/lib/notifications.ts) con solicitud de permisos del navegador, síntesis de audio nativa con Web Audio API (chime/alerta) y vibración sin dependencias externas. Al pulsar la notificación, el Service Worker enfoca la app.

### Backend & API
* **Base de datos:** Supabase PostgreSQL con RLS y migraciones en [`supabase/migrations/`](./supabase/migrations/).
* **WhatsApp Engine (Baileys):** Conexión vía WebSocket con Baileys ([`src/lib/whatsapp-client.ts`](./src/lib/whatsapp-client.ts)).
  * **Sin almacenamiento efímero local:** Credenciales serializadas y guardadas en la tabla `whatsapp_sessions` de Supabase.
  * **Multi-barbero:** Cada barbero vincula su propio WhatsApp con un socket independiente.
  * **Comando CANCELAR:** Procesamiento bidireccional de cancelaciones por mensaje de texto.
  * **Outbox Durable:** Cola de mensajes en base de datos para reintentar avisos si WhatsApp se desconecta temporalmente.
* **Autenticación del Barbero:** Cookies HTTP-Only de 12 horas ([`src/app/api/barbers/session/route.ts`](./src/app/api/barbers/session/route.ts)) con PIN hasheado en base de datos.
* **Keep-Alive:** Endpoint [`/api/health`](./src/app/api/health/route.ts) monitoreado mediante cron-job.org para evitar que la instancia gratuita de Render se duerma.

---

## 3. Registro de Cambios Recientes

### `b21bd11` — Notificaciones nativas en la app y permisos (11-Nov-2026)
* **Permisos:** Solicitud de permisos en la vista pública (cliente) y panel de control (barbero).
* **Alertas del Cliente:** Aviso sonoro y en pantalla cuando pasa al sillón (`serving`), cuando es el próximo (`notified_upcoming`) y cuando la fila avanza.
* **Alertas del Barbero:** Alerta sonora y notificación cuando un nuevo cliente se suma a la fila o cuando alguien cancela.
* **Service Worker:** Enfoque automático de la ventana al hacer clic en la notificación.
* **Tests:** Cobertura de pruebas agregada en [`src/lib/notifications.test.ts`](./src/lib/notifications.test.ts).

### `0dd525e` — Web App Instalable (PWA) (10-Nov-2026)
* Configuración de manifiesto con display standalone y orientación vertical.
* Pantalla de contingencia offline y cacheo de Service Worker.
* Íconos PWA de 192x192 y 512x512 adaptados para Android e iOS.

### `1d7712d` — Persistencia de sesión de barberos (10-Nov-2026)
* Implementación de sesión mediante cookies cifradas/firmadas que duran 12 horas.
* Evita el cierre de sesión al recargar la pestaña o abrirla nuevamente.

### `4d5d7d4` — Recibos de entrega de WhatsApp y outbox duradero (10-Nov-2026)
* Confirmación real de entrega de Baileys (`delivery receipts`) antes de marcar un mensaje como enviado.
* Reintentos automáticos tras reconexiones.

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
* `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`: Código de país por defecto (ej. `1` para República Dominicana / USA).
* `ADMIN_PIN`: PIN maestro del dueño de la barbería.
* `PORT`: Puerto del servidor (ej. `3001` local / asignado por Render en producción).

---

## 6. Siguientes Pasos Sugeridos / Backlog
1. **Web Push con VAPID (opcional):** Si se desea recibir notificaciones incluso con el navegador y la PWA totalmente cerrados en segundo plano profundo.
2. **Personalización del perfil del barbero:** Permitir subir foto de perfil o logo de la barbería.
3. **Métricas de atención:** Estadísticas de cortes diarios, tiempo promedio real por corte y horas pico en el panel del administrador.
