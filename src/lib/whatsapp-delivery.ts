import { getSupabaseAdmin } from "./supabase-admin";

declare global {
  var __waReceipts: Map<string, { shopId: string; messageId: string }> | undefined;
  var __waReceiptFlush: Promise<void> | undefined;
}
const pending = () => globalThis.__waReceipts ??= new Map();

export function recordWhatsAppDelivery(shopId: string, messageId: string) {
  pending().set(`${shopId}:${messageId}`, { shopId, messageId });
  void flushWhatsAppReceipts().catch(() => console.warn("Confirmación de WhatsApp pendiente de guardar."));
}

export function flushWhatsAppReceipts(): Promise<void> {
  if (globalThis.__waReceiptFlush) return globalThis.__waReceiptFlush;
  globalThis.__waReceiptFlush = (async () => {
    for (const [key, receipt] of pending()) {
      const { error } = await getSupabaseAdmin().rpc("confirm_whatsapp_delivery", {
        p_shop: receipt.shopId, p_message_id: receipt.messageId,
      });
      if (error) throw error;
      pending().delete(key);
    }
  })().finally(() => { globalThis.__waReceiptFlush = undefined; });
  return globalThis.__waReceiptFlush;
}
