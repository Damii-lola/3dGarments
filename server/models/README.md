# Cut-out model

`u2netp.onnx` — U²-Net-P (lightweight salient-object / background-removal network, Qin et al. 2020), 4.6 MB.
Used by `src/services/segment.js` to cut a garment out of a product photo (the colour-based cut-out in
`src/shared/silhouette.js` only works on plain backdrops). Weights as distributed by the rembg project.
U²-Net is released under the Apache-2.0 licence — check the current terms of the exact file before shipping commercially.
If the file is missing the server downloads it once from `U2NETP_URL` (default: rembg's GitHub release) into this folder.
