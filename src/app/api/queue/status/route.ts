import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { defaultShopId } from "@/lib/shop";
import { PUBLIC_QUEUE_COLUMNS } from "@/types/database";
import { ApiError, body, handleError, json, limit, requireManager } from "../../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const db = getSupabaseAdmin();
    const requestedShop = new URL(request.url).searchParams.get("shopId");
    if (requestedShop && !z.guid().safeParse(requestedShop).success) throw new ApiError(400, "Barbero inválido.");
    const shopId = requestedShop ?? defaultShopId();
    const [shop, queue] = await Promise.all([
      db.from("shops").select("*").eq("id", shopId).single(),
      db.from("queue_entries").select(PUBLIC_QUEUE_COLUMNS).eq("shop_id", shopId).in("status", ["waiting", "serving"]).order("position"),
    ]);
    if (shop.error || queue.error) throw shop.error ?? queue.error;
    return json({ shop: shop.data, queue: queue.data });
  } catch (error) { return handleError(error); }
}
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), id: z.guid(), token: z.string().regex(/^[a-f0-9]{64}$/), shopId: z.guid().optional() }),
  z.object({ action: z.literal("skip"), id: z.guid() }),
  z.object({ action: z.literal("open"), isOpen: z.boolean() }),
  z.object({ action: z.literal("duration"), minutes: z.number().int().min(5).max(180) }),
]);
export async function POST(request: Request) {
  try {
    const input = schema.parse(await body(request));
    const db = getSupabaseAdmin();
    if (input.action === "cancel") {
      limit(`cancel:${input.id}`, 10);
      const { error } = await db.rpc("cancel_queue", { p_shop: input.shopId ?? defaultShopId(), p_id: input.id, p_token_hash: createHash("sha256").update(input.token).digest("hex") });
      if (error) throw error;
    } else {
      const { shopId } = await requireManager(request);
      const result = input.action === "skip"
        ? await db.rpc("skip_queue", { p_shop: shopId, p_id: input.id })
        : await db.from("shops").update(input.action === "open" ? { is_open: input.isOpen } : { avg_cut_minutes: input.minutes }).eq("id", shopId);
      if (result.error) throw result.error;
    }
    return json({ ok: true });
  } catch (error) { return handleError(error); }
}
