// Server-side: what's known locally about the venues around a pin, from
// sources that say what's genuinely good (or not) — used by /api/plan as
// signals for the AI's picks and shown on cards as badges linking to the
// source. Nothing is invented: a badge only appears when a source lists
// that venue.
//
// Sources (all run in parallel, per area, cached for 7 days):
// - Food Standards Agency hygiene ratings (free, official) — restaurants,
//   pubs and bars, takeaways, hotels.
// - Wikipedia — notable places near the pin, with a short description.
// - OpenStreetMap — facts such as beer gardens, real ale, step-free access.
// - A "local scout": an AI call with web search restricted to trusted
//   guides (Michelin, Good Food Guide, Time Out, CAMRA, Atlas Obscura…),
//   returning which venues they recommend (or warn about),
//   with the page it came from. Only the fact of a listing and a short
//   paraphrase are kept — never the guide's own text.

import Anthropic from "@anthropic-ai/sdk";
import type { CategoryKey, Badge } from "./categoryOptions";
import { getAdminSupabase } from "./supabase/admin";
// Matching a source's name for a venue to Google's: brackets, generic
// words ("Inn", "Pub", "Hotel"…) and the town's own name are ignored, so
// CAMRA's "Boot Inn" is Google's "The Boot (Home to Boot Cantina)" and the
// Michelin Guide's "Thompson St Albans" is Google's "Thompson".
const GENERIC = new Set([
  "the", "a", "an", "at", "of", "and", "in", "on", "st", "saint", "ltd", "uk", "co",
  "inn", "pub", "bar", "restaurant", "hotel", "cafe", "kitchen", "tavern", "brasserie", "bistro", "grill",
]);
function coreWords(name: string, area: string): string[] {
  const areaWords = new Set(words(area));
  return words(name.replace(/\([^)]*\)/g, " ")).filter((w) => !GENERIC.has(w) && !areaWords.has(w));
}
function words(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// For sources with a location (hygiene, Wikipedia, OpenStreetMap): the
// names match either way round AND the two are within a short walk —
// "White Hart Tap" and "The White Hart" share words but not an address.
function metres(a: Pos, b: Pos): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
function samePlace(venue: string, pos: Pos | undefined, source: string, sourcePos: Pos | undefined, area: string, withinM: number): boolean {
  if (pos && sourcePos) {
    if (metres(pos, sourcePos) > withinM) return false;
    return sameVenue(venue, source, area) || sameVenue(source, venue, area);
  }
  return sameVenue(venue, source, area);
}
// One-way: every meaningful word of the source's name must be in the
// venue's — so "White Hart Tap" (a different pub) never matches "The White
// Hart" hotel, while "Boot Inn" still matches "The Boot".
function sameVenue(venue: string, source: string, area = ""): boolean {
  const v = new Set(coreWords(venue, area));
  const src = coreWords(source, area);
  return v.size > 0 && src.length > 0 && src.every((w) => v.has(w));
}


type Pos = { lat: number; lng: number };
type Hygiene = { name: string; rating: string; type: string; url: string; pos?: Pos };
type WikiPlace = { title: string; url: string; extract: string; pos?: Pos };
type OsmPlace = { name: string; features: string[]; pos?: Pos };
type GuideFinding = { name: string; category: string; source: string; label: string; url: string; note: string; tone: "good" | "warn" };

export type Knowledge = {
  hygiene: Hygiene[];
  wiki: WikiPlace[];
  osm: OsmPlace[];
  guides: GuideFinding[];
};
const EMPTY: Knowledge = { hygiene: [], wiki: [], osm: [], guides: [] };

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_AGENT = "LandedApp/1.0 (local recommendations; contact via landed app)";

// radiusKm: how far out to look — follows the radius slider.
type Place = { lat: number; lng: number; location: string; radiusKm: number };
type Usage = (u: { inputTokens: number; outputTokens: number; webSearches: number; usd: number }) => void;

// ── Cache (memory, then the shared plan_cache table) ─────────────────────

const memory = new Map<string, { expires: number; data: Knowledge }>();
const keyFor = (p: Place) => `lk6|${p.lat.toFixed(2)},${p.lng.toFixed(2)}|${Math.round(p.radiusKm)}`;

async function readCache(key: string): Promise<Knowledge | null> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const admin = getAdminSupabase();
  if (!admin) return null;
  try {
    const { data } = await admin.from("plan_cache").select("data").eq("key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
    const k = (data?.data as Knowledge | undefined) ?? null;
    if (k) memory.set(key, { expires: Date.now() + TTL_MS, data: k });
    return k;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: Knowledge) {
  memory.set(key, { expires: Date.now() + TTL_MS, data });
  const admin = getAdminSupabase();
  if (!admin) return;
  try {
    await admin.from("plan_cache").upsert({ key, data, expires_at: new Date(Date.now() + TTL_MS).toISOString() });
  } catch (err) {
    console.warn("[local] cache write failed", err);
  }
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ── Food hygiene (Food Standards Agency) ─────────────────────────────────

const FSA_TYPES = [1, 7843, 7844, 7842]; // restaurant/cafe, pub/bar/nightclub, takeaway, hotel/B&B

async function fetchHygiene(p: Place): Promise<Hygiene[]> {
  const pages = await Promise.all(
    FSA_TYPES.map((type) =>
      getJson(
        `https://api.ratings.food.gov.uk/Establishments?latitude=${p.lat}&longitude=${p.lng}&maxDistanceLimit=${Math.max(1, Math.min(10, p.radiusKm / 1.6)).toFixed(1)}&businessTypeId=${type}&pageSize=500&pageNumber=1`,
        { headers: { "x-api-version": "2", Accept: "application/json" } }
      ).catch(() => null)
    )
  );
  return pages.flatMap((d) =>
    ((d as { establishments?: { BusinessName: string; RatingValue: string; BusinessType: string; FHRSID: number; geocode?: { latitude?: string; longitude?: string } }[] } | null)?.establishments ?? []).map((e) => ({
      name: e.BusinessName,
      rating: String(e.RatingValue),
      type: e.BusinessType,
      url: `https://ratings.food.gov.uk/business/${e.FHRSID}`,
      pos: e.geocode?.latitude && e.geocode?.longitude ? { lat: Number(e.geocode.latitude), lng: Number(e.geocode.longitude) } : undefined,
    }))
  );
}

// ── Wikipedia (notable places near the pin) ──────────────────────────────

async function fetchWikipedia(p: Place): Promise<WikiPlace[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "geosearch",
    ggscoord: `${p.lat}|${p.lng}`,
    ggsradius: String(Math.min(10000, Math.max(3000, Math.round(p.radiusKm * 1000 * 2)))),
    ggslimit: "40",
    prop: "extracts|info|coordinates",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    exlimit: "max",
    inprop: "url",
    format: "json",
    origin: "*",
  });
  const d = (await getJson("https://en.wikipedia.org/w/api.php?" + params, { headers: { "User-Agent": USER_AGENT } })) as {
    query?: { pages?: Record<string, { title: string; fullurl?: string; extract?: string; coordinates?: { lat: number; lon: number }[] }> };
  };
  return Object.values(d.query?.pages ?? {})
    .filter((pg) => pg.fullurl)
    .map((pg) => ({
      title: pg.title,
      url: pg.fullurl!,
      extract: (pg.extract ?? "").slice(0, 280),
      pos: pg.coordinates?.[0] ? { lat: pg.coordinates[0].lat, lng: pg.coordinates[0].lon } : undefined,
    }));
}

// ── OpenStreetMap (venue facts) ──────────────────────────────────────────

const OSM_FEATURES: [string, string, string][] = [
  ["beer_garden", "yes", "Beer garden"],
  ["real_ale", "yes", "Real ale"],
  ["outdoor_seating", "yes", "Outdoor seating"],
  ["wheelchair", "yes", "Step-free"],
  ["dog", "yes", "Dog-friendly"],
  ["live_music", "yes", "Live music"],
];

async function fetchOsm(p: Place): Promise<OsmPlace[]> {
  const q = `[out:json][timeout:20];nwr(around:${Math.min(2000, Math.round(p.radiusKm * 1000))},${p.lat},${p.lng})["amenity"~"^(pub|bar|restaurant|cafe|biergarten|nightclub)$"]["name"];out tags center;`;
  // The public Overpass servers are free and sometimes busy (504): try the
  // main one, then a mirror.
  const post = (host: string) =>
    getJson(host, { method: "POST", headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) }, 20000);
  const d = (await post("https://overpass-api.de/api/interpreter").catch(() => post("https://overpass.kumi.systems/api/interpreter"))) as {
    elements?: { tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number } }[];
  };
  return (d.elements ?? [])
    .map((e) => {
      const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : undefined);
      return {
        name: e.tags?.name ?? "",
        features: OSM_FEATURES.filter(([k, v]) => e.tags?.[k] === v).map(([, , label]) => label),
        pos: at ? { lat: at.lat, lng: at.lon } : undefined,
      };
    })
    .filter((o) => o.name && o.features.length);
}

// ── Local scout: trusted guides, regional media, local voices ───────────
//
// Several searches run in parallel, each an AI call with web search:
// - food & drink: national guides and awards
// - stays & attractions: hotel guides, heritage, the unusual
// - regional: the area's own what's-on and food media, when the pin is in
//   a region we know (London, the North West, the Midlands, Yorkshire,
//   Nottingham, Bristol and the South West, Scotland)
// - local voices: independent local blogs and Substack newsletters,
//   searched across the web (big aggregators excluded)

const FOOD_DRINK_SOURCES = [
  "guide.michelin.com", "thegoodfoodguide.co.uk", "hardens.com", "hot-dinners.com", "theinfatuation.com",
  "squaremeal.co.uk", "timeout.com", "whatpub.com", "camra.org.uk", "top50gastropubs.com", "theworlds50best.com",
  "ra.co",
  // Awards and "best of" lists
  "nationalrestaurantawards.co.uk", "theaa.com", "thegoodpubguide.co.uk", "theguardian.com",
];
const STAY_SEE_SOURCES = [
  "guide.michelin.com", "mrandmrssmith.com", "sawdays.co.uk", "goodhotelguide.com", "timeout.com",
  "atlasobscura.com", "nationaltrust.org.uk", "english-heritage.org.uk",
  // Awards and "best of" lists
  "thetimes.com", "telegraph.co.uk", "cntraveller.com", "visitengland.com", "secretescapes.com",
];

// Regional media, by a rough box around each region.
type Region = { name: string; box: [number, number, number, number]; domains: string[] }; // [minLat, maxLat, minLng, maxLng]
const REGIONS: Region[] = [
  { name: "London", box: [51.28, 51.7, -0.52, 0.34], domains: ["secretldn.com", "londonist.com", "thenudge.com", "standard.co.uk", "hot-dinners.com", "timeout.com"] },
  { name: "Manchester and the North West", box: [53.2, 54.1, -3.2, -1.9], domains: ["themanc.com", "manchestersfinest.com", "confidentials.com", "ilovemanchester.com", "secretmanchester.com", "manchestereveningnews.co.uk", "liverpoolecho.co.uk"] },
  { name: "Birmingham and the Midlands", box: [52.2, 52.85, -2.35, -1.3], domains: ["confidentials.com", "birminghammail.co.uk", "brumhour.co.uk", "secretbirmingham.com"] },
  { name: "Leeds and Yorkshire", box: [53.35, 54.3, -2.1, -0.9], domains: ["leedslist.com", "yorkshireeveningpost.co.uk", "yorkshirepost.co.uk", "secretleeds.com", "confidentials.com"] },
  { name: "Nottingham", box: [52.85, 53.1, -1.35, -1.0], domains: ["leftlion.co.uk", "nottinghampost.com"] },
  { name: "Bristol and the South West", box: [51.25, 51.65, -2.85, -2.35], domains: ["bristol247.com", "secretbristol.com", "bristolpost.co.uk"] },
  { name: "Scotland", box: [54.6, 60.9, -8.0, -0.7], domains: ["list.co.uk", "edinburghnews.scotsman.com", "glasgowlive.co.uk", "secretedinburgh.com", "secretglasgow.com"] },
];
function regionFor(p: Place): Region | null {
  return REGIONS.find(({ box: [a, b, c, d] }) => p.lat >= a && p.lat <= b && p.lng >= c && p.lng <= d) ?? null;
}

// Local voices: anywhere on the web except the big aggregators and sites
// that aren't a local person's own view.
const NOT_LOCAL_VOICES = [
  "tripadvisor.com", "tripadvisor.co.uk", "yelp.com", "yelp.co.uk", "google.com", "facebook.com", "instagram.com", "tiktok.com",
  "booking.com", "expedia.co.uk", "hotels.com", "opentable.co.uk", "thefork.co.uk", "designmynight.com", "ubereats.com",
  "deliveroo.co.uk", "just-eat.co.uk", "wikipedia.org", "reddit.com",
];

// Sites the search tool can't read (they block its crawler) — naming one
// in allowed_domains fails the whole request, so they're dropped and
// remembered here once seen.
const BLOCKED = new Set<string>([
  "reddit.com", "eater.com", "theguardian.com", "thetimes.com", "telegraph.co.uk", "cntraveller.com",
  "manchestereveningnews.co.uk", "liverpoolecho.co.uk",
]);

type ScoutSpec = {
  name: string;
  what: string;
  sources: string; // how to describe where to look, in the prompt
  allowed?: string[];
  blocked?: string[];
  labels: string; // example badges
};

const FINDINGS_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_findings",
  description: "Submit what the trusted sources and locals said. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "category", "source", "label", "url", "note", "tone"],
          properties: {
            name: { type: "string", description: "One real venue's own name, as the source gives it. Never a list, an article title or a description." },
            category: { type: "string", enum: ["stay", "restaurant", "attractions", "bar", "live"] },
            source: { type: "string", description: "The source's name, e.g. 'Michelin Guide', 'Time Out', 'The Manc', or a blog or newsletter's name." },
            label: { type: "string", description: "A short badge, 2-5 words." },
            url: { type: "string", description: "The exact page you found it on." },
            note: { type: "string", description: "Up to 12 words, your own paraphrase of what they say. No quotes." },
            tone: { type: "string", enum: ["good", "warn"], description: "warn only for a clear warning: closed, gone downhill, poor recent experiences." },
          },
        },
      },
    },
  },
};

// The search limit covers the scout's whole conversation, not each turn:
// once it's used up every further search fails, so it's told its budget.
const SCOUT_SEARCHES = 10;

function scoutSpecs(p: Place): ScoutSpec[] {
  const specs: ScoutSpec[] = [
    {
      name: "food",
      what: "restaurants, pubs, bars, cocktail bars, nightlife and live music or comedy venues",
      sources: "trusted guides and awards (Michelin, Good Food Guide, Harden's, CAMRA Good Beer Guide, Good Pub Guide, National Restaurant Awards, AA Rosettes, Observer Food Monthly awards, Time Out)",
      allowed: FOOD_DRINK_SOURCES,
      labels: "'Michelin Bib Gourmand', 'Good Food Guide', 'CAMRA Good Beer Guide', 'AA Rosette', 'National Restaurant Awards'",
    },
    {
      name: "stays",
      what: "hotels, inns and B&Bs, and attractions (museums, landmarks, historic sites, unusual or hidden places)",
      sources: "trusted hotel guides and awards (Michelin Keys, Mr & Mrs Smith, Sawday's, Good Hotel Guide, Sunday Times best places to stay, Condé Nast Traveller, Secret Escapes) and heritage and curiosity guides (Atlas Obscura, National Trust, English Heritage, VisitEngland awards)",
      allowed: STAY_SEE_SOURCES,
      labels: "'Good Hotel Guide', 'Sunday Times best places to stay', 'Atlas Obscura', 'English Heritage'",
    },
    {
      name: "local voices",
      what: "restaurants, cafés, pubs, bars, nightlife, stays and things to do",
      sources:
        "independent local voices: local food and lifestyle blogs and Substack newsletters written by people who live there. Only use a blog or newsletter with a named local author and posts from the last three years — skip SEO listicles, chains, tourism sites and aggregators. Search e.g. '<town> food blog', '<town> substack', 'best independent <town>'",
      blocked: NOT_LOCAL_VOICES,
      labels: "'Local blog: Eat St Albans', 'Newsletter: The Herts Table'",
    },
  ];
  const region = regionFor(p);
  if (region) {
    specs.push({
      name: `regional (${region.name})`,
      what: "restaurants, cafés, pubs, bars, nightlife, live venues and things to do",
      sources: `${region.name}'s own what's-on and food media`,
      allowed: region.domains,
      labels: "'The Manc pick', 'Secret London', 'Confidentials review'",
    });
  }
  return specs;
}

async function scout(p: Place, apiKey: string, spec: ScoutSpec, onUsage: Usage): Promise<GuideFinding[]> {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  let allowed = spec.allowed?.filter((d) => !BLOCKED.has(d));
  const system = `You gather honest local knowledge for Landed, an app that plans a night or day out around a pin on a map. You search trusted guides and local voices and report which specific venues near the pin they recommend — or warn about. Report only venues you actually found in search results, with the page URL. Never invent a listing or an award. Paraphrase briefly; don't quote.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        `Area: ${p.location} (pin at ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}). Venues within about ${Math.round(p.radiusKm)} km of the pin, plus any exceptional ones a little further out.\n` +
        `Find ${spec.what} that ${spec.sources} recommend, and anything they warn about. Badges look like ${spec.labels}.\n` +
        `You have ${SCOUT_SEARCHES} web searches in total — plan them, naming the town in each. Up to 25 findings. Then call submit_findings.`,
    },
  ];
  const webSearch = () =>
    ({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: SCOUT_SEARCHES,
      ...(allowed ? { allowed_domains: allowed } : {}),
      ...(spec.blocked ? { blocked_domains: spec.blocked } : {}),
    }) as Anthropic.Beta.BetaToolUnion;
  for (let i = 0; i < 6; i++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system,
        tools: [webSearch(), FINDINGS_TOOL],
        messages,
      });
    } catch (err) {
      // A site that blocks the search crawler: drop it and try again.
      const m = String((err as Error)?.message ?? "").match(/not accessible to our user agent: \[([^\]]*)\]/);
      if (m && allowed) {
        const bad = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        bad.forEach((d) => BLOCKED.add(d));
        console.warn(`[local] scout (${spec.name}): dropped sites that block search: ${bad.join(", ")}`);
        allowed = allowed.filter((d) => !bad.includes(d));
        if (allowed.length) continue;
      }
      throw err;
    }
    const searches = res.usage.server_tool_use?.web_search_requests ?? 0;
    onUsage({
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      webSearches: searches,
      usd: (res.usage.input_tokens * 2 + res.usage.output_tokens * 10) / 1e6 + searches * 0.01,
    });
    if (process.env.LOCAL_DEBUG) {
      for (const b of res.content) {
        if (b.type === "server_tool_use") console.info("  search:", JSON.stringify(b.input));
        if (b.type === "web_search_tool_result") {
          const c = b.content as unknown;
          console.info("  results:", Array.isArray(c) ? (c as { title?: string; url?: string }[]).map((r) => r.url).join(" , ").slice(0, 400) : JSON.stringify(c).slice(0, 200));
        }
        if (b.type === "text") console.info("  text:", b.text.slice(0, 300));
      }
    }
    const submit = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === FINDINGS_TOOL.name);
    if (submit) {
      const findings = (submit.input as { findings?: GuideFinding[] }).findings ?? [];
      const kept = findings.filter((f) => {
        if (!f.name || !f.url || !/^https:\/\//.test(f.url)) return false;
        let host: string;
        try {
          host = new URL(f.url).hostname;
        } catch {
          return false;
        }
        return (
          // From where it was meant to look.
          (allowed ? allowed.some((d) => host.endsWith(d)) : !(spec.blocked ?? []).some((d) => host.endsWith(d))) &&
          // A list or a description rather than a venue.
          !/^(restaurants|pubs|bars|hotels|things to do|best)\b|\b(restaurants|pubs|bars|hotels|listings)$|\(|survey|outfit/i.test(f.name) &&
          // CAMRA's database lists every pub and Resident Advisor every club:
          // only the Good Beer Guide, an award or "best of", or a warning
          // (e.g. closed) is worth anything from them.
          (!/camra\.org\.uk|whatpub\.com|ra\.co/.test(host) || f.tone === "warn" || /good beer guide|of the year|award|best|top/i.test(`${f.label} ${f.note}`))
        );
      });
      console.info(`[local] scout (${spec.name}): ${findings.length} found, ${kept.length} kept`);
      return kept;
    }
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    messages.push({ role: "user", content: "Please call submit_findings now." });
  }
  console.warn(`[local] scout (${spec.name}): never submitted findings`);
  return [];
}

// ── Entry point ──────────────────────────────────────────────────────────

// Starts gathering local knowledge for the pin. `fast` resolves in a second
// or two (hygiene, Wikipedia, OpenStreetMap); `full` adds the scout's guide
// findings (much slower on a new area; instant once cached).
export function startLocalKnowledge(p: Place, anthropicKey: string, onUsage: Usage): { fast: Promise<Knowledge>; full: Promise<Knowledge> } {
  const key = keyFor(p);
  const cached = readCache(key);
  const fast = cached.then(async (hit) => {
    if (hit) return hit;
    const [hygiene, wiki, osm] = await Promise.all([
      fetchHygiene(p).catch((err) => (console.warn("[local] hygiene failed", err), [])),
      fetchWikipedia(p).catch((err) => (console.warn("[local] wikipedia failed", err), [])),
      fetchOsm(p).catch((err) => (console.warn("[local] openstreetmap failed", err), [])),
    ]);
    return { ...EMPTY, hygiene, wiki, osm };
  });
  const full = cached.then(async (hit) => {
    if (hit) return hit;
    const [base, ...scouts] = await Promise.all([
      fast,
      ...scoutSpecs(p).map((spec) => scout(p, anthropicKey, spec, onUsage).catch((err) => (console.warn(`[local] scout (${spec.name}) failed`, err), null))),
    ]);
    const knowledge = { ...base, guides: scouts.flatMap((f) => f ?? []) };
    console.info(`[local] ${p.location}: ${knowledge.hygiene.length} hygiene, ${knowledge.wiki.length} wikipedia, ${knowledge.osm.length} osm, ${knowledge.guides.length} guide findings`);
    // Kept for a week only when the scout worked and found something — a
    // failed or empty scout is retried next time rather than cached.
    if (scouts.every((f) => f !== null) && knowledge.guides.length > 0) void writeCache(key, knowledge);
    return knowledge;
  });
  return { fast, full };
}

// ── Per venue ────────────────────────────────────────────────────────────

const HYGIENE_CATEGORIES: CategoryKey[] = ["restaurant", "bar", "stay", "live"];

// The badges for one venue, strongest first.
export function badgesFor(cat: CategoryKey, name: string, k: Knowledge | null, area = "", pos?: Pos): Badge[] {
  if (!k) return [];
  const out: Badge[] = [];
  for (const g of k.guides) {
    if (sameVenue(name, g.name, area) && !out.some((b) => b.label === g.label)) {
      out.push({ label: g.tone === "warn" ? `${g.source}: ${g.note}` : g.label, source: g.source, url: g.url, tone: g.tone });
    }
  }
  const wiki = k.wiki.find((w) => samePlace(name, pos, w.title.replace(/,.*$/, ""), w.pos, area, 300));
  if (wiki && (cat === "attractions" || cat === "live" || cat === "stay" || cat === "bar")) out.push({ label: "On Wikipedia", source: "Wikipedia", url: wiki.url });
  if (HYGIENE_CATEGORIES.includes(cat)) {
    const h = k.hygiene.find((x) => samePlace(name, pos, x.name, x.pos, area, 150));
    if (h && /^[0-5]$/.test(h.rating)) {
      const r = Number(h.rating);
      out.push({ label: `Hygiene ${r}/5`, source: "Food Standards Agency", url: h.url, tone: r >= 4 ? "good" : r <= 2 ? "warn" : undefined });
    }
  }
  const osm = k.osm.find((o) => samePlace(name, pos, o.name, o.pos, area, 150));
  if (osm) for (const f of osm.features.slice(0, 2)) out.push({ label: f, source: "OpenStreetMap" });
  return out.slice(0, 5);
}

// A one-line note of the same signals for the AI's list, e.g.
// "Michelin Guide: Bib Gourmand (great Sunday roast); food hygiene 5/5".
export function signalNote(cat: CategoryKey, name: string, k: Knowledge | null, area = "", pos?: Pos): string {
  if (!k) return "";
  const parts: string[] = [];
  for (const g of k.guides) if (sameVenue(name, g.name, area)) parts.push(`${g.tone === "warn" ? "WARNING " : ""}${g.source}: ${g.label}${g.note ? ` (${g.note})` : ""}`);
  const wiki = k.wiki.find((w) => samePlace(name, pos, w.title.replace(/,.*$/, ""), w.pos, area, 300));
  if (wiki?.extract) parts.push(`Wikipedia: ${wiki.extract}`);
  if (HYGIENE_CATEGORIES.includes(cat)) {
    const h = k.hygiene.find((x) => samePlace(name, pos, x.name, x.pos, area, 150));
    if (h) parts.push(`food hygiene ${h.rating}/5`);
  }
  const osm = k.osm.find((o) => samePlace(name, pos, o.name, o.pos, area, 150));
  if (osm) parts.push(osm.features.join(", "));
  return parts.join("; ");
}

// Whether a trusted source recommends this venue — such a place may be
// further away than the others ("worth the trip").
export function isGuidePick(name: string, k: Knowledge | null, area = ""): boolean {
  return !!k?.guides.some((g) => g.tone === "good" && sameVenue(name, g.name, area));
}

// Places trusted sources recommend in this category — for the AI, in case
// Google's list missed them.
export function recommendedElsewhere(cat: CategoryKey, k: Knowledge | null, listed: string[], area = ""): string[] {
  if (!k) return [];
  return k.guides
    .filter((g) => g.category === cat && g.tone === "good" && !listed.some((n) => sameVenue(n, g.name, area)))
    .map((g) => `${g.name} — ${g.source}: ${g.label}${g.note ? ` (${g.note})` : ""}`)
    .slice(0, 10);
}
