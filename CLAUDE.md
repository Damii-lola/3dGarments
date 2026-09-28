# 3dGarments: notes for Claude Code

Users take a photo of a piece of clothing. The app cuts the garment out, measures its silhouette, and wraps it as a thin textured shell around a parametric 3D mannequin. The garment is a draped "3D plane", not a simulated cloth mesh.

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
    samples.js          synthetic flat-lay SVGs (demo + tests)
  test/                 node --test (runs the real pipeline on the samples)
  scripts/verify.mjs    live integration check (npm run verify)
web/                    Vite + three.js SPA (GitHub Pages)
  src/scene/body.js     parametric body: radii functions used by the mannequin AND the wrapping
  src/scene/mannequin.js  procedural mannequin mesh
  src/scene/wrap.js     garment shell builder (shell / sleeve / leg regions)
  src/scene/textures.js front texture + synthesized back panel
  src/scene/dresser.js  what's worn, layering, rebuilds
  src/scene/stage.js    renderer, lights, camera views
  src/services/         config, auth (supabase-js), api, local (in-browser pipeline), wardrobe store
supabase/migrations/    schema, RLS, private "garments" bucket
render.yaml             Render blueprint
.github/workflows/      ci, deploy-web (Pages), supabase (db push)
scripts/link.sh         pushes keys to GitHub secrets/vars + Render env
```

## Commands
- API: `cd server && npm i && cp .env.example .env && npm run dev` (port 8787)
- Web: `cd web && npm i && npm run dev` (port 5173). With no `.env.local` it runs in **local mode**, which does all processing in the browser and needs no backend.
- Demo and screenshots: `http://localhost:5173/?demo=tee,jeans` (also `dress`). `window.__3dg` exposes `{stage, dresser, wardrobe}`.
- Tests: `cd server && npm test`
- Integration check: `cd server && npm run verify`

## Coordinate conventions (don't break these)
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
- Back photo upload (`garments.back_texture_path` already exists) to replace the synthesized back
- Better segmentation for busy backgrounds (e.g. a segmentation model or Cloudflare Images `segment=foreground`)
- Pose presets (arm angle), skin tones, per-user saved outfits UI (`/api/me/outfits` exists)
- Cloth-like softness: vertex noise/wrinkles and hem sway
