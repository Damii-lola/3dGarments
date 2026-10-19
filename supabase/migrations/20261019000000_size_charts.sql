-- Size charts: the one thing a store types in to get a link.
--
-- A chart belongs to the account that typed it. It is also the only row in this
-- schema that a *shopper* has to be able to read without an account — so that
-- read goes through chart_by_code() rather than through a select policy: a
-- `using (true)` policy would let anyone list every store's chart, and the code
-- in the link is meant to be the only thing that opens one.
--
-- Rows are kept exactly as the store typed them — label and all ("M", "Medium",
-- "38"), in the unit they typed them in. The sizing engine converts to inches
-- itself, so there is exactly one place in the system that knows about units.

create table if not exists public.size_charts (
  id         uuid primary key default gen_random_uuid(),
  -- Who owns it. Filled in by the database from the caller's own token rather
  -- than sent by the browser: a client that had to name itself could name
  -- someone else, and this column is the whole of the access rule.
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The public half of the link: unguessable, and rotatable by the owner.
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
