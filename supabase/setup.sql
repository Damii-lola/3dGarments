-- 3dGarments: full database setup. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once (every statement is idempotent).
-- = supabase/migrations/*.sql, in order. Keep both in sync when adding migrations.

-- ================================================================ 20260928000000_init.sql
-- 3dGarments — initial schema
-- Tables: garments, body_profiles, outfits.  Storage: private "garments" bucket.
-- The API uses the service-role key (bypasses RLS) and always filters by user_id.
-- RLS policies below make direct client access (supabase-js + anon key) safe too.

create extension if not exists pgcrypto;

do $$ begin
  create type public.garment_status as enum ('processing', 'ready', 'failed');
exception when duplicate_object then null; end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ------------------------------------------------------------------
-- garments
-- ------------------------------------------------------------------
create table if not exists public.garments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text check (char_length(name) <= 60),
  status          public.garment_status not null default 'processing',
  error           text,
  category        text check (category in ('top','outerwear','dress','skirt','pants','shorts')),
  category_locked boolean not null default false,
  original_path   text,
  texture_path    text,
  preview_path    text,
  back_texture_path text,
  width           int,
  height          int,
  geometry        jsonb not null default '{}'::jsonb,  -- silhouette measurements (see server/src/shared/silhouette.js)
  analysis        jsonb not null default '{}'::jsonb,  -- Cloudflare vision description
  fit             jsonb not null default '{}'::jsonb,  -- user fit tweaks {size, lift, sleeveAngle}
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists garments_user_created_idx on public.garments (user_id, created_at desc);
create index if not exists garments_processing_idx on public.garments (status, updated_at) where status = 'processing';

drop trigger if exists garments_touch on public.garments;
create trigger garments_touch before update on public.garments
  for each row execute function public.touch_updated_at();

alter table public.garments enable row level security;

drop policy if exists "garments: owner read" on public.garments;
create policy "garments: owner read" on public.garments
  for select using (auth.uid() = user_id);
drop policy if exists "garments: owner update" on public.garments;
create policy "garments: owner update" on public.garments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "garments: owner delete" on public.garments;
create policy "garments: owner delete" on public.garments
  for delete using (auth.uid() = user_id);
-- inserts go through the API (it must run the processing pipeline)

-- ------------------------------------------------------------------
-- body_profiles
-- ------------------------------------------------------------------
create table if not exists public.body_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  height_cm  numeric(5,1) not null default 172 check (height_cm between 120 and 220),
  chest_cm   numeric(5,1) not null default 96  check (chest_cm between 60 and 160),
  waist_cm   numeric(5,1) not null default 80  check (waist_cm between 50 and 160),
  hips_cm    numeric(5,1) not null default 98  check (hips_cm between 60 and 170),
  skin_tone  text check (skin_tone ~* '^#[0-9a-f]{6}$'),
  updated_at timestamptz not null default now()
);

drop trigger if exists body_profiles_touch on public.body_profiles;
create trigger body_profiles_touch before update on public.body_profiles
  for each row execute function public.touch_updated_at();

alter table public.body_profiles enable row level security;
drop policy if exists "body: owner all" on public.body_profiles;
create policy "body: owner all" on public.body_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- outfits
-- ------------------------------------------------------------------
create table if not exists public.outfits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'Outfit' check (char_length(name) <= 60),
  garment_ids   uuid[] not null default '{}',
  snapshot_path text,
  created_at    timestamptz not null default now()
);
create index if not exists outfits_user_idx on public.outfits (user_id, created_at desc);

alter table public.outfits enable row level security;
drop policy if exists "outfits: owner all" on public.outfits;
create policy "outfits: owner all" on public.outfits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- storage: private bucket, files live under <user_id>/<garment_id>/...
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garments', 'garments', false, 20971520, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "garment files: owner read" on storage.objects;
create policy "garment files: owner read" on storage.objects
  for select using (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ================================================================ 20260929000000_garment_groups.sql
-- Stage 1 uploads: groups of garment photos (up to 10 per group), made in the browser.
-- Rows are written directly by the web app (supabase-js + anon key, the user's own session —
-- anonymous sign-in is fine), so RLS limits everything to the owner.
-- Images live in the private "garments" bucket under <user_id>/groups/<group_id>/<image_id>.<ext>.

create table if not exists public.garment_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  -- [{ id, name, type, path }] in display order
  images      jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists garment_groups_user_idx on public.garment_groups (user_id, created_at);

drop trigger if exists garment_groups_touch on public.garment_groups;
create trigger garment_groups_touch before update on public.garment_groups
  for each row execute function public.touch_updated_at();

alter table public.garment_groups enable row level security;
drop policy if exists "garment groups: owner all" on public.garment_groups;
create policy "garment groups: owner all" on public.garment_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- the browser uploads / replaces / deletes its own files (the API still uses the service role)
drop policy if exists "garment files: owner insert" on storage.objects;
create policy "garment files: owner insert" on storage.objects
  for insert with check (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "garment files: owner update" on storage.objects;
create policy "garment files: owner update" on storage.objects
  for update using (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "garment files: owner delete" on storage.objects;
create policy "garment files: owner delete" on storage.objects
  for delete using (bucket_id = 'garments' and (storage.foldername(name))[1] = auth.uid()::text);

