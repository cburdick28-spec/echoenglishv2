-- Echo English: Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create extension if not exists "pgcrypto";

create table if not exists public.scores (
  id            uuid primary key default gen_random_uuid(),
  user_email    text        not null,
  expected_text text        not null,
  actual_text   text        not null,
  score         integer     not null check (score between 0 and 100),
  created_at    timestamptz not null default now()
);

-- Indexes for the manager dashboard (newest-first listing and per-employee rollups).
create index if not exists scores_created_at_idx on public.scores (created_at desc);
create index if not exists scores_user_email_idx on public.scores (user_email);

-- Lock the table down. With RLS enabled and NO policies, the public anon key cannot read
-- or write anything. Only the backend (service-role key, which bypasses RLS) can, and it
-- verifies each user's login token before touching data.
alter table public.scores enable row level security;
