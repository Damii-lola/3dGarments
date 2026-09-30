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


# which panels are worn where (GarmentCode's panel names, as AIpparel's classes)
ZONE_OF = [('upper', ('torso', 'sleeve', 'collar', 'hood')), ('lower', ('skirt', 'pant', 'wb_'))]


def panel_zone(name):
    if name.startswith('sl_'): return 'upper'                   # sleeve cuffs (sl_*_cuff_skirt: a flared sleeve cuff)
    if name.startswith('pant_'): return 'lower'                 # trouser legs and their cuffs
    for z, keys in ZONE_OF:
        if any(k in name for k in keys): return z
    return 'full'


def emit_spec(req):
    """GarmentCodeData specification (AIpparel's answer) → our panels. The pattern was made for the body in its
    photo at GarmentCodeData's scale: scaled to this body's height (x, y, and the placement), panels outside the
    zone dropped with their stitches, and the photo fit's `spec.width` / `spec.length` factors applied"""
    spec = req['spec'].get('pattern', req['spec'])
    tmp = os.path.join('/tmp', f'body_{os.getpid()}.yaml')
    used = body_file(req.get('sex', 'female'), req.get('body') or {}, tmp)
    os.remove(tmp)
    mean = yaml.safe_load(open(os.path.join(HERE, 'garmentcode/assets/bodies', f'mean_{"male" if req.get("sex") == "male" else "female"}.yaml')))['body']
    k = used['height'] / mean['height']
    ov = req.get('overrides') or {}
    sx = k * min(1.6, max(0.6, float(ov.get('spec.width', 1)))); sy = k * min(1.6, max(0.6, float(ov.get('spec.length', 1))))
    zone = req.get('zone') or 'full'
    keep = {n for n in spec['panels'] if zone == 'full' or panel_zone(n) in (zone, 'full')}
    panels = {}
    for name in keep:
        p = spec['panels'][name]
        verts = np.array(p['vertices'], dtype=float)
        edges = []
        for e in p['edges']:
            cv = curve(e, verts)
            n = max(2, math.ceil(cv.length() / RES) + 1)
            pts = [[round(z.real * sx, 3), round(z.imag * sy, 3)] for z in (cv.point(t) for t in np.linspace(0, 1, n))]
            edges.append({'pts': pts, **({'label': e['label']} if e.get('label') else {})})
        t = p.get('translation', [0, 0, 0])
        panels[name] = {'translation': [round(t[0] * sx, 3), round(t[1] * sy, 3), round(t[2] * k, 3)],
                        'rotation': [round(v, 3) for v in p.get('rotation', [0, 0, 0])], 'edges': edges}
    stitches = [s for s in spec.get('stitches', []) if all(side['panel'] in keep for side in s)]
    json.dump({'panels': panels, 'stitches': stitches, 'body': {kk: round(v, 2) for kk, v in used.items()},
               'fit': {'spec.width': float(ov.get('spec.width', 1)), 'spec.length': float(ov.get('spec.length', 1))}}, sys.stdout)


WAIST_EASE = {'tight': 1.02, 'fitted': 1.08}


def shape_waist(spec, body, fit):
    """a fitted / tight top follows the waist: GarmentCode's plain shirt is a straight box from the chest down (bust
    wide at the waist too — a man's waist is ~15 cm smaller than his chest). Each torso panel's side seam is curved
    in to the body's waist girth (+ a little ease) at the waist's height, the way a tailor takes a boxy tee in; the
    front and back side seams curve alike, so they still meet"""
    ease = WAIST_EASE.get(fit)
    if not ease: return
    waist_y = body['height'] - body['head_l'] - body['waist_line']          # world cm (GarmentCode's frame)
    sides = []
    for name, p in spec['panels'].items():
        if 'torso' not in name or any(abs(r) > 1e-3 for r in p.get('rotation', [0, 0, 0])): continue
        verts = np.array(p['vertices'], dtype=float)
        p['_verts'] = verts                                                   # moved in place, written back below
        yl = waist_y - p['translation'][1]                                   # the waist in the panel's own frame
        best = None
        for e in p['edges']:
            if e.get('curvature'): continue
            a, b = verts[e['endpoints'][0]], verts[e['endpoints'][1]]
            lo, hi = min(a[1], b[1]), max(a[1], b[1])
            if not (lo + 2 < yl < hi - 2) or abs(b[1] - a[1]) < 2 * abs(b[0] - a[0]): continue
            t = (yl - a[1]) / (b[1] - a[1])
            x = abs(a[0] + (b[0] - a[0]) * t)
            if best is None or x > best[0]: best = (x, e, a, b, t)
        if best and best[0] > 5: sides.append(best)
    if len(sides) < 2: return
    # the hem (below the waist) comes in to the hips too: its corner on the side seam moves toward the centre line
    lows = [(a if a[1] < b[1] else b) for x, e, a, b, t in sides]
    have_h = sum(abs(v[0]) for v in lows) * 4 / len(sides)
    want_h = body['hips'] * (ease - 0.02)
    if want_h < have_h * 0.98:
        kh = want_h / have_h
        for v in lows: v[0] *= kh                                             # a, b are views of the panel's vertices
    sides = [(abs(a[0] + (b[0] - a[0]) * t), e, a, b, t) for x, e, a, b, t in sides]
    have = sum(x for x, *_ in sides) * 4 / len(sides)                         # the ring at the waist, cm
    want = body['waist'] * ease
    if want >= have * 0.98: return
    k = want / have
    for x, e, a, b, t in sides:
        d = x * (1 - k)                                                       # how far in, at the waist
        L = float(np.hypot(*(b - a)))
        s = min(0.8, max(0.2, t))
        for sign in (1, -1):
            # a quadratic with its control at the waist's place along the seam: its offset there is 2s(1−s)·p1·L
            cv = [s, sign * d / (2 * s * (1 - s) * L)]
            C = a + cv[0] * (b - a) + cv[1] * np.array([-(b - a)[1], (b - a)[0]])
            m = (1 - s) ** 2 * a + 2 * s * (1 - s) * C + s ** 2 * b
            if abs(m[0]) < x - 0.5 * d:                                       # inward: nearer the centre line (x = 0)
                e['curvature'] = cv
                break
    for p in spec['panels'].values():
        if '_verts' in p: p['vertices'] = p.pop('_verts').tolist()


def main():
    req = json.load(sys.stdin)
    g = ngl.parse({'garments': [req['garment']]}) if req.get('garment') else []
    if req.get('spec'):                        # a finished pattern (AIpparel): sized to this body, sampled like ours
        return emit_spec(req)
    if req.get('design'):                      # ChatGarment's cut (+ our lengths): combine.py
        import combine
        design = combine.combine(req['design'], req.get('zone') or 'full', g[0] if g else None)
    elif g:
        design = ngl.design(g[0])
    else:
        raise SystemExit('invalid garment')
    if req.get('overrides'):                   # the photo fit: lengths / widths measured on the photo
        import combine
        design = combine.apply_overrides(design, req['overrides'])
    tmp = os.path.join('/tmp', f'body_{os.getpid()}.yaml')
    used = body_file(req.get('sex', 'female'), req.get('body') or {}, tmp)
    sys.path.insert(0, ngl.GC)
    from assets.garment_programs.meta_garment import MetaGarment
    from assets.bodies.body_params import BodyParameters
    pat = MetaGarment('garment', BodyParameters(tmp), design).assembly()
    spec = pat.pattern
    if g and (design.get('meta', {}).get('upper', {}) or {}).get('v') == 'Shirt':
        shape_waist(spec, used, ((g[0].get('upper') or {}).get('fit')))
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
    import combine
    fit = {k: (combine._get(design, k) or {}).get('v') for k in combine.FIT_KEYS}
    json.dump({'panels': panels, 'stitches': spec['stitches'], 'body': {k: round(v, 2) for k, v in used.items()},
               'fit': {k: v for k, v in fit.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}}, sys.stdout)


if __name__ == '__main__':
    main()
