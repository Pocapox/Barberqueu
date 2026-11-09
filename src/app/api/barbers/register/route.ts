import { z } from "zod";
import { barberPinFingerprint, hashBarberPin, ownerPinMatches } from "@/lib/barber-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ApiError, body, handleError, json, limit, requireAdmin } from "../../_shared";

export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1).max(80), pin: z.string().regex(/^\d{6,12}$/, "El PIN debe tener entre 6 y 12 dígitos.") });

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const input = schema.parse(await body(request));
    limit("register-barber", 10, 60000);
    if (ownerPinMatches(input.pin)) throw new ApiError(409, "El PIN del barbero debe ser distinto del PIN administrador.");
    const { data, error } = await getSupabaseAdmin().rpc("create_barber_shop", {
      p_parent_shop: process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001",
      p_name: input.name,
      p_pin_hash: await hashBarberPin(input.pin),
      p_pin_fingerprint: barberPinFingerprint(input.pin),
    });
    if (error?.code === "23505") throw new ApiError(409, "Ese nombre o PIN ya está asignado a otro barbero.");
    if (error) throw error;
    return json({ barber: data }, 201);
  } catch (error) { return handleError(error); }
}
