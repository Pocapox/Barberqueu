import type { AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { BufferJSON, initAuthCreds, proto } from "./baileys";
import { getSupabaseAdmin } from "./supabase-admin";

export async function useSupabaseAuthState(shopId: string) {
  const db = getSupabaseAdmin();
  let pending: Promise<void> = Promise.resolve();
  const serial = (task: () => Promise<void>) => {
    const next = pending.then(task);
    pending = next.catch(() => undefined);
    return next;
  };
  async function read(key: string) {
    await pending;
    const { data, error } = await db.from("whatsapp_sessions").select("data").eq("shop_id", shopId).eq("key_id", key).maybeSingle();
    if (error) throw new Error("No se pudo leer la sesión de WhatsApp.");
    return data ? JSON.parse(data.data, BufferJSON.reviver) : null;
  }
  async function write(key: string, value: unknown) {
    const result = value == null
      ? await db.from("whatsapp_sessions").delete().eq("shop_id", shopId).eq("key_id", key)
      : await db.from("whatsapp_sessions").upsert({ shop_id: shopId, key_id: key, data: JSON.stringify(value, BufferJSON.replacer) });
    if (result.error) throw new Error("No se pudo guardar la sesión de WhatsApp.");
  }
  const creds = await read("creds") ?? initAuthCreds();
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const values: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = await read(`${type}-${id}`);
          if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          values[id] = value;
        }
        return values;
      },
      set: (data) => serial(async () => {
        for (const [category, keys] of Object.entries(data)) {
          for (const [id, value] of Object.entries(keys ?? {})) await write(`${category}-${id}`, value);
        }
      }),
    },
  };
  return { state, saveCreds: () => serial(() => write("creds", creds)), flush: () => pending };
}

