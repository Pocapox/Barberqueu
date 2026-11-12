import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { body, handleError, json, requireManager } from "../../_shared";

export const runtime = "nodejs";
const schema = z.object({ servingId: z.guid().nullable(), waitingId: z.guid().nullable(), finish: z.enum(["completed", "no_show"]).default("completed") });

export async function POST(request: Request) {
  try {
    const { shopId } = await requireManager(request);
    const input = schema.parse(await body(request));
    const { error } = await getSupabaseAdmin().rpc("advance_queue", {
      p_shop: shopId, p_expected_serving: input.servingId,
      p_expected_waiting: input.waitingId, p_finish: input.finish,
    });
    if (error) throw error;
    return json({ ok: true });
  } catch (error) { return handleError(error); }
}
