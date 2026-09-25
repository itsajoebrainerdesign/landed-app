import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client with the service-role key, which bypasses
// Row Level Security. Used only for the shared search cache (plan_cache),
// which has no RLS policies at all — so nothing in the browser can read or
// write it. NEVER import this from client code, and never prefix the key
// with NEXT_PUBLIC_. Returns null if SUPABASE_SERVICE_ROLE_KEY isn't set
// (the cache then stays in memory only).
let admin: SupabaseClient | null | undefined;

export function getAdminSupabase(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    admin = null;
    return admin;
  }
  try {
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (err) {
    console.error("[supabase] admin client couldn't start — shared cache off", err);
    admin = null;
  }
  return admin;
}
