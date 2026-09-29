// NGL words → GarmentCode sewing pattern (py/pattern.py), for every garment type — skipped without the Python libraries
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildPattern } from '../src/services/patterns.js';

const ready = existsSync(new URL('../.pydeps/.ok', import.meta.url));
const CASES = {
  top: { type: 'top', upper: { neckline: 'v_neck', sleeve_length: 'short' } },
  hoodie: { type: 'hoodie', upper: { neckline: 'hood', sleeve_length: 'long', fit: 'oversized' } },
  dress: { type: 'dress', upper: { neckline: 'square', sleeve_length: 'sleeveless' }, lower: { skirt_shape: 'circle', length: 'midi' } },
  skirt: { type: 'skirt', lower: { skirt_shape: 'pleated', length: 'mini' } },
  pants: { type: 'pants', lower: { leg: 'wide', length: 'ankle' } },
  jumpsuit: { type: 'jumpsuit', upper: { sleeve_length: 'short' }, lower: { leg: 'straight', length: 'ankle' } },
};

for (const [name, garment] of Object.entries(CASES)) {
  test(`pattern: ${name}`, { skip: !ready && 'Python libraries not installed' }, async () => {
    const p = await buildPattern({ garment, sex: name === 'pants' ? 'male' : 'female', body: { height: 170, waist: 74 } });
    const panels = Object.values(p.panels);
    assert.ok(panels.length >= 2, 'has panels');
    assert.ok(p.stitches.length >= 2, 'has stitches');
    for (const pn of panels) for (const e of pn.edges) assert.ok(e.pts.length >= 2);
    for (const [a, b] of p.stitches) { assert.ok(p.panels[a.panel]?.edges[a.edge]); assert.ok(p.panels[b.panel]?.edges[b.edge]); }
    assert.equal(p.body.height, 170);
  });
}
