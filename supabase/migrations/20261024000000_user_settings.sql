-- 3dGarments — user settings.
-- Settings that belong to an account: notifications, billing, appearance.
-- Run this whole file in Supabase → SQL Editor → New query → Run (or `supabase db push`).
-- Safe to run more than once: every statement is idempotent.

create table if not exists public.user_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  notify_results   boolean not null default true,
  notify_digest    boolean not null default false,
  notify_marketing boolean not null default false,
  notify_security  boolean not null default true,
  billing_email    text,
  tax_id           text,
  theme            text not null default 'dark' check (theme in ('dark','light','system')),
  accent_colour    text not null default '#ff6a4a' check (accent_colour ~* '^#[0-9a-f]{6}$'),
  default_unit     text not null default 'cm' check (default_unit in ('cm','in')),
  updated_at       timestamptz not null default now()
);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: owner all" on public.user_settings;
create policy "user_settings: owner all" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
