-- 20261027000000_subscriptions.sql
-- Subscriptions: one row per store account, activated by the Selar → Zapier webhook.
-- The API writes here (service role, filtered by user_id). The web app reads it
-- to gate chart creation behind an active $150/month plan.

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

-- The API (service role) and the webhook path write here directly; the browser
-- only ever reads its own row via the /api/me/subscription endpoint.
