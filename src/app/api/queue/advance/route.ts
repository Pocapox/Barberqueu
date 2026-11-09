import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendWhatsApp } from "@/lib/whatsapp-client";
import { body, handleError, json, requireManager } from "../../_shared";
export const runtime = "nodejs";
const schema = z.object({ servingId: z.guid().nullable(), waitingId: z.guid().nullable(), finish: z.enum(["completed", "no_show"]).default("completed") });
export async function POST(request: Request) {
  try {
    const { shopId } = await requireManager(request);
    const input = schema.parse(await body(request));
    const db = getSupabaseAdmin();
    const shop = await db.from("shops").select("barber_name").eq("id", shopId).single();
    if (shop.error) throw shop.error;
    const barberName = shop.data.barber_name;
    const { data, error } = await db.rpc("advance_queue", { p_shop: shopId, p_expected_serving: input.servingId, p_expected_waiting: input.waitingId, p_finish: input.finish });
    if (error) throw error;
    const warnings: string[] = [];
    if (data.serving) {
      const sent = await sendWhatsApp(data.serving.customer_phone, `${data.serving.customer_name}, ¡ya es tu turno con ${barberName}! Pasa al sillón.`);
      if (!sent) warnings.push(`No se pudo avisar a ${data.serving.customer_name} por WhatsApp.`);
      else {
        const result = await db.from("queue_entries").update({ notified_turn: true }).eq("id", data.serving.id);
        if (result.error) warnings.push("Aviso enviado, pero no se pudo registrar su entrega.");
      }
    }
    const waiting = await db.from("queue_entries")
      .select("id,customer_name,customer_phone,notified_upcoming")
      .eq("shop_id", shopId).eq("status", "waiting").order("position");
    if (waiting.error) warnings.push("La fila avanzó, pero no se pudo consultar a los clientes para enviar los avisos.");
    else if (input.finish === "completed" && input.servingId) {
      for (const [index, entry] of (waiting.data ?? []).entries()) {
        const ahead = index + (data.serving ? 1 : 0);
        const text = `${entry.customer_name}, la fila de ${barberName} avanzó. ${ahead === 1 ? "Falta 1 persona" : `Faltan ${ahead} personas`} antes de ti.${index < 2 ? " Casi es tu turno; ve acercándote a la barbería." : ""} Responde CANCELAR si no asistirás.`;
        const sent = await sendWhatsApp(entry.customer_phone, text);
        if (!sent) warnings.push(`No se pudo avisar a ${entry.customer_name} por WhatsApp.`);
        else if (index < 2 && !entry.notified_upcoming) {
          const result = await db.from("queue_entries").update({ notified_upcoming: true }).eq("id", entry.id);
          if (result.error) warnings.push("Aviso enviado, pero no se pudo registrar su entrega.");
        }
      }
    } else {
      for (const entry of (waiting.data ?? []).slice(0, 2)) {
        if (entry.notified_upcoming) continue;
        const sent = await sendWhatsApp(entry.customer_phone, `${entry.customer_name}, casi es tu turno con ${barberName}. Ve acercándote a la barbería. Responde CANCELAR si no asistirás.`);
        if (!sent) warnings.push(`No se pudo avisar a ${entry.customer_name} por WhatsApp.`);
        else {
          const result = await db.from("queue_entries").update({ notified_upcoming: true }).eq("id", entry.id);
          if (result.error) warnings.push("Aviso enviado, pero no se pudo registrar su entrega.");
        }
      }
    }
    return json({ ok: true, warnings });
  } catch (error) { return handleError(error); }
}
