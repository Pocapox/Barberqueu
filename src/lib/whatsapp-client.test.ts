import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  const socket = { ev: { on: vi.fn((name: string, callback: (event: unknown) => void) => listeners.set(name, callback)), removeAllListeners: vi.fn((name: string) => listeners.delete(name)) }, end: vi.fn(), sendMessage: vi.fn() };
  const shopName = { value: "María" };
  const from = vi.fn((table: string) => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "entry" }, error: null }),
      single: async () => ({ data: { barber_name: shopName.value }, error: null }) };
    if (table !== "queue_entries" && table !== "shops") throw new Error(`Unexpected table ${table}`);
    return query;
  });
  return { listeners, socket, factory: vi.fn(() => socket), rpc: vi.fn(), from, shopName, flush: vi.fn(), save: vi.fn() };
});
vi.mock("./baileys", () => ({ makeWASocket: mocks.factory, normalizeMessageContent: (value: { ephemeralMessage?: { message: unknown } } | undefined) => value?.ephemeralMessage?.message ?? value, fetchLatestWaWebVersion: async () => ({ isLatest: true, version: [2, 3000, 1053729251] }), DisconnectReason: { loggedOut: 401, badSession: 500, connectionReplaced: 440 } }));
vi.mock("./whatsapp-auth", () => ({ useSupabaseAuthState: async () => ({ state: {}, saveCreds: mocks.save, flush: mocks.flush }) }));
vi.mock("./supabase-admin", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("qrcode", () => ({ toDataURL: async () => "data:image/png;base64,test" }));
import { sendWhatsApp, startWhatsApp, stopWhatsApp, whatsappStatus } from "./whatsapp-client";

beforeEach(() => {
  globalThis.__waStates = undefined;
  mocks.listeners.clear(); vi.clearAllMocks();
  mocks.socket.sendMessage.mockResolvedValue({}); mocks.rpc.mockResolvedValue({ error: null }); mocks.flush.mockResolvedValue(undefined);
});
afterEach(async () => { await stopWhatsApp(); });
describe("WhatsApp socket lifecycle", () => {
  it("keeps each barber's connection state separate and scopes CANCELAR", async () => {
    const shopId = "11111111-1111-4111-8111-111111111111";
    await startWhatsApp(shopId);
    mocks.listeners.get("connection.update")?.({ connection: "open" });
    expect(whatsappStatus(shopId).status).toBe("connected");
    expect(whatsappStatus().status).toBe("disconnected");
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { conversation: "CANCELAR" } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", { p_shop: shopId, p_phone: "18095551234" }));
  });
  it("shares one socket across concurrent startup calls and closes listeners cleanly", async () => {
    await Promise.all([startWhatsApp(), startWhatsApp(), startWhatsApp()]);
    expect(mocks.factory).toHaveBeenCalledTimes(1);
    await stopWhatsApp();
    expect(mocks.listeners.size).toBe(0); expect(mocks.socket.end).toHaveBeenCalledTimes(1);
    expect(globalThis.__waStates?.get("00000000-0000-0000-0000-000000000001")?.socket).toBeUndefined();
    expect(whatsappStatus()).toEqual({ status: "disconnected", qr: null });
  });
  it("publishes a QR then clears it on connect and sends to international JIDs", async () => {
    await startWhatsApp();
    mocks.listeners.get("connection.update")?.({ qr: "payload" });
    await vi.waitFor(() => expect(whatsappStatus().status).toBe("qr"));
    mocks.listeners.get("connection.update")?.({ connection: "open" });
    expect(whatsappStatus()).toEqual({ status: "connected", qr: null });
    expect(await sendWhatsApp("00000000-0000-0000-0000-000000000001", "18095551234", "Tu turno")).toBe(true);
    expect(mocks.socket.sendMessage).toHaveBeenCalledWith("18095551234@s.whatsapp.net", { text: "Tu turno" });
    expect(await sendWhatsApp("00000000-0000-0000-0000-000000000001", "invalid", "Tu turno")).toBe(false);
  });
  it("cancels only direct incoming CANCELAR messages, not history or groups", async () => {
    await startWhatsApp();
    const listener = mocks.listeners.get("messages.upsert")!;
    const message = { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { conversation: " cancelar " } };
    listener({ type: "append", messages: [message] });
    listener({ type: "notify", messages: [{ ...message, key: { remoteJid: "group@g.us" } }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    listener({ type: "notify", messages: [message] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", { p_shop: "00000000-0000-0000-0000-000000000001", p_phone: "18095551234" }));
  });
  it.each(["Cancelar", "CANCELAR", "cancelar"])("cancels an active turn for WhatsApp text %s", async text => {
    await startWhatsApp();
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { conversation: text } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", {
      p_shop: "00000000-0000-0000-0000-000000000001",
      p_phone: "18095551234",
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses the sender phone when a direct chat arrives with a LID", async () => {
    await startWhatsApp();
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "987654321@lid", senderPn: "18095551234@s.whatsapp.net", fromMe: false }, message: { extendedTextMessage: { text: "Cancelar" } } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", {
      p_shop: "00000000-0000-0000-0000-000000000001",
      p_phone: "18095551234",
    }));
    expect(mocks.socket.sendMessage).toHaveBeenCalledWith("987654321@lid", expect.objectContaining({ text: expect.any(String) }));
  });
  it("cancels a wrapped disappearing text message", async () => {
    await startWhatsApp();
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { ephemeralMessage: { message: { conversation: "Cancelar" } } } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", { p_shop: "00000000-0000-0000-0000-000000000001", p_phone: "18095551234" }));
  });
  it("resolves a LID from WhatsApp contact updates when the message has no sender phone", async () => {
    await startWhatsApp();
    mocks.listeners.get("contacts.upsert")?.([{ id: "987654321@lid", jid: "18095551234@s.whatsapp.net" }]);
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "987654321@lid", fromMe: false }, message: { conversation: "cancelar" } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_queue_phone", {
      p_shop: "00000000-0000-0000-0000-000000000001",
      p_phone: "18095551234",
    }));
  });
  it("confirms cancellation using the barber's name", async () => {
    mocks.rpc.mockResolvedValue({ data: ["María"], error: null });
    await startWhatsApp();
    mocks.listeners.get("messages.upsert")?.({ type: "notify", messages: [
      { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { conversation: "CANCELAR" } },
    ] });
    await vi.waitFor(() => expect(mocks.socket.sendMessage).toHaveBeenCalledWith("18095551234@s.whatsapp.net", { text: "Tu turno con María fue cancelado." }));
  });
  it("processes live incoming messages with a request ID", async () => {
    await startWhatsApp();
    mocks.listeners.get("messages.upsert")?.({ type: "notify", requestId: "offline-delivery", messages: [
      { key: { remoteJid: "18095551234@s.whatsapp.net", fromMe: false }, message: { conversation: "CANCELAR" } },
    ] });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  });
  it("schedules reconnection after a transient close and clears it on shutdown", async () => {
    await startWhatsApp();
    mocks.listeners.get("connection.update")?.({ connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
    await vi.waitFor(() => expect(globalThis.__waStates?.get("00000000-0000-0000-0000-000000000001")?.retry).toBeDefined());
    await stopWhatsApp();
    expect(globalThis.__waStates?.get("00000000-0000-0000-0000-000000000001")?.retry).toBeUndefined();
    expect(await sendWhatsApp("00000000-0000-0000-0000-000000000001", "18095551234", "Aviso")).toBe(false);
  });
});


