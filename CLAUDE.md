# 3dGarments: notes for Claude Code

A 3D model studio for fashion shops, in three stages, each shown alone (no UI of a later stage until the user reaches it):
1. **Try-on (free, current UI):** pick the male/female mannequin (the owner's FBX models in `assets/`), set skin, height, weight and body shape; next: upload a garment's front/side/back and it goes onto the model (the server's photo → cut-out → measurement pipeline is the base).
2. **Style (paid, not built yet):** pose the dressed model, backdrop, furniture, an AI prompt that sets up scene + pose (stage.js HDRIs/lighting and poses.js already exist).
3. **Photoshoot (paid, not built yet):** product shots up to 4K / transparent PNG (stage.capture exists).

## ⚠ Clothes try-on is SWITCHED OFF (being rebuilt from the beginning)
The whole garment try-on system is commented out of the app: main.js lines marked `TRY-ON` (import, createTryOn,
onWear, the cards' "Try on" button, prepareTryOn). Everything in web/src/garments/ is kept but nothing imports it.
What stays live: the body, its controls, the photo upload groups, and the BODYSUIT (?suit=1 / human.setSuit /
the lab's box). The notes on garments/ below describe the old, switched-off system.

## Clothes are SEWN in Blender (tools/blender/sew/), the way KNOWLEDGE.md §1 says
(The old skin-pushed templates, web/src/templates/, were deleted.) With live.py running and the site on ?blender=1:
`send.py -f tools/blender/sew/export_body.py` writes the site's rest body to ~/.3dg-sew; then headless
`blender -b -P tools/blender/sew/tee.py` measures it, drafts the pattern (front/back + set-in sleeves, cap solved to the
armhole), places the pieces round the body (arc length round REAL body cross-sections ALL THE WAY UP through the
shoulder — envelope-smoothed over height to kill the deltoid/clavicle weight-paint wobble; clamping to one section at
the armhole and patching upward with a nearest-point shrinkwrap made a boxy torso and a creased shoulder, both gone
once the sections themselves follow the body), closes the seams (presew), relaxes every edge to its FLAT-PATTERN
length (no creases baked in), welds and drapes (cloth sim, jersey, stiff enough in bending to settle into a few broad
folds instead of many fine ones — "ironed", not pulled from a drawer) → ~/.3dg-sew/tee.obj; `send.py -f sew/load.py`
(STATE['load']) streams it to the site, which rigs it like the body (surface-smoothed weights, THEN smoothed again
across the GARMENT's own topology — a seam welds pieces placed independently, and the raw per-vertex nearest-body
blend can jump right at that line) and hides the skin it covers. sewlib.py = pieces, seams, sim helpers.
SEWN IN AN A-POSE (export_body.py also writes body_pose.obj/json: arms lowered 15° more, ~47° down — sewn with the
arm out, a sleeve stands out stiffly once it hangs), then UNPOSED to the rest pose (sewlib.unpose: inverse skinning with
surface-smoothed weights) — unpose() blends each vertex's OWN k-nearest weights independently, so two vertices a mm
apart in the drape can end up a hair's-width out of line with each other: invisible in the drape (it's smoothed there)
but it catches the light as a thin bright crease once re-posed on the site. A SECOND light smoothing pass (sewlib.iron),
run against the REST body after unposing (not the sewing-pose body the drape used), is what actually settles it — the
same pass right after the drape doesn't reach this, since the noise is introduced by unposing itself, afterward.
Pattern lengths above the armhole are measured along the body (half the extra path: the full one left a fold across
the chest). Rib neckband at 85 % of the neckline; sleeve cap asymmetric, each half = its own armhole, no ease; weld
removes non-manifold faces, fills small holes, AND recalculates consistent face winding (a seam joining pieces wound
independently can leave one face backward right at the join — same bright-crack symptom as the unpose noise, different
cause: check both if it comes back); seams and open edges smoothed after the drape; no Solidify (its inner shell showed
at seams); the live mesh casts a shadow but doesn't receive one (self-shadow acne at a seam's sharp little fold reads
as the same kind of crack). WRINKLES: a vertex group `fold` (tee.py `_fold_weight`, Gaussian-weighted in pattern
(u,v) space) marks underarm drag-line + back shoulder-blade zones; `cloth()`'s `shrink`/`shrink_group` locally scales
`vertex_group_shrink`, so the fold is a real settled cloth-sim buckle, not a sculpted crease (`iron()`'s
`exclude_group` keeps these zones from being pressed flat). HOLE-FILLING after weld's face-removal cleanup
(sewlib.fill_small_holes/_close_branch_vertices/_cdt_fill_loop): the corner where 3 pattern pieces meet (sleeve cap
+ front/back shoulder, or a cuff's hem + both underarm edges) can leave a vertex with 4+ boundary edges instead of
2 — an hourglass, not a simple loop — which both of Blender's own hole-fill operators (holes_fill, triangle_fill)
either skip outright or fill badly (sparse triangles too coarse for cloth to drape, crumpling into a jagged flap);
fixed by a constrained-Delaunay fill per boundary loop (mathutils.geometry.delaunay_2d_cdt, the same routine Piece
itself is built with) plus explicit fan-triangulation at any branch vertex. A vertex that's part of a REAL opening
(hem/neckline/cuffs, `keep_open` in tee.py) must never get closed, however big the hole looks — protect it by
object identity where the bmesh is still the one weld() built, but by a custom `bm.verts.layers.int` tag (created
*before* capturing the reference set — adding a layer can itself invalidate existing element references) once a
retry rebuilds the bmesh from the mesh datablock, since plain vertex indices silently point to the wrong vertex
after any earlier weld_verts/delete reindexes everything. At a branch vertex that IS protected (a cuff corner:
2 edges are the real hem curve, 2 are the accidental gap), only fan-close the edges whose other end ISN'T
protected — never the whole vertex.

## Layout
```
server/                 Express API (Render). ESM, Node 22.
  src/index.js          app, CORS, error handler
  src/config.js         all env vars (only place that reads process.env)
  src/lib/              supabase (service-role client), cloudflare (Workers AI REST), errors
  src/middleware/auth.js  verifies Supabase JWT → req.user
  src/routes/           garments (upload/list/patch/reprocess/delete), me (body, outfits), ngl (describe, pattern), health (+ /health/deep)
  src/services/patterns.js  py/pattern.py inside ONE long-lived Python worker (py/worker.py, JSON lines; imports once; one-shot fallback;
                        /health shows its state + last timings). Render's free CPU is ~15x slower than a laptop: keep pattern.py
                        cheap — py/fastpaths.py (svgpathtools lengths in closed form), operators.py's armhole fit batched + memoised
  src/services/pipeline.js  sharp decode → silhouette → texture PNG → Cloudflare vision → Supabase
  src/shared/           ⚠ imported by BOTH server and web (Vite alias @shared). Keep dependency-free.
    silhouette.js       segmentation, cut-out, silhouette measurements, categories
  test/                 node --test (runs the real pipeline on fixtures/samples.js SVG flat-lays)
  scripts/verify.mjs    live integration check (npm run verify)
assets/                 SOURCE body models from the owner: MaleModel.fbx, FemaleModel.fbx (both Character Creator: rig + face, eyes, teeth, underwear)
tools/body/             model pipeline: extract.mjs (FBX → JSON via the lab page test/extract.html; test/meshes.html lists an FBX's meshes),
                        prepare.py (merge kept meshes, tag parts, weld, metres, rename the rig to our bones, width morph,
                        shoulder probes, eye centres → GLB), glb.py
tools/blender/          CLOTHES MADE IN BLENDER (4.2 LTS, headless: blender -b -P x.py -- args). READ KNOWLEDGE.md FIRST: everything
                        learned about making clothes on a body (pattern → sew → weld → settle, cloth settings, fitting, layering,
                        pattern drafts per garment type). GARMENTS.md: EVERY garment type (men's + women's tops/bottoms, traditional,
                        swim, work…) broken into building blocks (fit/ease, sleeve system, neckline, collar, closure, hem, waist,
                        leg, skirt maths) + fabric → cloth settings + a catalogue line per garment. tee.py = first drape test
                        LIVE (live.py + send.py, no templates: clothing is modelled live in Blender ON THE SITE'S BODY):
                        `blender -b -P tools/blender/live.py` (or with the UI: `blender -P …`, same server on a timer) imports
                        web/public/body/{male,female}.glb (same vertices, same order as the site) and serves ws://127.0.0.1:8790.
                        The site with ?blender=1 (web/src/live/blender.js) sends its body AS SHOWN (sex + world positions of
                        every vertex: pose, height, width, shape sliders) → shape key 'site' on the Blender body (armature
                        muted, collision on), re-sent whenever it changes; Blender streams every mesh in its "Garments"
                        collection (evaluated: cloth frames as they simulate) back, drawn on the body. Round trip measured
                        0.00006 mm. Control = `python3 tools/blender/send.py '<python>'` / `-f file.py` (token in
                        ~/.3dg-blender-token, 0600; browsers can never exec); helpers in the session: body(), new_garment(),
                        step(frames, every), push(), STATE. Browser origins allow-listed (localhost dev + damii-lola.github.io).
                        Blender ↔ app coords: app (x, y, z) = Blender (x, z, -y). Chrome splits big WS messages: the server
                        joins fragments (keep the first frame's opcode). SIGPIPE is ignored (a client leaving mid-send killed
                        Blender). Don't pkill by a pattern that appears in your own command line
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
  src/human/cpumorph.js MORPHS ARE BLENDED ON THE CPU (useCpuMorphs, on the body and every garment): some Android GPU drivers
                        break three's morph-texture loop (the body came apart on a phone once a shape slider moved). The
                        morph data and weights stay (CPU code reads them); the shaders add two attributes morphPos/morphNrm,
                        re-summed only when the weights change, in the materials and the shadow (customDepthMaterial)
  src/human/human.js    BODYSUIT (makeSuit): black, skin-tight, head to fingers to toes — a second SkinnedMesh on the body's own
                        geometry + skeleton (follows every pose / shape slider; morphs from the body's CPU blend), skin triangles
                        only, pushed out 1.5 mm (+2 mm where prepare.py sank the skin under the underwear; smoothed normals there).
                        Invisible by default; testing: ?suit=1, human.setSuit(true), the lab's "Bodysuit" box (body + underwear
                        not drawn while it's shown)
  src/human/rig.js      POSE ZERO: the limb directions every pose in poses.js is authored against
  src/human/materials.js  body material: grey clay / skin tone (SSS wrap, sheen, procedural micro-texture)
  src/human/poses.js    pose + hand library, composePose()
  src/scene/stage.js    renderer, studio rig (cyclorama + lights follow camera), HDRIs, views, WYSIWYG capture
                        renders ON DEMAND: after changing anything in the scene call stage.invalidate(n, live) (live = a slider is
                        being dragged; main.js does it for shape, look, pose). LOW_POWER tier (touch / small screen / ≤4 cores):
                        pixel ratio ≤1.5, 1K shadows, half-res AO; while anything moves it skips AO and renders at an adaptive
                        pixel ratio, then draws one full frame when it settles. Resizes reallocate only once the size settles
                        (iOS rotation); a lost WebGL context rebuilds the PMREM environments. No preserveDrawingBuffer (capture
                        calls toBlob in the same task as the draw). N8AO renders the scene itself, so MSAA lives on ao.beautyRenderTarget.
                        Mobile CSS has no backdrop-filter, and the crop dim is a clip-path hole (not a 100vmax box-shadow)
  src/garments/tryon.js IN THE APP: a group card's "Try on" → the group's first photo through garments/pipeline.js (photo models in
                        the browser; words + patterns from the live API, retried twice) → worn on the model; it may switch the
                        model's sex first (onSex → main.js useSex: that sex's own settings) and follows body-shape changes.
                        Progress steps over the preview (.stage-busy); a manual sex switch takes the clothes off.
                        BUDGET ≤ 30 s a photo until the model is SHOWN DRESSED (users leave): pipeline pass 1 sews + shows every
                        garment (onDraft), pass 2 re-cuts to the photo in the background (secant steps, photofit.nextOverrides hist;
                        sew.js is async and yields a frame every ~50 ms with the visible body put back in its own pose; a take-off
                        cancels via alive()). App options fitRounds 2 + fitTolerance 0.15, search false (no CLIPSeg,
                        139 MB), painter 'patch' (fill.js PatchMatch, not LaMa 208 MB), parseSize 384. prepareTryOn (boot + 2.5 s) wakes
                        the API and creates the parser/pose sessions in idle time (models.js: files in Cache Storage '3dg-models').
                        pipeline.js overlaps every wait: describe is SENT before the parser runs (a sync wasm run holds the page and
                        the request), every garment's first pattern is requested up front, the pose is awaited only at photofit.
                        Canvases that are read back must be CPU-backed (willReadFrequently at their first getContext: a GPU readback
                        costs seconds). WebGPU (fp16 SegFormer) is opt-in ?gpu=1: unverified on real phones (no f16 → CPU).
                        Time it with a stage-by-stage harness (describe stubbed, patterns from the local py worker) before and after
  src/garments/hanger.js + layer.js  HANGER PHOTOS → CLOTHES LAYERED ON THE BODYSUIT (the main case: shop photos on hangers).
                        tryon.wear(images) parses the first photo: no wearer (isHangerPhoto) → hanger flow, else pipeline.js.
                        Views: the photos whose garment is whole (top + hem inside the frame; sides may touch), 1st = front,
                        2nd = back; close-ups ignored. cleanGarment takes the hanger leftovers, a garment worn inside it (underIn:
                        farthest-point k-means, cluster unions contrasting with the main colour, closing over necklace cords,
                        grown along its colour, opened to drop buttons) and jewellery off. layer.js: the garment's own shape
                        (side-seam lines fitted on the straight torso band, shoulder line, hem above the stand, sleeves = outside
                        the seams), scale = body shoulder points / garment shoulder width; charts resampled from the photos:
                        torso (around by arc length — front photo front half, back photo back half — × down from the shoulder
                        line, collar capped 9 cm) and one per sleeve (along the arm from the shoulder joint × around it). One
                        SkinnedMesh of the body's skin triangles (subset geometry: its bones, morph targets, suitGap/suitNrm),
                        alpha-tested (the photo's outline = the garment's edges), 1.2 mm over the suit; Body.layers re-binds it.
                        Hidden skin (materials.js _hide; underwear is never hidden: it's 2.5 mm off the skin, under fabric
                        that is ≥ 2.7 mm off it) sinks only 4 mm and is DRAWN 3 cm DEEPER (pushed along the
                        line of sight in project_vertex: same pixels, only depth) — a point sunk deep near a bending joint
                        comes out through the skin, and a depth step at an open edge reads as a crease to the AO: so the
                        hide set skips the skin's last triangle at an open edge. Tops only so far.
                        LOOSE, NOT A BODYSUIT (drape.js, a rest-space offset per body vertex): torso = per 1 cm slice the hull
                        radius by angle, upper-enveloped over ±6 cm, spanned vertically (profile's upper hull: collarbone →
                        chest, shoulder blades → small of the back), + ease (front/back > sides), then GRAVITY (below the chest
                        it never comes in faster than 12 cm/m), widened where the photo's hem flares; sleeves = a tube ≥ the
                        arm's 90th-pct radius +14 % (cap sits on the shoulder). The torso share rides the TORSO bones only
                        (drapeT/drapeW: a raised arm doesn't swing the shirt's side open), the sleeve share the skin weights.
                        Armholes = the 50 % level of each arm's surface-smoothed weight: triangles near it go on both charts,
                        each cut on its side (shell.js `seam`), so the seam is a smooth line. shell.reskin re-mixes the
                        garment's bones when the body re-weights its armpits (weightListeners). collide.js: after every pose
                        the arms/hands push the torso's hang in (drapeK), the dent smoothed.
                        COLLAR: the fall stands off the neck as a cone (drape.js collarTop/collarFlare); collarLine cuts one
                        smooth anti-aliased roll line (highest at the nape, lower at the sides, nothing at the throat — on the
                        hanger its sides climb toward the hook), the fall's edge 45 mm under it is stepped (edgeBands) and
                        shaded; the front/back photos are welded at the sides (else a line of pinholes). POCKETS: pocketPlan
                        (sheet's kind + place → torso-chart rects, kept 22 mm clear of an open front) → drawPockets (stitching,
                        patch hem fold, flap, welt slit, shadow) + raised in edgeBands. drawButtonholes: each button's mirror
                        on the other panel, 15 mm in from its edge. CLOSE-UPS (photos that aren't whole views): buttonFace
                        (details.js) cuts the real button out of one → the 3D buttons' face.
                        INNER GARMENT (a tee in an open shirt): clean.js keeps underIn's pixels (`under`) and the outline with
                        rows filled (`filled`); hanger.js builds it FIRST as its own layered garment (the shirt's shape closed
                        up, its colour as an even knit, crew neck via crewLine, 3.5 cm shorter, no sleeves, glow 0.12 so white
                        keeps its shading), clipped to what's seen past the shirt (torsoMask → clipUnder: openings + 5 cm);
                        the shirt is then built with `over` = the tee's drape: ≥ 6 mm further out along the skin normal.
                        BOXY: drape `flat` takes the sides out to the front photo's flat half-width. Sleeves: a straight
                        tube (upper hull of arm radius + 6 mm and the photo's girth), no deltoid puff. torsoTexture also
                        fills small holes (fillSmallHoles) and straightens an open front's edges (straightFront: smoothed,
                        a line fitted below the lapels' break). COLLAR POINTS: flapQuads (from the opening's edges) →
                        collarPoints: two-ply flaps anchored on the shirt (buildAnchored, per-vertex src), lit edges via
                        vertex colours (also on the emission), shadow drawn on the shirt (flapShadow).
                        3D + DETAILS (the AI decides, the code builds): POST /api/ngl/details (shared/details.js: the vision
                        model fills a fixed vocabulary — collar style, closure + button count/colour, placket, pockets, cuffs,
                        hem, fabric material/finish/pattern/weight, colours, what's shown inside, accessories). shell.js makes
                        the garment a real piece of fabric: triangles refined along the outline and where the edge bands step,
                        cut on the alpha (marching triangles, shared crossing points), outer + inner faces + a rim on every
                        edge (vertex = mix of body vertices: weights, morphs, suit offset). layer.js edgeBands: a chamfer
                        distance-to-edge field per chart raises folded edges by the sheet (collar + lapels, placket, hem,
                        rolled/hemmed cuffs). details.js findButtons: the sheet's count, measured on the photo (contrast vs
                        the fabric around, top-hat so a tee beside them doesn't swallow them, round, in a vertical line);
                        buildAnchored rides 3D domed 4-hole buttons on the shirt. Material: photo de-lit lightly + relief
                        normal map (fabric.js), finish → roughness/sheen tinted by the fabric's colour, the photo's own light
                        as emission (0.55) so a dark print reads as in the shot. Thickness from the sheet's fabric weight.
  src/services/         api/auth/local/wardrobe: garment-pipeline client
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
- URL shortcuts: `?model=male|female&pose=hips&scene=city&view=three`. `window.__3dg` exposes `{stage, human, state, takeShot}`.
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

## Garments from photos (the combined pipeline)
`web/src/garments/pipeline.js` `garmentsFromPhoto(human, image, { describe, pattern, designs, models })` runs every system:
parse.js (SegFormer clothes parsing, hem length measured on the wearer) → NGL words (`POST /api/ngl/describe`, Cloudflare) →
`POST /api/ngl/pattern` with the ChatGarment design when there is one (`server/py/combine.py`: ChatGarment's cut, our measured
lengths, sleeves/neckline voted with NGL, every value validated against GarmentCode's schema; `py/pattern.py` sizes it to the body)
→ sew.js (sewn + draped, textured from the photo; bake.js) + TRELLIS.2's fitted 3D model when there is one (mesh3d.js: its look
on the unseen sides and its relief).
Before sewing: clean.js takes off what isn't the garment (NGL `on_garment` + always necklace/chain/hand/hair/bag strap: CLIPSeg,
a thin-jewellery detector, skin openings; in the app CLIPSeg is off and underIn() finds a garment worn underneath by colour down the
centre front) and fill.js (or LaMa, `painter: 'lama'`) paints the fabric back; the wearer's sex (NGL made_for/worn_by, CLIPSeg
fallback) picks the model. After sewing, photofit.js measures hem / sleeve / leg on the photo against ViTPose keypoints (a top's hem
against the widest-hip level, which is where COCO hips sit — our rig's hip joints are ~10 cm higher) and re-cuts the pattern until
the model matches. AIpparel's pattern (`specs`, py/pattern.py `spec`) is a per-zone candidate: used only if its panels are the right
kind (it reads nearly everything as a dress) and it measures closer to the photo than the fitted ChatGarment/NGL pattern.
Fit: GarmentCode's plain `Shirt` is a box, bust-wide down to the hem; py/pattern.py `shape_waist` curves a fitted/tight top's
side seams in to the waist girth and moves the hem corner in to the hips (+ease), and combine.py never cuts a fitted top looser
than NGL's width. sew.js then hugs fitted/tight/skinny garments (knit negative ease: crosswise rest lengths of stretch + bend
shrink 5–8 %, sleeves excluded — shrunk against an armhole that isn't, they gather) and settles them on the body.
Garment meshes: fit.js `finish` winds every triangle to face away from the body (sewn back panels are mirrored fronts; the half-
bright inside layer showing made white read grey). Sleeves take their own arm's skin weights, and the arm under a sleeve is
sunk deep (`deep` in Body#setHidden): an arm resting on the side leaves the sleeve no room and would show through it.
GPU models run on Kaggle: `python tools/garment_ml/kernel.py push <model> <photos>` (chatgarment, aipparel, hunyuan3d; trellis2
has its own tools/garment_ml/trellis2/kernel.py) — every download shows % on https://ntfy.sh/<topic>, files SHA-256 checked.
KAGGLE_API_TOKEN only in the shell, never in files. Results for the test photos: tools/garment_ml/{chatgarment,aipparel}/results.
AIpparel on a T4: its 27 GB checkpoint is loaded memory-mapped onto a meta-device model in fp16 and split over both GPUs;
transformers 4.31 needs a real `tokenizers` (without it LLaVA's AddedToken entries become 3 new tokens and every garment token
id is off by 3): tokenizers 0.15.2 with the version table relaxed. The vision projector comes from LLaVA-1.5's second shard.
Hunyuan3D 2.1 (tools/garment_ml/hunyuan3d; its shapes face +z, y up, like glTF) is a second 3D model per zone after TRELLIS.2:
`models[zone]` is a list, best first, and the first that `isVolumetric` (depth ≥ ⅕ width — a cut-out with holes can come back as
a flat relief of the photo) gives the relief; an untextured one gives relief only. Its PBR paint needs custom_rasterizer (built
non-editable; import torch before it: libc10) and the mesh painter (extension suffix from sysconfig: no python3-config on
Kaggle); `STAGE=paint KERNEL_SOURCES=3dgarments-hunyuan3d` textures the last run's shapes.
GarmageNet: no pretrained weights are published (training code only); its dataset (Style3D/GarmageSet) is gated on HF.

## Roadmap / ideas
- Clothing: front/side/back garment photos → garment fitted on the human (body-surface projection + cut-out textures; `garments.back_texture_path` exists)
- Better segmentation for busy backgrounds (e.g. a segmentation model or Cloudflare Images `segment=foreground`)
- Long hair (hair cards), eye colours, direct-manipulation posing (click a joint + gizmo), ambient occlusion pass
- Save/load models and outfits to the cloud (`/api/me/outfits` exists)
