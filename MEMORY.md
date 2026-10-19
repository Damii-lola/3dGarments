# 3dGarments — Full Project Memory

> This file is the complete handoff for a new Claude Code session. Read it top to bottom before touching anything.

---

## What this project is

An embeddable 3D **Virtual Fitting Room** for e-commerce (B2B SaaS). Merchants add a script tag; the widget replaces the last static image in a product gallery with a 3D mannequin the shopper shapes to their own measurements, to judge fit before buying (fewer sizing returns, longer sessions, pre-order validation with digital twins of garments).

Planned: Next.js/React merchant dashboard (garment upload, subscription, analytics) · lazy-loaded iframe/script widget · Blender-exported compressed `.glb` garments with chest/waist/height driven by morph targets in JS (no server re-render) · pricing by widget loads (Starter $29 / 5k, Growth $79 / 25k, Scale $199 unlimited + white-label + sizing analytics) · go-to-market via cold outreach to streetwear labels, boutiques and mid-sized Shopify merchants with a custom prototype of their own clothing; 5–10 pilot merchants, then return-rate case studies.

**Garment scanner (server-side, new):** `/api/scan` + `shared/scan-core.js` + U²-Net-P cut-out (WASM). Verified on the owner's real front+back photos of a colour-blocked tee on a wood table (the old colour-based cut-out gave coverage 1 / fallback there): silhouette fit IoU 0.85, logos/cuffs/colour waves land correctly front and back; ~16 s end to end in the (CPU-limited) test box (cut-out ~5 s/photo single-thread WASM, scan ~4 s). Known flaws: small black smear on one side of the back panel from the cuff, perspective not corrected, shading baked in, Render free tier will be slower. Set `SCAN_LAB_KEY` on Render to use it from the lab.

**Template garments (primary: Blender-made, prefit):** the owner models templates with Blender MCP on the real mannequin GLB (first one: `Male/M_CrewNeckTee.glb`, 4,872 tris, 4 UV panels, 0 % UV overlap, 0 mm penetration at rest). `meta.prefit = true` -> `TemplateGarment` prefit path. Worst sink-in after settle is ~4 mm over 13 slider extremes. Female tee not made yet.

**Template garments (fallback, body-derived):** `bodygarment.js` builds the template from the mannequin itself (shares skeleton, skin weights and morphs; UV panels front/back/sleeves; specs in `bodytemplates.js` or Supabase `meta.spec`). Known flaws: lumpiness under the bust on the female body, chest bump highlights on the male, tee silhouette is a generic hang (no seams/folds), no collar thickness, sleeveless/V-neck/etc. not built, only upper-body garments. The static-GLB path below is legacy.

**Template garments (legacy static GLB):** own `.glb` models in Supabase (`garment_templates` + public `templates` bucket). `web/src/garments/template.js` fits a static mesh to the mannequin and follows body changes; the lab's *Templates* section lists them. First model: `Male/M_CrewNeckTee.glb` (AI-generated, decimated by `tools/garments/prepare_template.py`). Known limits: ~7 s fit and ~1.3 s settle in headless software rendering (measure on a real device), lumpy cloth surface, hem flanges at the hip, single static pose assumption.

**Removed from scope:** the old "Style" (pose / backdrop / scene) and "Photoshoot" (4K / transparent export) stages. The code for them (HDRIs, backdrop images, `stage.capture`, the pose library) was deleted. Do not re-add it.

**Live site:** `https://damii-lola.github.io/3dGarments` (served from `main` branch via GitHub Pages)
**Live API:** `https://threedgarments.onrender.com` (Render free tier)
**GitHub repo:** `Damii-lola/3dGarments`
**Current branch:** `main` (at commit `a60c6de`)

---

## Ground rules — never break these

- **Push straight to `main`** (the owner prefers it over feature branches and merges). Pushing to `main` deploys the site, runs the Supabase migrations and CI, so build and test first.
- **Never commit `.env` files.** All secrets live only in Render's env vars.
- `KAGGLE_API_TOKEN` only ever in the shell — never in files.
- API always uses the **service-role key** → every Supabase query MUST filter by `user_id`.
- Storage paths: `<user_id>/groups/<group_id>/<image_id>.<ext>` in the private `garments` bucket.
- Anything in `server/src/shared/` must run in both Node and the browser — no `Buffer`, no DOM.
- **Blender runs IN the cloud container** at `/usr/local/bin/blender`. Nothing needs to run locally.
- Canvas screenshots: `preserveDrawingBuffer: false` on the renderer → `canvas.toBlob()` returns blank. Use Playwright `page.screenshot({ clip: canvasBounds })` instead.

---

## Repo layout

```
assets/                   SOURCE body FBX files from the owner (Character Creator)
  MaleModel.fbx           male — rig + face, eyes, teeth, underwear (boxers)
  FemaleModel.fbx         female — rig + face, eyes, teeth, underwear (bra + bottoms)

tools/body/               model pipeline
  extract.mjs             FBX → raw JSON via the lab test/extract.html
  prepare.py              merge meshes, mannequin head, weld, metres, rename rig, width morph,
                          shoulder probes, eye centres → GLB (pip: numpy scipy)
  glb.py                  GLB helper

tools/garment_ml/         Kaggle ML runners (all headless, no notebook UI needed)
  chatgarment/            ChatGarment on 2×T4 — generates GarmentCode sewing patterns from photos
    kernel.py             push / status / fetch tool  (needs: pip install kaggle, KAGGLE_API_TOKEN)

server/                   Express API (Render). ESM, Node 22.
  src/index.js            app, CORS, error handler
  src/config.js           all env vars (ONLY place that reads process.env)
  src/lib/                supabase (service-role client), cloudflare (Workers AI REST), errors
  src/middleware/auth.js  verifies Supabase JWT → req.user
  src/routes/             garments, groups, me, health
  src/services/pipeline.js  sharp decode → silhouette → texture PNG → Cloudflare vision → Supabase
  src/services/groups.js  AI sorts photos into garments (zone/type/views), cut-outs + measurements
  src/shared/             ⚠ imported by BOTH server and web (Vite alias @shared). dependency-free.
    silhouette.js         segmentation, cut-out, silhouette measurements, categories
    wardrobe.js           garment grouping / colour-signature logic

supabase/
  migrations/             one SQL file per migration (idempotent)
  setup.sql               ALL migrations concatenated — paste into Supabase SQL editor to set up
  emails/                 paste-ready email templates (Confirm signup ← confirm-signup.html)

web/                      Vite + three.js SPA → GitHub Pages
  index.html              HOME — the camera card first, then the page brands read (problem, solution,
                          how it works, benefits, privacy, book a demo)
  size/index.html         THE SCANNER — capture → trim → who → measure → results
  auth/index.html         ACCOUNT SCREEN — sign up (username, email, password ×2) or log in. No codes.
  pricing/index.html      PRICING — what is included, how it is added, what brands ask first (FAQ)
  dashboard/index.html    DASHBOARD — the account, what we hold (a name and an email), and nothing else
  src/nav.js              THE BAR, on every page: the four sections, the account panel, log out,
                          and the sections that arrive as you reach them
  src/landing.js          the home page's camera button (a session → size/, otherwise → auth/)
                          and the demo form, which opens the visitor's own mail client
  src/auth.js             the account form: validation, the username check, sign up, log in,
                          and the expired/used confirmation link
  src/size.js             the door on /size (no account → /auth) and the lazy import of main.js
  src/dashboard.js        paints the account row, and the log out beside it
  public/body/            BUILT rigged models: male.glb female.glb (from tools/body/prepare.py)
  src/main.js             the scanner: the body-scan flow (native camera hand-off, trim, measure, results)
  src/body-scan/          frames (still-frame extraction), pose (?local=1 only), silhouette, trim, notes
  src/human/
    human.js              Human class — loads GLBs, arm hang solver, armpit fix, pose engine
    body.js               ModelController, RANGES, BUILDS, SKIN_STOPS, ABDOMEN, LIMITS, measurements
    shape.js              morph targets built at load from the mesh (belly, waist, bust, etc.)
    materials.js          body material: grey clay / skin tone (SSS wrap, sheen, micro-texture)
    poses.js              standing pose (+ T/A reference poses), composePose(), armsDown constant
    rig.js                POSE ZERO — the limb directions every pose is authored against
    assets.js             model URLs
  src/scene/stage.js      renderer, studio rig (cyclorama + lights), camera views
  src/uploads/
    groups.js             garment photo upload groups UI
    store.js              Supabase storage + IndexedDB fallback
  src/services/
    api.js, auth.js, config.js, local.js, profile.js, wardrobe.js
  src/garments/           garment pipeline (WIP — not wired into the UI yet at this commit)
    cloth.js, fabric.js, fit.js, local.js, outfit.js, pattern.js

test/                     LAB — human/rig/pose workbench (imports web/src directly)
  index.html              main lab page (skeleton, wireframe, weight views, bone editor, stats)
  extract.html            FBX → JSON extractor (for tools/body/extract.mjs)
  meshes.html             lists an FBX's meshes

.github/workflows/        ci.yml, deploy-web.yml (Pages), supabase.yml (db push)
render.yaml               Render blueprint
```

---

## Commands

```bash
# web dev server
cd web && npm i && npm run dev          # http://localhost:5173

# lab (skeleton / pose workbench)
cd test && npm i && npm run dev         # http://localhost:5174

# API server
cd server && npm i && npm run dev       # http://localhost:8787

# rebuild body GLBs (after changing assets/ or tools/body/)
# lab dev server must be running first (extract.mjs opens a headless browser)
node tools/body/extract.mjs && python3 tools/body/prepare.py
# then commit web/public/body/*.glb

# server tests
cd server && npm test

# integration check (live API)
cd server && npm run verify

# Kaggle: ChatGarment (needs KAGGLE_API_TOKEN in the shell, never in files)
export KAGGLE_API_TOKEN=...
python tools/garment_ml/chatgarment/kernel.py push [photos_dir]
python tools/garment_ml/chatgarment/kernel.py status
python tools/garment_ml/chatgarment/kernel.py fetch
```

---

## Render env vars (all keys live here ONLY — never in code or files)

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side, bypasses RLS |
| `SUPABASE_ANON_KEY` | browser-safe, handed to web via `GET /api/public-config` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers AI |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI |
| `CF_VISION_MODEL` | default `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `CF_TEXT_MODEL` | grouping step; defaults to vision model |
| `CF_AI_GATEWAY_ID` | optional Cloudflare gateway |
| `CORS_ORIGINS` | default includes `damii-lola.github.io` + localhost |

Web dev: override via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (without them, runs in local mode — everything in the browser).

---

## Database schema (supabase/setup.sql)

```
garments          id, user_id, name, status (processing/ready/failed), category, fit jsonb,
                  geometry jsonb (silhouette measurements), analysis jsonb (vision description),
                  original_path, texture_path, preview_path, back_texture_path

body_profiles     id, user_id, settings jsonb (the full panel state per device), updated_at

outfits           id, user_id, name, items jsonb

garment_groups    id, user_id, name, status, photos jsonb, processed_at

size_charts       id, user_id (default auth.uid()), code text unique (^[a-z0-9]{8,24}$),
                  name, sex (male/female/unisex), unit (in/cm),
                  columns jsonb ([{ id, label, measure }] - the shop's own column names, in
                    its order; measure is a body measurement or null for "printed only"),
                  rows jsonb ([{ key: 'M', col1: 40, col2: 34 }]), created_at, updated_at
                  + chart_by_code(candidate text) → (name, sex, unit, columns, rows)
                    (SECURITY DEFINER, anon may call it; dropped + recreated because the
                    return type cannot change in place)
```

Storage bucket: `garments` (private). Paths: `<user_id>/groups/<group_id>/<image_id>.<ext>`

Anonymous sign-ins must be enabled in Supabase Auth (uploads reach the cloud as anon users).

---

## Accounts (the way into /size)

```
profiles          id uuid → auth.users (cascade), username text (unique, lower-cased), created_at
                  + username_taken(candidate text) → boolean   (SECURITY DEFINER, anon may call it)
                  + on_auth_user_created on auth.users → handle_new_user() writes the profile row
```

- **Five pages, not one page with routes**: `/` (home), `/auth/` (account screen), `/size/` (the
  scanner), `/pricing/` and `/dashboard/`. Built as five Vite entries into five real directories, so
  GitHub Pages serves them without any rewrite trick. The bar's links are written as `%BASE_URL%…`,
  which Vite substitutes in the HTML at build time (in dev too), so one copy of the markup works in a
  subdirectory and at a domain root — relative links would break as soon as two pages sit at
  different depths. `dist/index.html` is copied to `dist/404.html`, so a wrong address lands on the
  home page.
- **The bar** (`src/nav.js` + `.nav` in styles.css) is on all five pages: the brand and Home, Sizing,
  Dashboard, Pricing, then the account button, which opens a panel filled from the session — the
  username and email, Dashboard, Log out, or "Log in or sign up" when nobody is signed in. Log out
  reloads the page so a gated one notices. It is `sticky` on the marketing pages and `static` on
  `/size` and `/auth` (`body.app`), where the room matters more than the chrome. The four section
  names fold behind one button on phones **and on the app pages at every size**: the app bar is
  clamped to the app column (27.5 rem), and at a 16 px root the brand, four names, the account button
  and the padding came to ≈463 px inside a 440 px bar — the brand would be the first thing to give,
  which is the one thing that must not. `.app .nav-links { display: none }` plus one menu button fits
  at any root size, and the dropdown itself (`.nav-links.open`) is defined once for both cases. Inside
  a brand's popup (`html.embed` + `body.embed`) the bar is the brand alone — centred, its link
  stripped, no menu or account — the sky comes off, and the phone UI runs at **48%** of its 189% root
  (90.72%), 52% down from the full page: the panel the store sized is untouched, only what is drawn
  inside it. **The scanner asks the shopper nothing**: "Who is this video of?" and "What are you
  wearing?" are gone from `/size` entirely, along with "What the app saw" (and the per-frame JPEGs it
  needed — the pose pass no longer draws or encodes a single frame, which is a real part of why a scan
  takes as long as it does). A chart's own `sex` picks the sheet; with no sex anywhere, the server
  scores both built-in sheets against the body and uses the closer one, saying so on the results. The same page opened as a plain link also gets that scale when the *screen* is a phone
  (`html.scan`: a phone-width viewport, or a touch device held sideways) — a WebView in a brand's app
  has no `?embed=1` to ask with — while tablets and desktops keep the size they had. Each page's own
  `<section data-reveal>` elements fade up as they are reached — the
  styles only hide them while `<html>` carries `js`, a flag set by a one-line script before the first
  paint and lifted by the page's own timer unless the observer reports first, so a page can never be
  left invisible. `aria-current` is set by comparing paths, not by hand in five files.
- **Click the camera on `/`** → a session? `/size` : `/auth`. Wait capped at 2.5 s; if the cloud
  settings (VITE_SUPABASE_* or Render's `/api/public-config`, cached in localStorage) do not answer
  in time, the account screen is the default.
- **The phone is not asked to do the measuring. The server is.** A shopper's phone draws a handful of
  still frames out of the clip (`extractFrames`: six JPEGs at 900 px with the 10×10 grid, cheap) and
  sends those; the vision model reads the joints on the server and every number after that is
  arithmetic there. Nothing heavy runs on the device — no 9 MB download, no wasm heap, no GPU required.
  That is the fix for a scan that hangs in a WebView: MediaPipe in an Android WebView was minutes.
  `?local=1` puts the measurement back on the phone (pose model, silhouette), and the module is
  **imported dynamically**, so a normal visit never even parses it. ?local=1 warms `loadPoseEngine()`
  0.7 s after load (never on `?demo=1`) so the download runs while the shopper is recording. Every
  analysis status carries a running clock, and
  `.status.busy::before` is a **transform** animation: inference blocks the main thread, so a JS-drawn
  spinner would freeze exactly when it is needed most while a compositor one keeps turning. The first
  scan is the slow one — the browser caches the files after it. **Which model** is decided by what the
  device can do: full weights on a GPU, lite on a GPU-less device, and never full on a CPU — that one
  combination is minutes rather than seconds. A CPU-bound engine also samples the turn in ten views
  instead of twelve, and the pass logs per-frame detect times plus the total. (All of this only
  happens under `?local=1` now.)
- **The privacy copy says "a few still frames", not "nothing is uploaded".** The default path really
  does send six JPEGs to the server, so every page that claims the video "is never uploaded" had to be
  reworded — the *video* is still never uploaded or stored, which is what the copy now says. This is
  the one place where the server-first architecture is visible to a shopper, and it must stay true.
- **The confirmation link goes to the login page.** `signUp` asks for `emailRedirectTo:
  accountPageUrl()` = `<origin>/<base>auth/` (built from `import.meta.env.BASE_URL`, not from the
  current path), and the account screen picks the session up and opens the scanner. That is only half
  of it: Supabase falls back to the project's **Site URL** whenever a redirect is not in its
  **Redirect URLs** list, and the default Site URL is `http://localhost:3000` — which is exactly how a
  confirmation link ends up on a blank page. Both settings are in README.md, step 3. A link that has
  expired or been used comes back with `error_code=otp_expired` in the fragment: the account screen
  says so and shows the login tab (`linkProblem()` in `src/auth.js`), and cleans the address bar.
  `supabase/emails/confirm-signup.html` is the paste-ready template for Authentication → Email
  Templates → Confirm signup.
- **`/size` is behind the door — except for a brand's link.** `src/size.js` waits (4 s cap) for the
  cloud settings, then requires a *non-anonymous* session, else `location.replace('../auth/')`. No
  cloud configured (or no answer) → the scanner opens anyway; it measures on the device and needs no
  account. Two addresses also open it with the door already open: `?g=CODE` (a shopper following a
  product link — no account, ever) and `?embed=1` (the same page inside the popup). `main.js` is
  imported only after the door is open.
- **The merchant flow lives in `/dashboard`** (not gated: signed out is a state there, so it shows the
  way in). Add a garment → type its size chart (own labels, own unit) → save → a code is generated
  client-side (`crypto.getRandomValues`, 12 chars from an alphabet with no `l`/`0`/`1`) and the card
  appears with the link, the popup snippet, a preview button, edit and delete.
  **Columns are the shop's too**: the form starts with Chest-or-bust / Waist / Hips and the shop adds,
  renames, repoints or removes columns; the table under it grows with them. A column is one of the
  seven measurements the scan can read (`server/src/shared/measures.js` — chest, waist, hips,
  shoulder, neck, arm, height) or "Other", which is carried and shown to the shopper but never
  scored. **The first measurable column decides the size**; every other measured column joins the
  worst-case comparison. The form refuses a chart with no measurable column, a size missing that
  column's number, and a column filled for only some sizes (a blank cell must not favour its row).
  `src/services/charts.js` does the CRUD and the shopper-side `chart_by_code` RPC; `notSetUp(error)`
  turns Postgres 42P01/42883 and PostgREST PGRST202/PGRST205 into the one notice that matters ("run
  supabase/setup.sql, README step 4") instead of a raw error, and lets a real permission error show
  itself.
- **The popup is `web/public/embed.js`** — plain JS, no build step, so Vite copies it verbatim to
  `dist/embed.js` and `%BASE_URL%embed.js` is a stable address to paste into a shop. It reads
  `data-chart`/`data-name`/`data-label`/`data-base` off its own `<script>` tag, derives the site root
  from its own `src` (nothing is hard-coded), mounts a button, and on click injects a dimmed overlay
  with `<iframe src="…/size/?g=CODE&embed=1">`. Escape, a backdrop click, the ✕, or a
  `{source:'3dg', type:'close'}` postMessage from the frame (origin-checked) close it; the page
  underneath is frozen and put back exactly as it was. It also publishes
  `window.ThreeDG.open({code, name})`, which is how the dashboard's Preview runs the real thing.
- **The password is never ours.** Supabase auth holds it, hashed. `profiles` has no password column
  and must never have one. The email lives in `auth.users` too; `profiles` holds only the username.
- **The username rides in the signup metadata** (`options.data.username`), and the trigger writes the
  profile row from it, so an account cannot exist without a name. A duplicate username makes the whole
  signup fail (unique index on `lower(username)`) — `username_taken()` is only there to say so early.
- **Email confirmation must be OFF** (Authentication → Providers → Email → Confirm email) for the
  "no verification step" flow the owner asked for: with it on, `signUp` returns no session and the
  page says "confirm the link we sent, then log in here" instead of opening the scanner. The project
  `yzqmpyxfwcqreymbqrhc` still had `mailer_autoconfirm: false` as of 2026-10-18.
- Local development with no cloud: `VITE_API_URL=http://127.0.0.1:5999 npm run dev` (an address that
  refuses) puts every page in the no-cloud state, so the landing → account → scanner walk can be
  tested without an account. A session can also be faked: `sb-<project-ref>-auth-token` in
  localStorage, `expires_at` in the future, `user.is_anonymous: false`.
- **"Book a Demo" is a mailto, and the address is a placeholder**: `DEMO_EMAIL` in `src/landing.js`
  (and the form's `action` in `index.html`, same string) currently says `hello@3dgarments.com`. The
  form opens the visitor's own mail client with the details filled in, so no form service is involved
  and the reply goes to the address they typed — but nothing arrives until that address is a real
  inbox. Change both together.

---

## Body models — conventions never to break

- **Metres, y up, facing +z, feet at y=0, left=+x** (prepare.py normalises this).
- Bone names are ours (not Character Creator names — prepare.py maps them):
  `pelvis, spine_01…03, neck_01, head, clavicle/upperarm/lowerarm/hand/thigh/calf/foot/ball_l|r, fingers thumb|index|middle|ring|pinky_01…03_l|r`
- **Bone frames:** y runs head→tail, x = y × (+z). **+x rotation swings a limb forward.** Hand/finger bones: +x curls into the palm. Feet/toes use y-up reference. +z moves a left limb outward. +y on the upper arm = internal rotation.
- **Vertex parts (_PART):** 0 skin, 4 fabric. Eyes/teeth/tongue removed (mannequin head). Underwear = fabric part (boxers male, bra+bottoms female).
- **Pose zero (rig.js):** every limb re-based onto fixed anatomical directions, whatever the model's bind pose (T-pose male, A-pose female). All poses mean the same on every model. Do NOT edit rig.js without recalibrating poses.js.
- **Poses authored anatomically** via `buildPose({ c, both, l, r })`. Right side mirrors left as `(x, −y, −z)`.
- **Mannequin heads:** face, eyes, teeth, ears shaved — a smooth featureless head shell replaces everything above a cut under the jaw (`head_cut`: 3 cm female, 5 cm male).
- **Width morph:** shoulders ±20% per unit; arms move out rigidly; hips follow a little. Implemented as a shape key called `width` (slot 0 in morph targets).

---

## Human system deep-dive

### ARM_FIT (human.js ~line 37)

Controls how each model's arms hang when `hang: true` is set on a pose bone:

```js
const ARM_FIT = {
  female: { lat: 0.48, follow: 1, maxOut: 90, minOut: 0 },
  male:   { lat: 0.48, follow: 1, maxOut: 90, minOut: 12 }
};
```

- `lat` — fraction of arm radius that must clear the torso surface (higher = arm pushed further out)
- `follow` — forearm tilt offset relative to upper arm (degrees outward)
- `maxOut` — maximum outward angle cap
- `minOut` — minimum outward angle floor
- `upperGap` — (add this if needed) extra clearance in metres between arm surface and torso; default 0.002 (2mm); raise to e.g. 0.045 for a visible gap on a muscular male

**Note:** At this commit the male `lat` is `0.48` and `minOut` is `12`. In the previous session we changed these to `lat: 0.72, minOut: 6, upperGap: 0.045` to fix the arm appearing glued to the torso. **Those changes are NOT in this commit** — they were on the deleted branch. If the arm looks glued, re-apply them.

### armsDown (poses.js ~line 87)

```js
const armsDown = {
  clavicle:  [0, 0, -4],
  upperarm:  { hang: true, fwd: 8 },          // ← was fwd:2 originally; 8 stops elbow kink
  lowerarm:  { hang: true, fwd: 10, twist: 16 },
  hand:      [-18, 0, -4],
};
```

**Note:** At this commit `fwd` on upperarm may still be `2` (the old value). We changed it to `8` in the deleted branch to stop the elbow kinking inward. If the elbow looks bent inward from the front, set `upperarm.fwd: 8`.

### #hangArm solver (human.js ~line 695)

- Starts at `upper=0°` outward, increments 0.5° until `#clear()` passes
- `#clear()` tests arm-segment clearance against skinned torso points (counting-sort by 1cm y-slices)
- Gap hardcoded to `0.002` m — raise it by adding `upperGap` to ARM_FIT (see above)
- Clamps to `[minOut, maxOut]` then calls `#aim()` to set the bone

### applyArmpit (human.js ~line 46)

A-pose male has lat skin bound 100% to spine → arm comes down but skin stays flared (armpit "glued"). Fix: torso skin near armpit gets up to 55% upper-arm weight, so it tucks in as the arm lowers. Full effect at ≤25° elevation, gone at ≥70°.

```js
const ARMPIT = { male: { reach: 0.2, max: 0.55 }, female: null };
```

### Shape targets (shape.js)

Built at load from the mesh itself (not pre-baked):
`belly, waist, bust, chest, glutes, hips, thighs, fat, muscle, core`

Clothing copies nearest skin vertex weights (inverse-square), so skin-tight garments follow the body. Skin under clothing gets no surface-detail change (avoids poke-through).

### Body controls / sync (body.js)

- Sliders range over `LIMITS` (calibrated on renders — past them the body stops looking real)
- Damped by body fat (`room()`: heavy body has less room to add more)
- Body fat is the stored value; **weight is derived** (every control moves it)
- Weight slider / body-type chips solve fat backwards to reach a target weight
- Measurements are real: height = inches (crown to sole), width = shoulder-point-to-point (cm)

---

## Fitting-room UI (web/src/main.js)

One panel, one 3D preview:
- Sex picker → switches the model (each sex keeps its own saved settings)
- Skin tone slider (0…1 along `SKIN_STOPS` — lightest to darkest)
- Live measurements card (height, weight, BMI, bust/chest, waist, hips, thigh, gap)
- Height & weight sliders
- Body type chips (Slender / Athletic / Soft / Plus-size) + Muscle tone slider
- Abdomen & waist (shape chips + waist cinch slider)
- Bust & chest / Chest width slider
- Shoulders & posture sliders
- Glutes, Hip width, Thighs sliders
- Reset body shape button

Settings saved to `localStorage` (key `3dg.tryon.v3`) and synced to Supabase `body_profiles.settings` per device — the newer copy wins at boot.

URL shortcuts: `?model=male|female&tone=0..1`
Dev console: `window.__3dg` → `{ stage, human, model, state, profile, applyShape, buildPanel }`

---

## Stage renderer (web/src/scene/stage.js)

- `preserveDrawingBuffer: false` — `canvas.toBlob()` returns blank; use Playwright instead
- `stage.invalidate(n, live)` — schedules n frames; `live=true` while a slider is dragged
- LOW_POWER tier (touch / small screen / ≤4 cores): pixel ratio ≤1.5, 1K shadows, half-res AO
- N8AO ambient occlusion on `ao.beautyRenderTarget`; MSAA lives there too
- Mobile CSS: no `backdrop-filter`

---

## Garment photo upload (web/src/uploads/)

- Upload box above the sex picker → review popup (remove / add more, max 10 per photo group)
- Confirm → a group card (click to edit / rename / delete); any number of groups
- Drafts: Cancel/Esc changes nothing
- Cloud: Supabase (`garment_groups` table + private `garments` bucket at `<uid>/groups/<group>/<image>`, anonymous sign-in if nobody is logged in)
- Fallback: IndexedDB when Supabase isn't configured or refuses

---

## Server API routes

| Route | What it does |
|-------|-------------|
| `GET /` | service info |
| `GET /health` | status |
| `GET /api/public-config` | browser-safe Supabase URL + anon key (cached 5 min) |
| `GET /api/garments` | list garments for the user |
| `POST /api/garments` | upload + process a photo |
| `PATCH /api/garments/:id` | update fit/name/category |
| `DELETE /api/garments/:id` | delete garment + storage |
| `GET /api/garments/:id/reprocess` | re-run the vision pipeline |
| `GET /api/me/body` | load body profile |
| `PUT /api/me/body` | save body profile |
| `GET /api/me/outfits` | list outfits |
| `GET /api/groups` | list garment groups |
| `POST /api/groups` | create group |
| `PATCH /api/groups/:id` | update group (name / photos) |
| `DELETE /api/groups/:id` | delete group |
| `POST /api/body-scan` | measure a clip (open route — no bearer): multipart `frames` JPEGs (the default path — the server's vision model reads them) or `source: 'pose'` + on-device landmarks (`?local=1`). Optional `chart` (the brand's own size chart — `{ name, sex, unit, columns, rows }` — used only to choose a size, never to measure). Answers with measurements, notes, `size`/`sizeChart`/`sizeBasis`, and `sizeSource` (`store` or `reference`) + `sizeName` |

---

## The size a brand's link comes back with (server/src/lib/sizing.js, routes/body-scan.js)

- `bestSize(sex, girths, chart = CHARTS[sex], columns = null)` scores every row by its **worst**
  disagreement with any measured column the chart actually has, and takes the smallest; an exact tie
  keeps the smaller size (i.e. the row typed first). Columns come from the chart (`{ id, label,
  measure }`, the shop's order) or, when absent, from `columnsFromRows()` (chest/bust first, then
  waist, hips) — which is how the built-in charts are read, so there is one scoring rule.
  **The first column with a measure decides the size**; a column only counts when *every* row carries
  it and the body has that measurement (a blank cell must not favour its row). `chartKey(chart)` still
  picks the torso column chest-preferred, so a men's shirt chart the shop typed as "chest" is not read
  as a bust chart. A chart with no measurable column returns `null`: no size beats an invented one.
- `chartFromInput(input)` normalises a shop's chart: columns keep their order, a missing/duplicate id
  gets `c1…`, a label is trimmed to 24 chars, an unknown `measure` becomes `null` (printed only); cm →
  inches once (the chart carries its own unit), first row wins on a duplicate label, values outside
  5–120 in dropped, a column no row uses dropped, and a row with no number in the deciding column
  dropped rather than guessed at. Returns `{ rows, columns }` or `null`, so the caller falls back to
  the reference chart rather than sizing against an empty table.
- `readChart(body)` in the route takes the chart as an object (pose path) or a JSON string (multipart)
  and never fails the scan for a bad chart — a chart is only ever used to CHOOSE a size.
- The result carries `sizeSource` ('store' | 'reference') and `sizeName`, so the page can say whose
  numbers these are; the snug/loose note is written from `size.field` + `size.label` (whichever column
  decided), and the depth hedge only fires when that column is the chest. On a store chart a
  successful size adds "This size is off <garment>'s own chart, not a standard one."
- `/size` shows the size in a card above the measurements **only when a chart was read** (plain
  scanning stays a tape measure), with an honest no-size state, and `?demo=1&store=1` renders that card
  without a link or a cloud.

---

## Garment pipeline (server/src/services/pipeline.js + src/shared/silhouette.js)

`sharp` decode → `silhouette.js` (segmentation, cut-out, measurements) → texture PNG → Cloudflare vision (`CF_VISION_MODEL`, default `llama-4-scout-17b-16e-instruct`) → Supabase.

Categories: `top | outerwear | dress | skirt | pants | shorts`

If vision fails → silhouette guess used; a failed call never blocks processing.

---

## AI grouping (server/src/services/groups.js)

POST `/api/groups/:id/process` → Cloudflare vision reads all photos in a group → assigns each to a zone (top/bottom/full), type, and views (front/back/side); produces cut-outs + silhouette measurements per photo.

---

## ChatGarment on Kaggle (tools/garment_ml/chatgarment/)

Generates GarmentCode sewing patterns from garment photos using a 27 GB LLaVA-based model on 2×T4 GPUs.

```bash
export KAGGLE_API_TOKEN=...   # shell only, never in files
python tools/garment_ml/chatgarment/kernel.py push [photos_dir]  # upload + start GPU run
python tools/garment_ml/chatgarment/kernel.py status             # check progress
python tools/garment_ml/chatgarment/kernel.py fetch              # download patterns
```

Kernel slugs: `3dgarments-chatgarment` (kernel), `3dgarments-test-photos` (dataset), `3dgarments-cg-weights` (weights).

---

## Garment 3D builder (web/src/garments/) — WIP, NOT WIRED INTO THE UI at this commit

Files exist but are not imported from `main.js`. This is the next thing to build:
- `cloth.js` — cloth simulation / sewing builder
- `fabric.js` — fabric material
- `fit.js` — garment fitting
- `outfit.js` — outfit management
- `pattern.js` — pattern → mesh

---

## How to screenshot the model (Playwright)

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
// click a body-type chip:
await pg.evaluate(() => { for (const c of document.querySelectorAll('.chip')) if (c.textContent.trim() === 'Athletic') { c.click(); break; } });
await pg.waitForTimeout(2500);
const box = await pg.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
await pg.screenshot({ path: '/tmp/render.png', clip: box });
await br.close();
```

Start the Vite dev server first: `cd web && npm run dev`

---

## Blender (in the cloud container)

Blender is installed at `/usr/local/bin/blender`. Everything runs in the cloud — no local machine needed.

```bash
# headless sewing script
blender -b -P tools/blender/sew/tee.py

# with UI + live WebSocket on ws://127.0.0.1:8790
blender -P tools/blender/live.py

# send a command/script to a running Blender session
python3 tools/blender/send.py '<python>'
python3 tools/blender/send.py -f some_script.py

# export the site body to ~/.3dg-sew (for Blender sewing scripts)
python3 tools/blender/send.py -f tools/blender/sew/export_body.py

# stream a sewn mesh back to the site
python3 tools/blender/send.py -f tools/blender/sew/load.py
```

The live link (`?blender=1`, `web/src/live/blender.js`) connects to Blender's WebSocket and renders whatever Blender streams — the site body is sent to Blender AS SHOWN (every vertex world position) and Blender sends back any mesh in its "Garments" collection evaluated in real time.

**Note:** At this commit `tools/blender/` does NOT exist — it was part of the deleted clothing system. It needs to be rebuilt from scratch.

---

## Known arm issues to fix (not in this commit)

The previous session fixed these but the fixes were on the deleted branch. Re-apply when rebuilding:

1. **Upper arm fwd: 2 → 8** in `armsDown` (poses.js line ~89) — stops the elbow kinking inward from the front
2. **ARM_FIT.male.minOut: 12 → 6** — 12° was too splayed
3. **ARM_FIT.male.lat: 0.48 → 0.72** — raises arm clearance threshold
4. **ARM_FIT.male.upperGap: 0.045** — forces 45mm air between arm surface and lat/chest skin (add the field and wire it into `#clear()` call: `fit.upperGap ?? 0.002`)

---

## Current state of the repo (commit a60c6de)

- ✅ Male + female mannequin models fully rigged and built (`web/public/body/*.glb`)
- ✅ Fitting-room UI: body controls, skin tone, measurements, photo upload groups
- ✅ Express API: garments, groups, me, health routes
- ✅ Supabase schema + RLS + storage bucket
- ✅ Cloudflare vision pipeline
- ✅ AI garment grouping (zone/type/views/cut-outs)
- ✅ ChatGarment Kaggle runner (generates GarmentCode patterns)
- ✅ **Size finder for brands** (the product): `/size` scans a 360° turn and reads it on the device,
  a brand types its chart in `/dashboard` and gets a link + a popup snippet (`embed.js`), and the
  shopper's size is scored against that brand's own chart. Pricing is $30/month for unlimited
  clothing size charts (text only — no checkout yet; `web/pricing/index.html`)
- ⏳ Garment 3D builder (`web/src/garments/`) — files exist but NOT wired into the UI
- ❌ Blender sewing pipeline — **deleted, needs to be rebuilt from scratch**
- ❌ Try-on UI (wearing clothes on the model) — **commented out / not built yet**
- ❌ Billing / subscriptions — the price is on the page, the checkout is next
- ❌ Packaged plugins for Shopify/WooCommerce — the snippet is what there is today

---

## Git attribution footer (every commit message)

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139JKEoXc4irHwm6ZnPDgHe
```
