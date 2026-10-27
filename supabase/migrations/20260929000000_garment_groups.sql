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
