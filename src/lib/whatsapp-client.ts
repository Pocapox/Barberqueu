import type { WASocket } from "@whiskeysockets/baileys";
import { makeWASocket, DisconnectReason, fetchLatestWaWebVersion } from "./baileys";
import pino from "pino";
import { toDataURL } from "qrcode";
import { useSupabaseAuthState } from "./whatsapp-auth";
import { getSupabaseAdmin } from "./supabase-admin";
import { isCancelCommand } from "./whatsapp-command";

type WAState = {
  status: "disconnected" | "connecting" | "qr" | "connected" | "error";
  qr: string | null;
  starting?: Promise<void>;
  retry?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  attempts: number;
  flush?: () => Promise<void>;
  lidPhones: Map<string, string>;
};
declare global {
  var __waState: WAState | undefined;
  var __waSocket: WASocket | undefined;
}
const state = (): WAState => globalThis.__waState ??= { status: "disconnected", qr: null, stopped: false, attempts: 0, lidPhones: new Map<string, string>() };
export const defaultShopId = () => process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";
export function whatsappStatus() { const s = state(); return { status: s.status, qr: s.qr }; }
function phoneFromJid(jid: string | null | undefined): string | undefined {
  return jid?.match(/^([1-9]\d{7,14})(?::\d+)?@s\.whatsapp\.net$/)?.[1];
}
function rememberPhone(lid: string | null | undefined, jid: string | null | undefined) {
  const phone = phoneFromJid(jid);
  if (lid?.endsWith("@lid") && phone) state().lidPhones.set(lid, phone);
}

function detach() {
  const socket = globalThis.__waSocket;
  globalThis.__waSocket = undefined;
  if (socket) {
    socket.ev.removeAllListeners("connection.update");
    socket.ev.removeAllListeners("creds.update");
    socket.ev.removeAllListeners("messages.upsert");
    socket.ev.removeAllListeners("contacts.upsert");
    socket.ev.removeAllListeners("contacts.update");
    socket.ev.removeAllListeners("chats.phoneNumberShare");
    socket.end(undefined);
  }
  state().lidPhones.clear();
}
function retry() {
  const s = state();
  if (s.stopped || s.retry) return;
  s.retry = setTimeout(() => { s.retry = undefined; void startWhatsApp(); }, Math.min(30000, 1000 * 2 ** Math.min(s.attempts++, 5)));
  s.retry.unref();
}

export async function startWhatsApp(): Promise<void> {
  const s = state();
  if (s.starting) return s.starting;
  if (globalThis.__waSocket || s.stopped) return;
  s.status = "connecting";
  s.starting = (async () => {
    try {
      const auth = await useSupabaseAuthState(defaultShopId());
      if (s.stopped) return;
      s.flush = auth.flush;
      const waVersion = await fetchLatestWaWebVersion({ timeout: 10000 });
      if (!waVersion.isLatest) throw new Error("No se pudo consultar la versión de WhatsApp Web.");
      // Baileys 6 types target Pino 7; the logging methods used by the socket also exist in Pino 9.
      const logger = pino({ level: "silent" }) as unknown as NonNullable<Parameters<typeof makeWASocket>[0]["logger"]>;
      const socket = makeWASocket({ auth: auth.state, version: waVersion.version, logger, printQRInTerminal: false,
        syncFullHistory: false, shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false,
        connectTimeoutMs: 20000, defaultQueryTimeoutMs: 15000 });
      globalThis.__waSocket = socket;
      const fail = () => { s.status = "error"; s.qr = null; detach(); retry(); };
      socket.ev.on("creds.update", () => { void auth.saveCreds().catch(fail); });
      socket.ev.on("contacts.upsert", contacts => {
        for (const contact of contacts) rememberPhone(contact.lid ?? contact.id, contact.jid ?? contact.id);
      });
      socket.ev.on("contacts.update", contacts => {
        for (const contact of contacts) rememberPhone(contact.lid ?? contact.id, contact.jid ?? contact.id);
      });
      socket.ev.on("chats.phoneNumberShare", ({ lid, jid }) => rememberPhone(lid, jid));
      socket.ev.on("connection.update", update => {
        void (async () => {
          if (globalThis.__waSocket !== socket) return;
          if (update.connection || update.qr) console.info("WhatsApp event:", update.connection ?? "qr");
          if (update.qr) {
            const qr = await toDataURL(update.qr, { margin: 2, width: 300 });
            if (globalThis.__waSocket === socket) { s.qr = qr; s.status = "qr"; }
          }
          if (update.connection === "open") { s.status = "connected"; s.qr = null; s.attempts = 0; }
          if (update.connection === "close") {
            s.status = "disconnected"; s.qr = null; detach();
            const error = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
            const code = error?.output?.statusCode;
            console.warn("WhatsApp disconnected with code:", code ?? "unknown");
            if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
              await auth.flush();
              const result = await getSupabaseAdmin().from("whatsapp_sessions").delete().eq("shop_id", defaultShopId());
              if (result.error) throw result.error;
            }
            if (code !== DisconnectReason.connectionReplaced) retry();
          }
        })().catch(fail);
      });
      socket.ev.on("messages.upsert", event => {
        void (async () => {
          if (event.type !== "notify") return;
          for (const message of event.messages) {
            const jid = message.key.remoteJid;
            if (message.key.fromMe || !jid || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) || message.message?.protocolMessage) continue;
            const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
            if (!isCancelCommand(text)) continue;
            rememberPhone(jid, message.key.senderPn);
            const phone = jid.endsWith("@lid") ? state().lidPhones.get(jid) : phoneFromJid(jid);
            if (!phone) {
              console.warn("WhatsApp CANCELAR recibido sin número de teléfono asociado.");
              continue;
            }
            const { data: names, error } = await getSupabaseAdmin().rpc("cancel_queue_phone_details", { p_phone: phone });
            if (error) throw error;
            await socket.sendMessage(jid, { text: names?.length
              ? `Tu turno con ${names.join(", ")} fue cancelado.`
              : "No encontramos un turno en espera para cancelar. Si ya estás en el sillón, habla con tu barbero." });
          }
        })().catch(() => console.error("No se pudo procesar un comando de WhatsApp."));
      });
    } catch (error) { console.warn("WhatsApp startup failed:", error instanceof Error ? error.name : "unknown"); s.status = "error"; retry(); }
    finally { s.starting = undefined; }
  })();
  return s.starting;
}

export async function sendWhatsApp(phone: string, text: string): Promise<boolean> {
  if (!/^[1-9]\d{7,14}$/.test(phone)) return false;
  const socket = globalThis.__waSocket;
  if (!socket || state().status !== "connected") return false;
  try { await socket.sendMessage(`${phone}@s.whatsapp.net`, { text }); return true; }
  catch { return false; }
}

export async function stopWhatsApp() {
  const s = state(); s.stopped = true;
  if (s.retry) clearTimeout(s.retry);
  s.retry = undefined;
  await s.starting;
  detach();
  await s.flush?.();
  s.status = "disconnected"; s.qr = null;
}

let resetting: Promise<void> | undefined;
export function resetWhatsApp(): Promise<void> {
  if (resetting) return resetting;
  resetting = (async () => {
    await stopWhatsApp();
    const result = await getSupabaseAdmin().from("whatsapp_sessions").delete().eq("shop_id", defaultShopId());
    if (result.error) throw new Error("No se pudo borrar la sesión anterior de WhatsApp.");
    const s = state();
    s.stopped = false; s.attempts = 0; s.flush = undefined;
    await startWhatsApp();
  })().finally(() => { resetting = undefined; });
  return resetting;
}
