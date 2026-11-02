"""
Export the trained PointNet (best_model.pt) to ONNX for the Node server.

Run this on the machine where you trained:
    python tools/export_pointnet_onnx.py --checkpoint checkpoints/best_model.pt --out pointnet.onnx

Then put pointnet.onnx in server/models/ on the server (or commit it if <100MB).
"""
import argparse
import torch
import torch.nn as nn

# Minimal model definition matching the multi-task PointNet we trained.
# Adjust if your training script used different layer sizes.
class PointNetEncoder(nn.Module):
    def __init__(self, in_dim=3, out_dim=256):
        super().__init__()
        self.mlp1 = nn.Sequential(
            nn.Linear(in_dim, 64), nn.BatchNorm1d(64), nn.ReLU(),
            nn.Linear(64, 128), nn.BatchNorm1d(128), nn.ReLU(),
            nn.Linear(128, 256), nn.BatchNorm1d(256), nn.ReLU(),
        )
        self.mlp2 = nn.Sequential(
            nn.Linear(256, 256), nn.BatchNorm1d(256), nn.ReLU(),
            nn.Linear(256, out_dim), nn.BatchNorm1d(out_dim), nn.ReLU(),
        )
    def forward(self, x):
        # x: (B, N, 3)
        B, N, _ = x.shape
        x = x.reshape(B * N, -1)
        x = self.mlp1(x)
        x = x.reshape(B, N, -1).max(dim=1).values
        return self.mlp2(x)

class MultiTaskModel(nn.Module):
    def __init__(self, n_outputs=35):
        super().__init__()
        self.encoder = PointNetEncoder()
        self.head = nn.Sequential(
            nn.Linear(256, 256), nn.BatchNorm1d(256), nn.ReLU(),
            nn.Linear(256, n_outputs),
        )
    def forward(self, x):
        return self.head(self.encoder(x))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--out", default="pointnet.onnx")
    p.add_argument("--n-points", type=int, default=2048)
    p.add_argument("--n-outputs", type=int, default=35)
    args = p.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    model = MultiTaskModel(n_outputs=args.n_outputs)
    # Try loading; if keys don't match, print and exit so user can adjust
    try:
        model.load_state_dict(ckpt.get("model_state_dict", ckpt), strict=False)
    except Exception as e:
        print("Load failed:", e)
        print("Keys in checkpoint:", list(ckpt.keys()) if isinstance(ckpt, dict) else type(ckpt))
        return
    model.eval()

    dummy = torch.randn(1, args.n_points, 3)
    torch.onnx.export(
        model, dummy, args.out,
        input_names=["points"], output_names=["measurements"],
        dynamic_axes={"points": {0: "batch", 1: "n_points"}},
        opset_version=17,
    )
    print(f"Exported to {args.out}")

if __name__ == "__main__":
    main()
