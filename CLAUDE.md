# 3dGarments: notes for Claude Code

A 3D model studio for fashion shops. Users shape a realistic rigged human (MakeHuman/MPFB CC0 data), pose it, pick a studio or location backdrop, and export product shots (up to 4K, transparent PNG). Next phase: users upload the front/side/back of a garment and it goes onto the model. The server's photo → cut-out → measurement pipeline is the base for that.

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
tools/human/            asset pipeline: fetch.sh (sparse-clone MakeHuman + MPFB), build.py, paint.py
web/                    Vite + three.js SPA (GitHub Pages)
  public/human/         BUILT assets: human.json + human.bin (brotli), skin/detail/underwear masks, eye.png
  src/main.js           studio UI: Model (sex, width cm, height in, skin) / Pose / Scene tabs, Shot panel, state in localStorage
  src/human/body.js     the simple body model: FIT presets, width "frame", SKINS (grey clay first, each with an ethnicity blend), ranges
  src/human/assets.js   loads + decodes human.bin (brotli-dec-wasm)
  src/human/modifiers.js  MakeHuman macro maths (gender/age/muscle/weight/height/proportions/breast/ethnicity)
  src/human/human.js    Human: CPU morph → joints from cubes → bone frames → rebind; pose; feet on floor; underwear
  src/human/materials.js  skin (masks, SSS wrap, pores), eyes, lashes, underwear knit
  src/human/hair.js     shell-textured hair styles
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
- Rebuild human assets (only after editing tools/human): `tools/human/fetch.sh && python3 tools/human/build.py` (pip: numpy pillow brotli). Commit the outputs in web/public/human.
- Tests: `cd server && npm test`
- Integration check: `cd server && npm run verify`

## Human conventions (don't break these)
- MakeHuman data stays in native space (decimetres, y up, faces +z) inside human.bin. human.js converts to metres with the feet on y = 0.
- Bone rest frames: y runs head → tail, and x = y × (+z), so **+x rotation swings a limb forward**. Hand and finger bones use the palm: +x curls into the palm. +z moves a left limb outward, and +y on the upper arm is internal rotation.
- Poses are authored anatomically (`buildPose({ c, both, l, r })`). The right side is mirrored as (x, −y, −z). Calibrate new poses in the lab with `grid`-style screenshots.
- Model controls are real measurements: width = shoulder point to point (biacromial, probe verts at the shoulder tips) in cm, height = crown to sole in inches. `Human.measure()` evaluates only probe vertices; `Human.solve()` inverts exactly because targets blend linearly on each half-range. Keep the width frame within FRAME_RANGE (the torso turns boxy above +0.6).
- Body-surface overlays (underwear, later tight garments) reuse the body's triangles and skin weights, pushed out along the normal in the shader, with the outline cut by a UV mask painted in paint.py from 3D curves.

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
