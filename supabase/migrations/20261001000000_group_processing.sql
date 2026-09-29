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
