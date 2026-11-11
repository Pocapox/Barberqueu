import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase-admin", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
import { flushWhatsAppReceipts, recordWhatsAppDelivery } from "./whatsapp-delivery";

beforeEach(() => { globalThis.__waReceipts = undefined; globalThis.__waReceiptFlush = undefined; rpc.mockReset(); });
it("retains a receipt after a database outage and retries it", async () => {
  rpc.mockResolvedValueOnce({ error: {} }).mockResolvedValue({ error: null });
  recordWhatsAppDelivery("shop", "message");
  await vi.waitFor(() => expect(globalThis.__waReceiptFlush).toBeUndefined());
  expect(globalThis.__waReceipts?.size).toBe(1);
  await flushWhatsAppReceipts();
  expect(globalThis.__waReceipts?.size).toBe(0);
  expect(rpc).toHaveBeenLastCalledWith("confirm_whatsapp_delivery", { p_shop: "shop", p_message_id: "message" });
});
