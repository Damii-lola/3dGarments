-- Body-derived templates are generated from the mannequin itself (web/src/garments/bodygarment.js), so
-- they have no model file: their definition is meta = { "kind": "body", "spec": { ... } }.
alter table public.garment_templates alter column glb_path drop not null;
comment on column public.garment_templates.glb_path is 'path in the templates bucket; null for body-derived templates (meta.kind = body)';
