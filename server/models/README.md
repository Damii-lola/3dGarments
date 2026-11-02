# Models

## u2netp.onnx
U²-Net-P for garment cut-out. See existing notes.

## pointnet.onnx
Trained body-measurement model. Optional — if missing, the scanner falls back to geometric measurement.

### How to add it
1. On the machine where you trained, export:
   ```
   python tools/export_pointnet_onnx.py --checkpoint checkpoints/best_model.pt --out pointnet.onnx
   ```
2. Place `pointnet.onnx` in this folder (`server/models/`).
3. Redeploy the server.

The model is used to fill measurement gaps when landmarks are incomplete. It does not override numbers that were already measured from the video.
