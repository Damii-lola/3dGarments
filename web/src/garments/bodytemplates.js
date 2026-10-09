/**
 * Built-in body-derived templates (no model file needed). Each is a `spec` for BodyGarment: the same
 * generator makes them on the male and the female body. More can be added in Supabase
 * (`garment_templates.meta.spec`, `meta.kind = "body"`).
 */
export const BODY_TEMPLATES = [
  { id: 'body:crew-tee', name: 'Crew-neck tee', category: 'top', sex: 'unisex', kind: 'body', spec: { sleeve: 0.55 } },
  { id: 'body:long-sleeve', name: 'Long sleeve', category: 'top', sex: 'unisex', kind: 'body', spec: { sleeve: 1.95, hem: -0.11 } },
];
