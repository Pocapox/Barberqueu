import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { defaultShopId, sendWhatsApp } from "@/lib/whatsapp-client";
import { ApiError, body, handleError, json, limit } from "../../_shared";
export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1, "Escribe tu nombre.").max(80), phone: z.string().max(40), shopId: z.guid().optional() });
export async function POST(request: Request) {
  try {
    const input = schema.parse(await body(request));
    let phone: string;
    try { phone = normalizePhone(input.phone, process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? "1"); }
    catch { throw new ApiError(400, "Introduce un teléfono válido con código de país."); }
    limit(`join:${phone}`, 5);
    const token = randomBytes(32).toString("hex");
    const shopId = input.shopId ?? defaultShopId();
    const db = getSupabaseAdmin();
    const shop = await db.from("shops").select("barber_name").eq("id", shopId).single();
    if (shop.error) throw shop.error;
    const { data, error } = await db.rpc("join_queue", {
      p_shop: shopId, p_name: input.name, p_phone: phone,
      p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    if (error) throw error;
    const delivered = await sendWhatsApp(phone, `${input.name}, ya estás en la fila de ${shop.data.barber_name}. Te avisaremos cuando se acerque tu turno. Responde CANCELAR si no asistirás.`);
    return json({ id: data.id, token, shopId, whatsappDelivered: delivered }, 201);
  } catch (error) { return handleError(error); }
}
