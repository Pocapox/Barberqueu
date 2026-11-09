import { z } from "zod";
import { barberPinFingerprint, hashBarberPin, ownerPinMatches } from "@/lib/barber-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ApiError, body, handleError, json, limit, requireAdmin } from "../../_shared";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), shopId: z.guid(), name: z.string().trim().min(1).max(80), pin: z.string().regex(/^\d{6,12}$/, "El PIN debe tener entre 6 y 12 dígitos.").optional() }),
  z.object({ action: z.literal("archive"), shopId: z.guid() }),
]);

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const input = schema.parse(await body(request));
    limit("manage-barber", 20, 60000);
    const db = getSupabaseAdmin();
    if (input.action === "archive") {
      const { error } = await db.rpc("archive_barber_account", {
        p_shop: input.shopId,
        p_primary_shop: process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001",
      });
      if (error?.message === "BARBER_HAS_ACTIVE_TURNS") throw new ApiError(409, "Este barbero tiene turnos activos. Termínalos o cancélalos antes de eliminarlo.");
      if (error?.message === "BARBER_NOT_FOUND") throw new ApiError(404, "Barbero no encontrado.");
      if (error) throw error;
      return json({ ok: true });
    }
    if (input.pin && ownerPinMatches(input.pin)) throw new ApiError(409, "El PIN del barbero debe ser distinto del PIN administrador.");
    const { data, error } = await db.rpc("update_barber_account", {
      p_shop: input.shopId,
      p_name: input.name,
      p_pin_hash: input.pin ? await hashBarberPin(input.pin) : null,
      p_pin_fingerprint: input.pin ? barberPinFingerprint(input.pin) : null,
    });
    if (error?.code === "23505") throw new ApiError(409, "Ese nombre o PIN ya está asignado a otro barbero.");
    if (error?.message === "BARBER_NOT_FOUND") throw new ApiError(404, "Barbero no encontrado.");
    if (error) throw error;
    return json({ barber: data });
  } catch (error) { return handleError(error); }
}
