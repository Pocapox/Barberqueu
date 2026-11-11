import { timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import { barberCredentialTag, verifyBarberToken, verifyOwnerToken } from "@/lib/barber-auth";
import { readManagerToken } from "@/lib/manager-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "Envía datos JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Faltan datos.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 4096) { await reader.cancel(); throw new ApiError(413, "Solicitud demasiado grande."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "JSON inválido."); }
  finally { reader.releaseLock(); }
}
const attempts = new Map<string, { count: number; expires: number }>();
export function limit(key: string, max: number, milliseconds = 60000) {
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
  if (attempts.size > 10000) throw new ApiError(429, "Intenta de nuevo más tarde.");
  const item = attempts.get(key) ?? { count: 0, expires: now + milliseconds };
  item.count++; attempts.set(key, item);
  if (item.count > max) throw new ApiError(429, "Demasiados intentos. Espera un minuto.");
}
export function requireAdmin(request: Request) {
  const expected = process.env.ADMIN_PIN;
  if (!expected) throw new ApiError(503, "Configura el PIN en el servidor.");
  const blocked = attempts.get("failed-admin");
  if (blocked && blocked.expires > Date.now() && blocked.count >= 20) throw new ApiError(429, "Demasiados intentos. Espera un minuto.");
  const headerPin = request.headers.get("x-admin-pin");
  if (headerPin === null && verifyOwnerToken(readManagerToken(request))) return;
  const received = headerPin ?? "";
  if (received.length > 128 || !timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(expected).digest())) {
    limit("failed-admin", 20);
    throw new ApiError(401, "PIN incorrecto.");
  }
}
export async function requireManager(request: Request): Promise<{ shopId: string; owner: boolean }> {
  const ownerPin = request.headers.get("x-admin-pin");
  if (ownerPin !== null) {
    requireAdmin(request);
    const shopId = request.headers.get("x-shop-id") ?? process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";
    if (!z.guid().safeParse(shopId).success) throw new ApiError(400, "Barbero inválido.");
    return { shopId, owner: true };
  }
  const cookieToken = readManagerToken(request);
  if (verifyOwnerToken(cookieToken)) {
    const shopId = request.headers.get("x-shop-id") ?? process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";
    if (!z.guid().safeParse(shopId).success) throw new ApiError(400, "Barbero inválido.");
    return { shopId, owner: true };
  }
  const session = verifyBarberToken(request.headers.get("x-barber-token") ?? cookieToken);
  if (!session) throw new ApiError(401, "Inicia sesión con tu nombre y PIN.");
  const { data, error } = await getSupabaseAdmin().from("barber_accounts").select("shop_id,pin_hash").eq("shop_id", session.shopId).maybeSingle();
  if (error) throw error;
  if (!data || barberCredentialTag(data.pin_hash) !== session.credential) throw new ApiError(401, "La sesión del barbero ya no es válida.");
  return { shopId: session.shopId, owner: false };
}
export function handleError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "Datos inválidos." }, 400);
  const message = (error as { message?: string })?.message;
  if ((error as { code?: string })?.code === "23505") return json({ error: "Este número ya tiene un turno activo." }, 409);
  if (message === "SHOP_CLOSED") return json({ error: "La fila está cerrada." }, 409);
  if (message === "QUEUE_CHANGED") return json({ error: "La fila cambió. Revisa los turnos e intenta de nuevo." }, 409);
  if (message === "INVALID_TURN") return json({ error: "El turno no se puede cancelar o el token es inválido." }, 403);
  if (message === "SHOP_NOT_FOUND") return json({ error: "Barbería no encontrada." }, 404);
  console.error("Falló una operación de BarberQueue.");
  return json({ error: "No se pudo completar la operación. Intenta de nuevo." }, 503);
}
