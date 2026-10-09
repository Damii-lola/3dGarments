# 3dGarments: notes for Claude Code

An embeddable 3D **Virtual Fitting Room** for e-commerce (B2B SaaS). Merchants drop in a script tag; the widget replaces the last static image in a product gallery with a 3D mannequin the shopper shapes to their own measurements, so they can judge fit and size before buying (fewer returns, longer sessions, pre-order validation with digital twins of garments). Planned: a Next.js/React merchant dashboard (garment upload, subscription, analytics), a lazy-loaded iframe/script widget, garments exported from Blender as compressed `.glb` with chest/waist/height driven by morph targets in JS (no server re-render), and tiered pricing by widget loads (Starter $29 / 5k, Growth $79 / 25k, Scale $199 unlimited).

Current repo: the fitting-room core: the male/female mannequins (the owner's FBX models in `assets/`) with skin, height, weight and body-shape controls, garment photo upload, and the server's photo → cut-out → measurement pipeline. Clothing on the model, the embeddable widget and the dashboard are not built yet.

Template garments: our own `.glb` models live in Supabase (`garment_templates` table + public `templates` bucket, migration `20261009000000_garment_templates.sql`). `tools/garments/prepare_template.py` decimates a raw model (~30k tris, <1 MB). `web/src/garments/template.js` fits a static mesh to the mannequin (align → wrap with ease → bind to skin triangles) and makes it follow every shape/pose change (`update()` while sliders move, `settle()` ~180 ms after). The lab (`test/`) has a Templates section; `?template=<glb url>&wear` loads a local model.

Out of scope, removed: pose library, backdrops/HDRIs, scene set-up and photo export. Do not add them back.

## Layout
```
server/                 Express API (Render). ESM, Node 22.
  src/index.js          app, CORS, error handler
  src/config.js         all env vars (only place that reads process.env)
  src/lib/              supabase (service-role client), cloudflare (Workers AI REST), errors
  src/middleware/auth.js  verifies Supabase JWT → req.user
  src/routes/           garments (upload/list/patch/reprocess/delete), me (body, outfits), health (+ /health/deep)
  src/services/pipeline.js  sharp decode → silhouette → texture PNG → Cloudflare vision → Supabase
  src/shared/           ⚠ imported by BOTH server and web (Vite alias @shared). Keep dependency-free.
    silhouette.js       segmentation, cut-out, silhouette measurements, categories
  test/                 node --test (runs the real pipeline on fixtures/samples.js SVG flat-lays)
  scripts/verify.mjs    live integration check (npm run verify)
assets/                 SOURCE body models from the owner: MaleModel.fbx, FemaleModel.fbx (both Character Creator: rig + face, eyes, teeth, underwear)
tools/body/             model pipeline: extract.mjs (FBX → JSON via the lab page test/extract.html; test/meshes.html lists an FBX's meshes),
                        prepare.py (merge kept meshes, tag parts, weld, metres, rename the rig to our bones, width morph,
                        shoulder probes, eye centres → GLB), glb.py
web/                    Vite + three.js SPA (GitHub Pages)
  public/body/          BUILT rigged models: male.glb, female.glb (from tools/body/prepare.py)
  src/main.js           STAGE 1 UI: one panel (sex, skin, live measurements card, height & weight, body type, abdomen & waist,
                        bust & chest, shoulders & posture, glutes & thighs) + the preview filling the rest. Each sex keeps its own settings
                        ({ sex, models: { female, male }, updated }): localStorage + per device in Supabase (services/profile.js →
                        body_profiles.settings of the browser's anonymous user; the newer copy wins at boot).
                        Responsive: desktop panel | preview; ≤860px preview over a scrolling panel; phones in landscape preview | panel
  src/uploads/          STAGE 1 garment photos: groups.js (upload box above the sex picker → review popup: remove / add more,
                        max 10 per group, Confirm bottom-right → a group card; click a card to edit, rename or delete; any number
                        of groups; drafts, so Cancel/Esc changes nothing), store.js (Supabase: table garment_groups + private
                        "garments" bucket at <uid>/groups/<group>/<image>, written with the user's own session — anonymous
                        sign-in if nobody is logged in; falls back to IndexedDB when cloud isn't configured or refuses)
  src/human/body.js     SKIN_STOPS/toneAt, RANGES, BUILDS, ABDOMEN, LIMITS, ModelController: height (uniform scale) + shoulders (width morph)
                        exact; weight = volume × density, solved with the fat target; girths/bra size; everything in sync (see below)
  src/human/shape.js    body-shape morph targets BUILT AT LOAD from the mesh (belly, waist, bust, chest, glutes, hips, thighs, fat,
                        muscle, core) + volume, fat solve, tape-measure girths (convex hull of slices)
  src/human/assets.js   model URLs
  src/human/human.js    Human: loads both GLBs, re-bases limb bones on pose zero, width morph + rebind, pose, hang solver, feet on floor
                        (the hang solver runs per slider tick: typed-array torso skinning + 1 cm y-slices; keep it that cheap.
                        Arms hang straight down: the forearm continues the upper arm's line (+1°) and never angles back in;
                        hips/thighs push it out only as needed (the hand is part of that test, following its fingers' curl, down
                        to mid-thigh), and if that is > 8° past the upper arm, the upper arm tilts out instead. Per-model ARM_FIT in
                        human.js: the male's upper arm stands ≥ 12° out from the shoulder and the forearm continues its line (more
                        abduction, or a forearm angled back in, kinks the elbow and pinches the shoulder skin); the
                        female's lies close. ARMPIT (male): his A-pose-sculpted lats were bound 100 % to the spine and stayed
                        flared when the arm came down, gluing the upper arm to the torso — torso skin beside/below the shoulder
                        joint gets up to 55 % upper-arm weight so it tucks in, blended per side by arm elevation (full ≤ 25°, none ≥ 70°:
                        Body.applyArmpit, called from #applyPose) so raised/overhead arms keep the model's own armpit (clearance numbers lie, check the render). Check arms with an
                        orthographic silhouette of the skinned arm, not bone angles)
  src/human/rig.js      POSE ZERO: the limb directions every pose in poses.js is authored against
  src/human/materials.js  body material: grey clay / skin tone (SSS wrap, sheen, procedural micro-texture)
  src/human/poses.js    the standing pose (+ T/A reference poses), composePose()
  src/scene/stage.js    renderer, studio rig (cyclorama + lights follow camera), camera views
                        renders ON DEMAND: after changing anything in the scene call stage.invalidate(n, live) (live = a slider is
                        being dragged; main.js does it for shape, look, pose). LOW_POWER tier (touch / small screen / ≤4 cores):
                        pixel ratio ≤1.5, 1K shadows, half-res AO; while anything moves it skips AO and renders at an adaptive
                        pixel ratio, then draws one full frame when it settles. Resizes reallocate only once the size settles
                        (iOS rotation); a lost WebGL context rebuilds the PMREM environments. No preserveDrawingBuffer. N8AO renders the scene itself, so MSAA lives on ao.beautyRenderTarget.
                        Mobile CSS has no backdrop-filter
  src/services/         api/auth/local/wardrobe: garment-pipeline client, waiting for the clothing phase (not wired in main.js)
test/                   🧪 LAB: human / rig / pose workbench (imports web/src directly, serves web/public)
supabase/migrations/    schema, RLS, private "garments" bucket
render.yaml             Render blueprint
.github/workflows/      ci, deploy-web (Pages), supabase (db push)
```

## Commands
- API: `cd server && npm i && npm run dev` (port 8787). Secrets live **only** in Render env vars. Never commit `.env` files. Live API: https://threedgarments.onrender.com
- **All keys live in Render's env only** (none in GitHub): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, CLOUDFLARE_*. The static web app gets the public ones (URL + anon key) at runtime from `GET /api/public-config` (services/config.js, cached in localStorage; a cold Render start is waited for once, then it falls back to local mode).
- Database: paste `supabase/setup.sql` (all migrations concatenated, idempotent) into the Supabase SQL editor. Regenerate it when adding a migration. Anonymous sign-ins must be enabled in Supabase Auth for uploads to reach the cloud.
- Web: `cd web && npm i && npm run dev` (port 5173). `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` override the Render config for local development; with neither it runs in **local mode** (everything in the browser).
- URL shortcuts: `?model=male|female&tone=0..1` (the lab also takes `&view=three`). `window.__3dg` exposes `{stage, human, model, state, profile}`.
- Lab: `cd test && npm i && npm run dev` (port 5174). Do all human/rig/pose work here: it has skeleton, wireframe, weight views, a bone editor and stats. `window.__lab` is exposed.
- Rebuild the body models (after changing assets/ or tools/body): with the lab dev server running, `node tools/body/extract.mjs && python3 tools/body/prepare.py` (pip: numpy scipy). Commit web/public/body/*.glb.
- Tests: `cd server && npm test`
- Integration check: `cd server && npm run verify`

## Human conventions (don't break these)
- Models are in metres, y up, facing +z, feet on y = 0, left = +x (prepare.py normalises them).
- Bone names are ours (pelvis, spine_01…03, neck_01, head, clavicle/upperarm/lowerarm/hand/thigh/calf/foot/ball_l|r, fingers thumb|index|middle|ring|pinky_01…03_l|r). prepare.py maps the Character Creator names (both models); helper bones (twist, share, breast, face, toes) fold into their parents.
- Both models are faceless mannequins, made in prepare.py (`mannequin_head`): the real head + eyes + teeth become a solid, ears are shaved per slice, the solid is blurred (~1.5 cm) and re-meshed, replacing everything above a cut under the jaw (`head_cut` above the neck bone: 3 cm female, 5 cm male). The skin is clipped exactly on the cut plane, its top 3 cm is snapped radially onto the shell, the shell dips under the neck below the cut, and the shell's lower part copies the neck's skin weights — one clean line, no rim/teeth.
- Vertex parts (_PART): 0 skin, 1 eye, 4 fabric, 5 teeth, 6 tongue (only skin + fabric remain after the mannequin head). Underwear comes from the models (female Bra + Underwear_Bottoms, male Boxers). Garment triangles render double-sided in their own material group (human.js; source garments fold over themselves), small holes are closed (`fill_holes`), fabric that bridges off the skin (the crotch gusset) gets surface-smoothed weights so it stretches instead of folding, fabric is only lifted where the skin normals under it agree, and skin > 2 cm under a garment is sunk 2 mm (never visible, can't poke through). Fabric is always black, copies the nearest skin vertex's weights and is lifted ≥ 2.5 mm off the skin in prepare.py (the source hides skin under clothes). materials.js colours them (clay or skin tone; the iris is drawn around each eyeball centre from the GLB extras). Transparent cards (lashes, brows, tear lines) are dropped.
- Bone frames: y runs head → tail, and x = y × (+z), so **+x rotation swings a limb forward**. Hand and finger bones use the palm: +x curls into the palm. Feet/toes take their roll from "up" (x = y × +y) in BOTH prepare.py and human.js — a switching reference axis twists the foot. +z moves a left limb outward, and +y on the upper arm is internal rotation.
- Pose zero (rig.js): every limb bone is re-based onto these directions whatever the model's bind pose (T-pose male, A-pose female), so all poses mean the same on every model. Don't edit rig.js without recalibrating poses.js.
- Poses are authored anatomically (`buildPose({ c, both, l, r })`). The right side is mirrored as (x, −y, −z). Calibrate new poses in the lab with `grid`-style screenshots.
- Body shape (shape.js): each target is a displacement field placed with skin weights + mesh landmarks (breast/glute apexes,
  natural waist, crotch) and surface-smoothed; clothing copies the nearest skin (inverse-square, so a skin-tight garment follows the skin right under it)
  and skin under clothing gets no surface-detail change (it would poke through). Targets are appended after the GLB's
  width target (slot 0), with normal deltas. The other sex's targets are built in idle time after load.
- Sync + limits (body.js): the proportion sliders are −1 … +1 across LIMITS (calibrated on renders: past them the body stops
  looking real), damped by body fat (`room()`: a heavy body has less room to add, a lean one less to lose). Body fat is the
  stored value; weight is derived (every control moves it), and the weight slider / body-type chips solve the fat for a weight.
  Re-check limits with grid renders of both sexes (presets, all-max, all-min) after changing any field.
- Model controls are real measurements: width = shoulder point to point (the two acromion probe vertices baked by prepare.py) in cm, height = crown to sole in inches. Height is a uniform scale; width is the linear "width" morph (shoulders ±20 % per unit, arms move out rigidly, hips follow a little) plus a skeleton rebind, so ModelController solves both exactly.

## Coordinate conventions (garment pipeline)
- **Garment space** (output of silhouette.js): unit = texture height; x ∈ [0, aspect]; y ∈ [0,1] with y pointing **down**.
- **World**: metres, y up, the body faces +z, and image-left maps to world −x.
- Textures are uploaded as DataTextures with the rows flipped, so `uv.y = 1` is the top of the photo.
- Sleeve `perp` in silhouette.js uses n = (−dy, dx) in y-down space. In 3D this maps to the arm's clockwise perpendicular `(a.y, −a.x)`.

## Rules
- The API always uses the service-role key, so **every query must filter by `user_id`**.
- Storage paths are `<user_id>/<garment_id>/{original.jpg,texture.png,preview.jpg}`. The bucket is private and the API hands out signed URLs.
- Anything in `server/src/shared` must run unchanged in Node and in the browser (no Buffer, no DOM).
- Categories are `top | outerwear | dress | skirt | pants | shorts`. `WRAP_MODE` maps them to the `upper | full | skirt | legs` wrap strategies.
- Vision model: `CF_VISION_MODEL` (default `@cf/meta/llama-4-scout-17b-16e-instruct`). If AI fails, the silhouette guess is used and a failed call never blocks processing.

## Roadmap / ideas
- Clothing: front/side/back garment photos → garment fitted on the human (body-surface projection + cut-out textures; `garments.back_texture_path` exists)
- Better segmentation for busy backgrounds (e.g. a segmentation model or Cloudflare Images `segment=foreground`)
- Long hair (hair cards), eye colours, direct-manipulation posing (click a joint + gizmo), ambient occlusion pass
- Save/load models and outfits to the cloud (`/api/me/outfits` exists)
