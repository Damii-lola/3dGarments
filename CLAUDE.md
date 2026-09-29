# 3dGarments: notes for Claude Code

A 3D model studio for fashion shops. Users pick the male or female mannequin model (the owner's FBX models in `assets/`), set real width/height and skin, pose it, pick a studio or location backdrop, and export product shots (up to 4K, transparent PNG). Next phase: users upload the front/side/back of a garment and it goes onto the model. The server's photo → cut-out → measurement pipeline is the base for that.

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
assets/                 SOURCE body models from the owner: MaleModel.fbx (Mixamo rig), FemaleModel.fbx (Character Creator rig + face, eyes, teeth, underwear)
tools/body/             model pipeline: extract.mjs (FBX → JSON via the lab page test/extract.html; test/meshes.html lists an FBX's meshes),
                        prepare.py (merge kept meshes, tag parts, weld, metres, rename the rig to our bones, width morph,
                        shoulder probes, eye centres → GLB), glb.py
web/                    Vite + three.js SPA (GitHub Pages)
  public/body/          BUILT rigged models: male.glb, female.glb (from tools/body/prepare.py)
  src/main.js           studio UI: Model (sex, width cm, height in, skin-tone slider) / Pose / Scene tabs, Shot panel, state in localStorage.
                        Responsive: desktop 3 columns; ≤860px (and phones in landscape) stage + bottom/side sheet — the matchMedia query in main.js mirrors styles.css
  src/human/body.js     SKIN_STOPS/toneAt (one slider, light → dark, default Latino), RANGES, ModelController (cm / in → width morph + uniform scale, exact)
  src/human/assets.js   model URLs
  src/human/human.js    Human: loads both GLBs, re-bases limb bones on pose zero, width morph + rebind, pose, hang solver, feet on floor
  src/human/rig.js      POSE ZERO: the limb directions every pose in poses.js is authored against
  src/human/materials.js  body material: grey clay / skin tone (SSS wrap, sheen, procedural micro-texture)
  src/human/poses.js    pose + hand library, composePose()
  src/scene/stage.js    renderer, studio rig (cyclorama + lights follow camera), HDRIs, views, WYSIWYG capture
  src/services/         api/auth/local/wardrobe: garment-pipeline client, waiting for the clothing phase (not wired in main.js)
test/                   🧪 LAB: human / rig / pose workbench (imports web/src directly, serves web/public)
supabase/migrations/    schema, RLS, private "garments" bucket
render.yaml             Render blueprint
.github/workflows/      ci, deploy-web (Pages), supabase (db push)
```

## Commands
- API: `cd server && npm i && npm run dev` (port 8787). Secrets live **only** in Render env vars. Never commit `.env` files. Live API: https://threedgarments.onrender.com
- Web: `cd web && npm i && npm run dev` (port 5173). Without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` it runs in **local mode**, which does all processing in the browser and needs no backend.
- URL shortcuts: `?model=male|female&pose=hips&scene=city&view=three`. `window.__3dg` exposes `{stage, human, state, takeShot}`.
- Lab: `cd test && npm i && npm run dev` (port 5174). Do all human/rig/pose work here: it has skeleton, wireframe, weight views, a bone editor and stats. `window.__lab` is exposed.
- Rebuild the body models (after changing assets/ or tools/body): with the lab dev server running, `node tools/body/extract.mjs && python3 tools/body/prepare.py` (pip: numpy scipy). Commit web/public/body/*.glb.
- Tests: `cd server && npm test`
- Integration check: `cd server && npm run verify`

## Human conventions (don't break these)
- Models are in metres, y up, facing +z, feet on y = 0, left = +x (prepare.py normalises them).
- Bone names are ours (pelvis, spine_01…03, neck_01, head, clavicle/upperarm/lowerarm/hand/thigh/calf/foot/ball_l|r, fingers thumb|index|middle|ring|pinky_01…03_l|r). prepare.py maps Mixamo (male) and Character Creator (female) names; helper bones (twist, share, breast, face, toes) fold into their parents.
- Both models are faceless mannequins. The female's face is removed in prepare.py (`mannequin_head`): the real head + eyes + teeth become a solid, ears are shaved per slice, the solid is blurred (~1.5 cm) and re-meshed, replacing everything above the jaw.
- Vertex parts (_PART): 0 skin, 1 eye, 4 fabric, 5 teeth, 6 tongue (only skin + fabric remain after the mannequin head). The male's boxer briefs are generated in prepare.py (`boxer_briefs`: a copy of his skin from the waistband to mid-thigh, hems snapped straight). Fabric is always black, copies the nearest skin vertex's weights and is lifted ≥ 2.5 mm off the skin in prepare.py (the source hides skin under clothes). materials.js colours them (clay or skin tone; the iris is drawn around each eyeball centre from the GLB extras). Transparent cards (lashes, brows, tear lines) are dropped.
- Bone frames: y runs head → tail, and x = y × (+z), so **+x rotation swings a limb forward**. Hand and finger bones use the palm: +x curls into the palm. Feet/toes take their roll from "up" (x = y × +y) in BOTH prepare.py and human.js — a switching reference axis twists the foot. +z moves a left limb outward, and +y on the upper arm is internal rotation.
- Pose zero (rig.js): every limb bone is re-based onto these directions whatever the model's bind pose (T-pose male, arms-down female), so all poses mean the same on every model. Don't edit rig.js without recalibrating poses.js.
- Poses are authored anatomically (`buildPose({ c, both, l, r })`). The right side is mirrored as (x, −y, −z). Calibrate new poses in the lab with `grid`-style screenshots.
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
