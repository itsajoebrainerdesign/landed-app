// Serves a venue photo from Google Places, so the Places key stays on the
// server. The plan search returns each venue's photo resource names
// ("places/…/photos/…"); cards load them as /api/photo?name=…&w=….
//
// Each uncached photo is a Place Photos request (billed by Google), so
// responses are cached for a day by the browser and Vercel's CDN, and
// there's a best-effort per-IP cap.

import { NextRequest, NextResponse } from "next/server";

const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const WIDTHS = [200, 400, 800];

const IP_LIMIT = 150;
const IP_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function allowIp(req: NextRequest): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 10_000) ipHits.clear();
  return recent.length <= IP_LIMIT;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!PHOTO_NAME_RE.test(name)) return new NextResponse("Bad photo name", { status: 400 });
  // Snap to a few sizes so the CDN cache isn't split by every width.
  const asked = Number(req.nextUrl.searchParams.get("w")) || 400;
  const width = WIDTHS.find((w) => w >= asked) ?? WIDTHS[WIDTHS.length - 1];

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return new NextResponse("Photos not configured", { status: 404 });
  if (!allowIp(req)) return new NextResponse("Too many requests", { status: 429 });

  try {
    const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&key=${apiKey}`, {
      redirect: "follow",
    });
    if (!res.ok || !res.body) {
      console.error(`[api/photo] Google returned ${res.status} for ${name}`);
      return new NextResponse("Photo unavailable", { status: res.status === 404 ? 404 : 502 });
    }
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error("[api/photo] fetch failed", err);
    return new NextResponse("Photo unavailable", { status: 502 });
  }
}
