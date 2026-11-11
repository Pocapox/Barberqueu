import { barberCredentialTag, verifyBarberToken, verifyOwnerToken } from "@/lib/barber-auth";
import { clearManagerCookie, readManagerToken } from "@/lib/manager-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ApiError, handleError, json } from "../../_shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = readManagerToken(request);
    if (verifyOwnerToken(token)) return json({ role: "owner", shopId: process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001", name: "Administrador" });
    const session = verifyBarberToken(token);
    if (!session) throw new ApiError(401, "Inicia sesión de nuevo.");
    const { data, error } = await getSupabaseAdmin().from("barber_accounts").select("shop_id,name,pin_hash").eq("shop_id", session.shopId).maybeSingle();
    if (error) throw error;
    if (!data || barberCredentialTag(data.pin_hash) !== session.credential) throw new ApiError(401, "La sesión ya no es válida.");
    return json({ role: "barber", shopId: data.shop_id, name: data.name });
  } catch (error) { return handleError(error); }
}

export async function DELETE(_request: Request) {
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", clearManagerCookie());
  return response;
}
