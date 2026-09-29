-- Stage 1: the model editor's settings, per device (the anonymous user the browser signs in as),
-- both sexes at once: { sex, models: { female: {...}, male: {...} }, updated }.
alter table public.body_profiles add column if not exists settings jsonb not null default '{}'::jsonb;
