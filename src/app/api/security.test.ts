import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("@/lib/whatsapp-client", () => ({ startWhatsApp: vi.fn(async () => {}), whatsappStatus: () => ({ status: "qr", qr: "private-qr" }) }));
import { body, handleError, limit, requireAdmin } from "./_shared";
import { GET as health } from "./health/route";
import { GET as whatsapp } from "./whatsapp/status/route";
afterEach(() => vi.unstubAllEnvs());
describe("API input and access boundaries", () => {
  it("rejects non-JSON, missing, malformed and oversized request bodies", async () => {
    await expect(body(new Request("http://localhost"))).rejects.toMatchObject({ status: 415 });
    await expect(body(new Request("http://localhost", { headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ status: 400 });
    await expect(body(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).rejects.toMatchObject({ status: 400 });
    await expect(body(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "a".repeat(5000) }))).rejects.toMatchObject({ status: 413 });
  });
  it("rate-limits repeated requests and resets expired windows", () => {
    vi.useFakeTimers();
    try { limit("test-rate", 1); expect(() => limit("test-rate", 1)).toThrow("Demasiados"); vi.advanceTimersByTime(60001); expect(() => limit("test-rate", 1)).not.toThrow(); }
    finally { vi.useRealTimers(); }
  });
  it("maps expected domain errors without internal details", () => {
    expect(handleError({ message: "SHOP_CLOSED" }).status).toBe(409);
    expect(handleError({ message: "SHOP_NOT_FOUND" }).status).toBe(404);
    const result = z.string().safeParse(1);
    if (!result.success) expect(handleError(result.error).status).toBe(400);
  });
  it("serves keep-alive without requiring credentials", async () => {
    expect(await health().json()).toEqual({ ok: true, service: "BarberQueue" });
  });
  it("protects the QR even when the frontend route is public", async () => {
    vi.stubEnv("ADMIN_PIN", "test-pin");
    expect((await whatsapp(new Request("http://localhost"))).status).toBe(401);
    const response = await whatsapp(new Request("http://localhost", { headers: { "x-admin-pin": "test-pin" } }));
    expect(await response.json()).toEqual({ status: "qr", qr: "private-qr" });
    vi.stubEnv("ADMIN_PIN", "");
    expect(() => requireAdmin(new Request("http://localhost"))).toThrow("Configura");
  });
});
