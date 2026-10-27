-- FindMySize — usernames for accounts that do not type one.
--
-- The account screen sends a username with every email signup, and the trigger
-- below refuses an account without one. Google does not send a username: it
-- sends a name, an address and a picture. Before this migration a Google signup
-- therefore failed inside the trigger and the person saw a generic database
-- error instead of an account.
--
-- The rule now: a username that was typed is still required and still checked;
-- a username that was not typed is MADE from what the provider did send, in the
-- same shape the form enforces, and made unique before the row is written. The
-- shape and the unique index are unchanged, so `sam.okafor` and `Sam.Okafor`
-- are still one name.
--
-- Safe to run more than once. Applied by .github/workflows/supabase.yml on push.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  typed     text  := lower(trim(coalesce(meta ->> 'username', '')));
  base      text;
  candidate text;
  n         int   := 0;
begin
  if typed <> '' then
    -- Someone typed it, so it has to be right. This is the path the signup form
    -- always takes, and the message is the one it already knows how to show.
    if typed !~ '^[a-z0-9._-]{3,20}$' then
      raise exception 'username must be 3-20 characters of letters, digits, dot, dash or underscore'
        using errcode = 'check_violation';
    end if;
    candidate := typed;
  else
    -- No username in the metadata: a provider signup. Google has no username
    -- field, so use the one it does have — the account's address. sam@example.com
    -- becomes sam. A name is only the fallback, and only if the address cannot
    -- make a name that fits the same shape the form enforces.
    base := lower(coalesce(
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      nullif(meta ->> 'preferred_username', ''),
      nullif(meta ->> 'user_name', ''),
      nullif(meta ->> 'full_name', ''),
      nullif(meta ->> 'name', '')
    ));
    base := regexp_replace(base, '[^a-z0-9._-]', '', 'g');
    base := trim(both '._-' from base);
    if base is null or length(base) < 3 then base := 'user'; end if;
    base := left(base, 16);

    candidate := base;
    loop
      exit when not exists (select 1 from public.profiles where lower(username) = candidate);
      n := n + 1;
      if n >= 1000 then
        -- Every short suffix is taken. The id is unique by definition.
        candidate := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
        exit;
      end if;
      candidate := left(base, 16) || n::text;
    end loop;
  end if;

  insert into public.profiles (id, username) values (new.id, candidate)
  on conflict (id) do update set username = excluded.username;

  return new;
exception
  when unique_violation then
    -- Two provider signups picked the same name between the check and the
    -- insert. Six characters of the account id settle it without a second
    -- round-trip through the provider.
    insert into public.profiles (id, username)
    values (new.id, left(coalesce(base, 'user'), 12) || substr(replace(new.id::text, '-', ''), 1, 6))
    on conflict (id) do update set username = excluded.username;
    return new;
end;
$$;
