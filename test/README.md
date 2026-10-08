# /test: 3dGarments Lab

This is the workbench for the **3D human, rig and poses**.

The lab runs the real app modules directly (`web/src/human/*`, `web/src/scene/*`) and serves `web/public`, so it holds no copies. Anything you build or fix here ships in the app, and the lab only adds debug tools on top.

```bash
cd test && npm i && npm run dev      # http://localhost:5174   (?gender=male, ?view=portrait)
                                     # /view.html?file=./body/male.glb&clay=1 — raw model viewer
```

## What's in it
- **Model**: the studio's controls (female/male, width in cm, height in in, skin).
- **Pose**: the pose presets, plus a per-bone editor (flex / twist / side in each bone's anatomical frame). The live pose JSON appears under the sliders, ready to paste into `poses.js`.
- **Debug**: skeleton overlay, wireframe, skin-weight view for the selected bone, turntable, camera views.
- **Stats**: FPS, draw calls, triangles, asset load time, reshape time, height.

## Where to edit
| Want to change | File |
|---|---|
| Models, skeleton, weights, width morph | `assets/*.fbx` → `tools/body/prepare.py` (then rebuild the GLBs) |
| Pose zero, pose application, hang solver, width/height, feet-on-floor | `web/src/human/human.js`, `web/src/human/rig.js` |
| Body material (clay / skin) | `web/src/human/materials.js` |
| Standing pose, hands | `web/src/human/poses.js` |
| Lights, studio backdrop, camera views | `web/src/scene/stage.js` |

`window.__lab` exposes `{ stage, human, THREE, composePose, POSES, setPose }`.
