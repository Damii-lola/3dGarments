-- "Never chose" is not the same as "chose the default".
--
-- user_settings was created with theme 'dark', accent '#ff6a4a' and unit 'cm' as NOT NULL
-- column defaults, so any row made by another panel (saving notifications or billing
-- details) recorded a dark theme, a coral accent and centimetres that nobody had picked.
-- That did no harm while nothing read them. Now that the theme and accent are applied
-- across the site, and the unit starts new charts, those rows would change the site for
-- people who never asked.
--
-- So the three columns become nullable with no default: null means "no choice yet", and
-- the site's own look (light, brand orange, inches in the dashboard) applies. Nothing
-- could be applied before today, so a stored 'dark', '#ff6a4a' or 'cm' is a default,
-- not a choice, and is cleared.

alter table public.user_settings alter column theme drop not null;
alter table public.user_settings alter column theme drop default;
alter table public.user_settings alter column accent_colour drop not null;
alter table public.user_settings alter column accent_colour drop default;
alter table public.user_settings alter column default_unit drop not null;
alter table public.user_settings alter column default_unit drop default;

update public.user_settings set theme = null where theme = 'dark';
update public.user_settings set accent_colour = null where lower(accent_colour) = '#ff6a4a';
update public.user_settings set default_unit = null where default_unit = 'cm';
