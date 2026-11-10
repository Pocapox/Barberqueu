import { createServer } from "node:http";
import next from "next";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT inválido.");
const app = next({ dev, hostname: "0.0.0.0", port });
await app.prepare();
const { restoreWhatsAppSessions, stopWhatsApp } = await import("./src/lib/whatsapp-client");
const { startWhatsAppOutbox, stopWhatsAppOutbox } = await import("./src/lib/whatsapp-outbox");
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  void handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end("Error interno"); });
});
server.listen(port, "0.0.0.0", () => {
  console.info(`BarberQueue disponible en http://localhost:${port}`);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) { startWhatsAppOutbox(); void restoreWhatsAppSessions().catch(() => console.error("No se pudieron restaurar las sesiones de WhatsApp.")); }
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10000); timeout.unref();
  server.close();
  await stopWhatsAppOutbox();
  await stopWhatsApp();
  await app.close();
  clearTimeout(timeout);
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
