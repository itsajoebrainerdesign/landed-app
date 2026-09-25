# Landed

A Next.js app that builds a night or day out — somewhere to stay, eat,
drink, see something live, and park — around a place and a vibe.

## What's in it

- **Booking flow** (`app/page.tsx`): on opening, the browser asks to use
  the device's location; if allowed, the map centres there (otherwise a
  wide UK & Ireland view). The pin moves with a search result, **Use my
  location**, or a tap anywhere on the map, but nothing is searched until
  the person taps **Confirm location** under the map — then the plan
  appears. Pick When / Vibe / Budget, swipe venue cards left and right
  between options (or remove them), and open the booking sheet. Plans
  auto-save as drafts; the + button saves the current plan and starts a
  fresh enquiry, locked at the map again.
  Browsers only share location over HTTPS (or localhost) — on
  `http://192.168…` from a phone, it falls back to searching.
- **Live venue search** (`app/api/plan/route.ts`): Claude (with web
  search) finds current candidates, Google Places verifies each one is
  real and open, and the results replace the built-in catalog. Open to
  everyone; rate-limited per user (signed in) or per IP address (guests).
- **No built-in venues**: every venue comes from a live search around
  the place the person chose (`app/lib/categoryOptions.ts` holds only
  the venue shape, category styles and the pick logic).
- **Accounts** (Supabase): sign up, log in, log out, password reset. The
  Account page's personal details and the Bookings page's drafts and
  confirmed plans are stored per user. Signed-out visitors can still make
  and save plans on their device; those move into their account the first
  time they sign in.
- **Affiliate booking links** (`app/lib/affiliates.ts`): results are
  chosen for the person; affiliates never affect which venues are picked.
  Each venue's main button goes to its own website (tickets search for
  attractions/live without one, directions for parking) — unless the
  venue has a confirmed page on a partner (`partnerUrl`) and that
  partner's programme is set up, in which case it books there, tracked:
  Booking.com (stays, with dates and party size filled in), OpenTable
  (restaurants, bars), Ticketmaster (live), GetYourGuide (attractions),
  JustPark (parking). Never a partner-site search. A short commission
  disclosure shows whenever a tracked link does. IDs: `.env.local.example`.
  Checking which venues each partner lists isn't built yet — until it
  is, every button goes to the venue's own website.
- **Not built yet**: payments (Stripe — the Account page's payment section
  is a placeholder), partner booking APIs (the "Connect" buttons are
  disabled), and plans shared between users (Explore says "No plans in
  this area" until that exists).

## Running it locally

Needs Node.js 20 or newer.

```bash
npm install
cp .env.local.example .env.local   # then fill in your keys (see below)
npm run dev
```

Open http://localhost:3000.

Other scripts: `npm run build` (production build), `npm run lint` (ESLint).

> Don't run `npm run build` while `npm run dev` is running — both write
> to `.next/` and the dev server breaks. If it happens, stop dev, delete
> `.next/`, and start it again.

## Setting up the services

Every key goes in `.env.local` (and in your host's environment variables
when you deploy). `.env.local.example` lists them all with notes. The app
runs without any of them — each missing piece just switches its feature
off — but here's what each one needs.

### Supabase (accounts, saved plans, rate limiting)

1. Create a project at https://supabase.com/dashboard.
2. **Settings → API**: copy the Project URL into
   `NEXT_PUBLIC_SUPABASE_URL` and the anon / publishable key into
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. For the shared search cache, also
   copy the **service_role** key into `SUPABASE_SERVICE_ROLE_KEY`
   (server-only — see "Shared cache setup").
3. **SQL Editor**: paste and run all of `supabase/schema.sql`. It creates
   the `profiles`, `bookings`, and `plan_searches` tables with Row Level
   Security so each user can only reach their own rows. It's safe to
   re-run, and **must be re-run whenever it changes** (e.g. it now adds a
   `location` column and the `plan_searches` table — without them, saving
   plans and live search report an error asking you to re-run it).
4. **Authentication → URL Configuration**: set the Site URL to your
   deployed domain, and add redirect URLs for the email links (sign-up
   confirmation and password reset both go through `/auth/callback` with
   a query string, so use a wildcard):
   - `http://localhost:3000/**`
   - `https://your-domain.com/**`

Email confirmation is on by default in Supabase; new users have to click
the link before they can log in.

### Google Maps and Places

In https://console.cloud.google.com, enable **Maps JavaScript API** and
**Places API (New)**, then create two keys:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — the map and its search box. It's
  sent to the browser by design, so **restrict it to your domain**
  (Credentials → the key → Website restrictions).
- `GOOGLE_PLACES_API_KEY` — server-only, used by `/api/plan` to verify
  venues. Restrict it to the Places API.
- The map's simplified look (town and city names only) is set in code —
  `MAP_STYLES` in `app/components/LiveMap.tsx` — so no Map ID is needed.
  (Code styles only apply to maps without a Map ID; that's also why the
  pin is Google's classic Marker.)

### Anthropic (live venue search)

`ANTHROPIC_API_KEY` from https://console.anthropic.com. Billing is
prepaid: if the balance runs out, live search quietly falls back to the
built-in catalog (the reason is logged, and shown in the browser console).

## Live search: speed, cost and limits

How a search works (`app/api/plan/route.ts`), streamed so the plan fills
in as it's found:

1. **~1 s — draft.** Google Places lists what's near the pin in each
   category (~8–10 Nearby Search requests). These show straight away as
   the plan, tiered Modest/Luxury by Google's £–££££ price level.
2. **~8–12 s — AI picks.** Six small AI calls run in parallel, one per
   category, each choosing the best fits for the vibe from its Google
   list, with price estimates, tiers and highlights. Each category's
   cards upgrade as soon as it's done. Only "live" uses web search (for
   what's on). Picks from a list are already verified.
3. **Cached for 12 hours** per area (~1 km), vibe and local date — in
   memory, and in the shared `plan_cache` table when
   `SUPABASE_SERVICE_ROLE_KEY` is set — so the next search of that area
   is instant for everyone. "Now" isn't stored: it's worked out from each
   venue's opening hours whenever results are served.

Measured 2026-09-25 (St Albans): draft at 0.9 s, all categories by 11 s
(was ~37 s as one big AI call), repeat search 0.01 s.

- **Models**: Sonnet 5 picks stays, restaurants, attractions, bars and
  parking from Google's lists; Opus 5 does live (web search for what's
  on). Set per category in `CATEGORY_MODEL` in the route.
- **Cost per new search**: roughly 25–35p (Claude ~10–18p, Google Places
  ~8–14 Enterprise-tier requests). Cached searches cost nothing. Each
  search logs its estimated cost (`[api/plan] … cost ≈ $…`) in Vercel's
  logs.

Protections:

- Signed-in users get **10 uncached searches per hour and 30 per day**
  (`LIMIT_PER_HOUR` / `LIMIT_PER_DAY`), counted in the `plan_searches`
  table so the limit holds across server instances.
- Guests get **5 per hour and 15 per day per IP address**
  (`GUEST_LIMIT_PER_HOUR` / `GUEST_LIMIT_PER_DAY`), counted in memory —
  per server instance, so a speed bump rather than a guarantee.
- `SEARCH_LIMITS_ON` switches both on or off (off while testing).
- A best-effort per-IP cap (60 requests per 10 minutes) returns HTTP 429.

**Set hard spend caps as the real backstop** (guests can't be limited
reliably without accounts):
- Anthropic: console.anthropic.com → Settings → Limits → set a monthly
  spend limit.
- Google: Cloud Console → APIs & Services → Places API (New) → Quotas →
  cap "Nearby Search" / "Text Search" requests per day.

### Shared cache setup

In Supabase → **Settings → API**, copy the **service_role** key (secret)
into Vercel as `SUPABASE_SERVICE_ROLE_KEY` (type **Secret**, never
`NEXT_PUBLIC_`), re-run `supabase/schema.sql` (creates `plan_cache`), and
redeploy. Without it, results are cached per server instance only.

## Deploying (Vercel)

1. Push the project to a GitHub repo and import it at
   https://vercel.com/new — it detects Next.js.
2. **Settings → Environment Variables**: add every variable from your
   `.env.local`.
3. **Function duration**: `/api/plan` sets `maxDuration = 300` (seconds)
   because a live search takes about a minute. Check your plan's limit —
   if it's lower than a minute, searches will be cut off and fall back to
   the catalog.
4. Add your Vercel domain (and any custom domain) to Supabase's redirect
   URLs and the Google Maps key's website restrictions.

## Project layout

- `app/page.tsx` — booking flow (map, plan with swipeable option cards, booking sheet,
  Explore)
- `app/bookings/page.tsx`, `app/account/page.tsx` — Bookings and Account
- `app/api/plan/route.ts` — live venue search
- `app/auth/callback/route.ts` — where Supabase email links land
- `app/components/` — `LiveMap`, `CategoryCarousel`, `PlanItemCard`, `QuickDropdown`, icons
- `app/lib/` — `bookingsStore` / `accountStore` (data, Supabase or this
  device), `categoryOptions` (venue shape + pick logic), `geo`
  (locations), `urls` (outbound links), `supabase/` (clients)
- `supabase/schema.sql` — database tables and security rules

## A mobile app later

It works as a mobile web app (add to home screen) as it is. For the app
stores, [Capacitor](https://capacitorjs.com) can wrap this React code in a
native shell, or the UI can be rebuilt in React Native.
