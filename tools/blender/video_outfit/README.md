# The video's outfit (sweatshirt + joggers), built live on our body

Following SCULPT_METHOD.md step by step. The whole outfit from scratch (or from a step on):

    python3 tools/blender/video_outfit/run_all.py [first_step]

or one file at a time inside the live session: `python3 tools/blender/send.py -f tools/blender/video_outfit/<file>`.

Blender runs with its UI on a virtual display, and the site is connected (?blender=1) so the body is there:

    Xvfb :55 -screen 0 1920x1080x24 -nolisten tcp &
    DISPLAY=:55 blender --enable-event-simulate -P tools/blender/live.py

| file | video step |
|---|---|
| 0_landmarks | measures the rest-pose body (crotch, waist, hip, leg); sets up a MatCap front view |
| 1a–1d | pants: box blockout + extruded leg + mirror → loop cuts + Shrinkwrap 0.01 + Subdivision → waistband/cuffs tight, legs loose (each leg on a smooth tube around the leg's convex outline, the vertices relaxed evenly over it; the crotch bridged across the thighs and split below the slot between them; every point ≥ 5 mm off the body) → Grab brush strokes |
| 1e–1f | sweatshirt: torso box + sleeves extruded along the arm → loop cuts + Shrinkwrap 0.026 + Subdivision → cuffs, hem band and neck rib tight, body blousing, sleeves loose |
| 2a | Mirror applied, Multires ×2, sculpt symmetry X |
| 2_* | PRIMARY folds (video 6:45–8:10), real Draw brush strokes (Ctrl = valleys, Shift = smooth): forearm bunch front/back, elbows, hem blousing (front/back/side), armpit drag folds; pants: cuff bunch front/back/side, knees, crotch drag |
| 3a, 3_* | SECONDARY (video 8:15–10:45): Multires +1, Crease Polish seams (hem band, cuffs, shoulder, side seams, waistband, neck rib), pocket slash (+ Ctrl) |
| 4a | finalize: Multires baked at level 2, every point of the outside ≥ 7 mm off the body (a deep valley can't push it behind its own inside layer: the black holes) |
| 4 | Solidify 5 mm (offset −1, rim fill, shell/rim groups) → Smooth rim (0.5×7) → Smooth shell (0.5×9) |

Brush batches go through the driver, which plays strokes one at a time: `python3 tools/blender/video_outfit/drive.py
tools/blender/video_outfit/2_b1_sleeve_front.py`. A stroke's brush settings act when its events run, not when they are
queued, so the driver waits for each stroke to finish (the depsgraph is quiet for 0.4 s) before setting up the next.

Lessons:
- Blender 4.5's replayed strokes do nothing; simulated mouse input works.
- The splash screen eats input: close it.
- Stabilize Stroke loses fast simulated drags: don't use it.
- Cut the neckline in the blockout, never after sculpting.
- Stream Multires level 2 to the site, not the sculpt level (about 90 k vertices per garment).
- Fabric spans the body's hollows, it doesn't follow them. Nearest-surface offsets copy every dent (knee, shin, the
  slot between the thighs) as a crease; per-slice convex outlines don't.
- The thighs leave a 1–3 cm slot from the crotch up to the perineum: no room for two layers of fabric, so the legs
  split below it. Check the crotch with cross-sections of body + garment, not only renders.
- A smoothing pass that stops at a hard height leaves a ledge there: fade every pass in and out.
- On the site each garment vertex blends the bone weights of the 6 nearest body vertices and the weights are smoothed
  over the garment (one nearest vertex tore the fabric at the armpit when the arm moved).
