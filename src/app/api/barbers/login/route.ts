import { z } from "zod";
import { issueBarberToken, verifyBarberPin } from "@/lib/barber-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ApiError, body, handleError, json, limit } from "../../_shared";

export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1).max(80), pin: z.string().regex(/^\d{6,12}$/) });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await body(request));
    const nameKey = input.name.toLowerCase();
    limit(`barber-login:${nameKey}`, 8, 60000);
    const { data, error } = await getSupabaseAdmin().from("barber_accounts")
      .select("shop_id,name,pin_hash").eq("name_key", nameKey).maybeSingle();
    if (error) throw error;
    if (!data || !(await verifyBarberPin(input.pin, data.pin_hash))) throw new ApiError(401, "Nombre o PIN incorrecto.");
    return json({ shopId: data.shop_id, name: data.name, token: issueBarberToken(data.shop_id, data.pin_hash) });
  } catch (error) { return handleError(error); }
}
