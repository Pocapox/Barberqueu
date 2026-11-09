import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

// Runtime guard also works in the custom Node server, outside Next's RSC loader.
if (typeof window !== "undefined") {
  throw new Error("supabase-admin solo puede ejecutarse en el servidor.");
}

let admin: SupabaseClient<Database> | undefined;

/** Lazy initialization permits builds without runtime secrets. Never import from UI. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuración del servidor de Supabase incompleta.");

  admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}
