# 3dGarments â€” Full Project Memory

> This file is the complete handoff for a new Claude Code session. Read it top to bottom before touching anything.

---

## What this project is

An embeddable 3D **Virtual Fitting Room** for e-commerce (B2B SaaS). Merchants add a script tag; the widget replaces the last static image in a product gallery with a 3D mannequin the shopper shapes to their own measurements, to judge fit before buying (fewer sizing returns, longer sessions, pre-order validation with digital twins of garments).

Planned: Next.js/React merchant dashboard (garment upload, subscription, analytics) Â· lazy-loaded iframe/script widget Â· Blender-exported compressed `.glb` garments with chest/waist/height driven by morph targets in JS (no server re-render) Â· pricing by widget loads (Starter $29 / 5k, Growth $79 / 25k, Scale $199 unlimited + white-label + sizing analytics) Â· go-to-market via cold outreach to streetwear labels, boutiques and mid-sized Shopify merchants with a custom prototype of their own clothing; 5â€“10 pilot merchants, then return-rate case studies.

**Garment scanner (server-side, new):** `/api/scan` + `shared/scan-core.js` + UÂ²-Net-P cut-out (WASM). Verified on the owner's real front+back photos of a colour-blocked tee on a wood table (the old colour-based cut-out gave coverage 1 / fallback there): silhouette fit IoU 0.85, logos/cuffs/colour waves land correctly front and back; ~16 s end to end in the (CPU-limited) test box (cut-out ~5 s/photo single-thread WASM, scan ~4 s). Known flaws: small black smear on one side of the back panel from the cuff, perspective not corrected, shading baked in, Render free tier will be slower. Set `SCAN_LAB_KEY` on Render to use it from the lab.

**Template garments (primary: Blender-made, prefit):** the owner models templates with Blender MCP on the real mannequin GLB (first one: `Male/M_CrewNeckTee.glb`, 4,872 tris, 4 UV panels, 0 % UV overlap, 0 mm penetration at rest). `meta.prefit = true` -> `TemplateGarment` prefit path. Worst sink-in after settle is ~4 mm over 13 slider extremes. Female tee not made yet.

**Template garments (fallback, body-derived):** `bodygarment.js` builds the template from the mannequin itself (shares skeleton, skin weights and morphs; UV panels front/back/sleeves; specs in `bodytemplates.js` or Supabase `meta.spec`). Known flaws: lumpiness under the bust on the female body, chest bump highlights on the male, tee silhouette is a generic hang (no seams/folds), no collar thickness, sleeveless/V-neck/etc. not built, only upper-body garments. The static-GLB path below is legacy.

**Template garments (legacy static GLB):** own `.glb` models in Supabase (`garment_templates` + public `templates` bucket). `web/src/garments/template.js` fits a static mesh to the mannequin and follows body changes; the lab's *Templates* section lists them. First model: `Male/M_CrewNeckTee.glb` (AI-generated, decimated by `tools/garments/prepare_template.py`). Known limits: ~7 s fit and ~1.3 s settle in headless software rendering (measure on a real device), lumpy cloth surface, hem flanges at the hip, single static pose assumption.

**Removed from scope:** the old "Style" (pose / backdrop / scene) and "Photoshoot" (4K / transparent export) stages. The code for them (HDRIs, backdrop images, `stage.capture`, the pose library) was deleted. Do not re-add it.

**Live site:** `https://damii-lola.github.io/3dGarments` (served from `main` branch via GitHub Pages)
**Live API:** `https://threedgarments.onrender.com` (Render free tier)
**GitHub repo:** `Damii-lola/3dGarments`
**Current branch:** `main` (at commit `a60c6de`)

---

## Ground rules â€” never break these

- **Push straight to `main`** (the owner prefers it over feature branches and merges). Pushing to `main` deploys the site, runs the Supabase migrations and CI, so build and test first.
- **Never commit `.env` files.** All secrets live only in Render's env vars.
- `KAGGLE_API_TOKEN` only ever in the shell â€” never in files.
- API always uses the **service-role key** â†’ every Supabase query MUST filter by `user_id`.
- Storage paths: `<user_id>/groups/<group_id>/<image_id>.<ext>` in the private `garments` bucket.
- Anything in `server/src/shared/` must run in both Node and the browser â€” no `Buffer`, no DOM.
- **Blender runs IN the cloud container** at `/usr/local/bin/blender`. Nothing needs to run locally.
- Canvas screenshots: `preserveDrawingBuffer: false` on the renderer â†’ `canvas.toBlob()` returns blank. Use Playwright `page.screenshot({ clip: canvasBounds })` instead.

---

## Repo layout

```
assets/                   SOURCE body FBX files from the owner (Character Creator)
  MaleModel.fbx           male â€” rig + face, eyes, teeth, underwear (boxers)
  FemaleModel.fbx         female â€” rig + face, eyes, teeth, underwear (bra + bottoms)

tools/body/               model pipeline
  extract.mjs             FBX â†’ raw JSON via the lab test/extract.html
  prepare.py              merge meshes, mannequin head, weld, metres, rename rig, width morph,
                          shoulder probes, eye centres â†’ GLB (pip: numpy scipy)
  glb.py                  GLB helper

tools/garment_ml/         Kaggle ML runners (all headless, no notebook UI needed)
  chatgarment/            ChatGarment on 2Ã—T4 â€” generates GarmentCode sewing patterns from photos
    kernel.py             push / status / fetch tool  (needs: pip install kaggle, KAGGLE_API_TOKEN)

server/                   Express API (Render). ESM, Node 22.
  src/index.js            app, CORS, error handler
  src/config.js           all env vars (ONLY place that reads process.env)
  src/lib/                supabase (service-role client), cloudflare (Workers AI REST), errors
  src/middleware/auth.js  verifies Supabase JWT â†’ req.user
  src/routes/             garments, groups, me, health
  src/services/pipeline.js  sharp decode â†’ silhouette â†’ texture PNG â†’ Cloudflare vision â†’ Supabase
  src/services/groups.js  AI sorts photos into garments (zone/type/views), cut-outs + measurements
  src/shared/             âš  imported by BOTH server and web (Vite alias @shared). dependency-free.
    silhouette.js         segmentation, cut-out, silhouette measurements, categories
    wardrobe.js           garment grouping / colour-signature logic

supabase/
  migrations/             one SQL file per migration (idempotent)
  setup.sql               ALL migrations concatenated â€” paste into Supabase SQL editor to set up
  emails/                 paste-ready email templates (Confirm signup â† confirm-signup.html)

web/                      Vite + three.js SPA â†’ GitHub Pages
  index.html              HOME â€” the camera card first, then the page brands read (problem, solution,
                          how it works, benefits, privacy, book a demo)
  size/index.html         THE SCANNER â€” capture â†’ trim â†’ who â†’ measure â†’ results
  auth/index.html         ACCOUNT SCREEN â€” sign up (username, email, password Ã—2) or log in. No codes.
  pricing/index.html      PRICING â€” what is included, how it is added, what brands ask first (FAQ)
  dashboard/index.html    DASHBOARD â€” the account, what we hold (a name and an email), and nothing else
  src/nav.js              THE BAR, on every page: the four sections, the account panel, log out,
                          and the sections that arrive as you reach them
  src/landing.js          the home page's camera button (a session â†’ size/, otherwise â†’ auth/)
                          and the demo form, which opens the visitor's own mail client
  src/auth.js             the account form: validation, the username check, sign up, log in,
                          and the expired/used confirmation link
  src/size.js             the door on /size (no account â†’ /auth) and the lazy import of main.js
  src/dashboard.js        paints the account row, and the log out beside it
  public/body/            BUILT rigged models: male.glb female.glb (from tools/body/prepare.py)
  src/main.js             the scanner: the body-scan flow (native camera hand-off, trim, measure, results)
  src/body-scan/          frames (fallback stills), pose (?local=1 only), silhouette, trim, notes
  src/human/
    human.js              Human class â€” loads GLBs, arm hang solver, armpit fix, pose engine
    body.js               ModelController, RANGES, BUILDS, SKIN_STOPS, ABDOMEN, LIMITS, measurements
    shape.js              morph targets built at load from the mesh (belly, waist, bust, etc.)
    materials.js          body material: grey clay / skin tone (SSS wrap, sheen, micro-texture)
    poses.js              standing pose (+ T/A reference poses), composePose(), armsDown constant
    rig.js                POSE ZERO â€” the limb directions every pose is authored against
    assets.js             model URLs
  src/scene/stage.js      renderer, studio rig (cyclorama + lights), camera views
  src/uploads/
    groups.js             garment photo upload groups UI
    store.js              Supabase storage + IndexedDB fallback
  src/services/
    api.js, auth.js, config.js, local.js, profile.js, wardrobe.js
  src/garments/           garment pipeline (WIP â€” not wired into the UI yet at this commit)
    cloth.js, fabric.js, fit.js, local.js, outfit.js, pattern.js

test/                     LAB â€” human/rig/pose workbench (imports web/src directly)
  index.html              main lab page (skeleton, wireframe, weight views, bone editor, stats)
  extract.html            FBX â†’ JSON extractor (for tools/body/extract.mjs)
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

## Render env vars (all keys live here ONLY â€” never in code or files)

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

Web dev: override via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (without them, runs in local mode â€” everything in the browser).

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
                  + chart_by_code(candidate text) â†’ (name, sex, unit, columns, rows)
                    (SECURITY DEFINER, anon may call it; dropped + recreated because the
                    return type cannot change in place)
```

Storage bucket: `garments` (private). Paths: `<user_id>/groups/<group_id>/<image_id>.<ext>`

Anonymous sign-ins must be enabled in Supabase Auth (uploads reach the cloud as anon users).

---

## Accounts (the way into /size)

```
profiles          id uuid â†’ auth.users (cascade), username text (unique, lower-cased), created_at
                  + username_taken(candidate text) â†’ boolean   (SECURITY DEFINER, anon may call it)
                  + on_auth_user_created on auth.users â†’ handle_new_user() writes the profile row
```

- **Five pages, not one page with routes**: `/` (home), `/auth/` (account screen), `/size/` (the
  scanner), `/pricing/` and `/dashboard/`. Built as five Vite entries into five real directories, so
  GitHub Pages serves them without any rewrite trick. The bar's links are written as `%BASE_URL%â€¦`,
  which Vite substitutes in the HTML at build time (in dev too), so one copy of the markup works in a
  subdirectory and at a domain root â€” relative links would break as soon as two pages sit at
  different depths. `dist/index.html` is copied to `dist/404.html`, so a wrong address lands on the
  home page.
- **The bar** (`src/nav.js` + `.nav` in styles.css) is on all five pages: the brand and Home, Sizing,
  Dashboard, Pricing, then the account button, which opens a panel filled from the session â€” the
  username and email, Dashboard, Log out, or "Log in or sign up" when nobody is signed in. Log out
  reloads the page so a gated one notices. It is `sticky` on the marketing pages and `static` on
  `/size` and `/auth` (`body.app`), where the room matters more than the chrome. The four section
  names fold behind one button on phones **and on the app pages at every size**: the app bar is
  clamped to the app column (27.5 rem), and at a 16 px root the brand, four names, the account button
  and the padding came to â‰ˆ463 px inside a 440 px bar â€” the brand would be the first thing to give,
  which is the one thing that must not. `.app .nav-links { display: none }` plus one menu button fits
  at any root size, and the dropdown itself (`.nav-links.open`) is defined once for both cases. Inside
  a brand's popup (`html.embed` + `body.embed`) the bar is the brand alone â€” centred, its link
  stripped, no menu or account â€” the sky comes off, and the phone UI runs at **48%** of its 189% root
  (90.72%), 52% down from the full page: the panel the store sized is untouched, only what is drawn
  inside it. **The scanner asks the shopper nothing**: "Who is this video of?" and "What are you
  wearing?" are gone from `/size` entirely, along with "What the app saw" (and the per-frame JPEGs it
  needed â€” the pose pass no longer draws or encodes a single frame, which is a real part of why a scan
  takes as long as it does). A chart's own `sex` picks the sheet; with no sex anywhere, the server
  scores both built-in sheets against the body and uses the closer one, saying so on the results. The same page opened as a plain link also gets that scale when the *screen* is a phone
  (`html.scan`: a phone-width viewport, or a touch device held sideways) â€” a WebView in a brand's app
  has no `?embed=1` to ask with â€” while tablets and desktops keep the size they had. Each page's own
  `<section data-reveal>` elements fade up as they are reached â€” the
  styles only hide them while `<html>` carries `js`, a flag set by a one-line script before the first
  paint and lifted by the page's own timer unless the observer reports first, so a page can never be
  left invisible. `aria-current` is set by comparing paths, not by hand in five files.
- **Click the camera on `/`** â†’ a session? `/size` : `/auth`. Wait capped at 2.5 s; if the cloud
  settings (VITE_SUPABASE_* or Render's `/api/public-config`, cached in localStorage) do not answer
  in time, the account screen is the default.
- **The CLIP goes to the server; the phone does no video work at all.** `analyzeVideo()` posts the
  trimmed recording as multipart `video` with `from`/`to`; `server/src/lib/videoFrames.js` pulls eight
  stills out of it with the bundled `ffmpeg-static` (one seek per frame, evenly spread â€” see below), and the
  existing vision loop reads them. Uploaded files land in `os.tmpdir()` and are unlinked on
  `res.finish`/`res.close`.
  Why: a WebView's `video.currentTime` seek is slow and sometimes returns a frame that never arrived, and
  the server can look at the whole clip. The trade is upload time â€” a clip over 80 MB (or `?frames=1`, or
  an upload/decode failure) falls back to 12 device-drawn stills. `?local=1` is the third path (on-device
  pose model, numbers only) and is still **imported dynamically**, so a normal visit never parses it.
- **`ffmpeg-static` in the API.** ~45 MB Windows / ~78 MB Linux binary fetched at `npm ci`; nothing to
  install on Render. Measured on the free instance: **22 s** for eight seeks on a 30 s 478Ã—850 clip,
  **11 s** for four. Grouped with the model wait, extraction is now only a quarter of a scan.
- **Measured end to end on a real phone clip (2026-10-20, after the one-pass decode and the four-at-a-time
  vision limit):** 8 frames **68.2 s** wall from the API's own clock â€” decode **16.4 s**, vision **38.9 s**,
  every frame 15â€“19 s, 709â€“868 completion tokens, 320â€“367 neurons. The same scan an hour earlier took
  **116.7 s** (decode 17.2 s, vision 87.7 s) because eight calls at once put two of them behind a 70 s GPU
  queue. The 2026-10-19 baseline was 89.5 s (decode 22 s, vision 63 s). Remaining wall: Render's free
  instance decodes 900 frames in ~16 s at 0.1 CPU, and two waves of four vision calls cost ~39 s. Both are
  hosting choices, not code.
- **Eight frames, four in flight, two waves.** Eight samples over one turn are 45Â° apart (worst case
  22.5Â° off square-on) and `measurePath` divides that out by cos(turn). Sixteen fired at once drew a 429
  ("capacity temporarily exceeded"), which is a measurement thrown away; `callModelRaw` retries a
  429/5xx twice with a short backoff as a second line of defence.
- **Frames come out of a clip ONE SEEK AT A TIME, and that is a correctness decision as much as a speed
  one.** `framesFromVideo` runs one short ffmpeg per frame, each with `-ss <time>` before `-i` and
  `-frames:v 1`: a keyframe seek plus a handful of decoded frames, eight times, evenly spread, all at
  once. Nothing asks ffmpeg for a *rate* of frames, so no frame-rate machinery sits in the middle to
  duplicate, reorder or substitute anything. The version before this used `-skip_frame nokey` with the
  default frame-rate mode and **served eight BLACK frames for every real phone clip** â€” the decoder hands
  back one frame it never filled in and vsync clones that empty picture across the whole set, so the first
  real clip ever run through the path was refused as "could not find a person". Two remaining guards:
  `isBlank()` (sharp `stats()`) drops a frame that is flat and dark, and one blank seek is retried a third
  of a slot later rather than costing that angle. **Never trust `-skip_frame nokey` without looking at a
  frame it produced.**
- **The clip's real length is probed, not assumed** (`ffmpeg -i`, parsing `Duration:` from the "just
  describe it" run), so a 21 s clip asked for "0 to 30" spreads its eight frames over its own 21 s instead
  of aiming three of them into nothing.
- **`getSpan()` spoke fractions and the clip path heard seconds.** Every UI scan sent `from=0, to=1` to
  `/api/body-scan`, so the server read a **one-second** span and took all eight "angles" out of the same
  instant of the turn. The harnesses passed seconds and looked fine, which is why it survived. `getSpan()`
  now returns `fromSec`/`toSec` beside the fractions, and only the server path uses the seconds.
- **One ffmpeg pass, not one per frame.** Eight `-ss` seeks each paid a process start and a decode from the
  nearest keyframe; `-ss <slot Â½> -t span -i clip -vf fps=count/span -frames:v count` decodes the clip once
  and writes the same eight moments. Measured on a 30 s phone clip: **4.4 s â†’ 0.9 s** of ffmpeg (2.7 s
  including the ruler composite, which is now done eight-wide instead of in a row). The per-slot seek is
  still the fallback for any slot the pass cannot fill, and every frame is still blank-checked.
- **The 215-second upload was the phone's own camera, not the server.** A native 30 s recording is 30â€“40 MB
  (the same clip on WhatsApp is 4.7 MB); on a shopper's uplink that is minutes. The upload now has a budget:
  `analyzeVideo` samples the real bytes/second after ~1 s and abandons the request when the whole file
  cannot be up inside `UPLOAD_BUDGET_MS` (10 s), then eight key frames (~450 KB) go instead â€”
  `err.slowUpload` marks it as a trade rather than a failure, so the shopper is told "key frames are going
  instead â€” the same turn, the same measurement". A 2g/3g or `saveData` connection skips the clip entirely
  above 3 MB. The fallback is eight stills, not twelve, because the server reads eight at a time: a twelfth
  frame is a second wave of vision calls and doubles the wait for 7Â° the cos-correction already handles.
- **The vision reply was being cut off, and that is what "only one usable frame" meant.**
  `@cf/qwen/qwen3.8-27b` reasons before it answers, and those hidden reasoning tokens are billed as
  output AND counted against `max_tokens`. At `max_tokens: 1600` six of eight frames came back
  `finish_reason: "length"` with the JSON chopped mid-landmark, so they parsed as nothing, the scan
  measured a body from the one or two frames that survived, and every truncated call still cost 572
  neurons. The frame call now sends `chat_template_kwargs: { enable_thinking: false }` with
  `max_tokens: 2600`. A caller can also send `count` (1â€“8) to trade angles for time.
- **Cost per scan, measured from `usage`**: 2,595 prompt tokens + up to 1,600 completion tokens =
  **572 neurons per frame**, so **~4,500 neurons per 8-frame scan**. The free Workers AI allowance is
  10,000 neurons/day (about $0.11) â€” roughly **two scans a day**, and it ran out mid-testing. The real
  fix is Workers Paid; on the paid rates ($0.45/M in, $3.20/M out) a scan is a few cents.
- **Never upscale a frame.** `scale=min(900\,iw):-2`: a phone clip is often narrower than 900 (WhatsApp
  sends 478Ã—850), and stretching it invents no detail while multiplying the image tokens the model reads.
- **The underlying cause of "it took forever" is often Render's cold start**, not the scan: a sleeping
  free instance adds ~50 s before any work begins. `.github/workflows/keep-warm.yml` pings `/health`
  every 10 minutes between 06:00 and 23:00 UTC (18 h/day, so the free plan's 750 instance-hours a month
  still has headroom).
- **The server draws the grid too.** `framesFromVideo` composites the same labelled 10Ã—10 ruler the
  canvas path draws (sharp + an SVG), because `FRAME_PROMPT` tells the model the top numbers are x and the
  left numbers are y. Frames from a clip never touched a canvas, so before this the prompt was describing
  a ruler that was not on the picture â€” the one thing worse than no grid is a promise of one.
- **The free-tier pool, not our batching, is the wall â€” measured twice.** A call is **15â€“19 s** when it
  gets a GPU slot. On the old account, eight calls at once got six slots and left two waiting ~70 s. On
  the fresh account (2026-10-20), a full eight-frame scan cost **91 s** of model time: frames 1â€“4 came
  back in 15.3 / 15.7 / 29.6 / 18.3 s, frames 5â€“7 in 57.9 / 61.7 / 74.7 s â€” 30â€“44 s of that was queue.
  A four-frame scan then cost **45 s**: 14.8 / 19.3 / **41.1** / **45.0** s. So even four concurrent calls
  queue on the free plan; firing all eight at once only moves the waiting from our code into Cloudflare's
  queue and pays neurons for it. **Workers Paid is the switch that removes the queue**; until then the
  frame count buys angle coverage at the price of a whole wave, and output length is the other lever
  (~750 tokens a frame at ~50 tok/s is the 15 s â€” a shorter reply is a shorter call).
  A paid Render instance (0.1 â†’ 0.5+ CPU) takes the ~16 s decode down to a few seconds. There is no code
  change that makes a 27B model answer faster than the GPU allows.
- **`/health/deep` reports the credentials the server actually holds** (`cloudflare_ai.credentials`:
  length, type, whitespace, an 8-char one-way fingerprint, and the account id) plus each verify
  attempt with Cloudflare's own error code. This exists because a rejected token and a token that was
  never pasted look identical from a 401, and the first version of this check called a valid 58-char
  `cfut_` token "unexpected" â€” Cloudflare moved to prefixed scannable tokens in 2026. A user token
  answers `/user/tokens/verify`; an account token can only answer `/accounts/{id}/tokens/verify`, so
  "Invalid API Token" on both points at a token paired with the wrong account.
- **Telling a spent allowance apart from a busy GPU.** `classifyAiError` in `lib/cloudflare.js` returns
  `capacity` (429 with no quota words â€” retry), `quota` (the body mentions neurons/the daily allocation â€”
  a new TOKEN on the same account changes nothing), or `auth` (401/403 â€” only this one is fixed by a new
  key). `recordVision` keeps `callsToday` + `lastError` in memory and `/health/deep` exposes them under
  `cloudflare_ai.vision`, so "are we out?" is a request, not a guess. The shopper-facing message comes
  from `aiErrorMessage`, so a spent allowance does not read as "we could not find a person".
- **The video never leaves the phone.** The server never reads a clip *as a clip* â€” it takes four stills out of it and measures those â€” so uploading it meant sending 30â€“40 MB (a phone camera's half-minute on
  a mobile uplink: minutes) for the server to do the one job the phone can do in two seconds, and then
  delete it. `analyzeVideo` is now the **fallback** (`?clip=1`), and the default is `extractFrames` on the
  phone: four JPEGs, about 240 KB, and nothing on the wire that is a video. The privacy line is therefore
  stronger and still true: *"Your video never leaves your phone. Four still frames are sent, measured,
  then deleted."* â€” which is why every page carries it. `res.on('finish')` unlink and the frames temp dir
  are still there for the `?clip=1` path.
- **Twelve frames in the still-frame fallback, because a six-frame turn can miss the front.** Six samples
  across a full rotation are 60Â° apart: unless the clip happens to start square on, the closest thing to a
  front view is 30Â° off, and a limb seen 30Â° round the turn projects to cos 30 of its length. Twelve puts
  the worst case at 15Â° and leaves room to drop a blurred frame. Multer's `frames` cap is 16.
- **The sleeve length was blank on every vision-path scan, and it was not the frames.** `PATHS.
  shoulderToWrist` asked for `shoulderJ/elbowJ/wristJ`, which is what the pose model emits; the vision
  prompt never asked for an elbow or a wrist at all. So no amount of frames or video would have found
  the arm. The prompt now asks for `elbowJointL/R` and `wristJointL/R`, and `joint()` in
  `bodyGeometry.js` accepts either naming scheme. It must never fall back to `elbowL`/`wristL` â€” in
  `REGIONS` those are the two EDGES of one limb (a girth), so using them as left/right joints would
  read the distance between the elbows as an arm. `measurePath` also undoes the frame's turn by
  dividing the horizontal component by cos(turn); frames past 60Â° are skipped â€” too little left to undo.
- **"Sleeve length" now means what a shirt chart means, and the arm is read separately.** On a 6'1"
  man the app reported 22" against a true 31", and neither number was wrong: 22" is the anatomical
  shoulder-point-to-wrist-bone arm (ANSUR's mean is 21.8"), while a shirt chart's sleeve length starts
  at the NAPE and runs out over the shoulder first â€” about 9" more, which is half the shoulder width.
  `PATHS.centreBackToWrist` (`neckCentre â†’ shoulder â†’ elbow â†’ wrist`, where `neckCentre` is the
  midpoint of `neckL/R`, a point the prompt already asks for) now feeds `sleeveLength`, and
  `shoulderToWrist` feeds a new `armLength` row, labelled "Arm (shoulder to wrist)". On the
  geometry fixture that is 32.9" vs 23.7"; on a 19"-shouldered man, 31" vs 23". A chart column typed
  "Sleeve Length" is still informational (`MEASURES` has no sleeve id), so this changes what the
  shopper is SHOWN, never how a size is decided.
- **A shoulder that is not a shoulder used to cost the whole scan its size.** One real clip came back
  with a 14" shoulder against a true 19" (the points had landed near the neck). `TORSO_SPAN_LIMIT`
  judges every torso row against a fraction of the shoulder span, so that short ruler called a good
  chest "the arms" in every frame, `bestSize` had no chest to anchor on, and the shopper got no size â€”
  with a note blaming "no straight-on front view". Two fixes: `checkFrame` now cross-checks
  `shoulderL-shoulderR` against `headTop-chin` (`SHOULDER_HEAD_RATIO` 1.55-2.60 head-lengths, adults
  run 1.65-2.35) and DROPS the shoulder when it fails, and the relational torso test is skipped in a
  frame whose own shoulder failed â€” a bad ruler no longer convicts the chest. The no-size note is now
  derived from the chart's deciding column ("your chest â€¦ could not be read"), not guessed at.
- **A reading outside its plausible range is dropped, not clamped to the edge.** Clamping published
  the range's own floor as if it were measured â€” a 12" shoulder came back as "14", a 7" upper arm as
  "8" â€” which is a confident wrong number where "could not be read" is the true one. Applies both to
  the region pass and to the fabric subtraction (`afterCloth`), which can only push a value under the
  floor. `RANGES.arm` moved to [9, 22] because an adult upper arm below 9" is not a reading.
- **The vision model is now asked for `turn` (0-90Â°) and the vision path keeps it.** The clip is a
  person TURNING, so a frame called "front" can be 30Â° off, and every width off it is short by
  cos 30 = 13% â€” the other plausible cause of that 14-16.6" shoulder. `frameTurn` already preferred a
  numeric turn; the frame object simply never carried the model's answer. The prompt pins the number
  to the view (front/back 0-15, three-quarter 25-65, side 70-90) so it cannot drift into nonsense.
- **The confirmation link goes to the login page.** `signUp` asks for `emailRedirectTo:
  accountPageUrl()` = `<origin>/<base>auth/` (built from `import.meta.env.BASE_URL`, not from the
  current path), and the account screen picks the session up and opens the scanner. That is only half
  of it: Supabase falls back to the project's **Site URL** whenever a redirect is not in its
  **Redirect URLs** list, and the default Site URL is `http://localhost:3000` â€” which is exactly how a
  confirmation link ends up on a blank page. Both settings are in README.md, step 3. A link that has
  expired or been used comes back with `error_code=otp_expired` in the fragment: the account screen
  says so and shows the login tab (`linkProblem()` in `src/auth.js`), and cleans the address bar.
  `supabase/emails/confirm-signup.html` is the paste-ready template for Authentication â†’ Email
  Templates â†’ Confirm signup.
- **`/size` is behind the door â€” except for a brand's link.** `src/size.js` waits (4 s cap) for the
  cloud settings, then requires a *non-anonymous* session, else `location.replace('../auth/')`. No
  cloud configured (or no answer) â†’ the scanner opens anyway; it measures on the device and needs no
  account. Two addresses also open it with the door already open: `?g=CODE` (a shopper following a
  product link â€” no account, ever) and `?embed=1` (the same page inside the popup). `main.js` is
  imported only after the door is open.
- **The merchant flow lives in `/dashboard`** (not gated: signed out is a state there, so it shows the
  way in). Add a garment â†’ type its size chart (own labels, own unit) â†’ save â†’ a code is generated
  client-side (`crypto.getRandomValues`, 12 chars from an alphabet with no `l`/`0`/`1`) and the card
  appears with the link, the popup snippet, a preview button, edit and delete.
  **Columns are the shop's too**: the form starts with Chest-or-bust / Waist / Hips and the shop adds,
  renames, repoints or removes columns; the table under it grows with them. A column is one of the
  seven measurements the scan can read (`server/src/shared/measures.js` â€” chest, waist, hips,
  shoulder, neck, arm, height) or "Other", which is carried and shown to the shopper but never
  scored. **The first measurable column decides the size**; every other measured column joins the
  worst-case comparison. The form refuses a chart with no measurable column, a size missing that
  column's number, and a column filled for only some sizes (a blank cell must not favour its row).
  `src/services/charts.js` does the CRUD and the shopper-side `chart_by_code` RPC; `notSetUp(error)`
  turns Postgres 42P01/42883 and PostgREST PGRST202/PGRST205 into the one notice that matters ("run
  supabase/setup.sql, README step 4") instead of a raw error, and lets a real permission error show
  itself.
- **The popup is `web/public/embed.js`** â€” plain JS, no build step, so Vite copies it verbatim to
  `dist/embed.js` and `%BASE_URL%embed.js` is a stable address to paste into a shop. It reads
  `data-chart`/`data-name`/`data-label`/`data-base` off its own `<script>` tag, derives the site root
  from its own `src` (nothing is hard-coded), mounts a button, and on click injects a dimmed overlay
  with `<iframe src="â€¦/size/?g=CODE&embed=1">`. Escape, a backdrop click, the âœ•, or a
  `{source:'3dg', type:'close'}` postMessage from the frame (origin-checked) close it; the page
  underneath is frozen and put back exactly as it was. It also publishes
  `window.ThreeDG.open({code, name})`, which is how the dashboard's Preview runs the real thing.
- **The password is never ours.** Supabase auth holds it, hashed. `profiles` has no password column
  and must never have one. The email lives in `auth.users` too; `profiles` holds only the username.
- **The username rides in the signup metadata** (`options.data.username`), and the trigger writes the
  profile row from it, so an account cannot exist without a name. A duplicate username makes the whole
  signup fail (unique index on `lower(username)`) â€” `username_taken()` is only there to say so early.
- **Email confirmation must be OFF** (Authentication â†’ Providers â†’ Email â†’ Confirm email) for the
  "no verification step" flow the owner asked for: with it on, `signUp` returns no session and the
  page says "confirm the link we sent, then log in here" instead of opening the scanner. The project
  `yzqmpyxfwcqreymbqrhc` still had `mailer_autoconfirm: false` as of 2026-10-18.
- Local development with no cloud: `VITE_API_URL=http://127.0.0.1:5999 npm run dev` (an address that
  refuses) puts every page in the no-cloud state, so the landing â†’ account â†’ scanner walk can be
  tested without an account. A session can also be faked: `sb-<project-ref>-auth-token` in
  localStorage, `expires_at` in the future, `user.is_anonymous: false`.
- **"Book a Demo" is a mailto, and the address is a placeholder**: `DEMO_EMAIL` in `src/landing.js`
  (and the form's `action` in `index.html`, same string) currently says `hello@3dgarments.com`. The
  form opens the visitor's own mail client with the details filled in, so no form service is involved
  and the reply goes to the address they typed â€” but nothing arrives until that address is a real
  inbox. Change both together.

---

## Body models â€” conventions never to break

- **Metres, y up, facing +z, feet at y=0, left=+x** (prepare.py normalises this).
- Bone names are ours (not Character Creator names â€” prepare.py maps them):
  `pelvis, spine_01â€¦03, neck_01, head, clavicle/upperarm/lowerarm/hand/thigh/calf/foot/ball_l|r, fingers thumb|index|middle|ring|pinky_01â€¦03_l|r`
- **Bone frames:** y runs headâ†’tail, x = y Ã— (+z). **+x rotation swings a limb forward.** Hand/finger bones: +x curls into the palm. Feet/toes use y-up reference. +z moves a left limb outward. +y on the upper arm = internal rotation.
- **Vertex parts (_PART):** 0 skin, 4 fabric. Eyes/teeth/tongue removed (mannequin head). Underwear = fabric part (boxers male, bra+bottoms female).
- **Pose zero (rig.js):** every limb re-based onto fixed anatomical directions, whatever the model's bind pose (T-pose male, A-pose female). All poses mean the same on every model. Do NOT edit rig.js without recalibrating poses.js.
- **Poses authored anatomically** via `buildPose({ c, both, l, r })`. Right side mirrors left as `(x, âˆ’y, âˆ’z)`.
- **Mannequin heads:** face, eyes, teeth, ears shaved â€” a smooth featureless head shell replaces everything above a cut under the jaw (`head_cut`: 3 cm female, 5 cm male).
- **Width morph:** shoulders Â±20% per unit; arms move out rigidly; hips follow a little. Implemented as a shape key called `width` (slot 0 in morph targets).

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

- `lat` â€” fraction of arm radius that must clear the torso surface (higher = arm pushed further out)
- `follow` â€” forearm tilt offset relative to upper arm (degrees outward)
- `maxOut` â€” maximum outward angle cap
- `minOut` â€” minimum outward angle floor
- `upperGap` â€” (add this if needed) extra clearance in metres between arm surface and torso; default 0.002 (2mm); raise to e.g. 0.045 for a visible gap on a muscular male

**Note:** At this commit the male `lat` is `0.48` and `minOut` is `12`. In the previous session we changed these to `lat: 0.72, minOut: 6, upperGap: 0.045` to fix the arm appearing glued to the torso. **Those changes are NOT in this commit** â€” they were on the deleted branch. If the arm looks glued, re-apply them.

### armsDown (poses.js ~line 87)

```js
const armsDown = {
  clavicle:  [0, 0, -4],
  upperarm:  { hang: true, fwd: 8 },          // â† was fwd:2 originally; 8 stops elbow kink
  lowerarm:  { hang: true, fwd: 10, twist: 16 },
  hand:      [-18, 0, -4],
};
```

**Note:** At this commit `fwd` on upperarm may still be `2` (the old value). We changed it to `8` in the deleted branch to stop the elbow kinking inward. If the elbow looks bent inward from the front, set `upperarm.fwd: 8`.

### #hangArm solver (human.js ~line 695)

- Starts at `upper=0Â°` outward, increments 0.5Â° until `#clear()` passes
- `#clear()` tests arm-segment clearance against skinned torso points (counting-sort by 1cm y-slices)
- Gap hardcoded to `0.002` m â€” raise it by adding `upperGap` to ARM_FIT (see above)
- Clamps to `[minOut, maxOut]` then calls `#aim()` to set the bone

### applyArmpit (human.js ~line 46)

A-pose male has lat skin bound 100% to spine â†’ arm comes down but skin stays flared (armpit "glued"). Fix: torso skin near armpit gets up to 55% upper-arm weight, so it tucks in as the arm lowers. Full effect at â‰¤25Â° elevation, gone at â‰¥70Â°.

```js
const ARMPIT = { male: { reach: 0.2, max: 0.55 }, female: null };
```

### Shape targets (shape.js)

Built at load from the mesh itself (not pre-baked):
`belly, waist, bust, chest, glutes, hips, thighs, fat, muscle, core`

Clothing copies nearest skin vertex weights (inverse-square), so skin-tight garments follow the body. Skin under clothing gets no surface-detail change (avoids poke-through).

### Body controls / sync (body.js)

- Sliders range over `LIMITS` (calibrated on renders â€” past them the body stops looking real)
- Damped by body fat (`room()`: heavy body has less room to add more)
- Body fat is the stored value; **weight is derived** (every control moves it)
- Weight slider / body-type chips solve fat backwards to reach a target weight
- Measurements are real: height = inches (crown to sole), width = shoulder-point-to-point (cm)

---

## Fitting-room UI (web/src/main.js)

One panel, one 3D preview:
- Sex picker â†’ switches the model (each sex keeps its own saved settings)
- Skin tone slider (0â€¦1 along `SKIN_STOPS` â€” lightest to darkest)
- Live measurements card (height, weight, BMI, bust/chest, waist, hips, thigh, gap)
- Height & weight sliders
- Body type chips (Slender / Athletic / Soft / Plus-size) + Muscle tone slider
- Abdomen & waist (shape chips + waist cinch slider)
- Bust & chest / Chest width slider
- Shoulders & posture sliders
- Glutes, Hip width, Thighs sliders
- Reset body shape button

Settings saved to `localStorage` (key `3dg.tryon.v3`) and synced to Supabase `body_profiles.settings` per device â€” the newer copy wins at boot.

URL shortcuts: `?model=male|female&tone=0..1`
Dev console: `window.__3dg` â†’ `{ stage, human, model, state, profile, applyShape, buildPanel }`

---

## Stage renderer (web/src/scene/stage.js)

- `preserveDrawingBuffer: false` â€” `canvas.toBlob()` returns blank; use Playwright instead
- `stage.invalidate(n, live)` â€” schedules n frames; `live=true` while a slider is dragged
- LOW_POWER tier (touch / small screen / â‰¤4 cores): pixel ratio â‰¤1.5, 1K shadows, half-res AO
- N8AO ambient occlusion on `ao.beautyRenderTarget`; MSAA lives there too
- Mobile CSS: no `backdrop-filter`

---

## Garment photo upload (web/src/uploads/)

- Upload box above the sex picker â†’ review popup (remove / add more, max 10 per photo group)
- Confirm â†’ a group card (click to edit / rename / delete); any number of groups
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
| `POST /api/body-scan` | measure a clip (open route â€” no bearer): multipart `video` + `from`/`to` (the default path â€” the server decodes the clip with ffmpeg and reads 8 stills), multipart `frames` JPEGs (`?frames=1`, and the fallback), or `source: 'pose'` + on-device landmarks (`?local=1`). Optional `chart` (the brand's own size chart â€” `{ name, sex, unit, columns, rows }` â€” used only to choose a size, never to measure). Answers with measurements, notes, `size`/`sizeChart`/`sizeBasis`, and `sizeSource` (`store` or `reference`) + `sizeName` |

---

## The size a brand's link comes back with (server/src/lib/sizing.js, routes/body-scan.js)

- `bestSize(sex, girths, chart = CHARTS[sex], columns = null)` scores every row by its **worst**
  disagreement with any measured column the chart actually has, and takes the smallest; an exact tie
  keeps the smaller size (i.e. the row typed first). Columns come from the chart (`{ id, label,
  measure }`, the shop's order) or, when absent, from `columnsFromRows()` (chest/bust first, then
  waist, hips) â€” which is how the built-in charts are read, so there is one scoring rule.
  **The first column with a measure decides the size**; a column only counts when *every* row carries
  it and the body has that measurement (a blank cell must not favour its row). `chartKey(chart)` still
  picks the torso column chest-preferred, so a men's shirt chart the shop typed as "chest" is not read
  as a bust chart. A chart with no measurable column returns `null`: no size beats an invented one.
- `chartFromInput(input)` normalises a shop's chart: columns keep their order, a missing/duplicate id
  gets `c1â€¦`, a label is trimmed to 24 chars, an unknown `measure` becomes `null` (printed only); cm â†’
  inches once (the chart carries its own unit), first row wins on a duplicate label, values outside
  5â€“120 in dropped, a column no row uses dropped, and a row with no number in the deciding column
  dropped rather than guessed at. Returns `{ rows, columns }` or `null`, so the caller falls back to
  the reference chart rather than sizing against an empty table.
- `readChart(body)` in the route takes the chart as an object (pose path) or a JSON string (multipart)
  and never fails the scan for a bad chart â€” a chart is only ever used to CHOOSE a size.
- The result carries `sizeSource` ('store' | 'reference') and `sizeName`, so the page can say whose
  numbers these are; the snug/loose note is written from `size.field` + `size.label` (whichever column
  decided), and the depth hedge only fires when that column is the chest. On a store chart a
  successful size adds "This size is off <garment>'s own chart, not a standard one."
- `/size` shows the size in a card above the measurements **only when a chart was read** (plain
  scanning stays a tape measure), with an honest no-size state, and `?demo=1&store=1` renders that card
  without a link or a cloud.

---

## Garment pipeline (server/src/services/pipeline.js + src/shared/silhouette.js)

`sharp` decode â†’ `silhouette.js` (segmentation, cut-out, measurements) â†’ texture PNG â†’ Cloudflare vision (`CF_VISION_MODEL`, default `llama-4-scout-17b-16e-instruct`) â†’ Supabase.

Categories: `top | outerwear | dress | skirt | pants | shorts`

If vision fails â†’ silhouette guess used; a failed call never blocks processing.

---

## AI grouping (server/src/services/groups.js)

POST `/api/groups/:id/process` â†’ Cloudflare vision reads all photos in a group â†’ assigns each to a zone (top/bottom/full), type, and views (front/back/side); produces cut-outs + silhouette measurements per photo.

---

## ChatGarment on Kaggle (tools/garment_ml/chatgarment/)

Generates GarmentCode sewing patterns from garment photos using a 27 GB LLaVA-based model on 2Ã—T4 GPUs.

```bash
export KAGGLE_API_TOKEN=...   # shell only, never in files
python tools/garment_ml/chatgarment/kernel.py push [photos_dir]  # upload + start GPU run
python tools/garment_ml/chatgarment/kernel.py status             # check progress
python tools/garment_ml/chatgarment/kernel.py fetch              # download patterns
```

Kernel slugs: `3dgarments-chatgarment` (kernel), `3dgarments-test-photos` (dataset), `3dgarments-cg-weights` (weights).

---

## Garment 3D builder (web/src/garments/) â€” WIP, NOT WIRED INTO THE UI at this commit

Files exist but are not imported from `main.js`. This is the next thing to build:
- `cloth.js` â€” cloth simulation / sewing builder
- `fabric.js` â€” fabric material
- `fit.js` â€” garment fitting
- `outfit.js` â€” outfit management
- `pattern.js` â€” pattern â†’ mesh

---

## How to screenshot the model (Playwright)

```js
// render.mjs â€” run with: node --input-type=module < render.mjs
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

Blender is installed at `/usr/local/bin/blender`. Everything runs in the cloud â€” no local machine needed.

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

The live link (`?blender=1`, `web/src/live/blender.js`) connects to Blender's WebSocket and renders whatever Blender streams â€” the site body is sent to Blender AS SHOWN (every vertex world position) and Blender sends back any mesh in its "Garments" collection evaluated in real time.

**Note:** At this commit `tools/blender/` does NOT exist â€” it was part of the deleted clothing system. It needs to be rebuilt from scratch.

---

## Known arm issues to fix (not in this commit)

The previous session fixed these but the fixes were on the deleted branch. Re-apply when rebuilding:

1. **Upper arm fwd: 2 â†’ 8** in `armsDown` (poses.js line ~89) â€” stops the elbow kinking inward from the front
2. **ARM_FIT.male.minOut: 12 â†’ 6** â€” 12Â° was too splayed
3. **ARM_FIT.male.lat: 0.48 â†’ 0.72** â€” raises arm clearance threshold
4. **ARM_FIT.male.upperGap: 0.045** â€” forces 45mm air between arm surface and lat/chest skin (add the field and wire it into `#clear()` call: `fit.upperGap ?? 0.002`)

---

## Current state of the repo (commit a60c6de)

- âœ… Male + female mannequin models fully rigged and built (`web/public/body/*.glb`)
- âœ… Fitting-room UI: body controls, skin tone, measurements, photo upload groups
- âœ… Express API: garments, groups, me, health routes
- âœ… Supabase schema + RLS + storage bucket
- âœ… Cloudflare vision pipeline
- âœ… AI garment grouping (zone/type/views/cut-outs)
- âœ… ChatGarment Kaggle runner (generates GarmentCode patterns)
- âœ… **Size finder for brands** (the product): `/size` scans a 360Â° turn and reads it on the device,
  a brand types its chart in `/dashboard` and gets a link + a popup snippet (`embed.js`), and the
  shopper's size is scored against that brand's own chart. Pricing is $30/month for unlimited
  clothing size charts (text only â€” no checkout yet; `web/pricing/index.html`)
- â³ Garment 3D builder (`web/src/garments/`) â€” files exist but NOT wired into the UI
- âŒ Blender sewing pipeline â€” **deleted, needs to be rebuilt from scratch**
- âŒ Try-on UI (wearing clothes on the model) â€” **commented out / not built yet**
- âŒ Billing / subscriptions â€” the price is on the page, the checkout is next
- âŒ Packaged plugins for Shopify/WooCommerce â€” the snippet is what there is today

---

## Git attribution footer (every commit message)

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0139JKEoXc4irHwm6ZnPDgHe
```

---

## Size scan: stability and speed (commits 3df6ed8, 20 Oct 2026)

Measured on the fixed four frames in `%TEMP%\opencode\frames4` (same clip, feet out of shot):

- **The numbers are stable now.** Six to eight consecutive scans return the same body:
  chest 38, waist 32, hips 36, shoulder 18 (catalogue: bust 38 / waist 32 / hips 36 /
  shoulder 18). Before this, hips swung 36-40 and a run could lose the chest entirely.
- **What was moving was the calculation step, not the vision.** Mistral's three reads per
  frame, merged by median, are deterministic on identical frames. The single Workers AI
  calculation call at temperature 0.1 was not. It is now temperature 0.
- **Fabric was coming off twice.** The calculation step is asked for the *body*, so its
  numbers no longer lose `2*pi*t` again in `buildCatalogue` (spans it fills are marked
  `fromCalc`). Only geometry-derived spans still lose fabric. That alone was 1.5" of chest.
- **The calculation model stalls.** `@cf/qwen/qwen3.8-27b` reads this body best (waist within
  0.5") and usually answers in 3-5 s, but on a shared queue it sometimes waits out the whole
  deadline. `/health/deep?calc=1&model=...` times any model: qwen answered 420 ms once and
  then timed out at 25 s; `@cf/meta/llama-3.3-70b-instruct-fp8-fast` answered ~200 ms every
  time but reads waist 28 and hips 40 (worse). Plan is now qwen 8 s, qwen 8 s, then llama.
- **When the calculation is lost the fallback is ~7" small** (geometry takes its scale from
  the head on a clip cropped at the shins: bust 30.6 for a 38 read). Rare now, but that is
  what a bad run looks like. `diagnostics.calcAttempts` says how many tries and which model.
- **Mistral is the speed bottleneck, not the calculation.** 12 vision calls per scan at
  roughly 1 request/second is an 11-12 s floor. Measured vision time 10-34 s; the calculation
  is 3-5 s. 15 of 93 vision calls hit 429. `?reads=1|2|3` picks the per-frame read count for
  one scan; three is still the best (two reads measured no faster and cannot take a median).
- **Debug knobs on the live API:** `?calcModel=<model>` and `?reads=<1-3>`.
- One scan can still take 30 s when the rate limit bites. That is the queue, not the maths.

---

## Calculation cost, and why the live chart said XXL (commits ef8fd5b..51710d6)

**Tokens per calculation, measured from the reply's own usage field:**

| version | in | out | total |
|---|---|---|---|
| long prompt + object-per-point (original) | ~1300 | up to 600 | ~1900-2700 |
| compact prompt, object points | 1241 | 100 | ~1340 |
| flat number table, 18 points | 901 | 100 | ~1000 |
| flat number table, 14 points | 902 | 100 | ~1000 |
| **flat table, 14 points, terse rules, measurements-only reply** | **632** | **76** | **~708** |
| **one-letter fields (k/f/v/d), same rules (now)** | **598** | **76** | **~674** |

**Can the input get to 200 tokens? No - about 600 is the floor, and here is the
arithmetic from the measurements, not from a guess:**

- A coordinate costs about **2.8 tokens** (the digits, the comma, sometimes a split).
  14 points x 2 numbers x 4 frames = 112 numbers = **~310 tokens** before any words.
- The rules that hold the numbers are **~130 tokens**; the chat wrapper and the JSON
  structure are another **~60**. 310 + 130 + 60 = 500, and the measured figure is 598.
- **Every cut below that was tried and measured on the same four frames:**
  - 8 points (head, chin, shoulders, waist, hips): **450 in / 37 out**, but the body
    read **chest 38, waist 30, hips 34-36** - two inches small in every direction.
  - 10 points (no armpits, no wrists): 495 in, same two-inch shortage.
  - Removing the feet did not change it; removing the armpits did not change it; asking
    for the height again did not change it. **14 points with the short prompt still read
    38/30/36.**
  - The two sentences that fix it are *"Never invent a missing part: no feet, no height"*
    and *"Give every number; null only when unsupported."* Put them back and the same
    payload reads **chest 40-42, waist 32-34, hips 36-38**. They are not decoration.
- So a 200-token calculation is four frames of six numbers: three points, no waist or
  no shoulders. It cannot measure the body it is being asked about.

**Each frame is now read once (VISION_READS defaults to 1).** Three reads existed to
outvote a wandering landmark, but the calculation is what reconciles the frames now and
never used the extra precision. A scan sends **4 Mistral calls instead of 12**: vision
**9-20 s**, whole scan **14-22 s**. `VISION_READS=3` restores the old behaviour without a
deploy.

- The **output is 76 tokens** once the reply stopped echoing the frames back. Echoing
  `{"i","view","turn"}` per frame cost ~130 tokens of answer and bought nothing.
- Asking the calculation to re-label the views was actively harmful: it called a profile
  "front", the catalogue took that frame's shoulder span, and the shoulder came back as
  **9.7"** - a body's depth printed as its breadth. The view a frame carries is already
  the majority of three reads, so the calculation now states measurements only.
- **The point table is the measurement, and it is the floor**: 14 points x 2 numbers x 4
  frames. Ten points (no armpits, no wrists) measured 545 in / 76 out - **621 total, only
  87 fewer** - and the shoulder collapsed to 14.7" because the shoulder points alone sit
  inside the deltoid. The armpits are what say how wide the torso under them is.
- **Below ~620 there is nothing left to cut except accuracy.** A ~200-token calculation
  would be four frames of six points and a one-line prompt; that is the version that read
  chest 32 / waist 24 on these frames.
- Shoulder is the one number this clip cannot support: the calculation gives it on two
  scans in eight and the landmark span reads 13-15" against a 19" truth. `catalogue.js`
  now drops a shoulder outside a 2.4th-to-1.75th of the chest girth (bounds applied to
  the calculated value too, which once answered 25" on a 40" chest), so the row is left
  unscored rather than printed.
- **Stable, 8 runs on the same four frames:** chest 40 every run (truth 40.8), waist
  32-34 (truth 32.2), hips 38 (truth 38), calc 1.7-3.5 s, whole scan 10-16 s, with the
  occasional 42-48 s when a Mistral read is slow.
- **Do not shorten the rules.** A ~100-word prompt without "one head in every frame",
  "wrist below the hip" and "shoulders at least as wide as hips" read chest 32 and
  waist 24 on the same four frames (truth 40.8 / 32.2). Wording that states the
  invariants is what keeps the chest at 40; it is ~120 tokens and it is load-bearing.
- Workers AI bills **neurons**, not tokens, but they scale together. The 10,000
  free neurons lasted ~60 scans at ~2,700 tokens (~165 neurons/scan); at ~700 tokens
  that is roughly 43 neurons a scan, so ~230 scans a day. The allowance resets
  around 00:00 UTC; `/health/deep?calc=1&model=...` reports the refusal verbatim.
- Mistral's key states `x-ratelimit-limit-req-minute: 30`; a scan sends 12 reads.
  The pacer is now a rolling minute with an 80% burst cap, not a 1.1 s metronome.

**The test chart is why the size looked wrong.** `iosbo5ufoui8` ("Mil Spec Crew")
carries chest 22.75 (S) to 27.75 (XXL) - widths taken across a garment lying flat, not
body girths. A 38" chest sits above every row, so the old scorer answered the largest
size every time. `chartFromInput` now marks a chest column whose largest value is
under 28" as flat (waist 24", hips 30") and `bestSize` compares half the body girth with
it; a column with no measure is never reinterpreted. Ties between two sizes now go to
the larger one (the garment that closes), not the smaller.

With that chart the scan answers **S**, because its own S row is a 45.5" finished
chest. A chart of real girths (36/40/44/48) answers M for the same body. If the
merchant meant body girths, the table needs real ones.

---

## Gemini as the calculator (2026-10-21, commits 1a9bc83..887b06f)

**The on-device path never ran the calculation at all.** The step sat inline after
the vision loop, and a scan measured on the phone (`source: 'pose'`) returns from
`finishScan` before reaching it - so the path the shopper's browser actually takes
was measuring from raw points alone. On the fixed frames it came back with **no
chest at all** (the one number a size cannot do without). It is now one function,
`runCalculation`, called by both entry points. This also made the calculation
testable without a vision pass: save one scan's `diagnostics.frames`, send them
back as `source: 'pose'`, and only the model changes between runs.

**Availability is the first finding.** Of the models the key lists:

| model | result |
|---|---|
| gemini-3.8-flash (the default name) | never returns headers; 503 "high demand" when it does answer |
| gemini-3.7-flash | same |
| gemini-flash-latest | same |
| **gemini-3.6-flash** | answers, 3.9 s for one word |
| **gemini-3.5-flash** | answers, 2.5 s for one word |
| gemini-3.1-flash-lite | answers, but reads chest 30 / waist 22 |
| gemini-2.5-flash | 404 - "no longer available to new users" |

The POST was never the problem: GET `/models` answers in 150 ms from Render, and
POST to another host in 290 ms; the 3.8/3.7 calls simply hang until the timeout.

**Numbers on the same four fixed frames (truth 40.8 / 32.2 / 38 / 19):**

| calculator | points | in/out | chest | waist | hips | shoulder | calc time | size |
|---|---|---|---|---|---|---|---|---|
| Cloudflare qwen-27b | 14 | 597/76 | **40** (3/3) | **32** (3/3) | 36 (3/3) | 15.1 | 2.3-3.1 s | M |
| Gemini 3.6 Flash | 14 | 574/51 | 38.5 | 31 | 39.5 | 17.5 | 3.2 s | S |
| Gemini 3.5 Flash | 14 | 574/51 | 38.5 | 31 | 39 | 17.5 | 2.0 s | S |
| Gemini 3.5 Flash | 8 | 434/51 | 38.5 (3/3) | 30-31 | 39-39.5 | 17.5 | 4.9-7.9 s | S |
| Cloudflare | 8 | 453/76 | 42 (4/5) | 34 (4/5) | 38 (4/5) | 15.1 | 2.3-5.1 s | M |

- **Gemini is better on hips and shoulder, worse on chest and waist, and the chest
  is what picks the size** - it would have sold this L/XL body an S. Cloudflare
  stays primary; Gemini stays wired as a rung (`?calcModel=gemini&geminiModel=...`,
  or `CALC_PROVIDER=gemini`) and is not the default.
- **Token counts are not comparable across providers.** The same payload is 574
  tokens to Gemini and 597 to qwen, because the tokenizers differ; Gemini's shorter
  reply (51 vs 76) is because it returns five numbers where qwen returns four plus
  the neck. At this size the difference is cents per thousand scans either way.
- **A Gemini 503 mid-scan silently hands the answer to Cloudflare**, and the two
  disagree by ~2" of chest - so a deployment with `CALC_PROVIDER=gemini` would size
  the same body differently run to run. One primary, watched, is the safe shape.
- **8 points is not the free lunch the older note implies.** With the current
  prompt, Cloudflare at 8 points read 42/34/38 on four of five runs and 40/32/36 on
  the fifth - as close to truth as 14 points and 144 input tokens cheaper, but not
  stable. The earlier "8 points reads two inches small" measurement predates the
  current prompt and could not be reproduced today; 14 remains the default.

`/health` now reports which calculator is configured; `/health/deep?geminiSweep=a,b,c`
asks each named model a one-line question and reports status, time and tokens;
`?geminiModels=1` lists what the key may call.

### The split by body part (`?calcSplit=1`, commit 8001aa3) - built, measured, OFF

Chest and waist from Cloudflare, hips and shoulder from Gemini, both asked the whole
question in parallel and merged by part with the provenance kept in
`diagnostics.calcAttempts.parts`.

- **Asking only for a part changes the answer.** Asked for chest and waist alone,
  qwen said **42/34** where the full question says 40/32; asked for hips and shoulder
  alone, Gemini returned the hips and **no shoulder at all**. So both are asked
  everything and the split only chooses whose answer to keep.
- **A part assigned to a provider that misses is filled by the ordinary ladder**, not
  by the other side: when Cloudflare timed out, the chest fell through to Gemini's
  38.5, which would have picked the size. That is now impossible.
- **It doubles the calculation**: 1,129-1,173 input tokens per scan against 597, and
  the scan waits for the slower of the two - 8-15 s against 2-3 s.
- **The body changes depending on who answered.** Gemini answers deterministically
  (38.5 / 31 / 39.5 / 16.5 / 15 twice on the same frames), so a run where it answers
  has hips 39.5 and a shoulder, and a run where it does not has hips 36 and no
  shoulder. Same person, same video, two bodies.
- **The free quota does not carry a shop.** After roughly thirty calls in one
  afternoon, 3.5 and 3.6 Flash answered `429 You exceeded your current quota` and kept
  answering it; `gemini-3.1-flash-lite` still worked but reads chest 30 / waist 22.
  Of three split runs: one Gemini answered, one timed out at 8 s, one 429'd.
- **Arms, head and legs cannot be split, because nothing measures them.** The payload
  carries 15 points from head to wrist - no knee, no ankle, no arm width - and the
  prompt forbids inventing feet or height, so both models return `height: null`.
  Upper arm comes from the silhouette path, not from either calculator; neck is the
  only head-area number either one states (qwen 14, Gemini 15/15.5, no ground truth
  to judge them by). A leg measurement would have to be invented.

So the split stays behind the flag. It is worth revisiting if Gemini's quota and
latency improve, because its hips and shoulder really are closer to truth - but a
calculator that answers one run in three is not a calculator a shop can stand on.

### The free calculators, measured (Oct 2026)

Truth for the fixed frames: **40.8 chest / 32.2 waist / 38 hips / 19 shoulder**.

| calculator | chest | waist | hips | shoulder | tokens in/out | time | answers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Z.AI `glm-4.5-flash`** | **40** | **32** | **38** | none stated | 556 / 39 | 2.4-4.7 s | 9 of 9 warm |
| Z.AI `glm-4.7-flash` | - | - | - | - | - | 2.2 s | echoes the empty template (0/0/0), or 429 |
| NVIDIA `deepseek-ai/deepseek-v4.1-flash` | - | - | - | - | - | 2.8-4 s | echoes the empty template |
| NVIDIA `gemma-4-31b-it` | - | - | - | - | - | >16 s | timeout |
| NVIDIA `nemotron-3-super-120b-a12b` | - | - | - | - | - | 7 s | wrong shape `{"body":{...}}` |
| NVIDIA `mistral-large-2-instruct` | - | - | - | - | - | 4 s | wrong shape `{"body":{...}}` |
| NVIDIA `qwen/qwen3-32b`, `kimi-k2.6` | - | - | - | - | - | 50 ms | not on the account (404) |
| Cloudflare `qwen3.8-27b` | 40 | 32 | 36 | none stated | 597 / 76 | 2.2 s | deterministic |
| OVH `Qwen3.8-27B` (keyless) | 38-42 | 28-34 | 32-38 | 40-44 | 597 / 76 | 2-28 s | noisy, 2 RPM |

- **Z.AI wins on the number that matters most.** Its hips are exact on every run;
  Cloudflare reads them two inches small, which is the error that picks a size. Chest
  and waist are as good as Cloudflare's, and it spends 41 fewer input tokens.
- **`glm-4.7-flash` is not usable**, despite being the name the free-tier docs give:
  it is either `429 service temporarily overloaded` or it answers the schema back with
  zeros. `glm-4.5-flash` is the working name and is now the default.
- **NVIDIA is out.** Of 83 models on the key, the only one that answered in-schema
  echoed the empty template; the rest were 404, timed out, or answered with a
  `{"body":{"head":...}}` description - the same wrong shape Mistral produces.
- **Z.AI still fails under congestion**: one run in ten took the full 16 s and fell
  through to Cloudflare, and 4.7-flash was 429 for a stretch. The ladder stays.
- **The shoulder is still geometry's 15.1** against a 19" truth, because both
  calculators state ~40 (a girth) and `RANGES.shoulder` is [14, 26], so it is dropped.
  That is the next accuracy problem, and no provider fixes it.

### What Z.AI's free tier actually allows (measured, not quoted)

- **Published**: `glm-4.5-flash` and `glm-4.7-flash` are $0 for input, cached input
  and output. No numeric token allowance is published at all; the limits are
  per-account and per-model and are shown only in the console
  (`z.ai/manage-apikey/rate-limits`). Free tier is **one concurrent request**.
- **No rate-limit headers come back** on any reply (checked on a live 200), so the
  remaining allowance cannot be read from the response - the console is the only
  source.
- **A scan costs 556 in + 39 out = 595 tokens.** 1,000 scans is ~595k tokens, so the
  commonly quoted 1M tokens/day would be ~1,680 scans/day. Unverified by the vendor,
  and irrelevant next to the request limit.
- **The binding limit is requests, not tokens.** Three at the same instant gave one
  instant `429 code 1302 Rate limit reached for requests` and two that never answered
  inside 40 s. After the burst the key stayed 429 for about a minute, then recovered.
- **Latency is the free tier's real tax**: 2.4-4.7 s when quiet, 14.5 s / 28 s / 37 s
  for the same one-word request when busy. The scan's 16 s cap means a busy minute
  falls through to Cloudflare.

### The key pool (`server/src/lib/openai-compat.js`)

Z.AI's limit is **concurrency, per key**: one in-flight request. So the fix is not
more tokens, it is more keys. `Z_API_KEY_1`, `Z_API_KEY_2`, `Z_API_KEY_3`, ... are
scanned by name and sorted numerically (`Z_API_KEY_4` needs no code change); the older
single `Z_API_KEY` / `ZAI_API_KEY` still counts as one, and duplicates are collapsed.

Each key has its own slot. A call takes the first key that is free and not cooling
down; if every key is busy it waits up to `ZAI_QUEUE_WAIT_MS` (6 s), up to
`ZAI_MAX_QUEUE` (2) deep, and only then takes the next rung. The slot is released in a
`finally`, so a failed call cannot leave the calculator blocked.

**A 429 no longer costs the shopper anything.** The key goes into a cool-down
(`retry-after`, else 30 s, capped at 5 min) and the same call immediately retries on
another key. With three keys, three shoppers are measured at the same instant.

Measured against a stubbed endpoint (3 keys, a forced 429 on key 1):

| | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| time | 406 ms | 406 ms | 935 ms (retried after the 429) |
| keys used | key-2 | key-3 | key-1 (429) then key-2 |

No key served two calls at once; `cooling: 1`, `refused: 0`, all three succeeded.
The single-key gate measured earlier (one shopper waited 1,998 ms for the slot) is
what happens now only when the pool has no free key.

**Keys from the same account are not extra slots.** Three keys created on one Z.AI
account, fired at together, still produced one `429 code 1302` and a 1.3-1.5 s wait
(3.06 / 3.06 / 4.93 s), then all three keys were refused together and recovered about
a minute later. Whatever is counted per key, the ceiling that matters is the account's.

**Three keys from three accounts are.** Measured in production on `main` with
`Z_API_KEY_1..3` on Render, three scans fired at the same instant:

| keys | scans | times | pool |
| --- | --- | --- | --- |
| 3 accounts | 3 | **3.27 / 3.27 / 3.31 s** | served 0→3, refused 0, last_wait **0** |
| 3 accounts | 4 | 3.03 / 3.82 / 5.12 / 5.54 s | served 3→7, refused 0, last_wait **1,562 ms** |

Three identical times is the proof there was no queueing: three requests in flight at
once, each paying only the model's own ~3.3 s. The fourth shopper waited 1.56 s for a
key and still got Z.AI - `served` rose by exactly the number of scans, so no call
needed a retry and nothing fell through to Cloudflare.

So: concurrency = number of **accounts**, not number of keys. Three accounts carry
three shoppers; the fourth queues for about one calculation. The per-minute request
window is also per account - when it closes, every key on that account answers
`429 1302` in under a second, and the pool moves to another account's key.

`/health` reports `integrations.calc.zai` = `{ configured, model, keys, pace }` where
`pace` = `{ keys, busy, waiting, cooling, last_wait_ms, refused, served }`.
`/health/deep?oa=zai&index=2` probes the third key without printing it.

A congested evening still measures like Cloudflare (38/32/36) rather than like Z.AI
(40/32/38): when the free pool is busy a call takes 10-37 s, the 10 s cap fires, and
the ladder answers. That is the correct outcome, not a bug.

## Accounts: signup, the login code, reset (21 Oct 2026)

### The name

The product is **FindMySize** everywhere a person can see it. The repository, the
Pages path (`/3dGarments/`), the Render service, the package names and the `ThreeDG`
global in `embed.js` still say 3dGarments on purpose: they are addresses, not labels,
and changing them would break every link and the embed. The visual name lives in five
HTML files (`brand-name`, `<title>`, `aria-label`), two JS strings and the emails.

### Sign up

`/auth/` -> username (3-20, `[A-Za-z0-9._-]`), email, password (6+), confirm ->
`username_taken` RPC on blur and again on submit -> `signUp({ data: { username } })`
-> the `handle_new_user` trigger writes `profiles`. **Confirm email is ON** in the live
project (`mailer_autoconfirm: false`), so there is no session yet: the page says
"Confirm your email" and offers to send it again (60 s cooldown).

### Log in is two steps, on purpose

1. Password, via `signInWithPassword`. The session that creates is **given straight
   back** with `signOut({ scope: 'local' })` - it proves only the password.
2. A code via `signInWithOtp({ shouldCreateUser: false })`, checked with
   `verifyOtp`.

`redirectBlocked` exists because the SIGNED_IN event from step 1 would otherwise send
the page to the scanner before step 2 happened. `scope: 'local'` matters: the default
`signOut()` revokes every refresh token and would log the person out on their other
devices.

The code comes from Supabase's **Magic Link** template, which must contain
`{{ .Token }}`. Without that the email only has a link, and the code box has nothing
to type - the link still works, because `detectSessionInUrl` turns it into a session
and the page redirects.

**The code is 8 digits in this project, not 6.** Measured 21 Oct 2026: the mail said
`29756589`, and `POST /auth/v1/verify { type: 'email', token }` took it. The box
therefore takes 6-10 digits, validates `^\d{6,10}$`, and does **not** auto-submit at
six - an early submit on an 8-digit project burns a wrong attempt. If you want the
old wording back, set Authentication -> Providers -> Email -> *Email OTP Length* to
6; the screen no longer promises a number either way.

**This needs a custom SMTP, and the dashboard will not even let the templates be
edited without one.** Supabase's built-in mailer allows a handful of messages an hour
for the whole project; every login now sends one. Two routes that need no domain:
Brevo (`smtp-relay.brevo.com:587`, SMTP key, a verified sender address - Gmail works
as a sender once confirmed - 300/day) or Gmail itself (`smtp.gmail.com:587`, a
16-character App Password under 2-Step Verification, ~500/day). The sender field must
match the address the provider verified. Then raise Authentication -> Rate Limits ->
*Emails sent per hour*. Without this the second or third login in an hour is told to
wait. This is the single blocking setup step, not a code problem.

### Reset

`resetPasswordForEmail` -> `?.../auth/?reset=1#access_token=...&type=recovery` -> the
page reads the hash **before** Supabase consumes it, shows the new-password form,
`updateUser({ password })`, then opens the scanner. A reset link outranks the
"already signed in" bounce.

### Google: cut from the page, kept in the database

The button, its handler, `signInWithGoogle` and its CSS are gone (21 Oct 2026) - a
Google OAuth client needs a published site and a verified brand, which is a step for
later. What stayed is `20261021000000_oauth_usernames.sql`: `handle_new_user` now
names a provider account from the address's own name (`sam@example.com` -> `sam`),
suffixing on collision, inside the same 3-20 shape. It changes nothing for email
signups and means the day the button returns, Google signup cannot fail inside the
trigger. The same body is in `supabase/setup.sql`.

To bring it back: `signInWithOAuth({ provider: 'google', options: { redirectTo:
accountPageUrl() } })`, a button above the tabs, and the provider block in
Supabase plus the callback URL in Google Cloud. `onAuthChange` already opens the
scanner for any session that arrives without the form being touched.

### Tested, and what was not

Local dev, real Supabase: page renders with no console errors; tabs switch; a wrong
password returns "That email and password do not match an account."; an `@example.com`
signup is refused by Supabase itself (`x-sb-error-code: email_address_invalid`).

**End to end, 21 Oct 2026, through the real mail:** a throwaway mailbox at mail.tm
signed up on the live Pages build (`fmsqa995374@maxxspace.com`, username
`fmsqa995374`), received **"Confirm your email address"** from
`FindMySize <damii.projects@gmail.com>` within ~25 s with the pasted template, and
the `verify` token confirmed the address. (The sender was switched to
`findmysize.us@gmail.com` the same day - a later signup mail arrived from
`"FindMySize" <findmysize.us@gmail.com>`, so the change works.) Then log in with the
password: the page
asked for the code, the second mail ("Your sign-in link", subject not yet changed to
the README's "Your FindMySize login code") arrived, and **the 8-digit code was
accepted by the API**.

Two faults came out of that test, both configuration rather than code:

- **Supabase's Site URL was `http://localhost:3000`** *(fixed the same day)*. The signup
  sent `redirect_to=https://damii-lola.github.io/3dGarments/auth/`, but the generated
  link said `http://localhost:3000`, so a real person clicking "Confirm and open the
  scanner" landed on a dead page. Setting Site URL to the Pages auth page and adding
  `https://damii-lola.github.io/3dGarments/**` + `http://localhost:5173/**` fixed it.
  Proved without an inbox: `GET /auth/v1/verify?token=bogus&redirect_to=…` returns
  **303** with `Location: https://damii-lola.github.io/3dGarments/auth/#error=…`
  (and `/auth/?reset=1#…` for the recovery variant). Before the fix both went to
  `localhost:3000`.
- **The code was 8 digits**, not six - see above.

After the fix, on the live build: an expired link shows "That link has expired or has
already been used…" and strips the hash; a real session arriving in the hash (minted
with the password grant) lands on `/size/` signed in; a `?reset=1#…&type=recovery`
arrival shows "Set a new password", and submitting it opened the scanner - the new
password then logged in (200) and the old one did not (400). The SMTP sender is now
`"FindMySize" <findmysize.us@gmail.com>` (seen in a delivered signup mail), not
`damii.projects@gmail.com`.

**Junk accounts from the test, safe to delete** (Authentication -> Users):
`fmsqa995374@maxxspace.com` (confirmed), `fmscheck2110@westcast-systems.com`,
`fmsdrop2110@maildrop.cc`, `fmslol2110@ov.lucktaro.com`.







