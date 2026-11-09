import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({ from: vi.fn() })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

beforeEach(() => {
  vi.resetModules();
  createClient.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Supabase clients", () => {
  it("creates the public client lazily, once, using only the public key", async () => {
    const { getSupabaseClient } = await import("./supabase-client");
    expect(createClient).not.toHaveBeenCalled();
    expect(getSupabaseClient()).toBe(getSupabaseClient());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "public-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("creates the admin client lazily without persistent auth sessions", async () => {
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(createClient).not.toHaveBeenCalled();
    expect(getSupabaseAdmin()).toBe(getSupabaseAdmin());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "private-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("refuses to load the admin module in a browser", async () => {
    vi.stubGlobal("window", {});
    await expect(import("./supabase-admin")).rejects.toThrow("solo puede ejecutarse en el servidor");
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("rejects missing public configuration %s", async (key) => {
    vi.stubEnv(key, "");
    const { getSupabaseClient } = await import("./supabase-client");
    expect(() => getSupabaseClient()).toThrow("Configuración pública de Supabase incompleta");
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])("rejects missing server configuration %s", async (key) => {
    vi.stubEnv(key, "");
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(() => getSupabaseAdmin()).toThrow("Configuración del servidor de Supabase incompleta");
    expect(createClient).not.toHaveBeenCalled();
  });
});
