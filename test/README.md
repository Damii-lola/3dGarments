# /test: 3dGarments Lab

This is the workbench for the **3D avatar, the mannequin and the clothing system**.

The lab runs the real app modules directly, `web/src/scene/*` and `server/src/shared/*`, so it holds no copy of them. Anything you build or fix here ships in the app, and the lab only adds debug tools on top.

```bash
cd test && npm i && npm run dev      # http://localhost:5174
# optional: http://localhost:5174/?demo=dress   (tee | jeans | dress, comma-separated)
```

## What's in it
- **Garments**: load the sample flat-lays or upload your own photos. These are processed in the browser with the same pipeline the API uses.
- **Body**: height, chest, waist and hips, plus the **arm angle** of the pose.
- **Fit**: category override, size and lift for the selected garment.
- **Debug**: wireframe, region colours (shell / sleeve L / sleeve R / leg L / leg R), mannequin and garment toggles, a hide-back-panel toggle, turntable, camera views, and PNG export.
- **Silhouette inspector**: the cut-out with the measurements the wrapper uses drawn on top. It shows the torso edges, the armpit and crotch lines, and each sleeve's axis and width.
- **Stats**: FPS, draw calls, triangle counts, rebuild time, and per-garment wrap mode, scale (m per garment unit) and ease.

## Where to edit
| Want to change | File |
|---|---|
| Body shape, proportions, pose | `web/src/scene/body.js` |
| Mannequin / avatar mesh & material | `web/src/scene/mannequin.js` |
| How clothes wrap (torso, sleeves, legs, drape) | `web/src/scene/wrap.js` |
| Back panel synthesis | `web/src/scene/textures.js` |
| Layering, one-per-slot rules | `web/src/scene/dresser.js` |
| Lights, camera, floor | `web/src/scene/stage.js` |
| Cut-out & measurements | `server/src/shared/silhouette.js` (then run `cd server && npm test`) |

`window.__lab` exposes `{ stage, dresser, garments, THREE }` for poking at things in the console.
