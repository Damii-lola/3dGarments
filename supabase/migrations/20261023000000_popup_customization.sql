-- Per-garment popup customization.
--
-- A store can recolour and relabel the "Find My Size" button and the popup that
-- opens from it, and change the text size inside the scanner. The settings live
-- on the chart itself so every link and every snippet copied from the dashboard
-- carries the same look, and a shopper who follows the link gets the store's
-- styling rather than a default.
--
-- `popup` is a JSON object with these optional keys:
--   label            text on the button (default "Find My Size")
--   color            accent colour, hex (default "#ff6a4a")
--   textSize         "sm" | "md" | "lg" (default "md")
--   theme            "dark" | "light" (default "dark")
--   showMeasurements boolean (default true) — whether the shopper is shown their
--                    measured numbers beside the size
--
-- Empty object means "use the defaults", so existing rows need no backfill.

alter table public.size_charts
  add column if not exists popup jsonb not null default '{}'::jsonb
  check (jsonb_typeof(popup) = 'object');

-- The shopper's half of the link now carries the popup settings too, so the
-- size page can theme itself without a second round trip. Dropped first because
-- a function's return type cannot be changed in place.
drop function if exists public.chart_by_code(text);
create function public.chart_by_code(candidate text)
returns table (name text, sex text, unit text, columns jsonb, rows jsonb, popup jsonb)
language sql
security definer
set search_path = public
as $$
  select c.name, c.sex, c.unit, c.columns, c.rows, c.popup
  from public.size_charts c
  where c.code = lower(trim(candidate))
  limit 1;
$$;
revoke all on function public.chart_by_code(text) from public;
grant execute on function public.chart_by_code(text) to anon, authenticated;