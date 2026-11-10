import type { WASocket } from "@whiskeysockets/baileys";
import { makeWASocket, DisconnectReason, fetchLatestWaWebVersion, normalizeMessageContent } from "./baileys";
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
  socket?: WASocket;
};
declare global {
  var __waStates: Map<string, WAState> | undefined;
}
const states = () => globalThis.__waStates ??= new Map<string, WAState>();
const state = (shopId = defaultShopId()): WAState => {
  let current = states().get(shopId);
  if (!current) {
    current = { status: "disconnected", qr: null, stopped: false, attempts: 0, lidPhones: new Map<string, string>() };
    states().set(shopId, current);
  }
  return current;
};
export const defaultShopId = () => process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";
export function whatsappStatus(shopId = defaultShopId()) { const s = state(shopId); return { status: s.status, qr: s.qr }; }
function phoneFromJid(jid: string | null | undefined): string | undefined {
  return jid?.match(/^([1-9]\d{7,14})(?::\d+)?@s\.whatsapp\.net$/)?.[1];
}
function rememberPhone(s: WAState, lid: string | null | undefined, jid: string | null | undefined) {
  const phone = phoneFromJid(jid);
  if (lid?.endsWith("@lid") && phone) s.lidPhones.set(lid, phone);
}

function detach(s: WAState) {
  const socket = s.socket;
  s.socket = undefined;
  if (socket) {
    socket.ev.removeAllListeners("connection.update");
    socket.ev.removeAllListeners("creds.update");
    socket.ev.removeAllListeners("messages.upsert");
    socket.ev.removeAllListeners("contacts.upsert");
    socket.ev.removeAllListeners("contacts.update");
    socket.ev.removeAllListeners("chats.phoneNumberShare");
    socket.end(undefined);
  }
  s.lidPhones.clear();
}
function retry(shopId: string) {
  const s = state(shopId);
  if (s.stopped || s.retry) return;
  s.retry = setTimeout(() => { s.retry = undefined; void startWhatsApp(shopId); }, Math.min(30000, 1000 * 2 ** Math.min(s.attempts++, 5)));
  s.retry.unref();
}

export async function startWhatsApp(shopId = defaultShopId()): Promise<void> {
  const s = state(shopId);
  if (s.starting) return s.starting;
  if (s.socket || s.stopped) return;
  s.status = "connecting";
  s.starting = (async () => {
    try {
      const auth = await useSupabaseAuthState(shopId);
      if (s.stopped) return;
      s.flush = auth.flush;
      const waVersion = await fetchLatestWaWebVersion({ timeout: 10000 });
      if (!waVersion.isLatest) throw new Error("No se pudo consultar la versión de WhatsApp Web.");
      // Baileys 6 types target Pino 7; the logging methods used by the socket also exist in Pino 9.
      const logger = pino({ level: "silent" }) as unknown as NonNullable<Parameters<typeof makeWASocket>[0]["logger"]>;
      const socket = makeWASocket({ auth: auth.state, version: waVersion.version, logger, printQRInTerminal: false,
        syncFullHistory: false, shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false,
        connectTimeoutMs: 20000, defaultQueryTimeoutMs: 15000 });
      s.socket = socket;
      const fail = () => { s.status = "error"; s.qr = null; detach(s); retry(shopId); };
      socket.ev.on("creds.update", () => { void auth.saveCreds().catch(fail); });
      socket.ev.on("contacts.upsert", contacts => {
        for (const contact of contacts) rememberPhone(s, contact.lid ?? contact.id, contact.jid ?? contact.id);
      });
      socket.ev.on("contacts.update", contacts => {
        for (const contact of contacts) rememberPhone(s, contact.lid ?? contact.id, contact.jid ?? contact.id);
      });
      socket.ev.on("chats.phoneNumberShare", ({ lid, jid }) => rememberPhone(s, lid, jid));
      socket.ev.on("connection.update", update => {
        void (async () => {
          if (s.socket !== socket) return;
          if (update.connection || update.qr) console.info("WhatsApp event:", shopId, update.connection ?? "qr");
          if (update.qr) {
            const qr = await toDataURL(update.qr, { margin: 2, width: 300 });
            if (s.socket === socket) { s.qr = qr; s.status = "qr"; }
          }
          if (update.connection === "open") { s.status = "connected"; s.qr = null; s.attempts = 0; }
          if (update.connection === "close") {
            s.status = "disconnected"; s.qr = null; detach(s);
            await auth.flush();
            const error = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
            const code = error?.output?.statusCode;
            console.warn("WhatsApp disconnected with code:", shopId, code ?? "unknown");
            if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
              await auth.flush();
              const result = await getSupabaseAdmin().from("whatsapp_sessions").delete().eq("shop_id", shopId);
              if (result.error) throw result.error;
            }
            if (code !== DisconnectReason.connectionReplaced) retry(shopId);
          }
        })().catch(fail);
      });
      socket.ev.on("messages.upsert", event => {
        void (async () => {
          if (event.type !== "notify") return;
          for (const message of event.messages) {
            const jid = message.key.remoteJid;
            if (message.key.fromMe || !jid || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) || message.message?.protocolMessage) continue;
            const content = normalizeMessageContent(message.message);
            const text = content?.conversation ?? content?.extendedTextMessage?.text;
            if (!isCancelCommand(text)) continue;
            rememberPhone(s, jid, message.key.senderPn);
            const phone = jid.endsWith("@lid") ? s.lidPhones.get(jid) : phoneFromJid(jid);
            if (!phone) {
              console.warn("WhatsApp CANCELAR recibido sin número de teléfono asociado.");
              continue;
            }
            const db = getSupabaseAdmin();
            const { data: pending, error: pendingError } = await db.from("queue_entries").select("id").eq("shop_id", shopId).eq("customer_phone", phone).eq("status", "waiting").maybeSingle();
            if (pendingError) throw pendingError;
            const { error } = pending ? await db.rpc("cancel_queue_phone", { p_shop: shopId, p_phone: phone }) : { error: null };
            if (error) throw error;
            const { data: shop, error: shopError } = await db.from("shops").select("barber_name").eq("id", shopId).single();
            if (shopError) throw shopError;
            await socket.sendMessage(jid, { text: pending
              ? `Tu turno con ${shop.barber_name} fue cancelado.`
              : "No encontramos un turno en espera para cancelar. Si ya estás en el sillón, habla con tu barbero." });
          }
        })().catch(() => console.error("No se pudo procesar un comando de WhatsApp."));
      });
    } catch (error) { console.warn("WhatsApp startup failed:", shopId, error instanceof Error ? error.name : "unknown"); s.status = "error"; detach(s); retry(shopId); }
    finally { s.starting = undefined; }
  })();
  return s.starting;
}

export async function restoreWhatsAppSessions() {
  const { data, error } = await getSupabaseAdmin().from("whatsapp_sessions").select("shop_id").eq("key_id", "creds");
  if (error) throw error;
  for (const { shop_id } of data ?? []) void startWhatsApp(shop_id);
}

export async function sendWhatsApp(shopId: string, phone: string, text: string): Promise<boolean> {
  if (!/^[1-9]\d{7,14}$/.test(phone)) return false;
  const s = state(shopId);
  const socket = s.socket;
  if (!socket || s.status !== "connected") return false;
  try { await socket.sendMessage(`${phone}@s.whatsapp.net`, { text }); return true; }
  catch { return false; }
}

export async function stopWhatsApp(shopId?: string) {
  for (const [id, s] of states()) {
    if (shopId && id !== shopId) continue;
    s.stopped = true;
    if (s.retry) clearTimeout(s.retry);
    s.retry = undefined;
    await s.starting;
    detach(s);
    await s.flush?.();
    s.status = "disconnected"; s.qr = null;
  }
}

const resetting = new Map<string, Promise<void>>();
export function resetWhatsApp(shopId: string): Promise<void> {
  const existing = resetting.get(shopId);
  if (existing) return existing;
  const operation = (async () => {
    await stopWhatsApp(shopId);
    const result = await getSupabaseAdmin().from("whatsapp_sessions").delete().eq("shop_id", shopId);
    if (result.error) throw new Error("No se pudo borrar la sesión anterior de WhatsApp.");
    const s = state(shopId);
    s.stopped = false; s.attempts = 0; s.flush = undefined;
    await startWhatsApp(shopId);
  })().finally(() => { resetting.delete(shopId); });
  resetting.set(shopId, operation);
  return operation;
}
