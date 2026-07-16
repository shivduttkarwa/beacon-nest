-- BeaconNest — Supabase setup
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor → New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT / existence-check guards throughout.
--
-- If you're upgrading from the old "Spotmark" setup, this script renames your
-- existing `bookmarks` table to `beacons` in place — your saved rows and their
-- screenshots are preserved, nothing is dropped.

-- 0. Rename from the old Spotmark schema, if present -------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'bookmarks')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'beacons') then
    alter table public.bookmarks rename to beacons;
  end if;
end $$;

-- 1. Beacons table ------------------------------------------------------------
create table if not exists public.beacons (
  id uuid primary key default gen_random_uuid(),
  title text,
  url text not null,
  description text default '',
  category text default 'general',    -- slug from BEACONNEST_CATEGORIES in lib/data.js
  selector text,
  selected_text text,
  snippet text,
  scroll_x integer default 0,
  scroll_y integer default 0,
  scroll_y_ratio double precision default 0,  -- scroll_y / max scrollable height at save time
  screenshot_path text,               -- path inside the 'screenshots' storage bucket
  created_by uuid references auth.users(id),
  created_by_email text,               -- convenience for display, avoids extra joins
  created_by_name text,                -- free-text display name tagged by the saving install
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrading an existing table that predates these columns.
alter table public.beacons add column if not exists created_by_name text;
alter table public.beacons add column if not exists scroll_y_ratio double precision default 0;
alter table public.beacons add column if not exists category text default 'general';

alter table public.beacons enable row level security;

-- Everyone authenticated can read every beacon (shared visibility), but only
-- the person who created a beacon can edit or delete it.
drop policy if exists "authenticated read" on public.beacons;
create policy "authenticated read"
  on public.beacons for select
  to authenticated
  using (true);

drop policy if exists "authenticated insert" on public.beacons;
drop policy if exists "owner insert" on public.beacons;
create policy "owner insert"
  on public.beacons for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "authenticated update" on public.beacons;
drop policy if exists "owner update" on public.beacons;
create policy "owner update"
  on public.beacons for update
  to authenticated
  using (created_by = auth.uid());

drop policy if exists "authenticated delete" on public.beacons;
drop policy if exists "owner delete" on public.beacons;
create policy "owner delete"
  on public.beacons for delete
  to authenticated
  using (created_by = auth.uid());

-- Keep updated_at fresh automatically.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bookmarks_updated_at on public.beacons;
drop trigger if exists trg_beacons_updated_at on public.beacons;
create trigger trg_beacons_updated_at
  before update on public.beacons
  for each row execute function public.set_updated_at();

-- 2. Realtime -------------------------------------------------------------
-- Lets both extensions subscribe and get pushed changes instantly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'beacons'
  ) then
    alter publication supabase_realtime add table public.beacons;
  end if;
end $$;

-- 3. Storage bucket for screenshots -------------------------------------------
-- Bucket id is kept as 'screenshots' (not renamed to match "beacons") so that
-- existing screenshot files and their stored paths keep working unchanged —
-- storage objects can't be cheaply renamed in bulk the way a table can.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

drop policy if exists "authenticated upload screenshots" on storage.objects;
create policy "authenticated upload screenshots"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'screenshots');

drop policy if exists "anyone can view screenshots" on storage.objects;
create policy "anyone can view screenshots"
  on storage.objects for select
  using (bucket_id = 'screenshots');

-- Only the uploader can delete their own screenshot file (mirrors the
-- owner-only delete policy on the beacons table above).
drop policy if exists "authenticated delete screenshots" on storage.objects;
drop policy if exists "owner delete screenshots" on storage.objects;
create policy "owner delete screenshots"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'screenshots' and owner = auth.uid());

-- Done. Next steps:
--   1. Project Settings → API: copy the "Project URL" and "anon public" key.
--   2. Authentication → Users: add one user per teammate (email + password
--      is simplest for two people — Authentication → Users → Add user).
--   3. Paste the Project URL + anon key into the BeaconNest options page,
--      then sign in with the email/password you just created.
