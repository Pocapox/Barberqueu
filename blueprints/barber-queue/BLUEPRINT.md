# BLUEPRINT — BarberQueue

## Estructura de Archivos Esperada
barber-queue/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── server.ts
├── .env.example
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
└── src/
    ├── types/
    │   └── database.ts
    ├── lib/
    │   ├── supabase-client.ts
    │   ├── supabase-admin.ts
    │   ├── phone.ts
    │   ├── whatsapp-auth.ts
    │   └── whatsapp-client.ts
    └── app/
        ├── layout.tsx
        ├── globals.css
        ├── page.tsx
        ├── admin/
        │   └── page.tsx
        └── api/
            ├── health/
            │   └── route.ts
            ├── queue/
            │   join/route.ts
            │   advance/route.ts
            │   status/route.ts
            └── whatsapp/
                status/route.ts

## Pasos de Ejecución para Codex
1. **Paso 1:** Configurar dependencias exactas en `package.json`, TypeScript, Tailwind CSS y `src/lib/phone.ts`.
2. **Paso 2:** Crear la migración SQL `supabase/migrations/001_initial_schema.sql` (tablas `shops`, `queue_entries`, `whatsapp_sessions` con Realtime activado) y los clientes de Supabase.
3. **Paso 3:** Implementar el motor Baileys en `src/lib/whatsapp-auth.ts` (persistencia obligatoria en Supabase DB) y `src/lib/whatsapp-client.ts`, junto con `server.ts` y el endpoint `/api/health`.
4. **Paso 4:** Implementar los Route Handlers de la cola en `src/app/api/queue/` (`/join`, `/advance`, `/status`) respetando la lógica de notificar al #1 (sillón) y #2 (pre-aviso).
5. **Paso 5:** Construir la Vista Pública en `src/app/page.tsx` con Supabase Realtime y almacenamiento local del turno propio.
6. **Paso 6:** Construir el Panel del Barbero en `src/app/admin/page.tsx` con protección por PIN, visor QR de WhatsApp en vivo y botón 1-Tap.