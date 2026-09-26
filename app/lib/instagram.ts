// Server-side: what UK food and going-out creators on Instagram say about
// venues in an area — via Meta's Instagram Graph API "Business Discovery",
// which reads public posts from Business and Creator accounts by username.
//
// Setup (Vercel → Environment Variables, all type Secret):
// - INSTAGRAM_ACCESS_TOKEN: a long-lived token (ideally a Meta Business
//   "system user" token, which doesn't expire) with instagram_basic and
//   pages_read_engagement, for Landed's own Instagram Business/Creator
//   account.
// - INSTAGRAM_BUSINESS_ID: that account's Instagram user ID (the
//   "instagram_business_account" id of its linked Facebook Page).
// - INSTAGRAM_CREATORS: comma-separated usernames to follow, e.g.
//   "creatorone,creatortwo" (public Business/Creator accounts only).
// Nothing runs until all three are set.
//
// Each creator's latest captions are fetched at most once a day (one
// call each; Meta allows 200 an hour) and cached. For a plan, captions
// that mention the area go to a quick AI step that picks out the venues
// recommended or warned about; those become badges linking to the post.
// Commenters and other users are never read or stored.

import Anthropic from "@anthropic-ai/sdk";
import { getAdminSupabase } from "./supabase/admin";

const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID || "";
const CREATORS = (process.env.INSTAGRAM_CREATORS || "")
  .split(",")
  .map((c) => c.trim().replace(/^@/, ""))
  .filter((c) => /^[A-Za-z0-9._]{1,30}$/.test(c));
const GRAPH = "https://graph.facebook.com/v22.0";
const DAY_MS = 24 * 60 * 60 * 1000;

export const INSTAGRAM_ON = !!(TOKEN && BUSINESS_ID && CREATORS.length);

type Post = { caption: string; permalink: string; timestamp: string };
type CreatorPosts = { username: string; posts: Post[] };

export type InstagramFinding = { name: string; category: string; creator: string; url: string; note: string; tone: "good" | "warn" };

// ── Fetching (cached a day per creator) ──────────────────────────────────

const memory = new Map<string, { expires: number; data: CreatorPosts }>();

async function creatorPosts(username: string): Promise<CreatorPosts | null> {
  const key = `ig1|${username.toLowerCase()}`;
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const admin = getAdminSupabase();
  if (admin) {
    try {
      const { data } = await admin.from("plan_cache").select("data").eq("key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (data?.data) {
        memory.set(key, { expires: Date.now() + DAY_MS, data: data.data as CreatorPosts });
        return data.data as CreatorPosts;
      }
    } catch {
      // fall through to a fresh fetch
    }
  }
  const fields = `business_discovery.username(${username}){username,media.limit(50){caption,permalink,timestamp}}`;
  const res = await fetch(`${GRAPH}/${BUSINESS_ID}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(TOKEN)}`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`[instagram] ${username}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return null;
  }
  const body = (await res.json()) as { business_discovery?: { username?: string; media?: { data?: { caption?: string; permalink?: string; timestamp?: string }[] } } };
  const posts = (body.business_discovery?.media?.data ?? [])
    .filter((m) => m.caption && m.permalink)
    .map((m) => ({ caption: m.caption!.slice(0, 1200), permalink: m.permalink!, timestamp: m.timestamp ?? "" }));
  const data = { username: body.business_discovery?.username ?? username, posts };
  memory.set(key, { expires: Date.now() + DAY_MS, data });
  if (admin) {
    void admin.from("plan_cache").upsert({ key, data, expires_at: new Date(Date.now() + DAY_MS).toISOString() }).then(() => undefined, () => undefined);
  }
  return data;
}

// ── Per area ─────────────────────────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_mentions",
  description: "Submit the venues these posts recommend or warn about. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["mentions"],
    properties: {
      mentions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "category", "creator", "url", "note", "tone"],
          properties: {
            name: { type: "string", description: "The venue's name as written in the post." },
            category: { type: "string", enum: ["stay", "restaurant", "attractions", "bar", "live"] },
            creator: { type: "string", description: "The creator's username." },
            url: { type: "string", description: "The post's permalink, exactly as given." },
            note: { type: "string", description: "Up to 10 words, your own paraphrase. No quotes." },
            tone: { type: "string", enum: ["good", "warn"] },
          },
        },
      },
    },
  },
};

// Venues the followed creators recommend (or warn about) in the area.
export async function instagramFindings(area: string, apiKey: string, onUsd: (usd: number) => void): Promise<InstagramFinding[]> {
  if (!INSTAGRAM_ON || !area) return [];
  const all = (await Promise.all(CREATORS.map((c) => creatorPosts(c).catch(() => null)))).filter((c): c is CreatorPosts => !!c);
  // Posts that mention the area by name (e.g. "St Albans", "Ancoats").
  const town = area.split(",")[0].trim().toLowerCase();
  const relevant = all.flatMap((c) => c.posts.filter((p) => p.caption.toLowerCase().includes(town)).map((p) => ({ creator: c.username, ...p })));
  if (relevant.length === 0) return [];

  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    output_config: { effort: "low" },
    system:
      "You read Instagram captions from food and going-out creators and list the specific venues in the named area they recommend or clearly warn about. Only venues actually named in a caption, only in that area. Paraphrase briefly; never quote. Ignore sponsored posts marked #ad or 'gifted' unless the creator still gives a clear personal view.",
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content:
          `Area: ${area}\n\n` +
          relevant
            .slice(0, 40)
            .map((p) => `@${p.creator} (${p.timestamp.slice(0, 10)}) ${p.permalink}\n${p.caption}`)
            .join("\n\n---\n\n"),
      },
    ],
  });
  onUsd((res.usage.input_tokens * 2 + res.usage.output_tokens * 10) / 1e6);
  const submit = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
  const permalinks = new Set(relevant.map((p) => p.permalink));
  return ((submit?.input as { mentions?: InstagramFinding[] } | undefined)?.mentions ?? []).filter((m) => m.name && permalinks.has(m.url));
}
