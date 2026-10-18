-- 3dGarments — accounts.
-- Run this whole file in Supabase → SQL Editor → New query → Run (or `supabase db push`).
-- Safe to run more than once: every statement is idempotent.
--
-- What this adds, and why:
--   * public.profiles — one row per account, holding the username. The email and
--     the password are NOT here: Supabase's own auth.users holds them, and the
--     password is stored only as a hash by the auth service. There is no password
--     column in this schema and there must never be one.
--   * a case-insensitive unique username, so Bob and bob cannot both exist.
--   * row level security, so a profile is readable by its owner and nobody else.
--   * username_taken(), so the signup form can say "that name is taken" before
--     anything is created — it has to answer without a select, because nobody may
--     read anybody else's row.
--   * handle_new_user(), the trigger that gives every new account its profile row
--     from the username sent with the signup. An account cannot exist without one.

-- ================================================================ profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);

-- Usernames are how people are known, so they are unique and they do not
-- distinguish case: sam.okafor and Sam.Okafor are the same name.
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- The shape the signup form asks for: 3–20 characters of letters, digits, dot,
-- dash or underscore. Enforced here as well as in the form, because the form is
-- not the only thing that could ever write a row.
do $$ begin
  alter table public.profiles add constraint profiles_username_shape
    check (username ~ '^[A-Za-z0-9._-]{3,20}$');
exception when duplicate_object then null; end $$;

-- ================================================================ row level security
alter table public.profiles enable row level security;

-- Your own row, to read and to update. There is deliberately no insert policy:
-- rows are created by the trigger below, never by a client.
drop policy if exists "profiles: owner read" on public.profiles;
create policy "profiles: owner read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles: owner update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ================================================================ is a username free?
-- Called by the signup form before anything is created. SECURITY DEFINER is what
-- makes it possible: it runs as its owner, so it can see the whole table while the
-- caller still cannot — the answer is a yes or a no, never the list.
create or replace function public.username_taken(candidate text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where lower(username) = lower(trim(candidate))
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- ================================================================ every account gets its profile
-- The username arrives in the signup metadata (web/src/auth.js sends it), lands in
-- auth.users.raw_user_meta_data, and is written here. If it is missing or malformed
-- the whole signup fails, which is the point: an account with no name is not an
-- account we can show anybody.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if wanted !~ '^[a-z0-9._-]{3,20}$' then
    raise exception 'username must be 3-20 characters of letters, digits, dot, dash or underscore'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, username) values (new.id, wanted)
  on conflict (id) do update set username = excluded.username;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
