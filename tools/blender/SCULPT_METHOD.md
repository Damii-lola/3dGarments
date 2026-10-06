# THE method: sculpting clothes on the body (from "Step By Step – Sculpting CLOTHS In Blender")

The owner's chosen way of making clothes. It was learned VISUALLY from the video (13:02, watched frame by frame
every 5 s; the frames are in the scratchpad). Outfit in the video: a loose crewneck sweatshirt + jogger pants on a
stylised male, T-pose.

**Setup in the video:**
- Blender **4.5.3 LTS**, Sculpting workspace, Solid shading with MatCap; the garment objects' viewport colour is
  orange (Object colour) so cloth reads against the grey body.
- The garments live in their own "Cloth" collection.
- Add-ons: **Extra Mesh Objects** (its Round Cube sits in the Quick Favorites menu, Q) and **Screencast Keys** (the
  on-screen key overlay, recording only).
- Everything else is built in.

**Installed here:** Blender 4.5.3 at /opt/blender/blender-4.5.3-linux-x64 (`blender` on PATH). Extensions
`extra_mesh_objects` + `screencast_keys`, installed and enabled:

```
blender --online-mode -c extension sync
blender --online-mode -c extension install --enable <id>
```

with `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` behind the proxy. Sculpt brushes need a real 3D viewport, so for brush
work Blender runs WITH its UI on a virtual display: `xvfb-run -s "-screen 0 1920x1080x24" blender -P …`.

---

## Step 1: block out the clothes (0:15 – 6:40): low-poly boxes, mirrored, shrink-wrapped onto the body

### Pants (0:15 – 3:50)

1. Add a **Cube**. In Edit mode, scale it to a box around the hips (front view: from the waist to the crotch, as wide
   as the hips).
2. Delete the faces of the −X half: we model one side. **Extrude** the bottom face of the leg down to the ankle
   (E, Z). Scale and move the box so it follows the leg, slightly wider than it.
3. **Mirror modifier**: axis X, **Clipping on**, Merge 0.001 m.
4. **Loop cuts** (Ctrl+R): several around the leg's length (about 8 rings down the leg) and vertical ones around it.
   The result is a grid of roughly square quads.
5. **Delete the inner faces** where the leg meets the other leg, and the top/bottom caps. The leg is an open tube
   joined to the hip box.
6. **Shrinkwrap modifier**: Wrap Method Nearest Surface Point, Snap Mode **On Surface**, Target = the body, Offset
   **0.01 m**. The box snaps onto the body.
7. **Subdivision Surface**: Catmull-Clark, viewport level 1 (render 2).
8. Apply them in order (Shrinkwrap, then Subdivision; the Mirror stays live). The blockout is now a smooth-ish quad
   mesh hugging the legs.
9. Edit mode, X-ray (Alt+Z):
   - add loop cuts for the **waistband** and the **ankle cuffs**;
   - scale the leg's rings OUT so the pants stand off the leg (loose joggers);
   - keep the cuff rings tight to the ankle.
10. **Sculpt mode, Grab brush** (G; big radius, about 130–230 px, strength 0.4): drag the silhouette out at the
    thigh and calf, and pull the fabric down so it bunches above the cuffs. Reference image of real joggers beside
    the viewport.

### Sweatshirt (3:50 – 6:40)

1. A new **Cube** at the chest, scaled to the torso box (shoulders to the hip).
2. Loop-cut it. **Extrude** the side faces outward along the arm (E) into a **sleeve box down to the wrist**: the
   sleeve continues the body box, it is not a separate tube.
3. Delete the faces at the neck, the bottom and the sleeve ends.
4. **Mirror** (X, clipping).
5. **Inset** the neck face to make the neck hole (I), then move its rim up and in.
6. Loop cuts across the sleeve (elbow, cuff) and the body (hem band).
7. **Shrinkwrap** to the body, Nearest Surface Point, On Surface, Offset **0.026 m** (a loose top stands further
   off than the pants).
8. **Subdivision** (Catmull-Clark 1). Apply the Shrinkwrap and Subdivision.
9. Edit mode:
   - add loops for the **cuffs** and the **hem rib band**;
   - shape the neck;
   - scale the sleeve rings out, keeping the cuffs tight;
   - pull the hem band in so the body **blouses over it**.
10. Viewport colour orange, then **Sculpt Grab** (big radius) to shape the volumes:
    - the sleeve drooping and bunching above the cuff;
    - the body ballooning over the hem band;
    - the shoulder seam sitting dropped onto the upper arm.

## Step 2: sculpt the PRIMARY forms (6:45 – 8:10)

1. **Apply the Mirror**.
2. Add **Multires**, then **Subdivide** (Catmull-Clark) to level 2–3.
3. **Draw brush** (radius about 50–70 px, strength 0.5):
   - normal strokes raise the fold ridges;
   - **Ctrl** = subtract, which carves the valleys between them;
   - **Shift** = smooth.

Big, readable folds where real cloth gathers:
- **sleeves:** stacked rings at the elbow and a heavy bunch above the cuff (several rings);
- **body:** the blouse overhanging the hem band (a deep shadowed fold all around), a few diagonal drag folds from
  the armpit;
- **pants:** the bunch stacking above the ankle cuffs (deep, many rings), soft folds at the knee and from the crotch.

Pants Multires up to level 3–4 for more resolution.

## Step 3: sculpt the SECONDARY details (8:15 – 10:45)

1. Multires to level 4–5.
2. **Crease Polish** brush (radius about 30–60 px, strength 0.25–0.4) with **Stroke ▸ Stabilize Stroke on**: the
   stroke lags behind the cursor and comes out smooth. Use it to:
   - carve **seam lines**: the side/inseam of each pants leg, the line where the cuff band meets the leg, the
     waistband line;
   - carve the **pocket opening** (a curved slash on the front of the thigh, deepened with Ctrl);
   - carve the sleeve and shoulder seams, the cuff seams, the neck rib line, and the hem band line.
3. **Draw**, with Ctrl, sharpens the main fold valleys: the stacked rings at the cuffs get crisp undercuts.
4. Small pinches and secondary wrinkles between the big folds, kept fewer than the primaries.

## Step 4: thickness and clean edges (11:00 – 12:50)

Isolate the garment (/ = local view).

1. **Solidify**:
   - Mode Simple;
   - Thickness 0.01 m, reduced to **0.005 m** at the end;
   - **Offset −1** (it grows inward);
   - **Rim Fill on**;
   - **Output Vertex Groups**: Shell = `shell`, Rim = `rim`. Create both empty groups first (Object Data ▸ Vertex
     Groups).
2. **Smooth modifier** (factor 0.5, repeat 7), vertex group **`rim`**: rounds the cut edges (neckline, cuffs, hem)
   so they read as a soft folded fabric edge instead of a hard box rim.
3. **Shade Smooth**.
4. A second **Smooth** (factor 0.5, repeat 9), vertex group **`shell`**: softens the faceted inner surface.
5. Final modifier stack: **Multires → Solidify (shell/rim groups) → Smooth (rim) → Smooth (shell)**.

---

## How we use it here (live, on the site's body)

- Blender 4.5 with its UI under Xvfb runs tools/blender/live.py. The body is the site's own (shape key 'site').
  The garments go in the Garments collection and stream to the site as they are modelled.
- Each step above is scripted with real operators:
  - edit-mode ops (bmesh) for the blockout;
  - the modifiers as in the video;
  - **brush strokes with bpy.ops.sculpt.brush_stroke** in the 3D viewport's context (Grab / Draw / Crease Polish,
    with the same radii, strengths and Stabilize Stroke). The stroke paths follow the body's landmarks (cuffs,
    elbows, hem band, seams), not hand-placed points.
- Checked by rendering the Blender viewport and the site, and by measuring against reference photos (KNOWLEDGE §6).
