import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn(), order: vi.fn(), update: vi.fn(), saved: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: () => ({
  select: () => ({ eq: () => ({ single: mocks.single, in: () => ({ order: mocks.order }) }) }),
  update: mocks.update,
}) }) }));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.stubEnv("ADMIN_PIN", "test-pin"); vi.clearAllMocks();
  mocks.single.mockResolvedValue({ data: { id: "shop" }, error: null });
  mocks.order.mockResolvedValue({ data: [{ id: "turn" }], error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.saved.mockResolvedValue({ error: null }); mocks.update.mockReturnValue({ eq: mocks.saved });
});
afterEach(() => vi.unstubAllEnvs());
const id = "00000000-0000-0000-0000-000000000001";
const request = (data: unknown) => new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-pin": "test-pin" }, body: JSON.stringify(data) });
it("returns the safe queue snapshot without caching", async () => {
  const response = await GET(new Request("http://localhost/api/queue/status")); expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ shop: { id: "shop" }, queue: [{ id: "turn" }] });
});
it("does not leak database errors", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.order.mockResolvedValue({ error: { message: "private database details" } });
  const response = await GET(new Request("http://localhost/api/queue/status")); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database details"); spy.mockRestore();
});
it("hashes the token for cancellation and handles a revoked turn", async () => {
  expect((await POST(request({ action: "cancel", id, token: "a".repeat(64) }))).status).toBe(200);
  expect(mocks.rpc.mock.calls[0][1].p_token_hash).not.toBe("a".repeat(64));
  mocks.rpc.mockResolvedValue({ error: { message: "INVALID_TURN" } });
  expect((await POST(request({ action: "cancel", id, token: "a".repeat(64) }))).status).toBe(403);
});
it("opens the shop and marks waiting no-shows with admin authorization", async () => {
  expect((await POST(request({ action: "open", isOpen: true }))).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ is_open: true });
  expect((await POST(request({ action: "skip", id }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("skip_queue", { p_shop: id, p_id: id });
  mocks.rpc.mockResolvedValue({ error: { message: "QUEUE_CHANGED" } });
  expect((await POST(request({ action: "skip", id }))).status).toBe(409);
});
