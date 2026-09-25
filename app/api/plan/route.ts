import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeKey, VibeKey } from "../../lib/constants";
import { TIME_OPTIONS, VIBE_OPTIONS } from "../../lib/constants";
import type { CategoryKey, CategoryOption } from "../../lib/categoryOptions";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_OPTIONS } from "../../lib/categoryOptions";
import { GALWAY, haversineKm } from "../../lib/geo";
import { getServerSupabase } from "../../lib/supabase/server";

/**
 * POST /api/plan
 *
 * Body: { location?: string, lat?: number, lng?: number,
 *         time: "now" | "tonight" | "tomorrow",
 *         vibe: "nightout" | "date" | "family" | "solo" }
 * (lat/lng default to Galway city centre.)
 *
 * 1) AI search — Claude with the web_search tool finds live, current
 *    candidates per category for the intake.
 * 2) Verification — each candidate is looked up in Google Places (New) to
 *    confirm it's real and operating, and to get its canonical address,
 *    phone, rating, and location.
 * 3) Assembly — verified venues are mapped into the same CategoryOption
 *    shape the static catalog uses, so the frontend's existing pick logic
 *    (distance / vibe / budget) ranks them unchanged.
 *
 * Budget isn't sent: every candidate carries an estimated price, and the
 * client applies Low/Modest/Luxury itself, so changing budget never costs
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

type PlanRequest = { location: string; lat: number; lng: number; time: TimeKey; vibe: VibeKey };
type LiveOptions = Partial<Record<CategoryKey, CategoryOption[]>>;
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
const CANDIDATES_PER_CATEGORY = 5;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

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
  if (!TIME_OPTIONS.some((o) => o.key === time)) return `"time" must be one of: ${TIME_OPTIONS.map((o) => o.key).join(", ")}.`;
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
    time: time as TimeKey,
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
  const quotaError = supabase && userId ? await consumeQuota(supabase, userId) : consumeGuestQuota(ip);
  if (quotaError) return staticResponse([quotaError]);

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
  return `${input.lat.toFixed(2)},${input.lng.toFixed(2)}|${input.time}|${input.vibe}`;
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

  const candidates = await findCandidatesWithAI(input, anthropicKey, warnings);
  if (candidates.length === 0) return staticResponse(warnings);

  const verified = await verifyWithGooglePlaces(candidates, input, placesKey, warnings);
  const options = rankAndAssemble(verified, input);
  const source = Object.keys(options).length > 0 ? "live" : "static";
  if (source === "static") warnings.push("No AI candidates could be verified in Google Places.");
  console.info(
    `[api/plan] ${input.location} ${input.time}/${input.vibe}: ${candidates.length} candidates, ${verified.length} verified, ` +
      `${Object.values(options).reduce((n, o) => n + (o?.length ?? 0), 0)} kept`
  );
  return { options, source, warnings };
}

// ── Step 1: AI search ───────────────────────────────────────────────────

type Candidate = {
  category: CategoryKey;
  name: string;
  price_gbp: number;
  vibes: VibeKey[];
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
          required: ["category", "name", "price_gbp", "vibes", "highlight"],
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
            vibes: {
              type: "array",
              items: { type: "string", enum: VIBE_OPTIONS.map((o) => o.key) },
              description: "Every vibe this venue genuinely suits.",
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

For the requested location, timeframe, and vibe, use web search to find up to ${CANDIDATES_PER_CATEGORY} strong candidates in EACH of these categories:
${CATEGORY_ORDER.map((c) => `- ${c} (${CATEGORY_LABELS[c]}): price_gbp is ${CATEGORY_UNITS[c]}`).join("\n")}

Guidance:
- Stay local to the exact coordinates — the person has put a pin on the map and wants what's closest and most convenient to that spot, not the best of the wider town or city. Search the named neighbourhood and its streets, not the whole town.
  - Aim for walking distance: within about 1 km of the pin.
  - Only if a category has nothing good that close, widen to 3 km. Never suggest anything further than ${MAX_DISTANCE_KM.restaurant} km for restaurants, bars and parking, ${MAX_DISTANCE_KM.live} km for live and attractions, or ${MAX_DISTANCE_KM.stay} km for stays — anything beyond is discarded.
  - Among good options, closer is better.
- Include a spread of price points (budget through premium) in every category where the area has them, so the user's budget setting has real choices.
- "live" means live music, comedy, theatre, or similar. Favour venues with something actually on during the timeframe, and put the act or show in "highlight".
- Only include places you have good evidence are open for business now. Skip anything permanently closed.
- "name" must be the venue's business name exactly as Google Maps would list it, since each one is verified against Google Places.
- price_gbp is your best current estimate from what you find, in British pounds (convert local prices if needed). The app labels it as an estimate.
- When you're done, call submit_venues once with everything. Don't write a prose answer.`;

// The venue's local time zone isn't known here, so give the model the
// exact UTC instant and let it work out local time for the location.
function describeTimeframe(time: TimeKey): string {
  const now = new Date().toISOString();
  if (time === "now") return `right now (current time: ${now} UTC — use the location's local time)`;
  if (time === "tonight") return `tonight, local time (current time: ${now} UTC)`;
  return `tomorrow, local time (current time: ${now} UTC)`;
}

async function findCandidatesWithAI(input: PlanRequest, apiKey: string, warnings: string[]): Promise<Candidate[]> {
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
  const vibeLabel = VIBE_OPTIONS.find((o) => o.key === input.vibe)!.label;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        `Pin on the map: ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)} — in ${input.location}. Find places closest to this exact spot.\n` +
        `Timeframe: ${describeTimeframe(input.time)}\nVibe: ${vibeLabel} (${input.vibe})`,
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
            max_uses: 5,
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
  const vibeKeys = VIBE_OPTIONS.map((o) => o.key) as string[];
  const out: Candidate[] = [];
  for (const v of venues) {
    if (!v || typeof v !== "object") continue;
    const { category, name, price_gbp, vibes, highlight } = v as Record<string, unknown>;
    if (!CATEGORY_ORDER.includes(category as CategoryKey)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({
      category: category as CategoryKey,
      name: name.trim().slice(0, 120),
      price_gbp: typeof price_gbp === "number" && isFinite(price_gbp) && price_gbp >= 0 ? price_gbp : NaN,
      vibes: Array.isArray(vibes) ? (vibes.filter((x) => vibeKeys.includes(x as string)) as VibeKey[]) : [],
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

async function verifyWithGooglePlaces(
  candidates: Candidate[],
  input: PlanRequest,
  apiKey: string,
  warnings: string[]
): Promise<Verified[]> {
  const results = await Promise.allSettled(candidates.map((c) => lookupPlace(c, input, apiKey)));
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
    const key = `${cat}|${place.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // "Now" means open now — except a stay or car park, which you can
    // head to regardless.
    if (input.time === "now" && place.currentOpeningHours?.openNow === false && cat !== "stay" && cat !== "parking") continue;

    const template = CATEGORY_OPTIONS[cat][0];
    const vibes = candidate.vibes.length > 0 ? candidate.vibes : [input.vibe];
    const meta = [`${(distanceKm * 0.621371).toFixed(1)} mi`];
    if (typeof place.rating === "number") meta.push(`★ ${place.rating.toFixed(1)} Reviews`);
    if (candidate.highlight) meta.push(candidate.highlight);

    (options[cat] ??= []).push({
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
    });
  }
  // Closest first, matching how the static catalog reads in the swap sheet.
  for (const cat of Object.keys(options) as CategoryKey[]) {
    options[cat]!.sort((a, b) => parseFloat(a.meta[0]) - parseFloat(b.meta[0]));
  }
  return options;
}

function formatPrice(gbp: number): string {
  if (gbp === 0) return "Free";
  if (!isFinite(gbp)) return "";
  return `£${gbp.toFixed(2)}`;
}
