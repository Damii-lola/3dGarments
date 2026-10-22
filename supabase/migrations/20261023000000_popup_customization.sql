-- Per-garment popup customization (rich editor).
-- `popup` is a JSON object. Empty object = defaults.
alter table public.size_charts
  add column if not exists popup jsonb not null default '{}'::jsonb
  check (jsonb_typeof(popup) = 'object');

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