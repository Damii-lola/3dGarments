#!/usr/bin/env python3
"""
Make a raw garment model (e.g. an AI-generated .glb) light enough for the web.

    pip install trimesh fast-simplification numpy
    python3 tools/garments/prepare_template.py M_CrewNeckTee.glb out/M_CrewNeckTee.glb [--tris 30000]

What it does: merges the scene into one mesh, welds duplicate vertices, quadric-decimates it to
--tris triangles (shape error is ~1 mm on a tee), drops colours / UVs / extras, and writes a plain
.glb (positions + normals + indices). The browser fits it to the mannequin (web/src/garments/template.js),
so no sizing is baked in here: the model keeps its own orientation (+Y up, +Z front) and proportions.
"""
import argparse, os, sys
import numpy as np
import trimesh
import fast_simplification as fs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--tris', type=int, default=30000, help='target triangle count (default 30000)')
    a = ap.parse_args()

    scene = trimesh.load(a.src, force='scene')
    mesh = trimesh.util.concatenate([g for g in scene.dump() if isinstance(g, trimesh.Trimesh)])
    mesh.merge_vertices()
    print(f'in : {len(mesh.vertices):,} verts, {len(mesh.faces):,} tris, watertight={mesh.is_watertight}')

    if len(mesh.faces) > a.tris:
        v, f = fs.simplify(mesh.vertices.astype(np.float64), mesh.faces.astype(np.int64),
                           target_reduction=1 - a.tris / len(mesh.faces), agg=5)
        mesh = trimesh.Trimesh(v, f, process=False)
    out = trimesh.Trimesh(mesh.vertices.astype(np.float32), mesh.faces.astype(np.uint32), process=False)
    out.vertex_normals  # computed and exported
    os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
    out.export(a.dst)
    print(f'out: {len(out.vertices):,} verts, {len(out.faces):,} tris, {os.path.getsize(a.dst)/1e6:.2f} MB -> {a.dst}')
    print('bounds', out.bounds.round(3).tolist())


if __name__ == '__main__':
    sys.exit(main())
