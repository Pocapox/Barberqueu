# Paso 1 — Configuración y normalización de teléfonos

## Fuentes y alcance

Se leyeron completos `.Claude.md` y `blueprints/barber-queue/BLUEPRINT.md`.
El documento principal tiene un punto inicial en su nombre real; no se modificó.
Se aplicaron las habilidades ECC `verification-loop` y `tdd-workflow`.
El detector ECC seleccionó npm. No hay repositorio Git inicializado ni commits TDD.

Configurados package.json, lockfile, TypeScript estricto, Next.js, PostCSS con
Tailwind 4, estilos base y variables de entorno de ejemplo sin secretos.
Los scripts dev/start apuntan al servidor personalizado del Paso 3; todavía
no son ejecutables hasta implementar ese servidor. La vista y layout se harán
en el Paso 5. No se afirma que la aplicación completa esté construida.

## Compatibilidad

`npm view` confirmó los pines de Next.js, Tailwind, Lucide, Supabase y Baileys.
Next.js admite React 19. Supabase exige Node >=22; el runner Vitest 5.1.0 exige
Node ^22.12.0, ^24.0.0 o >=26.0.0. package.json refleja esta intersección.
Entorno utilizado: Node 26.13.0, npm 11.20.0, Windows.
La caché npm es local al proyecto porque la caché global no era escribible.
No se instalaron actualizaciones globales. npm ls --depth=0 terminó con código 0.

## Evidencia TDD

Historia: como cliente, quiero que mi teléfono local o internacional se convierta
a una representación única de dígitos para identificar mi turno y recibir avisos.

1. Se escribió phone.test.ts antes de phone.ts.
2. La primera ejecución encontró una restricción del sandbox en esbuild; NO se
   contó como RED.
3. `npm test` fuera del sandbox terminó con código 1: `Failed to load url ./phone`.
   RED por implementación ausente; la suite no pudo importar la función y no
   ejecutó casos individuales. No se presenta como fallo de aserción.
4. Se implementó normalizePhone. Se corrigió el caso del límite de 15 dígitos
   para usar prefijo 44: prefijo 1 tiene longitud NANP fija de 11 dígitos.
5. `npm test -- --coverage`: código 0, 32 pruebas aprobadas, 100% de statements,
   branches, functions y lines en src/lib/phone.ts.

| Garantía | Prueba | Resultado |
|---|---|---|
| Números locales RD se convierten a prefijo 1 | phone.test.ts | PASS |
| Separadores, + y 00 se normalizan | phone.test.ts | PASS |
| Prefijo de país explícito configurable | phone.test.ts | PASS |
| Repetir normalización con prefijo predeterminado 1 no duplica el prefijo | phone.test.ts | PASS |
| Letras, extensiones, prefijos y longitudes inválidos se rechazan | phone.test.ts | PASS |

La función valida formato; no verifica que una línea esté asignada o tenga WhatsApp.
Para países diferentes del 1, los números sin +/00 se interpretan como nacionales.

## Verificación continua

- Tipos: PASS (`npm run typecheck`, código 0).
- Pruebas: PASS (32/32, cobertura 100% del normalizador).
- Búsqueda TODO y secretos NEXT_PUBLIC: sin coincidencias.
- Build: no ejecutado en Paso 1; requiere layout/página de pasos posteriores.
- Lint: no configurado ni ejecutado.
- Seguridad de dependencias: FAIL. npm audit reporta 10 vulnerabilidades:
  4 moderadas, 3 altas y 3 críticas. Detalle en ../../dependency-audit.json.
- Aceptación en hosting: no aplica a este paso local.

Los pines de arquitectura se conservaron. Hay hallazgos críticos asociados a
Next.js, Baileys y protobufjs. Baileys 6.7.3 permite suplantación de mensajes;
el aviso GHSA-qvv5-jq5g-4cgg identifica 6.7.22 como versión corregida de la rama 6.
Actualizar estos pines debe quedar reflejado en la arquitectura antes de producción.
Vitest, elegido como herramienta adicional de pruebas, se actualizó a 5.1.0 para
eliminar los hallazgos de su versión inicial. No se ejecutó npm audit fix --force.

La unicidad transaccional y el avance de cola se probarán al implementar los pasos
2 y 4; estas garantías no están implementadas ni cubiertas por este informe.
