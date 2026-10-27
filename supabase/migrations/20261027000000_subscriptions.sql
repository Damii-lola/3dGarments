-- 20261027000000_subscriptions.sql
-- Subscriptions: one row per store account, activated when a Selar sale is detected.
-- Selar has no webhooks, so after paying on Selar the customer comes back here
-- and we poll Selar's product API (SELAR_API_KEY) to confirm a new sale happened
-- before activating their $150/month unlimited plan.
--
-- Concurrency: `app_settings.selar_sales_watermark.consumed_sales` tracks how many
-- sales we've already activated. Each activation atomically increments it by 1
-- (only while it's below Selar's live sales count), so concurrent buyers each get
-- exactly one activation and nobody gets double-charged or locked out.

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

-- Global app settings: watermark of Selar sales we've already activated.
-- consumed_sales = number of activations we've done.
create table if not exists public.app_settings (
  key          text primary key,
  value        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.app_settings enable row level security;
drop policy if exists "app_settings: owner all" on public.app_settings;
create policy "app_settings: owner all" on public.app_settings
  for all using (true);
