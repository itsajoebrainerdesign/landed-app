import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser-side Supabase client, shared by every client component.
//
// Returns null (instead of throwing) when NEXT_PUBLIC_SUPABASE_URL or
// NEXT_PUBLIC_SUPABASE_ANON_KEY isn't set, so the app still runs — signed
// out, with bookings kept on this device — rather than crashing.
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn("[Landed] Supabase isn't configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) — accounts are disabled.");
    client = null;
    return client;
  }
  try {
    client = createBrowserClient(url, key);
  } catch (err) {
    // e.g. a malformed URL in the host's environment variables — run
    // signed-out rather than crashing every page.
    console.error("[Landed] Supabase client couldn't start — accounts are disabled.", err);
    client = null;
  }
  return client;
}
