// The Account page's data: auth (sign up / log in / log out) and the
// "Personal information" profile.
//
// Signed in → the Supabase `profiles` table (see supabase/schema.sql).
// Signed out → localStorage on this device, as before accounts existed.
// On first sign-in, a profile saved on this device as a guest seeds the
// account's profile.

import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";

export type AccountInfo = { name: string; email: string; phone: string };

const LOCAL_KEY = "landed_account";
const EMPTY: AccountInfo = { name: "", email: "", phone: "" };

function readDeviceProfile(): AccountInfo | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function accountsEnabled(): boolean {
  return getSupabase() !== null;
}

export async function getCurrentUser(): Promise<User | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// Calls back whenever someone signs in or out (in this tab or another).
// Skips INITIAL_SESSION (fired immediately on subscribe — callers already
// load the current session) and TOKEN_REFRESHED (same user, new token).
export function onAuthChange(cb: (user: User | null) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signUp(email: string, password: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  const sb = getSupabase();
  if (!sb) return { error: "Accounts aren't set up yet." };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/account` },
  });
  if (error) return { error: error.message };
  // With email confirmation on (Supabase's default), there's no session
  // until they click the link in their inbox.
  return { needsConfirmation: !data.session };
}

export async function logIn(email: string, password: string): Promise<{ error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "Accounts aren't set up yet." };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

// Emails a reset link. It lands on /auth/callback (which signs them in with
// a one-time code) and then /account?reset=1, where they choose a new
// password. Supabase says nothing about whether the address has an
// account, so neither do we.
export async function requestPasswordReset(email: string): Promise<{ error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "Accounts aren't set up yet." };
  const next = encodeURIComponent("/account?reset=1");
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
  });
  return error ? { error: error.message } : {};
}

export async function updatePassword(password: string): Promise<{ error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "Accounts aren't set up yet." };
  const { error } = await sb.auth.updateUser({ password });
  return error ? { error: error.message } : {};
}

export async function logOut(): Promise<{ error?: string }> {
  const sb = getSupabase();
  if (!sb) return {};
  const { error } = await sb.auth.signOut();
  return error ? { error: error.message } : {};
}

export async function getProfile(user: User | null): Promise<{ info: AccountInfo; error?: string }> {
  const sb = getSupabase();
  if (!sb || !user) return { info: readDeviceProfile() ?? EMPTY };

  const { data, error } = await sb.from("profiles").select("name, email, phone").eq("id", user.id).maybeSingle();
  if (error) {
    console.error("[Landed] couldn't load profile", error);
    return { info: { ...EMPTY, email: user.email ?? "" }, error: describeError(error) };
  }
  if (data) return { info: data as AccountInfo };

  // No profile row yet — start from whatever they saved here as a guest,
  // defaulting the email to the one they signed up with.
  const device = readDeviceProfile();
  return { info: { ...EMPTY, ...device, email: device?.email || user.email || "" } };
}

export async function saveProfile(user: User | null, info: AccountInfo): Promise<{ error?: string }> {
  const sb = getSupabase();
  if (!sb || !user) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(info));
      return {};
    } catch {
      return { error: "Couldn't save on this device." };
    }
  }
  const { error } = await sb.from("profiles").upsert({ id: user.id, ...info, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[Landed] couldn't save profile", error);
    return { error: describeError(error) };
  }
  // The account is now the source of truth for this device's guest profile.
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }
  return {};
}

function describeError(err: { message?: string; code?: string }): string {
  if (err.code === "PGRST205" || err.code === "42P01") return "The profiles table doesn't exist yet — run supabase/schema.sql in Supabase.";
  return err.message || "Unknown error";
}
