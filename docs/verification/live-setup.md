# Configuración de pruebas en Supabase

Proyecto Supabase `riqqqztscucmcpiqezhe`, configurado el 9 de noviembre de 2026.
Las claves y el PIN se guardaron únicamente en `.env.local` (ignorado por Git),
sin copiarlos a este informe. `PORT` quedó en 3001 porque 3000 estaba ocupado.

Diagnóstico inicial en el proyecto remoto: tablas `shops`, `queue_entries` y
`whatsapp_sessions` existentes con RLS, cinco funciones de cola, índices parciales
y cero turnos. Faltaban las políticas públicas y permisos del rol service_role.
Se aplicó `003_repair_api_access.sql` en el SQL Editor tras aprobación explícita.
La ejecución terminó con `Success. No rows returned`.

Comprobación REST con claves reales guardadas, sin imprimirlas:

| Solicitud | Resultado |
|---|---|
| service_role lee shops | 200 |
| anon lee shops | 200 |
| anon lee metadatos de queue_entries | 200 |
| anon intenta leer customer_phone | 401 (denegado) |
| service_role lee whatsapp_sessions | 200 |

La aplicación arrancó en `http://localhost:3001`. `/`, `/admin`, `/api/health`,
`/api/queue/status` y `/api/whatsapp/status` respondieron 200. El endpoint de
WhatsApp confirmó `status=qr` y QR DataURL presente. Nadie ha escaneado el QR
durante esta verificación: conexión emparejada y envío real aún no verificados.

Baileys 6.7.3 y luego 6.7.22 con la versión Web empaquetada devolvían error de
handshake 405 sin QR. Baileys 6.7.22 con `fetchLatestWaWebVersion()` produjo el
evento QR. `npm run typecheck`, 85 pruebas y `npm run build` terminaron con código 0
después del cambio. El build también se hizo con `.env.local` cargado.

La aplicación queda lista para que el usuario escanee el QR y registre sus
primeros turnos de prueba con números bajo su control. No se crearon turnos ni se
enviaron mensajes de prueba a números ajenos.
