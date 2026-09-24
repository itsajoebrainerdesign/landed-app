import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Keeps the Supabase session fresh: on every page request, refresh the
// auth token if it's close to expiring and write the new cookies onto
// both the request (for anything rendering this request) and the response
// (for the browser). This is the pattern @supabase/ssr documents for the
// Next.js App Router.
//
// It must never take the site down: if Supabase isn't configured, the
// URL/key are malformed, or Supabase is unreachable, the page is served
// signed-out instead (a crash here is a 500 on every page —
// MIDDLEWARE_INVOCATION_FAILED on Vercel).
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  try {
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
    await supabase.auth.getUser();
  } catch (err) {
    console.error("[middleware] Supabase session refresh failed — serving signed-out", err);
    return NextResponse.next({ request });
  }
  return response;
}

export const config = {
  // Full Node.js runtime rather than Vercel's Edge runtime, where the
  // Supabase client isn't fully supported.
  runtime: "nodejs",
  // Skip static assets, install files, and API routes (the plan API reads
  // auth cookies itself).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|icons/|api/|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ttf)$).*)",
  ],
};
