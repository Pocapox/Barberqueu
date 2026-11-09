import { startWhatsApp, whatsappStatus } from "@/lib/whatsapp-client";
import { handleError, json, requireManager } from "../../_shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { owner } = await requireManager(request);
    void startWhatsApp();
    const status = whatsappStatus();
    return json(owner ? status : { status: status.status, qr: null });
  } catch (error) { return handleError(error); }
}
