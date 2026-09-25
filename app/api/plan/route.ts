import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeKey, VibeKey, BudgetKey } from "../../lib/constants";
import { TIME_OPTIONS, VIBE_OPTIONS, BUDGET_OPTIONS } from "../../lib/constants";
import type { CategoryKey, CategoryOption } from "../../lib/categoryOptions";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_OPTIONS } from "../../lib/categoryOptions";
import { GALWAY, haversineKm } from "../../lib/geo";
import { getServerSupabase } from "../../lib/supabase/server";

/**
 * POST /api/plan
 *
 * Body: { location?: string, lat?: number, lng?: number,
 *         vibe: "nightout" | "date" | "family" | "solo" }
 * (lat/lng default to Galway city centre. A `time` field is accepted but
 * ignored — one search covers every timeframe.)
 *
 * Response: { options: { now, tonight, tomorrow }, source, warnings } —
 * each timeframe a Partial<Record<CategoryKey, CategoryOption[]>>, so
 * switching When in the app never needs another search.
 *
 * 1) AI search — Claude with the web_search tool finds live, current
 *    candidates per category, marking which timeframes each suits.
 * 2) Verification — each candidate is looked up in Google Places (New) to
 *    confirm it's real and operating, and to get its canonical address,
 *    phone, rating, and location.
 * 3) Assembly — verified venues are mapped into the same CategoryOption
 *    shape the static catalog uses, so the frontend's existing pick logic
 *    (distance / vibe / budget) ranks them unchanged.
 *
 * Budget isn't sent: every candidate carries an estimated price, and the
 * client applies Modest/Luxury itself, so changing budget never costs
 * another search.
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
 * Never throws to the client. Missing keys, used-up
 * quota, or failed upstream calls come back as 200 with
 * `source: "static"` and a `warnings` list, and the frontend keeps using
 * its fallback. A malformed body is a 400; an IP flood is a 429.
 */

// Claude + web search + ~30 Places lookups can take a minute or more.
export const maxDuration = 300;

type PlanRequest = { location: string; lat: number; lng: number; vibe: VibeKey };
type CategoryResults = Partial<Record<CategoryKey, CategoryOption[]>>;
type LiveOptions = Partial<Record<TimeKey, CategoryResults>>;
const TIME_KEYS = TIME_OPTIONS.map((o) => o.key);
type PlanResponse = { options: LiveOptions; source: "live" | "static"; warnings: string[] };

const DEFAULT_LOCATION = "Galway, Ireland";
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

const MODEL = "claude-opus-5";
// Every venue is labelled with a budget tier, and each tier needs its own
// pool — the plan's pick plus 3 swaps at that budget. So: about this many
// per tier per category (across all three timeframes)…
const PER_TIER = 4;
const BUDGET_KEYS = BUDGET_OPTIONS.map((o) => o.key);
// …and at most this many kept per tier, per category, per timeframe.
const OPTIONS_PER_TIER = 4;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// TESTING: per-user and per-guest search limits are switched off while
// the app is being tested, so every search runs. Set this back to true
// before sharing the app more widely — each uncached search costs about
// $1.20 (Claude + Google Places). The per-IP flood guard below stays on.
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
  const hasCoords = lat !== undefined || lng !== undefined;
  if (hasCoords) {
    if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return `"lat" and "lng" must both be valid coordinates.`;
    }
  }
  return {
    location: (location as string | undefined)?.trim() || DEFAULT_LOCATION,
    lat: hasCoords ? (lat as number) : GALWAY.lat,
    lng: hasCoords ? (lng as number) : GALWAY.lng,
    vibe: vibe as VibeKey,
  };
}

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

  try {
    return NextResponse.json(await handlePlan(parsed, clientIp(req)));
  } catch (err) {
    // Last-resort guard — every step below already catches its own errors.
    console.error("[api/plan] unexpected error", err);
    return NextResponse.json(staticResponse(["Live search failed unexpectedly."]));
  }
}

function staticResponse(warnings: string[]): PlanResponse {
  return { options: {}, source: "static", warnings };
}

async function handlePlan(input: PlanRequest, ip: string): Promise<PlanResponse> {
  const key = cacheKey(input);
  const cached = readCache(key);
  if (cached) return cached;

  // Signed in → the shared per-user quota; otherwise → the per-IP guest
  // quota. (No Supabase, or its auth check failing, just means "guest".)
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
  if (SEARCH_LIMITS_ON) {
    const quotaError = supabase && userId ? await consumeQuota(supabase, userId) : consumeGuestQuota(ip);
    if (quotaError) return staticResponse([quotaError]);
  }

  const value = buildPlan(input);
  writeCache(key, value);
  return value;
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
// Identical requests (same ~1 km area, time, and vibe) share one result
// for 30 minutes, and don't count against anyone's quota. In-memory, per
// server instance — see README for moving this to a shared table.

const cache = new Map<string, { expires: number; value: Promise<PlanResponse> }>();

function cacheKey(input: PlanRequest): string {
  return `${input.lat.toFixed(2)},${input.lng.toFixed(2)}|${input.vibe}`;
}

function readCache(key: string): Promise<PlanResponse> | null {
  const hit = cache.get(key);
  return hit && hit.expires > Date.now() ? hit.value : null;
}

function writeCache(key: string, value: Promise<PlanResponse>) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  // Don't keep failed or empty results around — let the next request retry.
  value.then(
    (v) => {
      if (v.source !== "live") cache.delete(key);
    },
    () => cache.delete(key)
  );
}

async function buildPlan(input: PlanRequest): Promise<PlanResponse> {
  const warnings: string[] = [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!anthropicKey) warnings.push("ANTHROPIC_API_KEY is not set — live AI search is disabled.");
  if (!placesKey) warnings.push("GOOGLE_PLACES_API_KEY is not set — venues can't be verified, so live results are disabled.");
  if (!anthropicKey || !placesKey) return staticResponse(warnings);

  // What's actually near the pin in each category, from Google — the AI
  // chooses from these lists (see findNearbyLists).
  const nearbyLists = await findNearbyLists(input, placesKey, warnings);
  const candidates = await findCandidatesWithAI(input, anthropicKey, warnings, nearbyLists);
  if (candidates.length === 0) return staticResponse(warnings);

  const verified = await verifyWithGooglePlaces(candidates, input, placesKey, warnings, nearbyLists);
  const options = rankAndAssemble(verified, input);
  const count = (t: TimeKey) => Object.values(options[t] ?? {}).reduce((n, o) => n + (o?.length ?? 0), 0);
  const source = TIME_KEYS.some((t) => count(t) > 0) ? "live" : "static";
  if (source === "static") warnings.push("No AI candidates could be verified in Google Places.");
  console.info(
    `[api/plan] ${input.location} ${input.vibe}: listed ` +
      CATEGORY_ORDER.map((c) => `${c} ${nearbyLists[c]?.length ?? 0}`).join(" / ") +
      `; ${candidates.length} candidates, ${verified.length} verified, kept ` +
      TIME_KEYS.map((t) => `${t} ${count(t)}`).join(" / ")
  );
  return { options, source, warnings };
}

// ── Step 1: AI search ───────────────────────────────────────────────────

type Candidate = {
  category: CategoryKey;
  name: string;
  price_gbp: number;
  times: TimeKey[];
  budget: BudgetKey;
  highlight: string;
};

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_venues",
  description:
    "Submit the final list of venue candidates. Call this exactly once, after you have finished searching.",
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
          required: ["category", "name", "price_gbp", "budget", "times", "highlight"],
          properties: {
            category: { type: "string", enum: [...CATEGORY_ORDER] },
            name: {
              type: "string",
              description: "The venue's real business name as it appears on Google Maps — no event names or descriptions.",
            },
            price_gbp: {
              type: "number",
              description: "Typical price in British pounds (GBP) for this category's unit (see instructions), converted if the venue charges in another currency. 0 if free.",
            },
            budget: {
              type: "string",
              enum: BUDGET_KEYS,
              description: "The budget tier this venue belongs to for its category, relative to the area: modest (cheap or free through mid-range) or luxury (premium).",
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

const SYSTEM_PROMPT = `You find real, currently operating venues for Landed, an app that builds a night or day out.

For the requested location and vibe, find strong candidates in EACH of these categories, for all three budget tiers and all three timeframes at once — the app lets the person switch budget and timeframe instantly, so this one search has to serve them all.

Budget tiers (label every venue with one, relative to the area):
- modest: everyday spending — include cheap and free options as well as mid-range ones (roughly half and half where the area has them)
- luxury: premium, special-occasion options
Aim for ${PER_TIER} venues per tier in every category (about ${PER_TIER * BUDGET_KEYS.length} per category) where the area has them — the person swaps between options within their chosen tier, so each tier needs its own choices.

Timeframes:
- now: open and worth going to at the current local time
- tonight: this evening, local time
- tomorrow: tomorrow, day or evening

Categories:
${CATEGORY_ORDER.map((c) => `- ${c} (${CATEGORY_LABELS[c]}): price_gbp is ${CATEGORY_UNITS[c]}`).join("\n")}

Guidance:
- Stay local to the exact coordinates — the person has put a pin on the map and wants what's closest and most convenient to that spot, not the best of the wider town or city. Search the named neighbourhood and its streets, not the whole town.
  - Aim for walking distance: within about 1 km of the pin.
  - Only if a category has nothing good that close, widen to 3 km. Never suggest anything further than ${MAX_DISTANCE_KM.restaurant} km for restaurants, bars and parking, ${MAX_DISTANCE_KM.live} km for live and attractions, or ${MAX_DISTANCE_KM.stay} km for stays — anything beyond is discarded.
  - Among good options, closer is better.
- "times" lists every timeframe a venue suits. Most places suit several; pick venues so that each tier still has a few options for each timeframe — e.g. a daytime café for now, a late bar for tonight.
- Keep "highlight" short; with this many venues, brevity matters.
- "live" means live music, comedy, theatre, or similar. Favour venues with something actually on in a timeframe, and only list the timeframes the show is on. Put the act or show in "highlight", with the day if it's only on one ("Tomorrow: jazz trio").
- Only include places that are currently operating. Skip anything permanently closed.
- "name" must be the venue's business name exactly as Google Maps would list it, since each one is verified against Google Places.
- price_gbp is your best current estimate from what you find, in British pounds (convert local prices if needed). The app labels it as an estimate.
- When you're done, call submit_venues once with everything. Don't write a prose answer.`;


async function findCandidatesWithAI(
  input: PlanRequest,
  apiKey: string,
  warnings: string[],
  nearbyLists: NearbyLists
): Promise<Candidate[]> {
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
  const vibeLabel = VIBE_OPTIONS.find((o) => o.key === input.vibe)!.label;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        `Pin on the map: ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)} — in ${input.location}. Find places closest to this exact spot.\n` +
        // The pin's time zone isn't known here, so give the exact UTC
        // instant and let the model work out local time for the location.
        `Current time: ${new Date().toISOString()} UTC — use the pin's local time for now / tonight / tomorrow.\n` +
        `Vibe: ${vibeLabel} (${input.vibe}) — only choose venues that suit this vibe.` +
        nearbyListsPrompt(nearbyLists),
    },
  ];

  let nudged = false;
  // Server-side web search can pause long turns (pause_turn); resume a few
  // times, then give up rather than loop forever.
  for (let i = 0; i < 6; i++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Server-side refusal fallback: if a safety classifier declines,
        // the API retries on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        // Measured 2026-09-24: low effort + 5 searches matched medium + 8
        // on venue quality and verification rate (27-29 of 30 kept) at
        // about half the input tokens, ~47s vs ~55s.
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            // The Google lists cover "what's nearby"; web search is only
            // for what's on, vibe and prices, so fewer are needed.
            max_uses: 3,
            // No user_location: web search rejects some countries in it
            // (e.g. "IE" → 400), and the prompt already has coordinates.
          },
          SUBMIT_TOOL,
        ],
        messages,
      });
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
      console.error("[api/plan] Anthropic request failed", err);
      return [];
    }

    const submit = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_TOOL.name
    );
    if (submit) return sanitizeCandidates(submit.input);

    if (response.stop_reason === "refusal") {
      warnings.push("AI search declined the request.");
      return [];
    }
    if (response.stop_reason === "max_tokens") {
      warnings.push("AI search ran out of output tokens before submitting results.");
      return [];
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    // Finished without calling submit_venues — ask once, then give up.
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Please call submit_venues now with the venues you found." });
  }
  warnings.push("AI search finished without returning any venues.");
  return [];
}

// strict: true guarantees the schema, but eager parsing / future model
// changes shouldn't be able to crash the route — re-check the shape.
function sanitizeCandidates(input: unknown): Candidate[] {
  const venues = (input as { venues?: unknown })?.venues;
  if (!Array.isArray(venues)) return [];
  const out: Candidate[] = [];
  for (const v of venues) {
    if (!v || typeof v !== "object") continue;
    const { category, name, price_gbp, times, budget, highlight } = v as Record<string, unknown>;
    if (!CATEGORY_ORDER.includes(category as CategoryKey)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({
      category: category as CategoryKey,
      name: name.trim().slice(0, 120),
      price_gbp: typeof price_gbp === "number" && isFinite(price_gbp) && price_gbp >= 0 ? price_gbp : NaN,
      // No timeframes given → treat it as suiting all three ("now" is
      // still checked against Google's live opening hours).
      times: Array.isArray(times) && times.some((t) => TIME_KEYS.includes(t as TimeKey))
        ? (times.filter((t) => TIME_KEYS.includes(t as TimeKey)) as TimeKey[])
        : [...TIME_KEYS],
      budget: BUDGET_KEYS.includes(budget as BudgetKey) ? (budget as BudgetKey) : "modest",
      highlight: typeof highlight === "string" ? highlight.trim().slice(0, 40) : "",
    });
  }
  return out;
}

// ── Step 2: Google Places verification ──────────────────────────────────

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
  types?: string[];
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
  "places.types",
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
// Before the AI search, Google lists what's actually around the pin in
// each category. The AI chooses from these lists (so it isn't limited to
// what a few web searches turn up), and anything it picks from a list is
// already verified — no separate lookup. That makes searches both broader
// and cheaper: ~8 list requests replace ~30 one-by-one verifications.
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

async function listCategory(cat: CategoryKey, input: PlanRequest, apiKey: string): Promise<NearbyPlace[]> {
  const queries = NEARBY_QUERIES[cat];
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
// fails just has no list — the AI finds that category itself, as before.
async function findNearbyLists(input: PlanRequest, apiKey: string, warnings: string[]): Promise<NearbyLists> {
  const lists: NearbyLists = {};
  const failed: string[] = [];
  await Promise.all(
    CATEGORY_ORDER.map(async (cat) => {
      try {
        lists[cat] = await listCategory(cat, input, apiKey);
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

function nearbyListsPrompt(lists: NearbyLists): string {
  const sections = CATEGORY_ORDER.filter((c) => lists[c]?.length).map(
    (c) => `${c} (${CATEGORY_LABELS[c]}):\n` + lists[c]!.map((p) => `- ${describeNearby(p)}`).join("\n")
  );
  if (sections.length === 0) return "";
  return (
    `\n\nWhat's actually near the pin, from Google Maps (closest first; ★rating (reviews); £–££££ price level):\n\n` +
    sections.join("\n\n") +
    `\n\nChoose venues from these lists wherever they fit, using the names exactly as written — they're real, open, and nearby. ` +
    `Use web search for what the lists can't tell you: what's on (especially live), what suits the vibe, and prices. ` +
    `Only add a place that isn't listed if a category has nothing suitable.`
  );
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
  nearbyLists: NearbyLists = {}
): Promise<Verified[]> {
  const results = await Promise.allSettled(
    candidates.map((c) => {
      const fromNearby = matchNearby(c, nearbyLists);
      return fromNearby ? Promise.resolve(fromNearby) : lookupPlace(c, input, apiKey);
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

const NAME_STOPWORDS = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "bar", "pub", "hotel", "restaurant", "cafe", "galway", "&"]);
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

// ── Step 3: Assemble into the frontend's CategoryOption shape ───────────

function rankAndAssemble(verified: Verified[], input: PlanRequest): LiveOptions {
  const options: LiveOptions = {};
  const seen = new Set<string>();
  for (const { candidate, place, distanceKm } of verified) {
    const cat = candidate.category;
    const template = CATEGORY_OPTIONS[cat][0];
    // Every search is for one vibe, and only venues suiting it are chosen —
    // so each is tagged with just that vibe (the AI doesn't spend time
    // tagging vibes nobody asked for).
    const vibes = [input.vibe];
    const meta = [`${(distanceKm * 0.621371).toFixed(1)} mi`];
    if (typeof place.rating === "number") meta.push(`★ ${place.rating.toFixed(1)} Reviews`);
    if (candidate.highlight) meta.push(candidate.highlight);
    const option: CategoryOption = {
      id: `g-${cat}-${place.id}`,
      tag: template.tag,
      tagBg: template.tagBg,
      title: place.displayName!.text,
      price: formatPrice(candidate.price_gbp),
      // Prices are the AI's estimate, not a quote — say so.
      unit: candidate.price_gbp === 0 ? "" : `${CATEGORY_UNITS[cat]} (est.)`,
      address: cleanAddress(place.shortFormattedAddress || place.formattedAddress || "", place.displayName!.text),
      phone: place.internationalPhoneNumber || "",
      vibes,
      meta,
      budget: candidate.budget,
    };

    for (const time of candidate.times) {
      const key = `${time}|${cat}|${place.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // "Now" means open now, by Google's live opening hours — except a
      // stay or car park, which you can head to regardless.
      if (time === "now" && place.currentOpeningHours?.openNow === false && cat !== "stay" && cat !== "parking") continue;
      ((options[time] ??= {})[cat] ??= []).push(option);
    }
  }
  // Closest first (matching how the static catalog reads in the swap
  // sheet), keeping the nearest OPTIONS_PER_TIER in each budget tier.
  for (const byCat of Object.values(options)) {
    if (!byCat) continue;
    for (const cat of Object.keys(byCat) as CategoryKey[]) {
      const sorted = byCat[cat]!.sort((a, b) => parseFloat(a.meta[0]) - parseFloat(b.meta[0]));
      const perTier = new Map<string, number>();
      byCat[cat] = sorted.filter((o) => {
        const n = perTier.get(o.budget ?? "modest") ?? 0;
        perTier.set(o.budget ?? "modest", n + 1);
        return n < OPTIONS_PER_TIER;
      });
    }
  }
  return options;
}

function formatPrice(gbp: number): string {
  if (gbp === 0) return "Free";
  if (!isFinite(gbp)) return "";
  return `£${gbp.toFixed(2)}`;
}
