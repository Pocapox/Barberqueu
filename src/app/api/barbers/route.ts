import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { handleError, json } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const [shops, accounts] = await Promise.all([
      db.from("shops").select("id,barber_name,avg_cut_minutes,is_open").is("archived_at", null).order("created_at"),
      db.from("barber_accounts").select("shop_id"),
    ]);
    if (shops.error || accounts.error) throw shops.error ?? accounts.error;
    const registered = new Set((accounts.data ?? []).map(account => account.shop_id));
    return json({ barbers: (shops.data ?? []).map(shop => ({ ...shop, registered: registered.has(shop.id) })) });
  } catch (error) { return handleError(error); }
}
