-- Template garments: our own 3D garment models, world-readable (the lab and the embeddable widget load
-- them without a login). Only the project owner / service role can write: there are deliberately no
-- insert / update / delete policies. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit)
values ('templates', 'templates', true, 31457280)   -- 30 MB per file
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;

create table if not exists public.garment_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null check (category in ('top','bottom','dress','outerwear','other')),
  sex         text not null default 'unisex' check (sex in ('male','female','unisex')),
  glb_path    text not null,                 -- path inside the "templates" bucket
  thumb_path  text,                          -- optional preview image, same bucket
  meta        jsonb not null default '{}',   -- size label, notes ...
  published   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.garment_templates enable row level security;
drop policy if exists "templates: public read" on public.garment_templates;
create policy "templates: public read" on public.garment_templates for select using (published);

-- 'Male' / 'Top' typed in the dashboard become 'male' / 'top'
create or replace function public.garment_templates_norm() returns trigger language plpgsql as $$
begin new.sex := lower(new.sex); new.category := lower(new.category); return new; end $$;
drop trigger if exists garment_templates_norm on public.garment_templates;
create trigger garment_templates_norm before insert or update on public.garment_templates
  for each row execute function public.garment_templates_norm();
