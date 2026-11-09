import { beforeEach, describe, expect, it, vi } from "vitest";
const { rows, fail, db } = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const fail = { value: false };
  const db = { from: vi.fn(() => {
    const filters: Record<string, string> = {}; let deleting = false;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ data: rows.has(filters.key_id) ? { data: rows.get(filters.key_id) } : null, error: fail.value ? {} : null }),
      delete: () => { deleting = true; return query; },
      upsert: async (record: { key_id: string; data: string }) => { if (!fail.value) rows.set(record.key_id, record.data); return { error: fail.value ? {} : null }; },
      then: (resolve: (value: { error: object | null }) => unknown) => { if (deleting && !fail.value) rows.delete(filters.key_id); return Promise.resolve(resolve({ error: fail.value ? {} : null })); },
    }; return query;
  }) }; return { rows, fail, db };
});
vi.mock("./supabase-admin", () => ({ getSupabaseAdmin: () => db }));
import { useSupabaseAuthState } from "./whatsapp-auth";

beforeEach(() => { rows.clear(); fail.value = false; });
describe("database-only WhatsApp authentication", () => {
  it("round trips credentials and binary Signal keys through serialized rows", async () => {
    const auth = await useSupabaseAuthState("shop");
    await auth.saveCreds();
    const loaded = await useSupabaseAuthState("shop");
    expect(loaded.state.creds.noiseKey.private).toEqual(auth.state.creds.noiseKey.private);
    await auth.state.keys.set({ session: { customer: Buffer.from([1, 2, 3]) } });
    const result = await loaded.state.keys.get("session", ["customer"]);
    expect(Buffer.from(result.customer)).toEqual(Buffer.from([1, 2, 3]));
    expect(rows.get("session-customer")).toContain("Buffer");
  });
  it("removes revoked keys and restores protobuf app-state keys", async () => {
    const auth = await useSupabaseAuthState("shop");
    await auth.state.keys.set({ "app-state-sync-key": { key: { keyData: Buffer.from([9]) } } });
    const result = await auth.state.keys.get("app-state-sync-key", ["key"]);
    expect(Buffer.from(result.key.keyData!)).toEqual(Buffer.from([9]));
    await auth.state.keys.set({ "app-state-sync-key": { key: null } });
    expect((await auth.state.keys.get("app-state-sync-key", ["key"])).key).toBeNull();
  });
  it("fails closed on reads and propagates persistence failures", async () => {
    fail.value = true;
    await expect(useSupabaseAuthState("shop")).rejects.toThrow("leer");
    fail.value = false;
    const auth = await useSupabaseAuthState("shop");
    fail.value = true;
    await expect(auth.saveCreds()).rejects.toThrow("guardar");
    fail.value = false;
    await expect(auth.saveCreds()).resolves.toBeUndefined();
  });
});
