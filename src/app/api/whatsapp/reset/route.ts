import { resetWhatsApp, whatsappStatus } from "@/lib/whatsapp-client";
import { handleError, json, requireManager } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { shopId } = await requireManager(request);
    await resetWhatsApp(shopId);
    return json(whatsappStatus(shopId));
  } catch (error) { return handleError(error); }
}
