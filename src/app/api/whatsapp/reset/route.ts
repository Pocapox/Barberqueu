import { resetWhatsApp, whatsappStatus } from "@/lib/whatsapp-client";
import { handleError, json, requireAdmin } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    await resetWhatsApp();
    return json(whatsappStatus());
  } catch (error) { return handleError(error); }
}
