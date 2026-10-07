# Session Memory — 3dGarments

> Drop this file into a new Claude Code session. It tells the new session exactly where we are, what was changed and why, and what to do next.

---

## Repo & branch

- **GitHub repo:** `Damii-lola/3dGarments`
- **Active feature branch:** `claude/zen-franklin-y92cb4`
- **Never push to `main` directly** — all work goes to the feature branch above.
- Live site (GitHub Pages) serves `main`; feature branch changes are not live until merged.

---

## What was worked on (most recent sessions)

### 1. Blender tee shirt (tools/blender/sew/)
- Sewn in A-pose (arms 47° down), then unposed to rest pose via inverse skinning.
- Fixed shoulder tear, boxy torso, sleeve cap asymmetry.
- Sleeve shortened to upper-bicep length (`SL = capH + 0.035`).
- Wrinkles added: `fold` vertex group (Gaussian-weighted in pattern UV space), `shrink_group` in cloth sim, `iron(exclude_group='fold')` so the fold zones don't get pressed flat.

### 2. Male arm hang — the main focus of the last two sessions

**Problem:** Male model's upper arm was bending inward toward the torso and looked "glued" to the lat skin.

**Root causes & fixes (all in `web/src/human/human.js` and `web/src/human/poses.js`):**

| What | Before | After | Why |
|------|--------|-------|-----|
| `armsDown.upperarm.fwd` (poses.js line ~89) | `2` | `8` | Upper arm leaned only 2° forward while forearm leaned 10°, creating an 8° divergence that made the elbow look kinked inward. Fixed by matching the upper arm to the lower arm's forward lean (not the other way around). |
| `ARM_FIT.male.minOut` (human.js line ~39) | `12` | `6` | 12° was too aggressive — arms looked artificially splayed. |
| `ARM_FIT.male.lat` (human.js line ~39) | `0.48` | `0.72` | 48% radius clearance let the arm rest deep into the torso geometry; raised to 72% to force a physical gap. |
| `ARM_FIT.male.upperGap` (human.js line ~39) | *(didn't exist — hardcoded 2mm)* | `0.045` (45mm) | The `#clear()` hang solver had a hardcoded 2mm gap. Even with lat=0.72 the bone was only 2mm from the torso surface and skin blending made them look fused. Added `upperGap` to ARM_FIT and wired it into `#clear()` so the solver keeps the arm 45mm clear of the lat/chest skin. |

**Current ARM_FIT state (human.js ~line 39):**
```js
const ARM_FIT = {
  female: { lat: 0.48, follow: 1, maxOut: 90, minOut: 0 },
  male:   { lat: 0.72, follow: 1, maxOut: 90, minOut: 6, upperGap: 0.045 }
};
```

**Current armsDown state (poses.js ~line 87):**
```js
const armsDown = {
  clavicle:  [0, 0, -4],
  upperarm:  { hang: true, fwd: 8 },
  lowerarm:  { hang: true, fwd: 10, twist: 16 },
  hand:      [-18, 0, -4],
};
```

**Where `upperGap` is used (human.js ~line 720):**
```js
while (upper < 50 && !this.#clear(
  shoulder, dir(upper, U.fwd || 0), A.upper,
  (A.rUpper + B.armGrowth(s, 'upper')) * fit.lat,
  (A.rUpper + B.armGrowth(s, 'upper')) * fit.lat * 0.875,
  sg, fit.upperGap ?? 0.002, [0.6, 0.8, 1]
)) upper += 0.5;
```

---

## Key files

| File | What's in it |
|------|-------------|
| `web/src/human/human.js` | `ARM_FIT` (line ~39), `#hangArm` (line ~695), `#clear` (line ~671), `applyArmpit` (torso skin tucks with arm) |
| `web/src/human/poses.js` | `armsDown` constant (line ~87), all pose definitions |
| `web/src/human/body.js` | `SKIN_STOPS`, `RANGES`, `BUILDS`, `ModelController` — height/weight/shape |
| `web/src/human/shape.js` | Morph targets built at load |
| `web/src/scene/stage.js` | Renderer — **`preserveDrawingBuffer: false`** — never call `canvas.toBlob()` to screenshot; use Playwright `page.screenshot({ clip: canvasBounds })` instead |
| `tools/blender/sew/tee.py` | Men's tee pattern + drape |
| `tools/blender/sew/sewlib.py` | Pattern pieces, seams, sim helpers, `unpose`, `iron` |

---

## How to render the model (Playwright)

```js
// render.mjs — run with: node --input-type=module < render.mjs
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const pg = await br.newPage();
await pg.setViewportSize({ width: 1400, height: 1100 });
await pg.goto('http://localhost:5173/?model=male&pose=stand', { waitUntil: 'networkidle', timeout: 30000 });
await pg.waitForTimeout(4500);
// click a body-type chip if needed:
await pg.evaluate(() => { for (const c of document.querySelectorAll('.chip')) if (c.textContent.trim() === 'Athletic') { c.click(); break; } });
await pg.waitForTimeout(2500);
const box = await pg.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
await pg.screenshot({ path: '/tmp/render.png', clip: box });
await br.close();
```

Start the dev server first: `cd web && npm run dev`

---

## Blender — runs IN the cloud container, no local machine needed

**Blender is installed at `/usr/local/bin/blender` in the cloud session container.**
Everything is done live — no local setup, no user running scripts manually.

```bash
# run a sewing script headless (outputs ~/.3dg-sew/tee.obj)
blender -b -P tools/blender/sew/tee.py

# export the site's current body pose to ~/.3dg-sew for Blender to read
python3 tools/blender/send.py -f tools/blender/sew/export_body.py

# stream the resulting mesh back to the live site
python3 tools/blender/send.py -f tools/blender/sew/load.py
```

The live link (`?blender=1`) uses a WebSocket on `ws://127.0.0.1:8790` served by `live.py` — but for headless sewing work `tee.py` runs standalone with no WebSocket needed.

---

## Commands

```bash
# dev server
cd web && npm i && npm run dev        # port 5173

# lab (skeleton/pose workbench)
cd test && npm i && npm run dev       # port 5174

# API server
cd server && npm i && npm run dev     # port 8787

# rebuild body GLBs (after changing assets/ or tools/body/)
node tools/body/extract.mjs && python3 tools/body/prepare.py
# then commit web/public/body/*.glb

# push to feature branch
git push -u origin claude/zen-franklin-y92cb4
```

---

## Conventions to never break

- All models in **metres, y up, facing +z, feet at y=0, left = +x**.
- Bone frames: **+x rotation swings a limb forward**; +z moves a left limb outward.
- `armsDown` pose uses `hang: true` — the hang solver (`#hangArm`) places the bone, NOT the Euler angles.
- Right side is mirrored as `(x, −y, −z)` of the left in `buildPose`.
- API always uses service-role key; **every query must filter by `user_id`**.
- **Never commit `.env` files**. Keys live only in Render env vars.
- `KAGGLE_API_TOKEN` only in the shell, never in files.

---

## Where we stopped / what's next

The user confirmed the arm gap looked good at 45mm. No new task was assigned.

**Likely next steps (user will confirm):**
1. Merge `claude/zen-franklin-y92cb4` → `main` so the arm fix goes live on GitHub Pages (ask user first).
2. Continue on garment try-on rebuild (task #15 / #16 in the task list — the whole system is currently commented out of `main.js`, being rebuilt from scratch per CLAUDE.md).
3. Further tuning of the tee shirt drape in Blender if the user wants to revisit it.

---

## Git attribution footer (append to every commit message)

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139JKEoXc4irHwm6ZnPDgHe
```
