# /test: 3dGarments Lab

This is the workbench for the **3D human, rig and poses**.

The lab runs the real app modules directly (`web/src/human/*`, `web/src/scene/*`) and serves `web/public`, so it holds no copies. Anything you build or fix here ships in the app, and the lab only adds debug tools on top.

```bash
cd test && npm i && npm run dev      # http://localhost:5174   (?gender=male, ?view=portrait)
```

## What's in it
- **Body**: every macro slider (gender, age, muscle, weight, height, proportions, bust, ethnicity).
- **Pose**: the pose presets, plus a per-bone editor (flex / twist / side in each bone's anatomical frame). The live pose JSON appears under the sliders, ready to paste into `poses.js`.
- **Debug**: skeleton overlay, wireframe, skin-weight view for the selected bone, turntable, camera views.
- **Stats**: FPS, draw calls, triangles, asset load time, reshape time, height.

## Where to edit
| Want to change | File |
|---|---|
| Mesh, targets, rig, weights, painted masks | `tools/human/build.py`, `tools/human/paint.py` (then rebuild) |
| Body morphing, skeleton fitting, skinning, feet-on-floor | `web/src/human/human.js` |
| Macro slider maths (MakeHuman port) | `web/src/human/modifiers.js` |
| Skin, eyes, lashes, underwear shaders | `web/src/human/materials.js` |
| Hair styles and shader | `web/src/human/hair.js` |
| Pose library, hands | `web/src/human/poses.js` |
| Lights, backdrops, HDRIs, camera views, capture | `web/src/scene/stage.js` |

`window.__lab` exposes `{ stage, human, THREE, composePose, POSES, setPose }`.
