// Where saved plans (drafts + confirmed bookings) live.
//
// Signed in → the Supabase `bookings` table (see supabase/schema.sql),
// scoped to the user by Row Level Security.
// Signed out, or Supabase not configured → localStorage on this device,
// exactly as before accounts existed.
//
// The first time someone signs in on a device, any plans they made as a
// guest are moved into their account (importDeviceBookings), so nothing
// made before signing up is lost.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import type { PlanLocation } from "./geo";
import type { CategoryOption } from "./categoryOptions";

// The live search results a plan was built from: per timeframe ("now",
// "tonight", "tomorrow"), per category.
export type SavedLiveResults = Record<string, Record<string, CategoryOption[]>>;

// The venue as it was when saved. Newer saves store the full option (id,
// address, phone, vibes, meta) so a live venue reloads exactly even after
// the live results it came from are gone; older saves only have the
// display fields.
export type SavedItem = {
  tag: string;
  tagBg: string;
  title: string;
  price: string;
  unit: string;
  hasApiBooking?: boolean;
  id?: string;
  address?: string;
  phone?: string;
  vibes?: string[];
  meta?: string[];
};
export type SavedBooking = {
  id: string;
  createdAt: string;
  planSummary: string;
  picks: Record<string, string>;
  items: Record<string, SavedItem>;
  vibe: string;
  time: string;
  budget: string;
  removedCategories: string[];
  confirmed: boolean;
  // Where the plan is. Missing on plans saved before the map search could
  // move the plan — those are Galway.
  location?: PlanLocation;
  // The search results behind the plan, so reopening it needs no new
  // search. Missing on older plans (they search again when opened).
  liveResults?: SavedLiveResults;
};
export type BookingsSource = "account" | "device";

const LOCAL_KEY = "landed_bookings";

type BookingRow = {
  id: string;
  created_at: string;
  plan_summary: string;
  picks: Record<string, string>;
  items: Record<string, SavedItem>;
  vibe: string;
  time_key: string;
  budget: string;
  removed_categories: string[];
  confirmed: boolean;
  location: PlanLocation | null;
  live_results?: SavedLiveResults | null;
};

function fromRow(r: BookingRow): SavedBooking {
  return {
    id: r.id,
    createdAt: r.created_at,
    planSummary: r.plan_summary,
    picks: r.picks || {},
    items: r.items || {},
    vibe: r.vibe,
    time: r.time_key,
    budget: r.budget,
    removedCategories: r.removed_categories || [],
    confirmed: r.confirmed,
    location: r.location ?? undefined,
    liveResults: r.live_results ?? undefined,
  };
}

// created_at is left to the database default, so updating a draft keeps
// the date it was first saved.
function toRow(b: SavedBooking) {
  return {
    id: b.id,
    plan_summary: b.planSummary,
    picks: b.picks,
    items: b.items,
    vibe: b.vibe,
    time_key: b.time,
    budget: b.budget,
    removed_categories: b.removedCategories,
    confirmed: b.confirmed,
    location: b.location ?? null,
    live_results: b.liveResults ?? null,
    updated_at: new Date().toISOString(),
  };
}

const BOOKING_COLUMNS = "id, created_at, plan_summary, picks, items, vibe, time_key, budget, removed_categories, confirmed, location";
// Fetched separately-able: if schema.sql hasn't been re-run since this
// column was added, everything else still works (see withoutLiveResults).
const BOOKING_COLUMNS_WITH_RESULTS = BOOKING_COLUMNS + ", live_results";

// Postgres / PostgREST "column doesn't exist".
function isMissingColumn(err: { code?: string } | null): boolean {
  return !!err && (err.code === "42703" || err.code === "PGRST204");
}
function withoutLiveResults<T extends { live_results?: unknown }>(row: T): Omit<T, "live_results"> {
  const { live_results: _drop, ...rest } = row;
  void _drop;
  return rest;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function newBookingId(): string {
  // randomUUID only exists in secure contexts (https / localhost) — e.g.
  // not when testing on a phone via http://192.168.x.x:3000.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Device storage ──────────────────────────────────────────────────────

// null means "nothing has ever been saved here" (vs. an empty list), which
// the Bookings page uses to decide whether to seed its examples.
export function readDeviceBookings(): SavedBooking[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as SavedBooking[]) : null;
  } catch {
    return null;
  }
}
export function writeDeviceBookings(list: SavedBooking[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — nothing to do
  }
}

// ── Session ─────────────────────────────────────────────────────────────

async function signedInClient(): Promise<{ sb: SupabaseClient; userId: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const userId = data.session?.user.id;
  return userId ? { sb, userId } : null;
}

function describeError(err: { message?: string; code?: string } | null): string {
  if (!err) return "Unknown error";
  // PostgREST's "table not found" — schema.sql hasn't been run yet.
  if (err.code === "PGRST205" || err.code === "42P01") return "The bookings table doesn't exist yet — run supabase/schema.sql in Supabase.";
  // Column missing — schema.sql was run before `location` was added.
  if (err.code === "PGRST204" || err.code === "42703") return "The bookings table is out of date — re-run supabase/schema.sql in Supabase.";
  return err.message || "Unknown error";
}

// ── Public API ──────────────────────────────────────────────────────────

export async function listBookings(): Promise<{ bookings: SavedBooking[] | null; source: BookingsSource; error?: string }> {
  const session = await signedInClient();
  if (!session) return { bookings: readDeviceBookings(), source: "device" };

  const importError = await importDeviceBookings(session.sb);
  // The list doesn't need the (large) search results.
  const { data, error } = await session.sb
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[Landed] couldn't load bookings", error);
    return { bookings: [], source: "account", error: describeError(error) };
  }
  return { bookings: (data as BookingRow[]).map(fromRow), source: "account", error: importError };
}

export async function getBooking(id: string): Promise<SavedBooking | null> {
  const session = await signedInClient();
  if (!session) return readDeviceBookings()?.find((b) => b.id === id) ?? null;
  if (!UUID_RE.test(id)) return null;
  let { data, error } = await session.sb.from("bookings").select(BOOKING_COLUMNS_WITH_RESULTS).eq("id", id).maybeSingle();
  if (isMissingColumn(error)) {
    ({ data, error } = await session.sb.from("bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle());
  }
  if (error) console.error("[Landed] couldn't load booking", error);
  return data ? fromRow(data as unknown as BookingRow) : null;
}

// Inserts or updates by id. If the account save fails, the plan is kept on
// this device instead so it isn't lost — the result says which happened.
export async function saveBooking(booking: SavedBooking): Promise<{ savedTo: BookingsSource; error?: string }> {
  const session = await signedInClient();
  if (session) {
    let { error } = await session.sb.from("bookings").upsert(toRow(booking));
    // schema.sql not re-run since live_results was added: save without it.
    if (isMissingColumn(error)) ({ error } = await session.sb.from("bookings").upsert(withoutLiveResults(toRow(booking))));
    if (!error) return { savedTo: "account" };
    console.error("[Landed] couldn't save booking to account — keeping it on this device", error);
    saveToDevice(booking);
    return { savedTo: "device", error: describeError(error) };
  }
  saveToDevice(booking);
  return { savedTo: "device" };
}

function saveToDevice(booking: SavedBooking) {
  const list = readDeviceBookings() || [];
  const idx = list.findIndex((b) => b.id === booking.id);
  if (idx >= 0) list[idx] = booking;
  else list.unshift(booking);
  writeDeviceBookings(list);
}

// Moves plans made as a guest on this device into the signed-in account.
// The Bookings page's seeded examples ("example-…") are demo content, not
// the user's, so they're dropped rather than imported. Device storage is
// only cleared once the insert succeeds.
async function importDeviceBookings(sb: SupabaseClient): Promise<string | undefined> {
  const local = readDeviceBookings();
  if (!local) return undefined;
  // Give legacy (timestamp) ids stable UUIDs and write them back first, so
  // a retry or an overlapping import upserts the same rows instead of
  // inserting duplicates.
  const mine = local
    .filter((b) => !b.id.startsWith("example-"))
    .map((b) => (UUID_RE.test(b.id) ? b : { ...b, id: newBookingId() }));
  if (mine.length > 0) {
    writeDeviceBookings(mine);
    const rows = mine.map((b) => ({ ...toRow(b), created_at: b.createdAt }));
    let { error } = await sb.from("bookings").upsert(rows);
    if (isMissingColumn(error)) ({ error } = await sb.from("bookings").upsert(rows.map(withoutLiveResults)));
    if (error) {
      console.error("[Landed] couldn't move this device's bookings into the account", error);
      return describeError(error);
    }
  }
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }
  return undefined;
}
