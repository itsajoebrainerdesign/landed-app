-- Landed — Supabase schema for accounts and saved plans.
--
-- Run this once in your project's SQL Editor
-- (https://supabase.com/dashboard → your project → SQL Editor → New query).
-- It's safe to re-run: every statement is idempotent.
--
-- Row Level Security is on for both tables, and every policy is scoped to
-- auth.uid(), so the public anon key can only ever read or write the
-- signed-in user's own rows.

-- ── Profiles: the Account page's "Personal information" ───────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
create policy "Profiles are readable by their owner"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "Profiles are insertable by their owner" on public.profiles;
create policy "Profiles are insertable by their owner"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Profiles are updatable by their owner" on public.profiles;
create policy "Profiles are updatable by their owner"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── Bookings: drafts and confirmed plans (the Bookings page) ──────────
-- Mirrors the shape the app used to keep in localStorage. picks / items /
-- removed_categories stay JSON so the plan shape can evolve without
-- migrations.
create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  plan_summary        text not null default '',
  picks               jsonb not null default '{}'::jsonb,
  items               jsonb not null default '{}'::jsonb,
  vibe                text not null,
  time_key            text not null,
  budget              text not null,
  removed_categories  jsonb not null default '[]'::jsonb,
  confirmed           boolean not null default false
);

create index if not exists bookings_user_created_idx on public.bookings (user_id, created_at desc);

alter table public.bookings enable row level security;

drop policy if exists "Bookings are readable by their owner" on public.bookings;
create policy "Bookings are readable by their owner"
  on public.bookings for select using (auth.uid() = user_id);

drop policy if exists "Bookings are insertable by their owner" on public.bookings;
create policy "Bookings are insertable by their owner"
  on public.bookings for insert with check (auth.uid() = user_id);

drop policy if exists "Bookings are updatable by their owner" on public.bookings;
create policy "Bookings are updatable by their owner"
  on public.bookings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Bookings are deletable by their owner" on public.bookings;
create policy "Bookings are deletable by their owner"
  on public.bookings for delete using (auth.uid() = user_id);

-- Where the plan is ({ name, label, lat, lng }) — set when the map search
-- moves a plan away from the Galway default. Null on older plans.
alter table public.bookings add column if not exists location jsonb;

-- ── Plan searches: per-user rate limiting for /api/plan ───────────────
-- One row per uncached live search. The API inserts a row as the
-- signed-in user, then counts their rows in the last hour/day. Users can
-- read and add their own rows but not update or delete them, so they
-- can't reset their own allowance.
create table if not exists public.plan_searches (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists plan_searches_user_created_idx on public.plan_searches (user_id, created_at desc);

alter table public.plan_searches enable row level security;

drop policy if exists "Plan searches are readable by their owner" on public.plan_searches;
create policy "Plan searches are readable by their owner"
  on public.plan_searches for select using (auth.uid() = user_id);

drop policy if exists "Plan searches are insertable by their owner" on public.plan_searches;
create policy "Plan searches are insertable by their owner"
  on public.plan_searches for insert with check (auth.uid() = user_id);
