import { getSupabaseAdmin } from "./supabase-admin";
import { sendWhatsApp, whatsappStatus, connectedWhatsAppShops } from "./whatsapp-client";
import { flushWhatsAppReceipts } from "./whatsapp-delivery";

let timer: ReturnType<typeof setInterval> | undefined;
let draining: Promise<number> | undefined;
const nextSend = new Map<string, number>();

export function drainWhatsAppOutbox(): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    const db = getSupabaseAdmin();
    await flushWhatsAppReceipts();
    let sentCount = 0;
    for (let index = 0; index < 10; index++) {
      const shops = connectedWhatsAppShops().filter(id => (nextSend.get(id) ?? 0) <= Date.now());
      if (!shops.length) break;
      const { data, error } = await db.rpc("claim_whatsapp_deliveries", { p_shops: shops, p_limit: 1 });
      if (error) throw error;
      const item = data?.[0];
      if (!item?.message_id) break;
      const { data: fresh, error: freshError } = await db.from("whatsapp_outbox").select("status,message_id").eq("id", item.id).single();
      if (freshError) throw freshError;
      if (fresh.status !== "sending" || fresh.message_id !== item.message_id) continue;
      nextSend.set(item.shop_id, Date.now() + 5000);
      const customer = await db.from('queue_entries').select('whatsapp_consent,status').eq('id',item.entry_id).single();
      if(customer.error) throw customer.error;
      if(!customer.data.whatsapp_consent || !['waiting','serving'].includes(customer.data.status)) {
        const discarded=await db.from('whatsapp_outbox').update({status:'superseded',leased_until:null}).eq('id',item.id);
        if(discarded.error) throw discarded.error;
        continue;
      }
      const sent = whatsappStatus(item.shop_id).status === "connected" && await sendWhatsApp(item.shop_id, item.phone, item.body, item.message_id);
      const result = await db.rpc("finish_whatsapp_attempt", { p_id: item.id, p_message_id: item.message_id, p_success: sent });
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
