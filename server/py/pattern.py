"""
Sewing pattern for one garment, sized to a body — the API runs this (services/patterns.js).

    stdin:  { "garment": NGL garment (shared/ngl.js), "sex": "female" | "male",
              "body": { optional measurements in cm: height, bust, underbust, waist, hips, shoulder_w, arm_length, leg_circ … } }
    stdout: { "panels": { name: { "translation": [x, y, z] (cm), "rotation": [x, y, z] (deg, XYZ),
                                  "edges": [ { "pts": [[x, y], …] (cm, start … end), "label"? } ] } },
              "stitches": [ [ { "panel", "edge" }, { "panel", "edge" } ], … ], "body": { measurements used } }

Edges are sampled every ~1.5 cm exactly as GarmentCode's own mesher reads them (pygarment/meshgen/boxmeshgen.py:
control points un-flipped, arcs swept by `right`). World frame: y up, the body faces +z, cm.
"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [p for p in [os.environ.get('PYDEPS'), HERE, os.path.join(HERE, 'garmentcode')] if p]

import numpy as np
import svgpathtools as svgpath
import yaml
import ngl

RES = 1.5   # cm between samples along an edge
LENGTHS = ['arm_length', 'armscye_depth', 'back_width', 'bum_points', 'bust_line', 'bust_points', 'crotch_hip_diff', 'head_l',
           'hip_back_width', 'hips_line', 'neck_w', 'shoulder_w', 'vert_bust_line', 'waist_back_width', 'waist_line', 'waist_over_bust_line']
GIRTHS = ['bust', 'underbust', 'waist', 'hips', 'leg_circ', 'wrist']


def body_file(sex, given, out):
    """GarmentCode's average body for the sex, scaled to the given height and girths (cm)"""
    base = yaml.safe_load(open(os.path.join(HERE, 'garmentcode/assets/bodies', f'mean_{"male" if sex == "male" else "female"}.yaml')))
    b = dict(base['body'])
    k = float(given.get('height') or b['height']) / b['height']
    for key in LENGTHS: b[key] = b[key] * k
    b['height'] = b['height'] * k
    gk = {g: float(given[g]) / b[g] for g in GIRTHS if given.get(g)}
    avg = sum(gk.values()) / len(gk) if gk else k
    for g in GIRTHS: b[g] = float(given[g]) if given.get(g) else b[g] * avg
    for key in LENGTHS:                                  # explicit lengths win
        if given.get(key): b[key] = float(given[key])
    base['body'] = b
    yaml.safe_dump(base, open(out, 'w'))
    return b


def curve(edge, verts):
    start, end = verts[edge['endpoints'][0]], verts[edge['endpoints'][1]]
    c = edge.get('curvature')
    rel = lambda p: start + p[0] * (end - start) + p[1] * np.array([-(end - start)[1], (end - start)[0]])
    C = lambda p: complex(p[0], p[1])
    if not c: return svgpath.Line(C(start), C(end))
    if isinstance(c, list) or c['type'] == 'quadratic':
        return svgpath.QuadraticBezier(C(start), C(rel(c if isinstance(c, list) else c['params'][0])), C(end))
    if c['type'] == 'circle':
        r, large, right = c['params']
        return svgpath.Arc(C(start), r + 1j * r, rotation=0, large_arc=large, sweep=right, end=C(end))
    if c['type'] == 'cubic':
        return svgpath.CubicBezier(C(start), *[C(rel(p)) for p in c['params']], C(end))
    raise ValueError(f'unknown curve {c}')


def main():
    req = json.load(sys.stdin)
    g = ngl.parse({'garments': [req['garment']]})
    if not g: raise SystemExit('invalid garment')
    tmp = os.path.join('/tmp', f'body_{os.getpid()}.yaml')
    used = body_file(req.get('sex', 'female'), req.get('body') or {}, tmp)
    sys.path.insert(0, ngl.GC)
    from assets.garment_programs.meta_garment import MetaGarment
    from assets.bodies.body_params import BodyParameters
    pat = MetaGarment('garment', BodyParameters(tmp), ngl.design(g[0])).assembly()
    spec = pat.pattern
    os.remove(tmp)
    panels = {}
    for name, p in spec['panels'].items():
        verts = np.array(p['vertices'], dtype=float)
        edges = []
        for e in p['edges']:
            cv = curve(e, verts)
            n = max(2, math.ceil(cv.length() / RES) + 1)
            pts = [[round(z.real, 3), round(z.imag, 3)] for z in (cv.point(t) for t in np.linspace(0, 1, n))]
            edges.append({'pts': pts, **({'label': e['label']} if e.get('label') else {})})
        panels[name] = {'translation': [round(v, 3) for v in p['translation']], 'rotation': [round(v, 3) for v in p['rotation']], 'edges': edges}
    json.dump({'panels': panels, 'stitches': spec['stitches'], 'body': {k: round(v, 2) for k, v in used.items()}}, sys.stdout)


if __name__ == '__main__':
    main()
