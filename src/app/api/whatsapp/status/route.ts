import { startWhatsApp, whatsappStatus } from "@/lib/whatsapp-client";
import { handleError, json, requireManager } from "../../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { shopId } = await requireManager(request);
    void startWhatsApp(shopId);
    return json(whatsappStatus(shopId));
  } catch (error) { return handleError(error); }
}
