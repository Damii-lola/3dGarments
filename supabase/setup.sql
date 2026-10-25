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

-- ================================================================ 20260930000000_profile_settings.sql
-- Stage 1: the model editor's settings, per device (the anonymous user the browser signs in as),
-- both sexes at once: { sex, models: { female: {...}, male: {...} }, updated }.
alter table public.body_profiles add column if not exists settings jsonb not null default '{}'::jsonb;

-- ================================================================ 20261001000000_group_processing.sql
-- Stage 1: a photo group is processed by the API into garments.
--   status: new → processing → ready | failed      items: the garments found (shared/wardrobe.js)
--   photos: per image { cut, preview, width, height, geometry, signature, ai }
alter table public.garment_groups add column if not exists status text not null default 'new';
alter table public.garment_groups add column if not exists error text;
alter table public.garment_groups add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.garment_groups add column if not exists photos jsonb not null default '{}'::jsonb;
alter table public.garment_groups add column if not exists processed_at timestamptz;
do $$ begin
  alter table public.garment_groups add constraint garment_groups_status_check check (status in ('new', 'processing', 'ready', 'failed'));
exception when duplicate_object then null; end $$;

-- ================================================================ 20261018000000_accounts.sql
-- Accounts: public.profiles holds the username (the email and the hashed password stay in
-- Supabase's own auth.users), usernames are unique and case-insensitive, RLS keeps a profile
-- to its owner, username_taken() lets the signup form check a name without reading the table,
-- and on_auth_user_created gives every new account its profile row.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
do $$ begin
  alter table public.profiles add constraint profiles_username_shape
    check (username ~ '^[A-Za-z0-9._-]{3,20}$');
exception when duplicate_object then null; end $$;

alter table public.profiles enable row level security;
drop policy if exists "profiles: owner read" on public.profiles;
create policy "profiles: owner read" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles: owner update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.username_taken(candidate text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where lower(username) = lower(trim(candidate))
  );
$$;
revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  typed     text  := lower(trim(coalesce(meta ->> 'username', '')));
  base      text;
  candidate text;
  n         int   := 0;
begin
  if typed <> '' then
    if typed !~ '^[a-z0-9._-]{3,20}$' then
      raise exception 'username must be 3-20 characters of letters, digits, dot, dash or underscore'
        using errcode = 'check_violation';
    end if;
    candidate := typed;
  else
    -- A provider signup (Google) has no username: use the address's own name.
    base := lower(coalesce(
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      nullif(meta ->> 'preferred_username', ''),
      nullif(meta ->> 'user_name', ''),
      nullif(meta ->> 'full_name', ''),
      nullif(meta ->> 'name', '')
    ));
    base := regexp_replace(base, '[^a-z0-9._-]', '', 'g');
    base := trim(both '._-' from base);
    if base is null or length(base) < 3 then base := 'user'; end if;
    base := left(base, 16);
    candidate := base;
    loop
      exit when not exists (select 1 from public.profiles where lower(username) = candidate);
      n := n + 1;
      if n >= 1000 then
        candidate := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
        exit;
      end if;
      candidate := left(base, 16) || n::text;
    end loop;
  end if;

  insert into public.profiles (id, username) values (new.id, candidate)
  on conflict (id) do update set username = excluded.username;
  return new;
exception
  when unique_violation then
    insert into public.profiles (id, username)
    values (new.id, left(coalesce(base, 'user'), 12) || substr(replace(new.id::text, '-', ''), 1, 6))
    on conflict (id) do update set username = excluded.username;
    return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ================================================================ 20261019000000_size_charts.sql
-- Size charts: the one thing a store types in to get a link.
-- A chart belongs to the account that typed it. It is also the only row in this
-- schema that a *shopper* has to be able to read without an account — so that
-- read goes through chart_by_code() rather than through a select policy: a
-- `using (true)` policy would let anyone list every store's chart, and the code
-- in the link is meant to be the only thing that opens one.
-- Rows are kept exactly as the store typed them — label and all ("M", "Medium",
-- "38"), in the unit they typed them in. The sizing engine converts to inches
-- itself, so there is exactly one place in the system that knows about units.
create table if not exists public.size_charts (
  id         uuid primary key default gen_random_uuid(),
  -- Who owns it. Filled in by the database from the caller's own token rather
  -- than sent by the browser: a client that had to name itself could name
  -- someone else, and this column is the whole of the access rule.
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code       text not null unique check (code ~ '^[a-z0-9]{8,24}$'),
  name       text not null check (char_length(name) between 1 and 60),
  sex        text not null default 'unisex' check (sex in ('male', 'female', 'unisex')),
  unit       text not null default 'in' check (unit in ('in', 'cm')),
  -- The store's columns, in the order it typed them:
  --   [{ id, label, measure }]
  -- `measure` is the body measurement the column stands for ('chest', 'waist',
  -- 'shoulder', …) or null for one that is only printed (a body length). The
  -- first column with a measure is the one a size is decided on.
  columns    jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  -- One entry per size, keyed by the label the store gave that size and by the
  -- column ids above: [{ key: 'M', col1: 40, col2: 34 }]
  rows       jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A project that ran this file before columns existed gets them here, rather
-- than by editing the table by hand.
alter table public.size_charts add column if not exists columns jsonb not null default '[]'::jsonb;

create index if not exists size_charts_user_idx on public.size_charts (user_id, created_at desc);

drop trigger if exists size_charts_touch on public.size_charts;
create trigger size_charts_touch before update on public.size_charts
  for each row execute function public.touch_updated_at();

alter table public.size_charts enable row level security;

drop policy if exists "size charts: owner all" on public.size_charts;
create policy "size charts: owner all" on public.size_charts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The shopper's half of the link: one row, by code, and nothing else. No
-- listing, no owner id, no timestamps. Dropped first because a function's
-- return type cannot be changed in place, and the columns are part of it.
drop function if exists public.chart_by_code(text);
create function public.chart_by_code(candidate text)
returns table (name text, sex text, unit text, columns jsonb, rows jsonb)
language sql
security definer
set search_path = public
as $$
  select c.name, c.sex, c.unit, c.columns, c.rows
  from public.size_charts c
  where c.code = lower(trim(candidate))
  limit 1;
$$;
revoke all on function public.chart_by_code(text) from public;
grant execute on function public.chart_by_code(text) to anon, authenticated;


-- 20261024000000_user_settings.sql

create table if not exists public.user_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  notify_results   boolean not null default true,
  notify_digest    boolean not null default false,
  notify_marketing boolean not null default false,
  notify_security  boolean not null default true,
  billing_email    text,
  tax_id           text,
  theme            text check (theme in ('dark','light','system')),
  accent_colour    text check (accent_colour ~* '^#[0-9a-f]{6}$'),
  default_unit     text check (default_unit in ('cm','in')),
  updated_at       timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: owner all" on public.user_settings;
create policy "user_settings: owner all" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 20261025000000_appearance_defaults.sql

alter table public.user_settings alter column theme drop not null;
alter table public.user_settings alter column theme drop default;
alter table public.user_settings alter column accent_colour drop not null;
alter table public.user_settings alter column accent_colour drop default;
alter table public.user_settings alter column default_unit drop not null;
alter table public.user_settings alter column default_unit drop default;

update public.user_settings set theme = null where theme = 'dark';
update public.user_settings set accent_colour = null where lower(accent_colour) = '#ff6a4a';
update public.user_settings set default_unit = null where default_unit = 'cm';
