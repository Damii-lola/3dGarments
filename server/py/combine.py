"""
A garment's design put together from the systems that read it, each for what it reads well:

  ChatGarment (a vision model trained on GarmentCode, tools/garment_ml/chatgarment) — the CUT: which garment
      programs (shirt / fitted shirt, pants / skirt kinds), collar, sleeves, open front, darts, flare …
  our photo measurement + NGL words (parse.js measuredLowerLength, ngl.py) — LENGTHS: ChatGarment reads cut
      well but not where a hem falls; the photo is measured for that. And a second opinion on sleeves.
  the zone the garment is worn in — ChatGarment always answers with an upper AND a lower garment; only the
      one the photo actually shows is kept

The design is checked against GarmentCode's own schema (default.yaml): every select must be one of its
options, every number a number (a design can come from outside, so nothing else gets through).
"""
import copy
import ngl

LENGTH_KEYS = {
    'lower': ['pants.length', 'skirt.length', 'flare-skirt.length', 'pencil-skirt.length', 'levels-skirt.length'],
    'upper': [],
}


def _get(d, path):
    for k in path.split('.'):
        if not isinstance(d, dict) or k not in d: return None
        d = d[k]
    return d


def _validate(base, given):
    """a design with base's structure; each leaf value taken from `given` if valid for base's schema"""
    out = {}
    for k, b in base.items():
        g = given.get(k) if isinstance(given, dict) else None
        if isinstance(b, dict) and 'v' in b and ('type' in b or 'range' in b):
            leaf = copy.deepcopy(b)
            v = g.get('v') if isinstance(g, dict) else None
            t = b.get('type')
            if v is not None or t == 'select_null':
                if t in ('select', 'select_null'):
                    if v in (b.get('range') or []): leaf['v'] = v
                elif t == 'bool':
                    if isinstance(v, bool): leaf['v'] = v
                elif t in ('float', 'int'):
                    try:
                        x = float(v)
                        if x == x and abs(x) < 1e4: leaf['v'] = int(round(x)) if t == 'int' else x
                    except (TypeError, ValueError): pass
            out[k] = leaf
        elif isinstance(b, dict):
            out[k] = _validate(b, g if isinstance(g, dict) else {})
        else:
            out[k] = b
    return out


def combine(cg_design, zone, ngl_garment=None):
    """ChatGarment design (its design.yaml, with or without the top 'design' key) + zone ('upper' | 'lower' |
    'full') + optional NGL garment words (their lengths win) → GarmentCode design"""
    base = ngl._default_design()
    src = cg_design.get('design', cg_design) if isinstance(cg_design, dict) else {}
    d = _validate(base, src)
    if zone == 'upper':
        d['meta']['bottom']['v'] = None; d['meta']['wb']['v'] = None
    elif zone == 'lower':
        d['meta']['upper']['v'] = None
    if ngl_garment:
        nd = ngl.design(ngl_garment)
        # sleeves: sleeveless only when both readings agree (a missing sleeve is the worse mistake); when
        # ChatGarment drops sleeves the NGL reading sees, the NGL sleeves are used
        if zone != 'lower' and ngl_garment.get('upper') and d['sleeve']['sleeveless']['v'] and not nd['sleeve']['sleeveless']['v']:
            d['sleeve'] = copy.deepcopy(nd['sleeve'])
        # neckline: ChatGarment opens it far too wide (off the shoulders; a cropped top slides down). A neckline
        # our reading sees sitting at the neck (crew, turtleneck, shirt collar) takes our width and depths;
        # any other is at least kept on the shoulders
        u = ngl_garment.get('upper') or {}
        if zone != 'lower' and u:
            c, nc = d['collar'], nd['collar']
            if u.get('neckline') in ('crew', 'turtleneck', 'collar'):
                for k in ('width', 'fc_depth', 'bc_depth'): c[k]['v'] = nc[k]['v']
            elif u.get('neckline') not in ('boat', 'strapless'):
                c['width']['v'] = min(c['width']['v'], nc['width']['v'])
        for path in LENGTH_KEYS.get(zone, []) + (LENGTH_KEYS['lower'] if zone == 'full' else []):
            src_leaf, dst_leaf = _get(nd, path), _get(d, path)
            if isinstance(src_leaf, dict) and isinstance(dst_leaf, dict): dst_leaf['v'] = src_leaf['v']
    return d


# design values the photo fit may set (py/pattern.py `overrides`): lengths and widths only
FIT_KEYS = ['shirt.length', 'shirt.width', 'shirt.flare', 'sleeve.length', 'sleeve.end_width', 'pants.length', 'pants.width',
            'pants.flare', 'skirt.length', 'flare-skirt.length', 'pencil-skirt.length', 'levels-skirt.length']


def apply_overrides(d, overrides):
    """numbers from the photo fit written into the design, clamped to GarmentCode's own range for each"""
    for path, v in (overrides or {}).items():
        if path not in FIT_KEYS: continue
        leaf = _get(d, path)
        try: v = float(v)
        except (TypeError, ValueError): continue
        if not isinstance(leaf, dict) or v != v: continue
        lo, hi = (leaf.get('range') or [None, None])[:2]
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)): v = min(max(v, lo), hi)
        leaf['v'] = v
    return d
