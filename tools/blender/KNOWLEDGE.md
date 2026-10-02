# Making clothes in Blender on a body: what we learned

This file collects how clothes are made and fitted in Blender. It is the reference for every garment template we build
there (tools/blender/*.py, run headless: `blender -b -P script.py -- args`). Blender 4.2.3 LTS is installed at
/opt/blender/blender-4.2.3-linux-x64.

Sources:
- the Blender 4.2 manual: cloth, collision, cloth sculpting, modifiers (armature, surface/mesh deform, shrinkwrap,
  smoothing, data transfer, mask, solidify, remesh), UV seams/mapping, skinning;
- Blender's own cloth presets;
- tutorials: timcoster (sewing a shirt), katsbits (cloth basics), renderguide (cloth settings), odederell3d (sewing
  springs), Roger's sewing wiki, "A Tailor's Approach" (pattern-first course), BlenderNation (pants), Blender Studio
  clothing shapes (fitting to body variants);
- the open-source add-ons: opensew-2 "Clothing Design" (GPL-3: pattern drafting → sew → weld → settle, read in full),
  cloth-lab, Garment Tool's docs.

**The one rule every source agrees on: a garment is CUT FROM FLAT PATTERN PIECES, SEWN, and DRAPED by the simulation.**
Shapes made by pushing the body's skin outward (what we did in skinwear.js) never hang like cloth. Folds, the hang
below the chest and the sleeve's flare all come from flat fabric meeting a round body under gravity.

---

## 1. The pipeline (garment on a body, end to end)

1. **Body.** Export the app's body in a pose with the arms away from the torso: an A-pose with arms about 45° down.
   Cloth sewn in a pose with the arms at the sides traps cloth between arm and torso. Units are metres. Add a
   **Collision** modifier to the body, its underwear and any garment already worn under this one.
2. **Pattern.** Draw each piece flat, in metres, as a closed outline split into named edges (side_L, shoulder_L, arm_L,
   neck, hem…). The pieces for each garment are in §4.
3. **Mesh each piece.** Use a structured quad grid clipped to the outline (spacing 1.2–2 cm): a regular grid follows the
   fabric's grain, so the cloth stretches the way woven or knit fabric does. Snap boundary vertices onto the outline,
   respace them evenly along each named edge, then smooth the interior a few times. Do NOT use a random
   triangulation: it stretches the same in every direction and wrinkles look like crumpled paper.
4. **Place the pieces around the body**, not flat in front of it:
   - Torso panels wrap by ARC LENGTH around the body's cross-section at each height, at radius + ease (1.4–3.6 cm).
     Clamp the wrap at ±95° from the panel's centre: past that the panel leaves the body tangentially instead of
     wrapping onto the opposite side.
   - Above the shoulder joint, hold the cross-section at the shoulder's size. The panel floats over the shoulder and
     the simulation drops it onto the shoulders, where a collar belongs. Mapped onto the neck, it would wind around
     the throat.
   - Sleeves wrap around the arm's axis with ONE reference radius (taken at the piece's centre). A local radius makes
     the tube spiral as the arm tapers, and self-collision then shreds it.
   - Place the sleeve so its UNDERARM line sits at the armpit. The cap rises above that line. Anchoring the sleeve's
     centre at the armpit hangs it a third of the way down the arm and leaves the shoulder bare.
5. **Sewing edges.** Each seam is a set of LOOSE EDGES (edges with no face) joining vertex i of edge A to vertex i of
   edge B. Both edges are resampled to the same vertex count, and the pairing is flipped when the two run opposite
   ways. In the cloth modifier: Shape → **Sewing** on, Max Sewing Force 0 (unlimited) or about 5–50 to soften it.
6. **Stitch (phase 1):**
   - Run gravity at ×0.15 for about 25 frames. The sewing springs pull the panels together around the body.
   - Pin the collar band (torso vertices above the shoulder line −1 cm) with a vertex group as Pin Group, pin
     stiffness 25. This is the tailor's hand holding the shoulders on the dress form. Without it, the sleeves' cap
     seams drag the whole top down the body.
   - At 60 % of the stitch phase, keep only the BACK collar pinned, so the front can draw in to the neck.
7. **Weld (phase 2):**
   - Apply the cloth's current shape (bake it as the mesh) and remove the cloth modifier.
   - Merge every sewing edge's two ends at their midpoint, following the seam explicitly (union-find), with a maximum
     gap of 4.5 cm. Distance merging alone leaves the wide stitches open.
   - Push any vertex closer than 2 mm to the body back out to 3 mm. A midpoint across a body ridge, such as the collar
     over the trapezius, lands inside the body, and a cloth vertex that starts inside a collider is trapped there for
     good.
   - Add a FRESH cloth modifier with **Shrink Min = take-in** (0.05 is the default; more gives a closer fit, negative
     eases it out).
   - Step onto the current frame once (`scene.frame_set(scene.frame_current)` + evaluate) so the new solver
     initialises from the mesh. Blender keys the point cache by modifier NAME: a rebuilt "Cloth" reads the old cache,
     which has a different vertex count, and the garment drops off the body in one step.
   - Why weld at all: without it the sewing springs keep pulling for the whole simulation and crush the garment into
     wrinkles.
8. **Settle (phase 3):** unpin, gravity ×1, 50 frames.
9. **Relax (optional finish, outermost garment only):**
   - Bending stiffness 2, take-in 0.06, 60 frames.
   - Bake that as the rest shape, lift the garment off the layers under it (7 mm), then bending 8, shrink 0, 90 frames.
   - Why: the weld bakes the ballooned mid-drape shape as the rest shape. At full stiffness the bending springs HOLD
     that shape, and settling never lays the garment down (measured: 150 extra frames moved the chest by 1 mm).
   - Do not relax trousers, skirts or jumpsuits: softening slides the waistband down. Do not relax inner layers either:
     the collar rolls up the neck.
10. **Finish.** Use this modifier order: **Armature → Cloth → Subdivision → Solidify**.
    - Subdivision: 1 in the viewport, 2 at render.
    - Solidify: thickness 1.5 mm (jersey 1–1.5 mm, denim 2–3 mm, coat 4–6 mm); offset −1 (it grows inward) or +1.
    - Hide the subsurf and solidify while simulating (the "cage" is what the solver and the other layers see).
11. **Rig it for animation and poses:**
    - Copy weights with **Data Transfer** (Vertex Data → Vertex Groups, mapping "Nearest Face Interpolated",
      POLYINTERP_NEAREST, all source groups by name), then apply.
    - Smooth the weights about 20 × 0.5 over the garment's own edges, drop weights under 1e‑4, and normalise.
    - Add an Armature modifier ABOVE the cloth.
    - Raw nearest-skin weights make a sleeve tear at the armpit; smoothed weights stretch it.
12. **Export.**
    - glTF/GLB with skin and shape keys, or OBJ for us to bind in the app.
    - OBJ with `forward_axis='Y', up_axis='Z'` keeps the app's y-up coordinates unchanged.
    - Then set the scene's gravity to (0, −9.81, 0) so it points down −y.

## 2. Cloth simulation settings (the manual, translated)

**Physical properties**

| setting | what it does | tee (jersey) |
|---|---|---|
| Vertex Mass | kg per vertex-share; heavier hangs straighter, stretches more | 0.25–0.3 |
| Air Viscosity | slows free fall/fluttering | 1–1.6 |
| Bending Model | Angular (real per-edge bending, use this) vs Linear (old, faster, no compression) | Angular |
| Tension / Compression | stretch along and against edges; compression low = buckles easily (fine wrinkles) | 15 / 15 |
| Shear | diagonal stretch; low = the grain skews (drapes diagonally) | 5–8 |
| Bending | **the strongest control over how many folds**: low = many fine folds, high = few broad ones | 0.5–2 |
| Damping (tension/compression/shear) | kills jitter; high values look like syrup | 5–15 |
| Bending damping | | 0.5 |
| Internal Springs | pressure-like springs across a closed volume (plush toys); not for clothes | off |
| Pressure | inflates closed meshes (balloons, cushions); not for clothes | off |

**Shape**
- **Pin Group**: a vertex group of weights; 1 = fixed to the animated mesh. Pin Stiffness controls how hard.
- **Sewing**: loose edges pull together. Max Sewing Force limits it.
- **Shrinking Min/Max** with a vertex group: shrinks the rest lengths. A positive value makes it tighter. Use a vertex
  group to take in only some regions; for example, the chest/shoulders tight with the hem free.
- **Dynamic Mesh**: the rest shape follows modifiers above the cloth. Use it when shape keys change the garment under
  the sim.
- **Shape Key** (rest shape key): the cloth's rest shape taken from a shape key, so a garment can be sewn flat but
  rest round.

**Collisions (on the cloth)**
- Quality: 4 lets a collar tunnel into the neck when the pin releases; 6 catches it.
- Distance (min): 3–5 mm. This is the gap the cloth keeps from colliders. Too small and it pokes through; too large and
  it floats.
- Impulse clamping: stops explosions when a vertex starts inside a collider.
- Self collisions: on for anything that folds. Distance 0.5× the body distance (≥ 1 mm), friction 2–5, Vertex Group to
  limit it.
- Collision **Collection**: the cloth collides only with objects in it. Use one collection per layer:
  - layer N collides with the body + layers < N;
  - the inner layers do NOT collide with the outer ones (one-way);
  - otherwise the inner shirt pushes the jacket off and the jacket crushes the shirt.

**Collision (on the body/collider object)**
- Thickness Outer: 2–5 mm. Thickness Inner: 1–2 cm (catches cloth that has gone a little inside).
- Friction: 5–15 for skin; 60 to keep a garment from sliding.
- Damping 0.3.
- Single Sided: on for open meshes (the cloth is pushed to the normal side).
- Override Normals: for non-manifold bodies.

**Cache**
- Frame start/end, then Bake.
- A cache start frame of 1 with gravity on means the cloth falls from frame 1.
- To start pre-shaped, apply the cloth at a frame (Apply modifier keeps that frame's shape) and resimulate.

**Quality**
- Steps per frame: 5 for simple drapes, 10–15 for tight, sewn, colliding garments.
- More steps is the fix for poke-through, not more collision distance.

**Field weights**
- Gravity factor: animate 0.15 → 1 for stitching.
- Wind and turbulence force fields only matter for stylised motion.

**Blender's presets** (quality, mass, tension = compression = shear, bending, damping):

| preset | quality | mass | stiffness | bending | damping |
|---|---|---|---|---|---|
| Cotton | 5 | 0.3 | 15 | 0.5 | 5 |
| Denim | 12 | 1.0 | 40 | 10 | 25 |
| Leather | 15 | 0.4 | 80 | 150 | 25 |
| Rubber | 7 | 3.0 | 15 | 25 | 25 |
| Silk | 5 | 0.15 | 5 | 0.05 | 0 |

**opensew's fabrics** (all use quality 7–14 with collision quality 6):

| fabric | tension | compression | shear | bend | mass | damping | take-in |
|---|---|---|---|---|---|---|---|
| CRISP (tailored, few big folds) | 20 | 120 | 8 | 25 | 0.28 | 1.6 | 0.05 |
| SOFT (jersey, clings, fine folds) | 15 | 15 | 5 | 0.5 | 0.30 | 1.0 | 0 |
| STIFF (denim) | 25 | 200 | 15 | 60 | 0.45 | 1.8 | 0.03 |
| LIGHT (silk) | 12 | 8 | 3 | 0.15 | 0.15 | 1.0 | 0 |

**Their cloth damping**: tension 15, compression 15, shear 5, bending 0.5.

**Their collision**: distance 4 mm, damping 0.3, friction 15, self 2 mm with friction 2. The body collider uses outer
2 mm, inner 2 cm and friction 60.

## 3. Fitting: how a garment fits PERFECTLY

**Ease** is the gap between garment and body: chest girth × (1 + fit). A tee uses fit 0.10–0.14. Our reference tee
(photos 34–38): body ~1.09–1.14 shoulder widths across at the chest, straight down; see the metrics in §6.

**Tight at the top, loose at the bottom** (our tee spec) comes from the pattern, not from pushing:
- shoulders and chest cut to the body's measurements (small ease), the hem cut to the hip + ease;
- take-in (shrink) via a vertex group over the shoulders/chest only;
- gravity then lets the straight side seams hang below the chest.

**The armhole** (opensew's drafting, the part everything depends on):
- Depth = the shoulder line down to the armpit + 3 cm (anatomy, not solved from a length). Allow up to 10 cm deeper
  only if the sleeve can't fit; then buy any remaining length SIDEWAYS (scye extension ≤ 5 cm).
- Too deep and the sleeve can't reach it: the seam never closes and the shoulder is bare.
- The shoulder seam must reach the shoulder tip (acromion). A seam that stops short leaves the deltoid outside the
  panel, so the top of the arm is bare between the body and the sleeve.

**The sleeve, drafted the way a tailor does it:**
- Width = biceps girth × 1.06 (never more than 0.82 × the armhole length).
- Then SOLVE the cap height so the cap curve measures the armhole × 1.02 (a little ease over the head).
- The other way round (a shallow cap made wide until it measures) gives a wide droopy tube with a flat head. That is
  exactly what "sleeves look separate" means.

**The neck:**
- Width from the neck girth × 1.12.
- Front depth 6.0 cm (man) / 7.5 cm (woman); back depth 2.2 cm.
- Under-cut necks ride up the throat. A deep V has nothing to catch on and the garment slides down until the armholes
  stop it.

**Hem length:**
- Cut 3–6.5 cm longer than wanted: the stitch phase hoists a top a few cm.
- Long sleeves get +8 %: they bunch at the elbow.

**Fitting a finished garment to other body shapes** (our sliders):
- **Surface Deform** modifier: bind the garment to the body at its base shape. Every later change of the body (shape
  keys, width morph) carries the garment with it, keeping the offset.
  - Use it for body variants. Blender Studio uses this, plus a per-variant corrective shape key.
  - Bind with Falloff 4, Strength 1. Use a vertex group to leave loose parts (a skirt's hem) to the sim.
- **Mesh Deform**: a cage around the body drives the garment. It is smoother over big changes but needs a closed cage.
- **Shrinkwrap**: snaps to the surface (Nearest Surface Point / Project, Offset = gap, "Outside Surface"). Good for
  skin-tight parts such as leggings, cuffs and waistbands; it makes NO folds. Use it with a vertex group for just the
  tight zone, then sim the rest.
- **Corrective Smooth** after any deform: removes the creases a deform adds, relative to the rest shape.
- **Laplacian Smooth** smooths the shape itself (volume preserve on).
- Re-simulate per shape when the change is large: a heavy body's tee hangs differently from a slim body's.
  - Our app uses CPU morphs: either export shape keys of the garment (per body morph, made with Surface Deform), or
    bind in the app (bindToBody + unskin), as the old shell templates did.

**Layering:**
- Dress from the inside out: trousers, then the top untucked over the waistband, then the jacket.
- Each layer's collision collection = body + inner layers. Lift each new layer at least 7 mm off the one under it
  before settling.
- An inner top sewn under the trousers leaves its hem beneath the waistband.

**Never let skin poke through:**
- Use enough quality steps and a collision distance of at least 3 mm.
- Sink or hide the skin under the garment (we discard it in materials.js), or delete it with a **Mask** modifier
  (vertex group of covered skin, inverted).

## 4. The pattern pieces for every garment type (opensew drafts, MAN figure)

Man figure:
- neck front 6.0 cm, back 2.2 cm;
- shoulder drop 4.5 cm, shoulder point at full width;
- tops cut +6.5 cm;
- straight side seams;
- hem 0.98 × hip;
- tee sleeve 20 cm, its hem 0.88 × the cap width;
- trouser rise 0.78 (the waistband below the natural waist);
- the shoulder shelf sits 4 cm above the arm joint.

| garment | pieces | seams |
|---|---|---|
| T-shirt | Front, Back (bodice to the hip), Sleeve ×2 (set-in) | sides, shoulders, cap front→front armhole, cap back→back armhole, each sleeve's underarm |
| Tank | Front, Back (deeper neck 8.5 cm, narrow shoulder ≤ neck + 5 cm) | sides, shoulders |
| Jacket | Front_L, Front_R (open front, button stand 2 cm), Back, long Sleeves (arm × 1.08) | + one button seam (lapels above and vent below stay open); ease 3.4 cm |
| Hoodie | Front, Back (split necks), Sleeves, Hood_L/R (neck edge = the neckline it joins / 1.005, height = neck girth × 0.62) | + crown, hood necks; ease 3.6 cm |
| Trousers | Hip yoke front/back + 4 leg panels (top = π·thigh r·(1+fit), bottom = π·ankle r·(1+fit)·1.15) | yoke sides, legs' inseam/outseam, yoke → leg tops (outer part only), crotch seams |
| Skirt | Front, Back trapezoids (top = waist, bottom = top × flare 1.35) | sides |
| Dress | A-line Front/Back from the bodice, hem = hip × flare 1.45 | sides, shoulders (+ sleeves) |
| Jumpsuit | bodice to the crotch with split V hem + 4 leg panels + sleeves | all of the above |

**Bodice outline** (a half of the panel, mirrored), from the shoulder line y = 0 down:
- neck: a bezier from (neck_half, 0) to (0, −depth);
- shoulder: (neck_half, 0) → (sh_x, −sh_drop);
- armhole: a bezier from (sh_x, −sh_drop) to (scye_x, −arm_d), with controls (sh_x + 3.5 cm, −sh_drop − 2 cm) and
  (scye_x, −0.45·arm_d);
- side seam: down to the hem at hem_half (in at the waist for shaped figures);
- hem: straight across.

## 5. Tutorials, distilled

**Sewing a shirt from flat pieces** (timcoster, odederell3d, Roger's sewing wiki):
- Model front/back as flat planes in front of and behind the body and connect edge pairs with faceless edges (select
  two edges → Bridge Edge Loops → delete faces only).
- Cloth with Sewing Springs on, gravity 0 for the first frames, then on.
- Apply the cloth at the frame it looks right, then Remove Doubles over the seams (merge by distance), then
  resimulate with gravity.
- Add Subsurf and Solidify after the cloth. Use Pin Groups for waistbands and collars.

**Pattern-first** ("A Tailor's Approach", Garment Tool):
- Draft the 2D pattern as a curve/mesh to real measurements; label seams; ease; seam allowances are not modelled.
- Grain lines become the mesh's rows.

**Cloth basics and settings** (katsbits, renderguide):
- Scale matters: the sim is physical, so it must run in metres, at true size (a 1.8 m human, not 18 units).
- Check whether a crash comes from too few quality steps or too thin a collider.
- Subdivide the cloth before simulating, not after; aim for even quads.

**Pants** (BlenderNation):
- Leg tubes alone slide off a tapering thigh. The hip yoke or waistband holds them up: pin it or make it tight
  (shrink).

**Cloth sculpting** (Sculpt mode → Cloth brush, Cloth Filter):
- Use it to add or remove folds by hand after the sim.
- Use Pin/Mask to protect areas, and Gravity/Inflate/Expand filters for bulk changes.
- Good for art-directing a finished drape; not reproducible from a script.

**Geometry Nodes simulation zone:** you can write your own solver (custom springs). It is not needed: the built-in cloth
does sewing, shrinking, pinning and collisions.

**UVs for the texture (our PNG "skin"):**
- Every pattern piece IS its own UV island, laid flat exactly as cut. The flat pattern is the UV layout, scaled into
  the atlas, with the grain vertical.
- Seams are the sewing lines, so the texture continues across them correctly if both sides use the same scale (texels
  per metre).
- Mark seams on the sewing lines and unwrap Conformal if a piece was edited after placement.

## 6. Our tee: the target, measured (photos 34/35, in shoulder widths, SegFormer + ViTPose)

| metric | value |
|---|---|
| neck (front drop) | 0.22 |
| hem | ~1.55 |
| body width at 55 % | 1.09 |
| body width at 70 % | 1.10 |
| body width at 85 % | 1.14 |
| body width at 97 % | 1.06 |
| wide0 | 1.44 |
| wide15 | 1.64 |
| sleeve | 0.97 |
| sleeveOut | 0.29 |

Tools in the scratchpad: tplshot.mjs (render), measure.mjs (metrics), tune.sh. Measure; never eyeball.

## 7. Headless scripting notes (bpy, Blender 4.2)

```python
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=..., forward_axis='Y', up_axis='Z')    # app coords unchanged (y up)
scn.gravity = (0, -9.81, 0)
cl = ob.modifiers.new('cloth', 'CLOTH'); s = cl.settings; cs = cl.collision_settings
s.use_sewing_springs = True; s.sewing_force_max = 0; s.bending_model = 'ANGULAR'
s.vertex_group_mass = 'pin'; s.pin_stiffness = 25; s.shrink_min = 0.05; s.vertex_group_shrink = 'tight'
s.effector_weights.gravity = 0.15
cs.collision_quality = 6; cs.distance_min = 0.004; cs.use_self_collision = True; cs.self_distance_min = 0.002
cs.collection = bpy.data.collections['colliders_L0']
body.modifiers.new('col', 'COLLISION'); body.collision.thickness_outer = 0.002; body.collision.thickness_inner = 0.02
cl.point_cache.frame_start = scn.frame_current; cl.point_cache.frame_end = scn.frame_current + 300
for f in range(n): scn.frame_set(scn.frame_current + 1)                # steps the sim (headless OK)
bpy.ops.object.modifier_apply(modifier=cl.name)                        # bake the current shape into the mesh
bpy.ops.wm.obj_export(filepath=..., export_selected_objects=True, forward_axis='Y', up_axis='Z', export_uv=True)
```

- Sewing edges in bmesh: `bm.edges.new((va, vb))` between panels (no face).
- The weld: union-find over faceless edges whose length is under the maximum gap, merged at the midpoint (pointmerge),
  then the faceless edges removed.
- Simulation speed: about 1.6 k quads with self-collision at quality 10 runs about 10 s/frame on this container.
  Keep the cage coarse (1.5–2 cm grid) and subdivide after.

---

## 8. More research (round 2)

**Sources for this round:**
- Sewing With Numbers (three t-shirt drafting methods: Richardson, Aldrich, their own; t-shirt sleeves);
- Melly Sews, The Last Stitch, Elizabeth Made This (knit neckbands);
- t-shirt size specs (Perfect T-shirt Co, Brave Star, Fresh Clean Tees);
- Garment Tool quick start;
- seams-to-sewing-pattern source (artyredd, GPL; cloned and read);
- blender_clothing_tools (whyoh);
- A Tailor's Approach (Blender Artists);
- STYLY's cloth tutorial;
- Nabesaka (cloth for stills);
- Blender Studio "Clothing Shapes";
- the manual's Shape / Collisions / Property Weights pages;
- Marvelous Designer's fabric manual;
- fold-drawing guides.

YouTube refuses this container (bot check), so video courses are known only from their text pages.

### 8.1 Drafting a men's tee the way pattern makers do

**Measurements needed:**
- chest girth, neck girth;
- shoulder length (neck point to shoulder point) and shoulder drop (slope);
- armhole depth (vertical from the shoulder point to the armpit);
- across chest and across back;
- biceps girth;
- the lengths.

"The top hangs from the shoulders. If it hangs unevenly, the fit is off." Shoulder slope and length come from the body's
MEASUREMENTS, not from percentages.

**Ease, knit:**
- zero-ease sloper for stable knit (25 % stretch);
- 2 cm ease = easy fit, 4 cm = loose;
- negative ease = close fitting (shrink in the sim);
- our "normal tee, top bodysuit-close, bottom out": about 0–2 cm ease at the chest, more at the hem (the straight side
  seam from the armpit down IS the "flying out" below the chest).

**Sleeve cap height** (A = armhole depth):

| cap | height | effect |
|---|---|---|
| deep | 0.75·A | sleeve hangs close to the body, arm down |
| medium | 0.66·A | default |
| shallow | 0.5·A | sleeve stands out from the body |

- Knit tees use a shallow-to-medium cap: the sleeve flies out at an angle, as in our reference photos.
- Sleeve width at the underarm: biceps girth (or half the total armhole length per half-sleeve).
- Cap ease 0–3 mm for knits; 12 mm is too much.
- ALWAYS "true" the cap: its curve length = the armhole's length.
- Cap curve: on the diagonal from the cap top to the underarm corner, push 12 mm in at ¼ and 12 mm out at ¾.

**Sleeve variants:**
- fitted (hem tapers);
- loose (vertical underarm, no taper, full biceps width at the hem);
- cap sleeve (shorter).

**Neckband:**
- Rib cut at 70–75 % of the neckline length for stretchy rib, 88 % for firm jersey.
- Folded width 2.5 cm (classic crew; heavier tees 3.5 cm cut / 1.8 cm finished).
- Folded lengthwise; notched at centre back, shoulders and centre front.
- Stretched (the band, not the body) onto the neckline: this pulls the neck in so it hugs the base of the neck.
- In the sim: make the band its own piece, shorter than the neckline, sewn to it. The sewing springs plus its short
  length draw the neckline in like the real thing. Then fold it (two layers), or fake it with a solidify + the edge
  band in the texture.
- Topstitch 3–6 mm from the seam (a texture/normal detail).

**Hems:** sleeve and body hems are turned up 2–2.5 cm with twin-needle stitching. A turned hem is two layers: it hangs
heavier and straighter, and it stays flat. In the sim, use a stiffer and heavier strip along the hem via Property Weights
(Bending group + mass), or a real folded strip.

**Size-M men's tee, real spec sheets** (flat measurements; double the widths for girths):

| measurement | value |
|---|---|
| chest (pit to pit) | 20.5–21 in = 52–53 cm → girth ~105 cm on a ~96–100 cm chest: about 5–9 cm ease for a regular fit |
| length (HPS to hem) | 27.5–29 in = 70–74 cm |
| shoulder seam to seam | 18.25 in = 46 cm |
| sleeve (from the shoulder seam) | 8–8.25 in = 20–21 cm |

**Sewing order** (it matters for a sim that stitches in stages):
1. shoulders;
2. the neckband;
3. sleeves set in FLAT into the armholes;
4. side seam + sleeve underarm in ONE continuous seam (hem to sleeve hem);
5. hems.

This is why a real tee reads as one continuous piece from the body into the sleeve: the underarm seam runs straight
through. Use exactly this topology: the sleeve is not a separate tube.

### 8.2 How folds form (what the sim must reproduce, and what to check)

- Two forces: gravity (fabric falls straight down, soft rounded folds where it is loose) and tension (anchor points pull
  it taut: angular, tight folds radiating from the pinch point).
- Pinch points on a tee: shoulders, armpits, elbows, the waist where it bunches.
- Arm down: folds gather UNDER the armpit and drag lines run from the armpit across the chest/back.
- Arm raised: fabric bunches at the shoulder and stretches across the chest.
- Cotton jersey: soft but structured. Folds are fewer and rounder than silk, sharper than knit fleece.
- MD's fabric model:
  - shear lower than weft/warp → stretchy, clinging (jersey, silk);
  - shear equal to weft/warp → wrinkles easily (woven cotton, denim);
  - buckling ratio near 100 % → bends easily (jersey).
- In Blender terms: low shear, low compression, low bending, for jersey.

### 8.3 Blender features that matter, beyond the basics

**Property Weights** (Physics ‣ Cloth ‣ Property Weights): per-vertex control via vertex groups.
- **Shrinking group + Max Shrinking**: shrink ONLY where painted. This is the tool for "bodysuit-close at the chest and
  shoulders, free below": paint the yoke/chest/shoulders 1 → 0 by the waist, max shrink about 0.05–0.15.
  - Python: `s.vertex_group_shrink='tight'; s.shrink_min=0; s.shrink_max=0.1`. Weight 0 → shrink_min, weight 1 →
    shrink_max.
- **Structural group** (max tension/compression), **Shear group**, **Bending group** (max bending): stiffer hem bands,
  collar, neckband, cuffs.
- **Rest Shape Key**: start the sim from a pre-draped shape key WITHOUT making it the rest state. Apply-as-mesh is a
  "plastic deformation": it relaxes every spring into the draped shape (the ballooning problem). Use it to start from a
  good guess while keeping the flat pattern's true rest lengths.
- **Dynamic Mesh**: the rest shape follows the modifiers above the cloth every frame (stylised squash/stretch). It
  excludes Rest Shape Key.
- **Max Sewing Force**:
  - The manual says 0 (unbounded) is NOT recommended: it is unstable in the first frames while the springs are long.
  - Values seen: 5 (light), 15 (heavy), 20–25 (shirts, A Tailor's Approach / PIXXO).
  - opensew uses 0 but with low gravity and pinning.
- **Speed multiplier** 0.5 (A Tailor's Approach) or 0.1–0.2 (tight collision work): defaults are "way too snappy".
- **Impulse clamping** 25–55 in tight spots: stops explosions.
- Collision distance: 5 mm object / 2 mm self (A Tailor's Approach, Cotton preset shirt; Denim trousers).
- Garment Tool:
  - quality steps above 15 to stop body penetration;
  - collision distance about 2 mm on the cloth AND the body;
  - Initialize Simulation animates gravity 0 → 9.8, sewing force, and Max Shrinking over the first frames.
- Mesh density: about 10 k faces for a shirt at 1:1 scale (A Tailor's Approach). opensew uses a 1.8 cm grid + subsurf.
- Air viscosity 10 + pressure 10 (medium) / 50 (high) with gravity 0 is seams-to-sewing-pattern's "Quick Clothsim". That
  is for plush toys, not clothes.

### 8.4 Getting a garment onto every pose and every body shape

**Poses (Blender manual, rigged cloth):**
- Model or sew in the bind pose.
- The Armature modifier sits ABOVE Cloth; pin groups (waistband, collar) follow the bones.
- Animate from the bind pose to the target pose over several frames (~20–40), and sim through it: the cloth follows.
- Freeze a frame you like with **Cloth ‣ Save as Shape Key** (or apply), then sculpt fixes.
- For stills: pose at frame 150, rest pose at 0, bake to 175–200, pick the frame.

**Body shapes (our sliders), options from best to cheapest:**
1. **Morph the body inside the sim.** Animate the body's shape key 0 → 1 over ~30 frames while the dressed cloth
   simulates, then let it settle. The garment's new shape − its base shape = a GARMENT SHAPE KEY for that body morph.
   - Done per body morph (belly, chest, shoulders, weight…), this gives the garment the same morph targets as the body.
   - Our app already blends morphs on the CPU (cpumorph.js), so the garment just carries its own deltas.
   - This is the closest to "perfectly fits everything".
2. **Surface Deform**, bound at the base shape: carries the garment with the body's surface, keeping the offset (Blender
   Studio does this for secondary clothing). It gives no new folds. A heavy belly pushes the tee out evenly instead of
   stretching it taut, but it is good for small changes.
3. Skin binding (the app's old bindToBody/unskin): the same as 2 with bones, done in the app.
- Blender Studio keeps the corrective shape-key count small: shared masks and drivers blend sculpted displacement per
  bone rotation.
- "Deform to Corrective" (extension) bakes any modifier result (cloth, surface deform) into a corrective shape key with
  the rig live.

### 8.5 Two routes from design to pattern

1. **Pattern first** (tailor, opensew, Garment Tool, clothing_tools): draft flat pieces → place them around the body →
   sew → sim.
   - The pieces' joining edges need MATCHING vertex counts (clothing_tools walks the boundary from one picked vertex per
     side to the next corner, adding one sewing edge per vertex pair).
   - Gaps such as button fronts are left unsewn.
2. **3D first, then flatten** (seams-to-sewing-pattern):
   - Model the garment roughly in 3D, mark seams where it would be cut, then UV unwrap (Conformal/Angle Based).
   - Remesh to an even triangle size (edge = √(area per tri / (√3/4)) × 0.8).
   - Bevel the seams, delete their faces: the bevel's edges become the sewing edges.
   - Each UV island becomes a FLAT piece: the vertex position = the island's mean position + tangent·Δu + bitangent·Δv,
     pushed off along the normal; then rescale so the area matches the 3D area.
   - Sim it: the flat pieces sew back into the 3D shape with real rest lengths.
   - This route lets us start from a 3D tee shaped like the photo and get a true pattern out of it, plus an SVG pattern
     and UVs = pattern pieces.

### 8.6 Finishing for real-time (the web app)

- Keep the sim cage moderate (5–15 k faces). Subdivide or solidify at export or in the app.
- Bake fine wrinkles to a normal map: the high-res sim/sculpt → the low-res mesh, with no large gap between them, MikkT
  tangents, and UV islands padded. Use this when the in-app mesh must be light.
- Simulate the big shapes and folds, then add small hand-sculpted or texture wrinkles on top. Pure sim reads generic.
- Seam/stitch detail lives in the texture (our PNG) or the normal map, not in geometry.
