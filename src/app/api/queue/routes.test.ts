import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), drain: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), filterEq: vi.fn(), order: vi.fn(), single: vi.fn() }));
vi.mock("../../../lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: () => ({ update: mocks.update, select: mocks.select }) }) }));
vi.mock("../../../lib/whatsapp-client", () => ({ defaultShopId: () => "00000000-0000-0000-0000-000000000001", whatsappStatus: () => ({ status: "connected" }) }));
vi.mock("../../../lib/whatsapp-outbox", () => ({ drainWhatsAppOutbox: mocks.drain }));
import { POST as join } from "./join/route";
import { POST as advance } from "./advance/route";
import { POST as status } from "./status/route";

const id = "00000000-0000-0000-0000-000000000001";
function request(data: unknown, pin = "correct-test-pin") {
  return new Request("http://localhost/api/queue", { method: "POST", headers: { "content-type": "application/json", "x-admin-pin": pin }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ADMIN_PIN", "correct-test-pin");
  mocks.drain.mockResolvedValue(1); mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.select.mockReturnValue({ eq: mocks.filterEq });
  mocks.filterEq.mockReturnValue({ eq: mocks.filterEq, order: mocks.order, single: mocks.single });
  mocks.single.mockResolvedValue({ data: { barber_name: "María" }, error: null });
  mocks.order.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("queue route contracts", () => {
  it("normalizes phones, hashes cancellation tokens and returns no private row", async () => {
    mocks.rpc.mockResolvedValue({ data: { id, customer_phone: "18095551234", cancel_token_hash: "private" }, error: null });
    const response = await join(request({ name: "Ana", phone: "(809) 555-1234" }));
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result).toEqual({ id, shopId: id, token: expect.stringMatching(/^[a-f0-9]{64}$/), whatsappDelivered: false, whatsappQueued: true });
    expect(mocks.rpc.mock.calls[0][1].p_phone).toBe("18095551234");
    expect(mocks.rpc.mock.calls[0][1].p_token_hash).not.toBe(result.token);
    expect(mocks.drain).toHaveBeenCalledOnce();
  });
  it("maps duplicate turns to HTTP 409 and sends no notification", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect((await join(request({ name: "Ana", phone: "18295551234" }))).status).toBe(409);
    expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("rejects malformed phones without touching the database", async () => {
    expect((await join(request({ name: "Ana", phone: "bad" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires PIN before advancing", async () => {
    expect((await advance(request({}, "wrong"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("notifies the first for the chair and the second to approach", async () => {
    mocks.rpc.mockResolvedValue({ data: { serving: { id, customer_name: "Ana", customer_phone: "18095551234" }, upcoming: { id: "next", customer_name: "Luis", customer_phone: "18295551234", notified_upcoming: false } }, error: null });
    mocks.order.mockResolvedValue({ data: [
      { id: "next", customer_name: "Luis", customer_phone: "18295551234", notified_upcoming: false },
      { id: "third", customer_name: "Eva", customer_phone: "18495551234", notified_upcoming: false },
    ], error: null });
    const response = await advance(request({ servingId: null, waitingId: id }));
    expect(response.status).toBe(200);
    expect(mocks.drain).toHaveBeenCalledOnce();
  });
  it("reports delivery failures without rolling back the completed advance", async () => {
    mocks.drain.mockRejectedValueOnce(new Error("offline"));
    mocks.rpc.mockResolvedValue({ data: { serving: { id, customer_name: "Ana", customer_phone: "18095551234" }, upcoming: null }, error: null });
    const response = await advance(request({ servingId: null, waitingId: id }));
    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toHaveLength(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates each waiting customer after a completed cut with the number ahead", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      serving: { id, customer_name: "Ana", customer_phone: "18095551234" },
      upcoming: { id: "next", customer_name: "Luis", customer_phone: "18295551234", notified_upcoming: false },
    }, error: null });
    mocks.order.mockResolvedValue({ data: [
      { id: "next", customer_name: "Luis", customer_phone: "18295551234", notified_upcoming: false },
      { id: "third", customer_name: "Eva", customer_phone: "18495551234", notified_upcoming: false },
    ], error: null });
    const response = await advance(request({ servingId: "00000000-0000-0000-0000-000000000002", waitingId: id, finish: "completed" }));
    expect(response.status).toBe(200);
    expect(mocks.drain).toHaveBeenCalledOnce();
  });
  it("requires the admin PIN and validates the barber's estimated minutes", async () => {
    expect((await status(request({ action: "duration", minutes: 30 }, "wrong"))).status).toBe(401);
    expect((await status(request({ action: "duration", minutes: 0 }))).status).toBe(400);
    const response = await status(request({ action: "duration", minutes: 30 }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ avg_cut_minutes: 30 });
  });
  it("requires PIN to close the shop or skip a turn", async () => {
    expect((await status(request({ action: "open", isOpen: false }, "wrong"))).status).toBe(401);
    expect((await status(request({ action: "skip", id }, "wrong"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
