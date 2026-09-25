# Landed

A Next.js app that builds a night or day out — somewhere to stay, eat,
drink, see something live, and park — around a place and a vibe.

## What's in it

- **Booking flow** (`app/page.tsx`): on opening, the browser asks to use
  the device's location; if allowed, the map centres there and the plan
  appears for that place. If not, the page stays at the map (a wide UK &
  Ireland view) until a place is searched. Then pick When / Vibe / Budget,
  swap or remove venue cards, and open the booking sheet. The + button
  saves the current plan and starts a fresh one from the device location.
  Browsers only share location over HTTPS (or localhost) — on
  `http://192.168…` from a phone, it falls back to searching.
- **Live venue search** (`app/api/plan/route.ts`): Claude (with web
  search) finds current candidates, Google Places verifies each one is
  real and open, and the results replace the built-in catalog. Open to
  everyone; rate-limited per user (signed in) or per IP address (guests).
- **Built-in Galway catalog** (`app/lib/categoryOptions.ts`): the pilot
  region's static venues. Used as the fallback near Galway while live
  results load, for signed-out visitors, or if the live search fails.
  Away from Galway there is no fallback — the plan is live results only.
- **Accounts** (Supabase): sign up, log in, log out, password reset. The
  Account page's personal details and the Bookings page's drafts and
  confirmed plans are stored per user. Signed-out visitors can still make
  and save plans on their device; those move into their account the first
  time they sign in.
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
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
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
- `NEXT_PUBLIC_GOOGLE_MAP_ID` (optional) — a Map ID from **Map
  Management**. Without it the map uses Google's `DEMO_MAP_ID`, which is
  fine for development but should be replaced before launch.

### Anthropic (live venue search)

`ANTHROPIC_API_KEY` from https://console.anthropic.com. Billing is
prepaid: if the balance runs out, live search quietly falls back to the
built-in catalog (the reason is logged, and shown in the browser console).

## Live search: cost and limits

One search covers Now, Tonight and Tomorrow together, so switching When
in the app is instant; a new search only runs when the place or vibe
changes. Measured 2026-09-24/25 (uncached):

- **~45–80 s** per search (the longer end since it covers all three
  timeframes), so results appear well after the page loads.
  An animated loading bar shows meanwhile; near Galway the built-in
  catalog shows underneath it.
- **Claude**: ~22k input + ~2k output tokens and up to 5 web searches —
  roughly **$0.20** per search at list prices.
- **Google Places**: ~30 Text Search calls per search, with Enterprise-tier
  fields (rating, phone, opening hours) — roughly **$1** per search at list
  prices, before Google's monthly free allowance. This is the bigger cost.
- Typically 27–29 of the 30 AI candidates pass Places verification.

Protections in `app/api/plan/route.ts`:

- Signed-in users get **10 uncached searches per hour and 30 per day**
  (`LIMIT_PER_HOUR` / `LIMIT_PER_DAY`), counted in the `plan_searches`
  table so the limit holds across server instances.
- Guests get **5 per hour and 15 per day per IP address**
  (`GUEST_LIMIT_PER_HOUR` / `GUEST_LIMIT_PER_DAY`), counted in memory —
  per server instance, and reset when Vercel starts a new one, so it's
  a speed bump rather than a guarantee.
- Over a limit, people get the fallback catalog and a message.

**Set hard spend caps as the real backstop** (guests can't be limited
reliably without accounts):
- Anthropic: console.anthropic.com → Settings → Limits → set a monthly
  spend limit.
- Google: Cloud Console → APIs & Services → Places API (New) → Quotas →
  cap "Text Search requests per day" (≈30 per uncached search).
- A best-effort per-IP cap (60 requests per 10 minutes, per server
  instance) returns HTTP 429.
- Identical searches (same ~1 km area, time, and vibe) share a result for
  30 minutes and don't count against the limit.

That result cache is in memory, so on a serverless host each instance has
its own and it's lost on redeploy. To share it, add a `plan_cache` table
and write to it with a server-only Supabase **service role** key — not the
anon key, or any signed-in user could write fake venues into everyone's
results.

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

- `app/page.tsx` — booking flow (map, plan, swap sheet, booking sheet,
  Explore)
- `app/bookings/page.tsx`, `app/account/page.tsx` — Bookings and Account
- `app/api/plan/route.ts` — live venue search
- `app/auth/callback/route.ts` — where Supabase email links land
- `app/components/` — `LiveMap`, `PlanItemCard`, `QuickDropdown`, icons
- `app/lib/` — `bookingsStore` / `accountStore` (data, Supabase or this
  device), `categoryOptions` (Galway catalog + pick logic), `geo`
  (locations), `urls` (outbound links), `supabase/` (clients)
- `supabase/schema.sql` — database tables and security rules

## A mobile app later

It works as a mobile web app (add to home screen) as it is. For the app
stores, [Capacitor](https://capacitorjs.com) can wrap this React code in a
native shell, or the UI can be rebuilt in React Native.
