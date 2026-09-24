import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client for route handlers, reading and writing the
// auth cookies through next/headers. Returns null if Supabase isn't
// configured.
export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const cookieStore = await cookies(); // async since Next 15
  try {
    return makeClient(url, key, cookieStore);
  } catch (err) {
    console.error("[supabase] server client couldn't start", err);
    return null;
  }
}

function makeClient(url: string, key: string, cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
