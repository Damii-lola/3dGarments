"""
Synthetic video training data from 3D models.

Renders the male/female GLB at different turns, projects mesh vertices
to the same landmark format the live scanner produces, then builds
point clouds with the identical landmarksToPoints logic used at inference.

Labels come from the actual 3D mesh measurements, so the model learns
the real 2D→measurement mapping it will face on real video.
"""
import json, math, os, random
import numpy as np
import trimesh

GLB = {"female": "female.glb", "male": "male.glb"}  # update paths
OUT = "training_synthetic_video.json"
N_POINTS = 512
TURNS = [0, 45, 90, 135, 180, 225, 270, 315]

LANDMARKS = [
    "headTop", "chin", "neckL", "neckR", "shoulderL", "shoulderR",
    "armpitL", "armpitR", "waistL", "waistR", "hipL", "hipR",
    "elbowJointL", "elbowJointR", "wristJointL", "wristJointR",
    "crotch", "footL", "footR",
]

def load_mesh(path):
    scene = trimesh.load(path)
    if isinstance(scene, trimesh.Scene):
        mesh = scene.dump(concatenate=True)
    else:
        mesh = scene
    return mesh

def project_landmarks(verts, turn_deg):
    """Project mesh to 2D landmarks at a given turn angle."""
    rad = math.radians(turn_deg)
    c, s = math.cos(rad), math.sin(rad)
    # Rotate around Y
    x = verts[:, 0] * c + verts[:, 2] * s
    y = verts[:, 1]
    z = -verts[:, 0] * s + verts[:, 2] * c
    # Normalize to 0-100 like the scanner
    x_n = (x - x.min()) / (x.max() - x.min() + 1e-6) * 100
    y_n = (y - y.min()) / (y.max() - y.min() + 1e-6) * 100
    y_n = 100 - y_n  # image y is top-down
    # Pick representative points for each landmark
    h = y.max() - y.min()
    lm = {}
    # Simple height-based assignment
    def pick(name, y_frac, x_side):
        mask = (y > y.min() + h * (y_frac - 0.05)) & (y < y.min() + h * (y_frac + 0.05))
        if not mask.any():
            return
        xs = x_n[mask]
        ys = y_n[mask]
        if x_side < 0:
            idx = xs.argmin()
        elif x_side > 0:
            idx = xs.argmax()
        else:
            idx = np.argmin(np.abs(xs - 50))
        lm[name] = {"x": float(xs[idx]), "y": float(ys[idx])}
    pick("headTop", 0.95, 0)
    pick("chin", 0.85, 0)
    pick("neckL", 0.80, -1)
    pick("neckR", 0.80, 1)
    pick("shoulderL", 0.75, -1)
    pick("shoulderR", 0.75, 1)
    pick("armpitL", 0.68, -1)
    pick("armpitR", 0.68, 1)
    pick("waistL", 0.55, -1)
    pick("waistR", 0.55, 1)
    pick("hipL", 0.45, -1)
    pick("hipR", 0.45, 1)
    pick("crotch", 0.42, 0)
    pick("footL", 0.05, -1)
    pick("footR", 0.05, 1)
    return lm

def landmarks_to_points(frames, n=N_POINTS):
    """Same logic as server/src/lib/pointnet.js landmarksToPoints."""
    pts = []
    for f in frames:
        turn = math.radians(f.get("turn", 0))
        for name, p in f.get("landmarks", {}).items():
            if not p or "x" not in p or "y" not in p:
                continue
            x = (p["x"] - 50) / 50
            y = (50 - p["y"]) / 50
            z = math.sin(turn) * 0.3
            pts.extend([x, y, z])
    if len(pts) < 9:
        return None
    out = np.zeros(n * 3, dtype=np.float32)
    for i in range(n):
        src = (i * 3) % len(pts)
        out[i*3] = pts[src]
        out[i*3+1] = pts[src+1] if src+1 < len(pts) else 0
        out[i*3+2] = pts[src+2] if src+2 < len(pts) else 0
    return out.tolist()

def mesh_measurements(verts):
    """Rough measurements from mesh bounding boxes."""
    h = verts[:, 1].max() - verts[:, 1].min()
    def circ(y_frac, band=0.03):
        y0 = verts[:, 1].min() + h * y_frac
        mask = np.abs(verts[:, 1] - y0) < h * band
        if not mask.any():
            return 0
        xs = verts[mask, 0]
        zs = verts[mask, 2]
        w = xs.max() - xs.min()
        d = zs.max() - zs.min()
        # Ramanujan ellipse perimeter
        a, b = w/2, d/2
        return math.pi * (3*(a+b) - math.sqrt((3*a+b)*(a+3*b))) * 100  # to cm-ish
    return {
        "chest_cm": circ(0.70),
        "waist_cm": circ(0.55),
        "hips_cm": circ(0.45),
        "shoulder_cm": circ(0.75) * 0.4,
        "neck_circumference_cm": circ(0.80) * 0.5,
    }

def main():
    samples = []
    for sex, path in GLB.items():
        if not os.path.exists(path):
            print(f"skip {path}")
            continue
        mesh = load_mesh(path)
        verts = mesh.vertices
        print(f"{sex}: {len(verts)} verts")
        for i in range(200):  # shape variations
            scale = 0.9 + random.random() * 0.2
            v = verts * scale
            frames = []
            for t in TURNS:
                lm = project_landmarks(v, t)
                frames.append({"turn": t, "landmarks": lm})
            pts = landmarks_to_points(frames)
            if pts is None:
                continue
            meas = mesh_measurements(v)
            samples.append({
                "points": pts,
                "extra": [scale],
                "measurements": meas,
                "sex": sex,
            })
            if i % 50 == 0:
                print(f"  {i} chest={meas['chest_cm']:.0f}")
    with open(OUT, "w") as f:
        json.dump({"samples": samples}, f)
    print(f"wrote {len(samples)} samples to {OUT}")

if __name__ == "__main__":
    main()
