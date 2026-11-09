"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

let client: SupabaseClient<Database> | undefined;

/** Reuse one client so callers can share its Realtime connection. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configuración pública de Supabase incompleta.");

  client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
