import { getSupabaseAdmin } from "./supabase-admin";
import { sendWhatsApp, whatsappStatus } from "./whatsapp-client";

let timer: ReturnType<typeof setInterval> | undefined;
let draining: Promise<number> | undefined;

export function drainWhatsAppOutbox(): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    if (whatsappStatus().status !== "connected") return 0;
    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("claim_whatsapp_outbox", { p_limit: 10 });
    if (error) throw error;
    let sentCount = 0;
    for (const item of data ?? []) {
      const sent = await sendWhatsApp(item.phone, item.body);
      const result = await db.rpc("finish_whatsapp_outbox", { p_id: item.id, p_success: sent });
      if (result.error) throw result.error;
      if (sent) sentCount++;
    }
    return sentCount;
  })().finally(() => { draining = undefined; });
  return draining;
}

export function startWhatsAppOutbox() {
  if (timer) return;
  timer = setInterval(() => { void drainWhatsAppOutbox().catch(() => console.error("No se pudieron procesar avisos de WhatsApp.")); }, 5000);
  timer.unref();
  void drainWhatsAppOutbox().catch(() => console.error("No se pudieron procesar avisos de WhatsApp."));
}

export async function stopWhatsAppOutbox() {
  if (timer) clearInterval(timer);
  timer = undefined;
  await draining;
}
