import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), order: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(), update: vi.fn(), accounts: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => ({
  rpc: mocks.rpc,
  from: (table: string) => table === "shops"
    ? { select: () => ({ is: () => ({ order: mocks.order }) }), update: mocks.update }
    : { select: () => ({ eq: mocks.eq, then: (resolve: (value: unknown) => void) => resolve({ data: mocks.accounts(), error: null }) }) },
}) }));
import { hashBarberPin, verifyBarberToken } from "@/lib/barber-auth";
import { GET as list } from "./route";
import { POST as login } from "./login/route";
import { POST as ownerLogin } from "./owner-login/route";
import { POST as register } from "./register/route";
import { POST as manage } from "./manage/route";
import { GET as restoreSession, DELETE as logout } from "./session/route";
import { POST as queueStatus } from "../queue/status/route";

const main = "00000000-0000-0000-0000-000000000001";
const barber = "00000000-0000-0000-0000-000000000002";
function request(data: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_PIN", "111111"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-secret");
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  mocks.order.mockResolvedValue({ data: [{ id: main, barber_name: "Principal" }, { id: barber, barber_name: "María" }], error: null });
  mocks.accounts.mockReturnValue([{ shop_id: barber }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("barber registration and access", () => {
  it("lists public barber names without exposing PIN hashes", async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ barbers: [{ id: main, barber_name: "Principal", registered: false }, { id: barber, barber_name: "María", registered: true }] });
  });
  it("allows only the owner to create a separately pinned barber", async () => {
    expect((await register(request({ name: "María", pin: "123456" }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await register(request({ name: "María", pin: "111111" }, { "x-admin-pin": "111111" }))).status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: { id: barber, name: "María" }, error: null });
    const response = await register(request({ name: "María", pin: "123456" }, { "x-admin-pin": "111111" }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("create_barber_shop", expect.objectContaining({ p_name: "María", p_parent_shop: main, p_pin_hash: expect.stringMatching(/^scrypt:/), p_pin_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(await response.json())).not.toContain("pin_hash");
  });
  it("logs in by name and PIN and scopes mutations to that barber's shop", async () => {
    const pinHash = await hashBarberPin("123456");
    mocks.maybeSingle.mockResolvedValue({ data: { shop_id: barber, name: "María", pin_hash: pinHash }, error: null });
    expect((await login(request({ name: "María", pin: "654321" }))).status).toBe(401);
    const response = await login(request({ name: "María", pin: "123456" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^barberqueue_session=[^;]+;.*HttpOnly.*SameSite=Lax/i);
    const session = await response.json();
    expect(session.shopId).toBe(barber);
    expect(verifyBarberToken(session.token)?.shopId).toBe(barber);
    const mutation = await queueStatus(request({ action: "duration", minutes: 30 }, { "x-barber-token": session.token, "x-shop-id": main }));
    expect(mutation.status).toBe(200);
    expect(mocks.update.mock.results.at(-1)?.value.eq).toHaveBeenCalledWith("id", barber);
    expect((await queueStatus(request({ action: "duration", minutes: 40 }, { "x-barber-token": `${session.token}x` }))).status).toBe(401);
    mocks.maybeSingle.mockResolvedValue({ data: { shop_id: barber, pin_hash: await hashBarberPin("654321") }, error: null });
    expect((await queueStatus(request({ action: "duration", minutes: 40 }, { "x-barber-token": session.token }))).status).toBe(401);
  });
  it("restores barber and owner sessions from a private cookie and clears it on logout", async () => {
    const pinHash = await hashBarberPin("123456");
    mocks.maybeSingle.mockResolvedValue({ data: { shop_id: barber, name: "María", pin_hash: pinHash }, error: null });
    const barberLogin = await login(request({ name: "María", pin: "123456" }));
    const barberCookie = barberLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const restoredBarber = await restoreSession(new Request("http://localhost/api/barbers/session", { headers: { cookie: barberCookie } }));
    expect(restoredBarber.status).toBe(200);
    expect(await restoredBarber.json()).toEqual({ role: "barber", shopId: barber, name: "María" });
    const cookieMutation = await queueStatus(request({ action: "duration", minutes: 35 }, { cookie: barberCookie, "x-shop-id": main }));
    expect(cookieMutation.status).toBe(200);
    expect(mocks.update.mock.results.at(-1)?.value.eq).toHaveBeenCalledWith("id", barber);

    const owner = await ownerLogin(request({ pin: "111111" }));
    expect(owner.status).toBe(200);
    expect(JSON.stringify(await owner.json())).not.toContain("111111");
    const ownerCookie = owner.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const restoredOwner = await restoreSession(new Request("http://localhost/api/barbers/session", { headers: { cookie: ownerCookie } }));
    expect(restoredOwner.status).toBe(200);
    expect(await restoredOwner.json()).toEqual({ role: "owner", shopId: main, name: "Administrador" });
    mocks.rpc.mockResolvedValueOnce({ data: { id: barber, name: "María" }, error: null });
    expect((await register(request({ name: "María", pin: "123456" }, { cookie: ownerCookie }))).status).toBe(201);

    const signedOut = await logout(new Request("http://localhost/api/barbers/session", { method: "DELETE", headers: { cookie: barberCookie } }));
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("set-cookie")).toMatch(/^barberqueue_session=;.*Max-Age=0.*HttpOnly/i);
    expect((await restoreSession(new Request("http://localhost/api/barbers/session"))).status).toBe(401);
  });
  it("lets only the owner rename, reset the PIN and archive a barber", async () => {
    expect((await manage(request({ action: "update", shopId: barber, name: "Nuevo" }))).status).toBe(401);
    mocks.rpc.mockResolvedValueOnce({ data: { id: barber, name: "Nuevo" }, error: null });
    const renamed = await manage(request({ action: "update", shopId: barber, name: "Nuevo", pin: "654321" }, { "x-admin-pin": "111111" }));
    expect(renamed.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_barber_account", expect.objectContaining({ p_shop: barber, p_name: "Nuevo", p_pin_hash: expect.stringMatching(/^scrypt:/) }));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "BARBER_HAS_ACTIVE_TURNS" } });
    expect((await manage(request({ action: "archive", shopId: barber }, { "x-admin-pin": "111111" }))).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await manage(request({ action: "archive", shopId: barber }, { "x-admin-pin": "111111" }))).status).toBe(200);
  });
});
