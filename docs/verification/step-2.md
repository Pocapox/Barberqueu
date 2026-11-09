# Paso 2 — Base de datos y clientes Supabase

## Resultado

Se crearon la migración 001, los tipos Database/Shop/QueueEntry/WhatsAppSession y
los clientes tipados público y administrativo. Se mantuvieron las fuentes
`.Claude.md` y `blueprints/barber-queue/BLUEPRINT.md` sin modificaciones.

Se aplicó el flujo ECC verification-loop y tdd-workflow. No hay repositorio Git
inicializado, por lo que la evidencia se conserva aquí y no en commits.

## TDD y verificaciones ejecutadas

Historia: un cliente puede tener un solo turno activo por barbería, volver a
anotarse después de finalizar/cancelar/no-show y mantener turnos en otras barberías.
El público puede observar la fila sin acceder a teléfonos o credenciales.

1. Pruebas escritas antes de migración/clientes. Primera ejecución: faltaban
   módulos y migración (7 fallos, 19 pruebas SQL sin ejecutar, 32 aprobadas).
2. Se creó el esquema base sin índices únicos. `npm test`: 4 fallos de aserción
   por duplicados aceptados, 54 aprobadas. Esta es la evidencia RED del requisito
   de unicidad, con PostgreSQL ejecutando las inserciones y actualizaciones.
3. Se añadieron los índices parciales de teléfono activo y turno en atención.
4. `npm test -- --coverage`: código 0, 58/58 pruebas aprobadas, sin omisiones.
5. `npm run typecheck`: código 0, sin errores.

| Garantía | Evidencia | Resultado |
|---|---|---|
| Teléfono único por barbería entre waiting/serving | database.test.ts, INSERT y UPDATE | PASS |
| Nueva inscripción después de estados terminales | database.test.ts | PASS |
| Independencia entre barberías | database.test.ts | PASS |
| Un solo serving por barbería | database.test.ts | PASS |
| Formato de teléfono, estados y referencias válidos | database.test.ts | PASS |
| updated_at se actualiza automáticamente | database.test.ts | PASS |
| anon/authenticated no leen teléfonos ni autenticación WA | database.test.ts, SET ROLE | PASS |
| Roles públicos no insertan, borran, truncan ni cambian apertura | database.test.ts, SET ROLE | PASS |
| service_role puede escribir turnos y sesiones | database.test.ts | PASS |
| RLS habilitado en tres tablas; publicación solo de dos | database.test.ts, catálogos PostgreSQL | PASS |
| Clientes lazy/singleton con credencial correcta y sin sesión persistente | supabase.test.ts | PASS |
| Módulo admin rechaza navegador; validación de configuración | supabase.test.ts | PASS |

Cobertura V8: 100% de líneas, ramas, funciones e instrucciones en phone.ts,
supabase-client.ts y supabase-admin.ts. SQL no se mide con V8: se ejecutó mediante
PGlite 0.5.16 (PostgreSQL embebido en memoria, sin mocks SQL).

## Integración para pasos posteriores

- Aplicar `supabase/migrations/001_initial_schema.sql` una sola vez en un proyecto
  Supabase nuevo mediante el sistema de migraciones o SQL Editor. Se ejecuta en
  una transacción y presupone los roles estándar y la publicación supabase_realtime.
  No es una migración de reconciliación para tablas preexistentes.
- Usar `getSupabaseClient()` en UI y `getSupabaseAdmin()` solo en servidor.
  Las variables se validan al crear cada cliente, no durante la importación.
- El módulo administrativo tiene guardia de navegador compatible con el servidor
  Node personalizado. No utiliza el paquete server-only, cuyo entrypoint estándar
  lanza excepciones fuera del loader RSC. Las variables privadas no tienen prefijo
  NEXT_PUBLIC. La protección de importación del admin se prueba en runtime;
  no se afirma que exista una barrera de compilación server-only.
- Consultar la fila pública con `.select(PUBLIC_QUEUE_COLUMNS)`; `.select('*')`
  está prohibido para anon/authenticated porque incluye customer_phone.
- La publicación contiene shops y queue_entries. Las suscripciones Realtime deben
  seleccionar solo columnas públicas. No usar REPLICA IDENTITY FULL: se conserva
  la identidad primaria para no incluir teléfonos en los registros antiguos.
- Los estados terminales mantienen metadatos públicos para entregar transiciones
  Realtime; la UI debe filtrar waiting/serving para la fila visible.
- position es un ordinal creciente, no una posición visual sin huecos. La posición
  visible se calcula sobre los turnos activos ordenados por position.
- El índice único es la garantía final frente a duplicados; el Paso 4 debe validar
  previamente y manejar el código PostgreSQL 23505 al insertar.
- Los tipos reflejan el SQL manualmente. Actualizarlos al añadir funciones de cola.

Referencias consultadas: documentación oficial de Supabase sobre
[inicialización](https://supabase.com/docs/reference/javascript/initializing),
[permisos por columna](https://supabase.com/docs/guides/database/postgres/column-level-security)
y [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## Límites y pendientes

- Supabase real: NO VERIFICADO. No se aplicó ninguna migración remota ni se abrió
  conexión con credenciales. Falta validar REST y entrega por WebSocket Realtime
  usando anon/service_role en el proyecto de destino.
- Las pruebas usan un motor de una sola conexión. Verifican restricciones del
  motor pero no simulan múltiples sesiones PostgreSQL concurrentes.
- Build y lint: no ejecutados; layout y páginas siguen siendo pasos posteriores,
  y todavía no hay configuración de linter.
- Permanecen las 10 vulnerabilidades de dependencias fijadas en el Paso 1. No se
  presenta el proyecto como listo para producción.
- No se implementaron avance de cola ni envío WhatsApp, correspondientes a pasos
  3 y 4. Las pruebas de avance se añadirán antes de implementar esa lógica.
