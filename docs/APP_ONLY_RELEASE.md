# BarberQueue: aplicación sin WhatsApp automático

La decisión del propietario del 11 de noviembre de 2026 sustituye la arquitectura anterior de WhatsApp. Los archivos de migraciones 001–010 se conservan únicamente como historial reproducible; la 011 retira las sesiones y la bandeja de WhatsApp y crea las suscripciones y avisos web privados.

## Copia anterior

`backups/pre-app-only-20261111/` contiene el código del commit 006a1b4, los cambios locales existentes, las dependencias iniciales, una instantánea privada de las tablas y la configuración anterior. Está excluido de Git. No compartir: incluye teléfonos, credenciales y PIN cifrados/hash o secretos del servidor.

Para recuperar el código anterior, extraer el ZIP en otra carpeta y aplicar el parche guardado si se necesitan los cambios locales. La base no se revierte desplegando solo el commit: reconstruir el esquema anterior en un proyecto de recuperación y restaurar la instantánea privada de forma controlada. No sobreescribir los turnos creados después de la copia. Las antiguas sesiones de WhatsApp podrían requerir vincularse de nuevo.

## Avisos

El botón de activación suscribe el dispositivo con permiso explícito. Las suscripciones del cliente requieren el token privado de su turno; las del barbero requieren su sesión. Solo se aceptan servicios push conocidos, evitando destinos arbitrarios. Las claves VAPID privadas permanecen en el servidor.

Los cambios de fila generan trabajos dentro de la transacción SQL. El servidor los procesa cada cinco segundos, con exclusión entre trabajadores, reintentos limitados y caducidad de cinco minutos. Se descartan avisos de turnos cancelados o terminados. La aceptación por el proveedor no demuestra que el teléfono haya mostrado el aviso. iOS requiere instalar la aplicación en la pantalla de inicio (16.4 o posterior).

Las suscripciones de clientes caducan a las 24 horas y las de barberos a las 12 horas; se renuevan al abrir la pantalla. Cambiar el PIN o eliminar un barbero revoca sus suscripciones. Salir del panel elimina la suscripción de esa fila en ese dispositivo.

## Prueba de aceptación en teléfonos reales

1. Compartir la fila desde el panel, descargar la guía y comprobar que la aplicación elegida recibe imagen y enlace; usar los botones separados si no admite ambos.
2. Instalar desde Chrome en Android y desde Safari en iPhone. Abrir desde el icono antes de tomar turno y activar avisos.
3. Tomar tres turnos de prueba con teléfonos distintos en una fila de pruebas. Recargar y comprobar que cada cliente conserva su turno y el barbero su sesión.
4. Bloquear el teléfono del cliente y avanzar desde otro dispositivo. Confirmar los avisos de próximos y de sillón; comprobar el estado al abrir el aviso.
5. Cancelar tanto en espera como en el sillón. Intentar un segundo avance con un estado antiguo y comprobar que no salta dos clientes.
6. Cortar internet y recuperarlo; comprobar el aviso de desconexión y la fila actualizada.

Render gratuito todavía puede suspender el servidor. La eliminación de WhatsApp evita tener que reconectar sus sockets; no elimina la demora de arranque ni las restricciones de batería, conexión o permisos del teléfono.

Referencias: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://support.google.com/chrome/answer/9658361 ; https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26
