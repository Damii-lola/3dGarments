# The video's outfit (sweatshirt + joggers), built live on our body

Following SCULPT_METHOD.md step by step. Run each file in order inside the live session:

    python3 tools/blender/send.py -f tools/blender/video_outfit/<file>

Blender runs with its UI on a virtual display, and the site is connected (?blender=1) so the body is there:

    Xvfb :55 -screen 0 1920x1080x24 -nolisten tcp &
    DISPLAY=:55 blender --enable-event-simulate -P tools/blender/live.py

| file | video step |
|---|---|
| 0_landmarks | measures the rest-pose body (crotch, waist, hip, leg); sets up a MatCap front view |
| 1a–1d | pants: box blockout + extruded leg + mirror → loop cuts + Shrinkwrap 0.01 + Subdivision → waistband/cuffs tight, legs loose → Grab brush strokes |
| 1e–1f | sweatshirt: torso box + sleeves extruded along the arm → loop cuts + Shrinkwrap 0.026 + Subdivision → cuffs, hem band and neck rib tight, body blousing, sleeves loose |
