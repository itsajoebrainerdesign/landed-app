import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Keeps the Supabase session fresh: on every page request, refresh the
// auth token if it's close to expiring and write the new cookies onto
// both the request (for anything rendering this request) and the response
// (for the browser). This is the pattern @supabase/ssr documents for the
// Next.js App Router. No-op when Supabase isn't configured.
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Responses that set auth cookies must not be cached (per @supabase/ssr).
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch (err) {
    // Supabase unreachable — carry on signed out rather than failing the page.
    console.error("[middleware] Supabase session refresh failed", err);
  }
  return response;
}

export const config = {
  // Skip static assets and API routes (the plan API doesn't use auth).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|icons/|api/|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ttf)$).*)",
  ],
};
