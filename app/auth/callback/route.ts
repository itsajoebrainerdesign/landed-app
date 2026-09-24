import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "../../lib/supabase/server";

// Where Supabase's confirmation email sends people after they click the
// link: exchanges the one-time ?code= for a session cookie, then returns
// them to the Account page (or ?next=, if it's a same-site path).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") || "/account";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";

  const supabase = await getServerSupabase();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[auth/callback] code exchange failed", error.message);
  }
  return NextResponse.redirect(`${origin}/account?auth_error=1`);
}
