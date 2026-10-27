-- 20261027000000_subscriptions.sql
-- Subscriptions: one row per store account, activated when a Selar sale is detected.
-- Selar has no webhooks, so after paying on Selar the customer comes back here,
-- enters their email, and we poll Selar's product API (SELAR_API_KEY) to confirm
-- a new sale happened before activating their $150/month unlimited plan.

create table if not exists public.subscriptions (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  plan             text not null check (plan in ('unlimited')),
  status           text not null check (status in ('active', 'past_due', 'canceled')),
  selar_customer_id text,
  selar_transaction_id text,
  paid_until       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions: owner all" on public.subscriptions;
create policy "subscriptions: owner all" on public.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Global app settings: watermark of the last Selar sales count we processed,
-- so we can detect when a new sale happens without per-customer data from Selar.
create table if not exists public.app_settings (
  key          text primary key,
  value        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.app_settings enable row level security;
drop policy if exists "app_settings: owner all" on public.app_settings;
create policy "app_settings: owner all" on public.app_settings
  for all using (auth.uid() = (value ->> 'user_id')::uuid);
