import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeKey, VibeKey, BudgetKey } from "../../lib/constants";
import { TIME_OPTIONS, VIBE_OPTIONS, BUDGET_OPTIONS } from "../../lib/constants";
import type { CategoryKey, CategoryOption, VenuePhoto } from "../../lib/categoryOptions";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_STYLE } from "../../lib/categoryOptions";
import { haversineKm } from "../../lib/geo";
import { getServerSupabase } from "../../lib/supabase/server";
import { getAdminSupabase } from "../../lib/supabase/admin";

/**
 * POST /api/plan
 *
 * Body: { location?: string, lat: number, lng: number,
 *         vibe: "nightout" | "date" | "family" | "solo" }
 * (lat/lng — the pin on the map — are required. A `time` field is
 * accepted but ignored — one search covers every timeframe.)
 *
 * Response: a stream of JSON lines (NDJSON), so the plan fills in as it's
 * found instead of after one long wait:
 *   {"type":"draft","options":…}      ~1 s — straight from Google's lists
 *   {"type":"category","category":"bar","options":…}   × up to 6, as each
 *                                      category's AI pick finishes
 *   {"type":"final","options":…,"source":"live"|"static","warnings":[…]}
 * `options` is { now, tonight, tomorrow }, each a Partial<Record<
 * CategoryKey, CategoryOption[]>> (for "category", just that category).
 * A cached result is a single "final" line.
 *
 * How a search works:
 * 1) Google Places lists what's actually near the pin in each category
 *    (Nearby Search) → sent straight away as the draft plan, tiered by
 *    Google's price level.
 * 2) Six small AI calls run in parallel, one per category, each choosing
 *    the best fits for the vibe from its Google list, with price
 *    estimates, budget tiers and highlights. Only "live" uses web search
 *    (for what's on). Picks from a list are already verified; the odd
 *    unlisted pick is looked up in Google Places.
 * 3) The finished result is cached — in memory and, when
 *    SUPABASE_SERVICE_ROLE_KEY is set, in the shared `plan_cache` table —
 *    for CACHE_TTL_MS per area, vibe and local date, so the next search
 *    of that area is instant for everyone. "Now" isn't stored: it's worked
 *    out from each venue's opening hours whenever results are served, so
 *    cached results stay right as the day goes on.
 *
 * Budget isn't sent: every venue carries a tier, and the client applies
 * Modest/Luxury itself, so changing budget never costs another search.
 *
 * Abuse protection — every uncached search spends real money. Anyone can
 * get live results, signed in or not; cached results never count.
 * - Signed-in users get LIMIT_PER_HOUR / LIMIT_PER_DAY uncached searches,
 *   counted in the Supabase `plan_searches` table so the limit holds
 *   across serverless instances.
 * - Guests get GUEST_LIMIT_PER_HOUR / GUEST_LIMIT_PER_DAY per IP address,
 *   counted in memory — so only per server instance, and reset when
 *   Vercel starts a new one. Weaker than the signed-in limit; the real
 *   backstop is a spend cap in the Anthropic console and a quota on the
 *   Places API in Google Cloud (see README).
 * - A best-effort per-IP limit (in memory, per instance) caps request
 *   floods before any upstream work.
 *
 * Never fails the stream. Missing keys, used-up quota, or failed upstream
 * calls end in a "final" line with `source: "static"` and `warnings`, and
 * the frontend keeps using its fallback. A malformed body is a 400 and an
 * IP flood a 429 (plain JSON, before any streaming).
 */

// Six AI calls in parallel plus Places; well under a minute, but allow slack.
export const maxDuration = 300;

type PlanRequest = { location: string; lat: number; lng: number; vibe: VibeKey };
type CategoryResults = Partial<Record<CategoryKey, CategoryOption[]>>;
type LiveOptions = Partial<Record<TimeKey, CategoryResults>>;
const TIME_KEYS = TIME_OPTIONS.map((o) => o.key);

// How the pin is described to the AI when the app doesn't send a name.
const UNNAMED_LOCATION = "the pin on the map";
// Results are local to the exact point on the map: walking distance first,
// and never further than this. Stays and car parks are sparser in quiet
// areas, so they get a little more room.
const MAX_DISTANCE_KM: Record<CategoryKey, number> = {
  restaurant: 3,
  bar: 3,
  live: 5,
  attractions: 5,
  parking: 3,
  stay: 8,
};

// Which Claude model picks the venues for each category. Every category
// except "live" chooses from its Google list (a simple job); "live" also
// searches the web for what's on (harder). Change a line here to switch.
//
// Tested 2026-09-25 on St Albans, Leverstock Green and Harpenden (see the
// model trial): Sonnet 5 on the list categories matched Opus 5's picks and
// tiers, finished them in ~5–6 s instead of 6–10 s, at roughly half the AI
// cost. Opus stays on "live": Sonnet was slower there (28–37 s vs 15–19 s)
// and read far more web text. Haiku 4.5 was ruled out — wrong tiers
// (Domino's as "luxury"), missing timeframes, prices too low.
const CATEGORY_MODEL: Record<CategoryKey, ModelId> = {
  stay: "claude-sonnet-5",
  restaurant: "claude-sonnet-5",
  attractions: "claude-sonnet-5",
  bar: "claude-sonnet-5",
  live: "claude-opus-5",
  parking: "claude-sonnet-5",
};

// What each model supports: adaptive thinking and "effort" (Opus 5,
// Sonnet 5 — not Haiku 4.5), the server-side refusal fallback (used on
// Opus 5), and which web search tool version it takes. Prices are list
// prices in USD per million tokens, for the cost log.
type ModelId = "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5";
const MODEL_SETUP: Record<
  ModelId,
  { adaptiveThinking: boolean; effort: boolean; refusalFallback: boolean; webSearch: "web_search_20260209" | "web_search_20250305"; usdPerMInput: number; usdPerMOutput: number }
> = {
  "claude-opus-5": { adaptiveThinking: true, effort: true, refusalFallback: true, webSearch: "web_search_20260209", usdPerMInput: 5, usdPerMOutput: 25 },
  "claude-sonnet-5": { adaptiveThinking: true, effort: true, refusalFallback: false, webSearch: "web_search_20260209", usdPerMInput: 2, usdPerMOutput: 10 },
  "claude-haiku-4-5": { adaptiveThinking: false, effort: false, refusalFallback: false, webSearch: "web_search_20250305", usdPerMInput: 1, usdPerMOutput: 5 },
};
const USD_PER_WEB_SEARCH = 0.01;
// Google Places Nearby / Text Search with Enterprise-tier fields (rating,
// phone, opening hours), list price before the monthly free allowance.
const USD_PER_PLACES_REQUEST = 0.035;

// Running cost of one search, logged when it finishes.
type SearchUsage = { inputTokens: number; outputTokens: number; webSearches: number; placesRequests: number; usd: number };
function newUsage(): SearchUsage {
  return { inputTokens: 0, outputTokens: 0, webSearches: 0, placesRequests: 0, usd: 0 };
}
// Every venue is labelled with a budget tier, and each tier needs its own
// pool — the plan's pick plus 3 swaps at that budget. So: about this many
// per tier per category (across all three timeframes)…
const PER_TIER = 4;
const BUDGET_KEYS = BUDGET_OPTIONS.map((o) => o.key);
// …and at most this many kept per tier, per category, per timeframe.
const OPTIONS_PER_TIER = 4;
// Venues and what suits an area don't change hour to hour; "now" is worked
// out from opening hours at serve time, so results keep for half a day.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// TESTING: per-user and per-guest search limits are switched off while
// the app is being tested, so every search runs. Set this back to true
// before sharing the app more widely — each uncached search costs about
// 25–35p (Claude + Google Places). The per-IP flood guard below stays on.
const SEARCH_LIMITS_ON = false;

// Uncached live searches per signed-in user.
const LIMIT_PER_HOUR = 10;
const LIMIT_PER_DAY = 30;
// Uncached live searches per guest IP address (in memory, per instance).
const GUEST_LIMIT_PER_HOUR = 5;
const GUEST_LIMIT_PER_DAY = 15;
// Requests (cached or not) per IP per window, per server instance.
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60 * 1000;

const CATEGORY_UNITS: Record<CategoryKey, string> = {
  stay: "per night",
  restaurant: "per person",
  attractions: "per person",
  bar: "avg. per drink",
  live: "per person",
  parking: "per hour",
};

// ── Request parsing ─────────────────────────────────────────────────────

function parseRequest(body: unknown): PlanRequest | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Body must be a JSON object.";
  const { location, lat, lng, time, vibe } = body as Record<string, unknown>;
  if (time !== undefined && !TIME_KEYS.includes(time as TimeKey)) return `"time" must be one of: ${TIME_KEYS.join(", ")}.`;
  if (!VIBE_OPTIONS.some((o) => o.key === vibe)) return `"vibe" must be one of: ${VIBE_OPTIONS.map((o) => o.key).join(", ")}.`;
  if (location !== undefined && (typeof location !== "string" || location.trim().length === 0 || location.length > 100)) {
    return `"location" must be a non-empty string of at most 100 characters.`;
  }
  if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return `"lat" and "lng" (the pin on the map) are required and must be valid coordinates.`;
  }
  return {
    location: (location as string | undefined)?.trim() || UNNAMED_LOCATION,
    lat,
    lng,
    vibe: vibe as VibeKey,
  };
}

// ── Streaming ───────────────────────────────────────────────────────────

type StreamEvent =
  | { type: "draft"; options: LiveOptions }
  | { type: "category"; category: CategoryKey; options: LiveOptions }
  // `cache` says where a cached result came from (for checking the shared
  // cache works; the app ignores it).
  | { type: "final"; options: LiveOptions; source: "live" | "static"; warnings: string[]; cache?: "memory" | "shared" };
type Emit = (event: StreamEvent) => void;

export async function POST(req: NextRequest) {
  if (!allowIp(clientIp(req))) {
    return NextResponse.json({ error: "Too many requests — try again in a few minutes." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = parseRequest(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  const ip = clientIp(req);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit: Emit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true; // client went away — keep working so the result still gets cached
        }
      };
      try {
        await handlePlan(parsed, ip, emit);
      } catch (err) {
        // Last-resort guard — every step below already catches its own errors.
        console.error("[api/plan] unexpected error", err);
        emit({ type: "final", options: {}, source: "static", warnings: ["Live search failed unexpectedly."] });
      }
      if (!closed) controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Stop proxies buffering the stream (which would undo the point of it).
      "X-Accel-Buffering": "no",
    },
  });
}

async function handlePlan(input: PlanRequest, ip: string, emit: Emit): Promise<void> {
  const key = cacheKey(input);
  const served = (data: PlanData, cache?: "memory" | "shared") =>
    emit({ type: "final", options: serveOptions(data, Date.now()), source: "live", warnings: [], cache });

  const fromMemory = readMemoryCache(key);
  if (fromMemory) {
    served(fromMemory, "memory");
    return;
  }
  const fromShared = await readSharedCache(key);
  if (fromShared) {
    writeMemoryCache(key, fromShared);
    served(fromShared, "shared");
    return;
  }
  // Someone else is already searching this area and vibe — wait for theirs.
  const pending = inFlight.get(key);
  if (pending) {
    const data = await pending.catch(() => null);
    if (data) {
      served(data);
      return;
    }
  }

  // Signed in → the shared per-user quota; otherwise → the per-IP guest
  // quota. (No Supabase, or its auth check failing, just means "guest".)
  if (SEARCH_LIMITS_ON) {
    const supabase = await getServerSupabase();
    let userId: string | null = null;
    if (supabase) {
      try {
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id ?? null;
      } catch {
        userId = null;
      }
    }
    const quotaError = supabase && userId ? await consumeQuota(supabase, userId) : consumeGuestQuota(ip);
    if (quotaError) {
      emit({ type: "final", options: {}, source: "static", warnings: [quotaError] });
      return;
    }
  }

  const search = buildPlan(input, emit);
  const promise = search.then((r) => r.data);
  inFlight.set(key, promise as Promise<PlanData>);
  let result: BuildResult;
  try {
    result = await search;
  } finally {
    inFlight.delete(key);
  }
  if (result.data) {
    // Only a complete result is kept — if some categories' AI calls failed
    // (e.g. a rate limit), the next search should try again, not reuse it.
    if (result.complete) {
      writeMemoryCache(key, result.data);
      void writeSharedCache(key, result.data);
    }
    emit({ type: "final", options: serveOptions(result.data, Date.now()), source: "live", warnings: result.warnings });
  } else {
    emit({ type: "final", options: {}, source: "static", warnings: result.warnings });
  }
}

// ── Per-IP limit (best effort, per instance) ────────────────────────────

const ipHits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

function allowIp(ip: string): boolean {
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 10_000) ipHits.clear(); // don't let the map grow without bound
  return recent.length <= IP_LIMIT;
}

// ── Guest quota (in memory, per instance) ───────────────────────────────

const guestSearches = new Map<string, number[]>();

function consumeGuestQuota(ip: string): string | null {
  const now = Date.now();
  const recent = (guestSearches.get(ip) ?? []).filter((t) => now - t < 86400_000);
  if (recent.filter((t) => now - t < 3600_000).length >= GUEST_LIMIT_PER_HOUR) {
    return `You've used this hour's ${GUEST_LIMIT_PER_HOUR} live searches — sign in for more, or try again later.`;
  }
  if (recent.length >= GUEST_LIMIT_PER_DAY) {
    return `You've used today's ${GUEST_LIMIT_PER_DAY} live searches — sign in for more, or try again tomorrow.`;
  }
  recent.push(now);
  guestSearches.set(ip, recent);
  if (guestSearches.size > 10_000) guestSearches.clear(); // don't let the map grow without bound
  return null;
}

// ── Per-user quota (Supabase, shared across instances) ──────────────────
// Record the search first, then count — so two concurrent requests can't
// both slip under the limit. Fails closed: if the table is missing or the
// check errors, no paid search runs.

async function consumeQuota(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { error: insertError } = await supabase.from("plan_searches").insert({ user_id: userId });
  if (insertError) {
    console.error("[api/plan] couldn't record search for rate limiting", insertError);
    if (insertError.code === "PGRST205" || insertError.code === "42P01") {
      return "Live search is off until the plan_searches table exists — re-run supabase/schema.sql in Supabase.";
    }
    return "Couldn't check your live-search allowance, so live search is paused.";
  }
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const [hour, day] = await Promise.all([
    supabase.from("plan_searches").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since(3600_000)),
    supabase.from("plan_searches").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since(86400_000)),
  ]);
  if (hour.error || day.error || hour.count === null || day.count === null) {
    console.error("[api/plan] couldn't count searches", hour.error || day.error);
    return "Couldn't check your live-search allowance, so live search is paused.";
  }
  if (hour.count > LIMIT_PER_HOUR) return `You've used your ${LIMIT_PER_HOUR} live searches for this hour — showing saved suggestions for now.`;
  if (day.count > LIMIT_PER_DAY) return `You've used your ${LIMIT_PER_DAY} live searches for today — showing saved suggestions for now.`;
  return null;
}


// ── Cache ───────────────────────────────────────────────────────────────
// A finished search is kept for CACHE_TTL_MS per area (~1 km), vibe and
// the pin's local date — in memory on this server instance, and in the
// shared `plan_cache` table (when SUPABASE_SERVICE_ROLE_KEY is set) so it
// survives new instances and serves every user. Cached results don't
// count against anyone's quota.

const memoryCache = new Map<string, { expires: number; data: PlanData }>();
const inFlight = new Map<string, Promise<PlanData | null>>();

// The pin's local date, approximated from longitude (15° per hour) — close
// enough to keep "tonight" and "tomorrow" meaning the right days.
function localDate(lng: number): string {
  return new Date(Date.now() + (lng / 15) * 3600_000).toISOString().slice(0, 10);
}

function cacheKey(input: PlanRequest): string {
  return `v4|${input.lat.toFixed(2)},${input.lng.toFixed(2)}|${input.vibe}|${localDate(input.lng)}`;
}

function readMemoryCache(key: string): PlanData | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return hit.data;
}

function writeMemoryCache(key: string, data: PlanData) {
  if (memoryCache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of memoryCache) if (v.expires <= Date.now()) memoryCache.delete(k);
    if (memoryCache.size >= CACHE_MAX_ENTRIES) memoryCache.delete(memoryCache.keys().next().value!);
  }
  memoryCache.set(key, { expires: Date.now() + CACHE_TTL_MS, data });
}

// The shared table is written with the server-only service-role key and
// has no RLS policies, so browsers (anon key) can't read or write it — no
// one can plant fake venues in other people's results.
async function readSharedCache(key: string): Promise<PlanData | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("plan_cache")
      .select("data")
      .eq("key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) {
      console.error("[api/plan] shared cache read failed", error.message);
      return null;
    }
    return (data?.data as PlanData | undefined) ?? null;
  } catch (err) {
    console.error("[api/plan] shared cache read failed", err);
    return null;
  }
}

async function writeSharedCache(key: string, data: PlanData): Promise<void> {
  const admin = getAdminSupabase();
  if (!admin) return;
  try {
    const now = new Date();
    const { error } = await admin
      .from("plan_cache")
      .upsert({ key, data, expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString() });
    if (error) console.error("[api/plan] shared cache write failed", error.message);
    // Tidy up expired rows now and then.
    if (Math.random() < 0.05) await admin.from("plan_cache").delete().lt("expires_at", now.toISOString());
  } catch (err) {
    console.error("[api/plan] shared cache write failed", err);
  }
}

// ── Plan data, and "now" from opening hours ─────────────────────────────
// What's stored (and cached) per search. "Tonight" and "tomorrow" are
// fixed lists; "now" is derived whenever results are served: every venue
// in `pool` that's open at that moment by its Google opening hours (stays
// and car parks always count), so a cached result stays right all day.

type OpeningPeriodPoint = { day: number; hour?: number; minute?: number };
type OpeningPeriod = { open?: OpeningPeriodPoint; close?: OpeningPeriodPoint };
type OpeningHours = { periods: OpeningPeriod[]; utcOffsetMinutes?: number };

type PlanData = {
  pool: CategoryResults;
  tonight: CategoryResults;
  tomorrow: CategoryResults;
  hours: Record<string, OpeningHours | null>;
};

type BuildResult = { data: PlanData | null; warnings: string[]; complete: boolean; usage: SearchUsage };

function emptyPlan(): PlanData {
  return { pool: {}, tonight: {}, tomorrow: {}, hours: {} };
}

const WEEK_MINUTES = 7 * 24 * 60;

// Open at this instant? Unknown hours count as open (better to show a
// place than hide it on missing data).
function isOpenAt(hours: OpeningHours | null | undefined, nowMs: number): boolean {
  if (!hours?.periods?.length) return true;
  const p0 = hours.periods[0];
  if (hours.periods.length === 1 && p0.open && !p0.close) return true; // open 24/7
  const local = new Date(nowMs + (hours.utcOffsetMinutes ?? 0) * 60_000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const at = (x: OpeningPeriodPoint) => x.day * 1440 + (x.hour ?? 0) * 60 + (x.minute ?? 0);
  return hours.periods.some((period) => {
    if (!period.open || !period.close) return false;
    const open = at(period.open);
    let close = at(period.close);
    if (close <= open) close += WEEK_MINUTES; // wraps past Saturday night
    return (t >= open && t < close) || (t + WEEK_MINUTES >= open && t + WEEK_MINUTES < close);
  });
}

// Closest first, keeping the nearest OPTIONS_PER_TIER in each budget tier.
function trimTiers(list: CategoryOption[]): CategoryOption[] {
  const perTier = new Map<string, number>();
  return [...list]
    .sort((a, b) => parseFloat(a.meta[0]) - parseFloat(b.meta[0]))
    .filter((o) => {
      const n = perTier.get(o.budget ?? "modest") ?? 0;
      perTier.set(o.budget ?? "modest", n + 1);
      return n < OPTIONS_PER_TIER;
    });
}

function nowFor(data: PlanData, cat: CategoryKey, nowMs: number): CategoryOption[] {
  const always = cat === "stay" || cat === "parking";
  return trimTiers((data.pool[cat] ?? []).filter((o) => always || isOpenAt(data.hours[o.id], nowMs)));
}

function serveOptions(data: PlanData, nowMs: number): LiveOptions {
  const now: CategoryResults = {};
  for (const cat of CATEGORY_ORDER) {
    const list = nowFor(data, cat, nowMs);
    if (list.length) now[cat] = list;
  }
  return { now, tonight: data.tonight, tomorrow: data.tomorrow };
}

function serveCategory(data: PlanData, cat: CategoryKey, nowMs: number): LiveOptions {
  return {
    now: { [cat]: nowFor(data, cat, nowMs) },
    tonight: { [cat]: data.tonight[cat] ?? [] },
    tomorrow: { [cat]: data.tomorrow[cat] ?? [] },
  };
}

function mergeCategory(into: PlanData, from: PlanData, cat: CategoryKey) {
  into.pool[cat] = from.pool[cat] ?? [];
  into.tonight[cat] = from.tonight[cat] ?? [];
  into.tomorrow[cat] = from.tomorrow[cat] ?? [];
  for (const o of into.pool[cat]!.concat(into.tonight[cat]!, into.tomorrow[cat]!)) {
    if (!(o.id in into.hours)) into.hours[o.id] = from.hours[o.id] ?? null;
  }
}

function hasVenues(data: PlanData): boolean {
  return CATEGORY_ORDER.some((c) => (data.tonight[c]?.length ?? 0) + (data.tomorrow[c]?.length ?? 0) + (data.pool[c]?.length ?? 0) > 0);
}

// ── Building a plan ─────────────────────────────────────────────────────

async function buildPlan(input: PlanRequest, emit: Emit): Promise<BuildResult> {
  const warnings: string[] = [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) {
    warnings.push("GOOGLE_PLACES_API_KEY is not set — live results are disabled.");
    return { data: null, warnings, complete: false, usage: newUsage() };
  }

  // 1) What's actually near the pin, from Google → the instant draft.
  const usage = newUsage();
  const lists = await findNearbyLists(input, placesKey, warnings, usage);
  const draft = draftFromLists(lists, input);
  if (hasVenues(draft)) emit({ type: "draft", options: serveOptions(draft, Date.now()) });
  if (!anthropicKey) {
    warnings.push("ANTHROPIC_API_KEY is not set — showing Google's nearby places without AI picks.");
    return { data: hasVenues(draft) ? draft : null, warnings, complete: false, usage };
  }

  // 2) One small AI call per category, all at once; each category is sent
  //    as soon as it's done. A category whose AI call fails keeps its
  //    draft from Google, so the plan is never worse than the draft.
  const result = emptyPlan();
  let aiDone = 0;
  const started = Date.now();
  await Promise.all(
    CATEGORY_ORDER.map(async (cat) => {
      const part = await searchCategory(cat, input, anthropicKey, placesKey, lists, warnings, usage).catch((err) => {
        console.error(`[api/plan] ${cat} search failed`, err);
        return null;
      });
      if (part) aiDone++;
      const use = part ?? draft;
      mergeCategory(result, use, cat);
      emit({ type: "category", category: cat, options: serveCategory(use, cat, Date.now()) });
    })
  );

  console.info(
    `[api/plan] ${input.location} ${input.vibe}: listed ` +
      CATEGORY_ORDER.map((c) => `${c} ${lists[c]?.length ?? 0}`).join(" / ") +
      `; AI done for ${aiDone}/${CATEGORY_ORDER.length} categories in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      `; cost ≈ $${usage.usd.toFixed(3)} (${usage.inputTokens} in / ${usage.outputTokens} out tokens, ` +
      `${usage.webSearches} web searches, ${usage.placesRequests} Places requests)`
  );
  if (aiDone < CATEGORY_ORDER.length) warnings.push(`${CATEGORY_ORDER.length - aiDone} categories are showing Google's nearby places without AI picks.`);
  return { data: hasVenues(result) ? result : null, warnings, complete: aiDone === CATEGORY_ORDER.length, usage };
}

// The draft: Google's nearby places as they are — tiered by Google's price
// level (£££ and up → luxury), priced with that band rather than an
// estimate, and described by their kind.
function draftFromLists(lists: NearbyLists, input: PlanRequest): PlanData {
  const verified: Verified[] = [];
  for (const cat of CATEGORY_ORDER) {
    for (const { place, distanceKm } of lists[cat] ?? []) {
      const level = place.priceLevel ?? "";
      verified.push({
        candidate: {
          category: cat,
          name: place.displayName!.text,
          price_gbp: level === "PRICE_LEVEL_FREE" ? 0 : NaN,
          priceLabel: level && level !== "PRICE_LEVEL_FREE" ? PRICE_LEVEL_LABEL[level] : undefined,
          budget: level === "PRICE_LEVEL_EXPENSIVE" || level === "PRICE_LEVEL_VERY_EXPENSIVE" ? "luxury" : "modest",
          times: ["now", "tonight", "tomorrow"],
          highlight: kindLabel(place),
        },
        place,
        distanceKm,
      });
    }
  }
  return assemble(verified, input);
}

function kindLabel(place: Place): string {
  const kind = (place.primaryType || "").replace(/_/g, " ");
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "";
}

async function searchCategory(
  cat: CategoryKey,
  input: PlanRequest,
  anthropicKey: string,
  placesKey: string,
  lists: NearbyLists,
  warnings: string[],
  usage: SearchUsage
): Promise<PlanData | null> {
  const candidates = await findCandidatesForCategory(cat, input, anthropicKey, lists[cat] ?? [], warnings, usage);
  if (candidates.length === 0) return null;
  const verified = await verifyWithGooglePlaces(candidates, input, placesKey, warnings, lists, usage);
  if (verified.length === 0) return null;
  return assemble(verified, input);
}

// ── AI pick, one category at a time ─────────────────────────────────────

type Candidate = {
  category: CategoryKey;
  name: string;
  price_gbp: number;
  // Draft only: Google's price band ("££") instead of an estimate.
  priceLabel?: string;
  times: TimeKey[];
  budget: BudgetKey;
  highlight: string;
};

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_venues",
  description: "Submit the chosen venues. Call this exactly once, when you've chosen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["venues"],
    properties: {
      venues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "price_gbp", "budget", "times", "highlight"],
          properties: {
            name: {
              type: "string",
              description: "The venue's name exactly as written in the Google list (or as Google Maps would list it, if not from the list).",
            },
            price_gbp: {
              type: "number",
              description: "Typical price in British pounds (GBP) for this category's unit, converted if the venue charges in another currency. 0 if free.",
            },
            budget: {
              type: "string",
              enum: BUDGET_KEYS,
              description: "modest (cheap or free through mid-range) or luxury (premium), relative to the area.",
            },
            times: {
              type: "array",
              items: { type: "string", enum: TIME_KEYS },
              description: "Every timeframe this venue is a good, open option for: now, tonight, tomorrow.",
            },
            highlight: {
              type: "string",
              description: "2-4 word selling point, e.g. 'Trad session 9pm', 'Sea view', 'Tasting menu'. No prices or currency.",
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You choose venues for Landed, an app that builds a night or day out around a pin on a map. Each request is for ONE category.

Choose ${PER_TIER} venues for each budget tier (${PER_TIER * BUDGET_KEYS.length} in total) where the area has them — the person swaps between options within their chosen tier:
- modest: everyday spending — include cheap and free options as well as mid-range ones (roughly half and half where the area has them)
- luxury: premium, special-occasion options

Timeframes ("times" — list every one a venue suits):
- now: open and worth going to at the current local time
- tonight: this evening, local time
- tomorrow: tomorrow, day or evening
Pick venues so that each tier has options for tonight and for tomorrow.

Guidance:
- Choose from the Google Maps list in the request wherever it fits, using names exactly as written — those places are real, open and near the pin. Closer is better among good options. Only add a place that isn't listed if the list has nothing suitable.
- Only choose venues that suit the requested vibe.
- price_gbp is your best current estimate, in British pounds (convert local prices if needed); the list's £–££££ is Google's price level. The app labels prices as estimates.
- Keep "highlight" short.
- When you've chosen, call submit_venues once. Don't write a prose answer.`;

const LIVE_GUIDANCE = `This category is "live": live music, comedy, theatre or similar. Use web search to find what's actually on tonight and tomorrow at these venues (and any nearby ones the list missed). Favour venues with something on, list only the timeframes a show is on, and put the act or show in "highlight", with the day if it's only on one ("Tomorrow: jazz trio").`;

async function findCandidatesForCategory(
  cat: CategoryKey,
  input: PlanRequest,
  apiKey: string,
  list: NearbyPlace[],
  warnings: string[],
  usage: SearchUsage
): Promise<Candidate[]> {
  const model = CATEGORY_MODEL[cat];
  const setup = MODEL_SETUP[model];
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  const vibeLabel = VIBE_OPTIONS.find((o) => o.key === input.vibe)!.label;
  const isLive = cat === "live";
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        `Category: ${cat} (${CATEGORY_LABELS[cat]}) — price_gbp is ${CATEGORY_UNITS[cat]}.\n` +
        `Pin on the map: ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)} — in ${input.location}.\n` +
        // The pin's time zone isn't known here, so give the exact UTC
        // instant and let the model work out local time for the location.
        `Current time: ${new Date().toISOString()} UTC — use the pin's local time for now / tonight / tomorrow.\n` +
        `Vibe: ${vibeLabel} (${input.vibe}).\n\n` +
        (list.length
          ? `Near the pin, from Google Maps (closest first; ★rating (reviews); £–££££ price level):\n` +
            list.map((p) => `- ${describeNearby(p)}`).join("\n")
          : `Google Maps had nothing listed for this category near the pin${isLive ? "" : " — suggest only places you're confident exist within walking distance"}.`) +
        (isLive ? `\n\n${LIVE_GUIDANCE}` : ""),
    },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = isLive
    ? [
        // Only "live" needs the web (what's on); every other category is
        // chosen from its Google list. No user_location: web search rejects
        // some countries in it (e.g. "IE" → 400); the prompt has coordinates.
        { type: setup.webSearch, name: "web_search", max_uses: 2 },
        SUBMIT_TOOL,
      ]
    : [SUBMIT_TOOL];

  let nudged = false;
  // Server-side web search can pause long turns (pause_turn); resume a few
  // times, then give up rather than loop forever.
  for (let i = 0; i < 6; i++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 8000,
        // Server-side refusal fallback (Opus 5): if a safety classifier
        // declines, the API retries on a fallback model in the same call.
        ...(setup.refusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        ...(setup.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
        ...(setup.effort ? { output_config: { effort: "low" as const } } : {}),
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });
      usage.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      usage.outputTokens += response.usage.output_tokens;
      const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
      usage.webSearches += searches;
      usage.usd +=
        (response.usage.input_tokens * setup.usdPerMInput + response.usage.output_tokens * setup.usdPerMOutput) / 1e6 +
        searches * USD_PER_WEB_SEARCH;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        warnings.push("Anthropic rejected ANTHROPIC_API_KEY (401).");
      } else if (err instanceof Anthropic.RateLimitError) {
        warnings.push("Anthropic rate limit hit (429) — try again shortly.");
      } else if (err instanceof Anthropic.APIError) {
        // e.g. "Your credit balance is too low…" arrives as a 400 — pass the
        // API's own message through so it's diagnosable from the browser.
        const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
        warnings.push(`Anthropic API error${err.status ? ` (${err.status})` : ""}${detail ? `: ${detail}` : "."}`);
      } else {
        warnings.push("Couldn't reach the Anthropic API.");
      }
      console.error(`[api/plan] Anthropic request failed (${cat})`, err);
      return [];
    }

    const submit = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_TOOL.name
    );
    if (submit) return sanitizeCandidates(submit.input, cat);

    if (response.stop_reason === "refusal") {
      warnings.push(`AI search declined the ${CATEGORY_LABELS[cat]} request.`);
      return [];
    }
    if (response.stop_reason === "max_tokens") {
      warnings.push(`AI search ran out of output tokens for ${CATEGORY_LABELS[cat]}.`);
      return [];
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    // Finished without calling submit_venues — ask once, then give up.
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Please call submit_venues now with the venues you chose." });
  }
  return [];
}

// strict: true guarantees the schema, but eager parsing / future model
// changes shouldn't be able to crash the route — re-check the shape.
function sanitizeCandidates(input: unknown, cat: CategoryKey): Candidate[] {
  const venues = (input as { venues?: unknown })?.venues;
  if (!Array.isArray(venues)) return [];
  const out: Candidate[] = [];
  for (const v of venues) {
    if (!v || typeof v !== "object") continue;
    const { name, price_gbp, times, budget, highlight } = v as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({
      category: cat,
      name: name.trim().slice(0, 120),
      price_gbp: typeof price_gbp === "number" && isFinite(price_gbp) && price_gbp >= 0 ? price_gbp : NaN,
      // No timeframes given → treat it as suiting all three.
      times: Array.isArray(times) && times.some((t) => TIME_KEYS.includes(t as TimeKey))
        ? (times.filter((t) => TIME_KEYS.includes(t as TimeKey)) as TimeKey[])
        : [...TIME_KEYS],
      budget: BUDGET_KEYS.includes(budget as BudgetKey) ? (budget as BudgetKey) : "modest",
      highlight: typeof highlight === "string" ? highlight.trim().slice(0, 40) : "",
    });
  }
  return out;
}

// ── Google Places: lookups, nearby lists, verification ──────────────────

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  priceLevel?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { periods?: OpeningPeriod[] };
  utcOffsetMinutes?: number;
  types?: string[];
  websiteUri?: string;
  photos?: { name: string; authorAttributions?: { displayName?: string }[] }[];
};
type Verified = { candidate: Candidate; place: Place; distanceKm: number };

const PLACES_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.location",
  "places.businessStatus",
  "places.currentOpeningHours.openNow",
  // For working out "now" at serve time, even from cached results.
  "places.regularOpeningHours.periods",
  "places.utcOffsetMinutes",
  "places.types",
  // Same billing tier as the fields above, so no extra cost per search.
  // (Each photo shown is billed separately — see app/api/photo.)
  "places.photos",
  "places.websiteUri",
].join(",");

// Categories with a clear Places type must match it — otherwise a "car
// park" candidate can verify as the square it's named after, or a
// "restaurant" as the village association that shares its area's name.
// (Live and attractions are too varied to pin down this way.)
const FOOD_TYPES = ["food", "cafe", "meal_takeaway", "meal_delivery", "pub", "bar", "bakery", "food_court"];
const BAR_TYPES = ["bar", "pub", "night_club", "brewpub", "brewery", "winery", "beer_garden", "bar_and_grill"];
const CATEGORY_TYPE_CHECK: Partial<Record<CategoryKey, (types: string[]) => boolean>> = {
  parking: (types) => types.some((t) => ["parking", "parking_garage", "parking_lot"].includes(t)),
  stay: (types) =>
    types.some((t) => ["lodging", "hotel", "bed_and_breakfast", "guest_house", "hostel", "motel", "inn", "resort_hotel"].includes(t)),
  restaurant: (types) => types.some((t) => t.endsWith("restaurant") || FOOD_TYPES.includes(t)),
  // "_bar" suffix covers wine_bar, cocktail_bar, sports_bar… without
  // matching barber_shop.
  bar: (types) => types.some((t) => BAR_TYPES.includes(t) || t.endsWith("_bar")),
};

async function lookupPlace(candidate: Candidate, input: PlanRequest, apiKey: string): Promise<Place | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELDS },
    body: JSON.stringify({
      textQuery: `${candidate.name}, ${input.location}`,
      maxResultCount: 1,
      // Tight bias so a common name ("Costa", "Premier Inn") matches the
      // branch by the pin, not one across town.
      locationBias: { circle: { center: { latitude: input.lat, longitude: input.lng }, radius: 3000 } },
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PlacesError(res.status, detail.slice(0, 300));
  }
  const data = (await res.json()) as { places?: Place[] };
  return data.places?.[0] ?? null;
}

class PlacesError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(`Places API ${status}: ${detail}`);
    this.status = status;
  }
}

// ── Nearby places per category (Google Places Nearby Search) ────────────
//
// Google lists what's actually around the pin in each category. These are
// the instant draft plan, and each category's AI call chooses from its
// list (so it isn't limited to what a web search turns up); anything
// picked from a list is already verified — no separate lookup.
//
// Google returns at most 20 places per request, so restaurants and bars
// (plentiful in town centres) get two: the 20 most popular and the 20
// closest. Lists use each place's *primary* type where secondary types
// would let other categories in (hotels also count as restaurants, etc.).

type NearbyPlace = { place: Place; distanceKm: number };
type NearbyLists = Partial<Record<CategoryKey, NearbyPlace[]>>;

type NearbyQuery = {
  types: string[];
  primary?: boolean; // match on primary type only
  excludePrimary?: string[];
  rank: "POPULARITY" | "DISTANCE";
  radiusKm: number;
};

const STAY_TYPES = ["hotel", "bed_and_breakfast", "guest_house", "inn", "hostel", "motel", "resort_hotel", "extended_stay_hotel", "farmstay"];
const BAR_PRIMARY_TYPES = ["bar", "pub", "night_club", "wine_bar", "cocktail_bar", "sports_bar", "lounge_bar", "irish_pub", "brewpub", "beer_garden", "bar_and_grill", "gastropub", "karaoke"];
const NOT_RESTAURANT_PRIMARY = ["hotel", "lodging", "bed_and_breakfast", "guest_house", "inn", ...BAR_PRIMARY_TYPES.filter((t) => t !== "gastropub" && t !== "bar_and_grill")];
const ATTRACTION_TYPES = [
  "tourist_attraction", "museum", "art_gallery", "park", "bowling_alley", "movie_theater", "amusement_center", "spa",
  "historical_landmark", "zoo", "aquarium", "amusement_park", "ice_skating_rink", "water_park", "botanical_garden",
  "cultural_landmark", "planetarium", "garden",
];
const LIVE_PRIMARY_TYPES = ["live_music_venue", "performing_arts_theater", "concert_hall", "comedy_club", "opera_house", "amphitheatre", "dance_hall", "event_venue", "night_club"];

const NEARBY_QUERIES: Record<CategoryKey, NearbyQuery[]> = {
  stay: [{ types: STAY_TYPES, primary: true, rank: "DISTANCE", radiusKm: MAX_DISTANCE_KM.stay }],
  restaurant: [
    { types: ["restaurant"], excludePrimary: NOT_RESTAURANT_PRIMARY, rank: "POPULARITY", radiusKm: 1.5 },
    { types: ["restaurant"], excludePrimary: NOT_RESTAURANT_PRIMARY, rank: "DISTANCE", radiusKm: 1.5 },
  ],
  bar: [
    { types: BAR_PRIMARY_TYPES, primary: true, rank: "POPULARITY", radiusKm: 1.5 },
    { types: BAR_PRIMARY_TYPES, primary: true, rank: "DISTANCE", radiusKm: 1.5 },
  ],
  attractions: [{ types: ATTRACTION_TYPES, excludePrimary: ["hotel", "lodging", "gym", "fitness_center"], rank: "POPULARITY", radiusKm: MAX_DISTANCE_KM.attractions }],
  live: [{ types: LIVE_PRIMARY_TYPES, primary: true, rank: "POPULARITY", radiusKm: MAX_DISTANCE_KM.live }],
  parking: [{ types: ["parking"], rank: "DISTANCE", radiusKm: MAX_DISTANCE_KM.parking }],
};

// Fewer reviews than this usually means a stale or spam listing (for
// stays, individual holiday lets). Car parks rarely get reviewed.
const MIN_REVIEWS: Record<CategoryKey, number> = { stay: 3, restaurant: 5, bar: 5, attractions: 5, live: 3, parking: 0 };
// In quiet areas, a walking-distance list this short gets one wider retry.
const THIN_LIST = 8;

async function nearbySearch(q: NearbyQuery, radiusKm: number, input: PlanRequest, apiKey: string): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELDS + ",places.userRatingCount,places.primaryType,places.priceLevel",
    },
    body: JSON.stringify({
      [q.primary ? "includedPrimaryTypes" : "includedTypes"]: q.types,
      ...(q.excludePrimary ? { excludedPrimaryTypes: q.excludePrimary } : {}),
      maxResultCount: 20,
      rankPreference: q.rank,
      locationRestriction: { circle: { center: { latitude: input.lat, longitude: input.lng }, radius: radiusKm * 1000 } },
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new PlacesError(res.status, (await res.text().catch(() => "")).slice(0, 300));
  return ((await res.json()) as { places?: Place[] }).places ?? [];
}

async function listCategory(cat: CategoryKey, input: PlanRequest, apiKey: string, usage: SearchUsage): Promise<NearbyPlace[]> {
  const queries = NEARBY_QUERIES[cat];
  const count = () => {
    usage.placesRequests++;
    usage.usd += USD_PER_PLACES_REQUEST;
  };
  queries.forEach(count);
  let places = (await Promise.all(queries.map((q) => nearbySearch(q, q.radiusKm, input, apiKey)))).flat();
  const usable = (list: Place[]) =>
    list.filter(
      (p) =>
        p.location &&
        p.displayName?.text &&
        (!p.businessStatus || p.businessStatus === "OPERATIONAL") &&
        (p.userRatingCount ?? 0) >= MIN_REVIEWS[cat]
    );
  // Quiet area: widen once to the category's limit.
  if (usable(places).length < THIN_LIST && queries[0].radiusKm < MAX_DISTANCE_KM[cat]) {
    count();
    places = places.concat(await nearbySearch(queries[0], MAX_DISTANCE_KM[cat], input, apiKey));
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return usable(places)
    .filter((p) => {
      const name = p.displayName!.text.trim().toLowerCase();
      if (seenIds.has(p.id) || seenNames.has(name)) return false;
      seenIds.add(p.id);
      seenNames.add(name);
      return true;
    })
    .map((place) => ({
      place,
      distanceKm: haversineKm({ lat: input.lat, lng: input.lng }, { lat: place.location!.latitude, lng: place.location!.longitude }),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// All categories in parallel (well under a second). A category whose list
// fails just has no list — its AI call suggests places on its own.
async function findNearbyLists(input: PlanRequest, apiKey: string, warnings: string[], usage: SearchUsage): Promise<NearbyLists> {
  const lists: NearbyLists = {};
  const failed: string[] = [];
  await Promise.all(
    CATEGORY_ORDER.map(async (cat) => {
      try {
        lists[cat] = await listCategory(cat, input, apiKey, usage);
      } catch (err) {
        console.error(`[api/plan] nearby ${cat} list failed`, err);
        failed.push(CATEGORY_LABELS[cat]);
      }
    })
  );
  if (failed.length) warnings.push(`Couldn't list nearby ${failed.join(", ")} from Google; the AI searched for those itself.`);
  return lists;
}

const PRICE_LEVEL_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "£",
  PRICE_LEVEL_MODERATE: "££",
  PRICE_LEVEL_EXPENSIVE: "£££",
  PRICE_LEVEL_VERY_EXPENSIVE: "££££",
};

// One compact line per place for the AI: name, distance, kind, rating, price.
function describeNearby({ place, distanceKm }: NearbyPlace): string {
  const kind = (place.primaryType || place.types?.[0] || "").replace(/_/g, " ");
  const rating = typeof place.rating === "number" ? ` ★${place.rating.toFixed(1)} (${place.userRatingCount ?? 0})` : "";
  const price = place.priceLevel && PRICE_LEVEL_LABEL[place.priceLevel] ? ` ${PRICE_LEVEL_LABEL[place.priceLevel]}` : "";
  return `${place.displayName?.text} — ${distanceKm.toFixed(1)} km — ${kind}${rating}${price}`;
}

// A venue the AI picked from a list: the same Google place, no lookup
// needed. Any category's list counts (a gastropub might be picked as a
// restaurant from the bar list); the category's type check still applies.
function matchNearby(candidate: Candidate, lists: NearbyLists): Place | null {
  const norm = (n: string) => n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const own = lists[candidate.category] ?? [];
  const all = [...own, ...CATEGORY_ORDER.filter((c) => c !== candidate.category).flatMap((c) => lists[c] ?? [])];
  const exact = all.find((n) => norm(n.place.displayName!.text) === norm(candidate.name));
  if (exact) return exact.place;
  return own.find((n) => namesMatch(candidate.name, n.place.displayName!.text))?.place ?? null;
}

async function verifyWithGooglePlaces(
  candidates: Candidate[],
  input: PlanRequest,
  apiKey: string,
  warnings: string[],
  nearbyLists: NearbyLists = {},
  usage?: SearchUsage
): Promise<Verified[]> {
  const results = await Promise.allSettled(
    candidates.map((c) => {
      const fromNearby = matchNearby(c, nearbyLists);
      if (fromNearby) return Promise.resolve(fromNearby);
      if (usage) {
        usage.placesRequests++;
        usage.usd += USD_PER_PLACES_REQUEST;
      }
      return lookupPlace(c, input, apiKey);
    })
  );
  const verified: Verified[] = [];
  let failures = 0;
  let firstError: unknown = null;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failures++;
      firstError ??= r.reason;
      return;
    }
    const place = r.value;
    if (!place?.location || !place.displayName?.text) return;
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") return;
    // Text Search always returns its closest match, even for a name that
    // doesn't exist — reject it unless the names actually share a word.
    if (!namesMatch(candidates[i].name, place.displayName.text)) return;
    const typeCheck = CATEGORY_TYPE_CHECK[candidates[i].category];
    if (typeCheck && !typeCheck(place.types ?? [])) return;
    const distanceKm = haversineKm({ lat: input.lat, lng: input.lng }, { lat: place.location.latitude, lng: place.location.longitude });
    if (distanceKm > MAX_DISTANCE_KM[candidates[i].category]) return;
    verified.push({ candidate: candidates[i], place, distanceKm });
  });
  if (failures > 0) {
    console.error(`[api/plan] ${failures}/${candidates.length} Places lookups failed`, firstError);
    const status = firstError instanceof PlacesError ? ` (${firstError.status})` : "";
    warnings.push(`${failures} of ${candidates.length} Google Places lookups failed${status}.`);
  }
  return verified;
}

const NAME_STOPWORDS = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "bar", "pub", "hotel", "restaurant", "cafe", "&"]);
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t))
  );
}
function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

// Places sometimes prefixes the address with the venue's own name.
function cleanAddress(address: string, name: string): string {
  const prefix = name + ", ";
  return address.startsWith(prefix) ? address.slice(prefix.length) : address;
}


// ── Assemble into the frontend's CategoryOption shape ───────────────────

function hoursOf(place: Place): OpeningHours | null {
  const periods = place.regularOpeningHours?.periods;
  return periods?.length ? { periods, utcOffsetMinutes: place.utcOffsetMinutes } : null;
}

const PHOTOS_PER_VENUE = 1;
function photosOf(place: Place): VenuePhoto[] | undefined {
  const photos = (place.photos ?? []).slice(0, PHOTOS_PER_VENUE).map((p) => ({
    name: p.name,
    author: p.authorAttributions?.[0]?.displayName,
  }));
  return photos.length ? photos : undefined;
}

function assemble(verified: Verified[], input: PlanRequest): PlanData {
  const data = emptyPlan();
  const seen = new Set<string>();
  for (const { candidate, place, distanceKm } of verified) {
    const cat = candidate.category;
    const template = CATEGORY_STYLE[cat];
    const meta = [`${(distanceKm * 0.621371).toFixed(1)} mi`];
    if (typeof place.rating === "number") meta.push(`★ ${place.rating.toFixed(1)} Reviews`);
    if (candidate.highlight) meta.push(candidate.highlight);
    const option: CategoryOption = {
      id: `g-${cat}-${place.id}`,
      tag: template.tag,
      tagBg: template.tagBg,
      title: place.displayName!.text,
      price: candidate.priceLabel ?? formatPrice(candidate.price_gbp),
      // Prices are the AI's estimate, not a quote — say so. (Google's price
      // band in the draft needs no unit.)
      unit: candidate.priceLabel || candidate.price_gbp === 0 || !isFinite(candidate.price_gbp) ? "" : `${CATEGORY_UNITS[cat]} (est.)`,
      address: cleanAddress(place.shortFormattedAddress || place.formattedAddress || "", place.displayName!.text),
      phone: place.internationalPhoneNumber || "",
      // Every search is for one vibe, and only venues suiting it are chosen.
      vibes: [input.vibe],
      meta,
      budget: candidate.budget,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      photos: photosOf(place),
      website: place.websiteUri,
    };
    data.hours[option.id] = hoursOf(place);

    for (const time of ["tonight", "tomorrow"] as const) {
      const key = `${time}|${option.id}`;
      if (!candidate.times.includes(time) || seen.has(key)) continue;
      seen.add(key);
      (data[time][cat] ??= []).push(option);
    }
    // "Now" is decided at serve time from opening hours. A live venue only
    // counts if its show is on now or tonight, not just tomorrow.
    const poolKey = `pool|${option.id}`;
    const liveNotYet = cat === "live" && !candidate.times.some((t) => t === "now" || t === "tonight");
    if (!seen.has(poolKey) && !liveNotYet) {
      seen.add(poolKey);
      (data.pool[cat] ??= []).push(option);
    }
  }
  for (const time of ["tonight", "tomorrow"] as const) {
    for (const cat of Object.keys(data[time]) as CategoryKey[]) data[time][cat] = trimTiers(data[time][cat]!);
  }
  return data;
}

function formatPrice(gbp: number): string {
  if (gbp === 0) return "Free";
  if (!isFinite(gbp)) return "";
  return `£${gbp.toFixed(2)}`;
}
