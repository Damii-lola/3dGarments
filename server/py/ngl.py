"""
NGL — Natural Garment Language (after Badalyan et al., "NGL: Natural Garment Language for Training-Free
Sewing Pattern Estimation", 2026). Their code isn't released; this is an implementation of the method:

    photo → a vision-language model answers in plain garment words (PROMPT, fixed vocabulary)
          → parse(): every attribute validated, unknown/missing → a default
          → design(): the words mapped deterministically onto GarmentCode design parameters
          → build(): GarmentCode (MIT, github.com/maria-korosteleva/GarmentCode) makes the sewing pattern

Vision models describe garments well in words but guess numbers badly — so they only ever pick words.

    python ngl.py describe.json out_dir [body.yaml]    # NGL JSON (from the model) → pattern(s)
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GC = os.environ.get('GARMENTCODE', os.path.join(HERE, 'garmentcode'))

# ------------------------------------------------------------------ the vocabulary (shared with the server)
_V = json.load(open(os.path.join(HERE, '../src/shared/ngl-vocab.json')))
TYPES, UPPER, LOWER = _V['types'], _V['upper'], _V['lower']
DEFAULTS_U, DEFAULTS_L = _V['defaults']['upper'], _V['defaults']['lower']
# the question asked of the vision model is server/src/shared/ngl.js NGL_PROMPT


# ------------------------------------------------------------------ parse (validate, default)
def _pick(v, allowed, default):
    t = str(v or '').strip().lower().replace('-', '_').replace(' ', '_')
    return t if t in allowed else default


def parse(answer):
    """model answer (dict or JSON text) → [{type, upper?, lower?}] with every value valid"""
    if isinstance(answer, str):
        s = answer[answer.find('{'): answer.rfind('}') + 1]
        answer = json.loads(s) if s else {}
    out = []
    for g in (answer or {}).get('garments', [])[:3]:
        t = _pick(g.get('type'), TYPES, None)
        if not t: continue
        e = {'type': t}
        if t not in ('skirt', 'pants', 'shorts'):
            u = g.get('upper') or {}
            e['upper'] = {k: _pick(u.get(k), UPPER[k], DEFAULTS_U[k]) for k in UPPER}
        if t in ('dress', 'jumpsuit', 'skirt', 'pants', 'shorts'):
            l = g.get('lower') or {}
            e['lower'] = {k: _pick(l.get(k), LOWER[k], DEFAULTS_L[k]) for k in LOWER}
        out.append(e)
    return out


# ------------------------------------------------------------------ words → GarmentCode design parameters
def _default_design():
    import yaml
    return yaml.safe_load(open(os.path.join(GC, 'assets/design_params/default.yaml')))['design']


def design(g):
    """one parsed garment → GarmentCode design dict"""
    d = copy.deepcopy(_default_design())
    S = lambda path, v: _set(d, path, v)
    t, u, l = g['type'], g.get('upper'), g.get('lower')
    S('meta.upper', None); S('meta.bottom', None); S('meta.wb', None)

    if u:
        S('meta.upper', 'FittedShirt' if u['fit'] in ('tight', 'fitted') else 'Shirt')
        S('shirt.width', {'tight': 1.0, 'fitted': 1.0, 'regular': 1.05, 'loose': 1.15, 'oversized': 1.28}[u['fit']])
        # length in units of the body's shoulder-to-waist line
        S('shirt.length', {'cropped': 0.8, 'waist': 1.0, 'high_hip': 1.15, 'hip': 1.35, 'thigh': 1.7}[u['length']])
        S('shirt.flare', {'straight': 1.0, 'slightly_flared': 1.15, 'flared': 1.4}[u['hem']])
        nl = u['neckline']
        S('shirt.strapless', nl == 'strapless')
        S('collar.f_collar', {'crew': 'CircleNeckHalf', 'scoop': 'CircleNeckHalf', 'v_neck': 'VNeckHalf', 'square': 'SquareNeckHalf',
                              'boat': 'CircleArcNeckHalf', 'sweetheart': 'Bezier2NeckHalf', 'turtleneck': 'CircleNeckHalf',
                              'collar': 'VNeckHalf', 'hood': 'VNeckHalf', 'strapless': 'CircleNeckHalf'}[nl])
        S('collar.b_collar', 'CircleNeckHalf')
        depth = {'shallow': 0.35, 'medium': 0.6, 'deep': 1.1, 'plunging': 1.6}[u['neckline_depth']]
        if nl == 'crew': depth = min(depth, 0.45)
        if nl == 'scoop': depth = max(depth, 0.8)
        if nl == 'boat': depth = 0.3
        S('collar.fc_depth', depth)
        S('collar.bc_depth', 0.15 if nl in ('scoop', 'square', 'boat', 'sweetheart') else 0)
        S('collar.width', {'narrow': -0.2, 'medium': 0.2, 'wide': 0.6}[u['neckline_width']] if nl != 'boat' else 0.8)
        S('collar.component.style', {'turtleneck': 'Turtle', 'collar': 'SimpleLapel', 'hood': 'Hood2Panels'}.get(nl))
        sl = u['sleeve_length']
        S('sleeve.sleeveless', sl == 'sleeveless')
        S('sleeve.length', {'sleeveless': 0.3, 'cap': 0.12, 'short': 0.28, 'elbow': 0.45, 'three_quarter': 0.7, 'long': 1.0}[sl])
        S('sleeve.end_width', {'fitted': 0.7, 'straight': 1.0, 'wide': 1.4, 'bell': 1.9, 'puff': 1.0}[u['sleeve_shape']])
        S('sleeve.connect_ruffle', 1.6 if u['sleeve_shape'] == 'puff' else 1.0)
        S('sleeve.connecting_width', 0.4 if u['fit'] in ('loose', 'oversized') else 0.2)
        S('sleeve.cuff.type', {'none': None, 'band': 'CuffBand', 'ruffle': 'CuffSkirt'}[u['cuff']])
        if u['sleeve_shape'] == 'puff': S('sleeve.cuff.type', 'CuffBand')

    if l:
        rise = {'low': 0.6, 'mid': 0.8, 'high': 1.0}[l['rise']]
        skirt_len = {'micro': 0.12, 'mini': 0.22, 'above_knee': 0.34, 'knee': 0.45, 'below_knee': 0.55, 'midi': 0.66,
                     'ankle': 0.85, 'floor': 0.95}[l['length']]
        if t in ('pants', 'shorts', 'jumpsuit'):
            S('meta.bottom', 'Pants')
            plen = {'micro': 0.2, 'mini': 0.22, 'above_knee': 0.3, 'knee': 0.42, 'below_knee': 0.5, 'midi': 0.6,
                    'ankle': 0.85, 'floor': 0.9}[l['length']]
            if t == 'shorts': plen = min(plen, 0.35)
            S('pants.length', plen)
            S('pants.width', {'skinny': 1.0, 'straight': 1.1, 'wide': 1.35, 'palazzo': 1.5, 'flared': 1.05}[l['leg']])
            S('pants.flare', {'skinny': 0.6, 'straight': 1.0, 'wide': 1.0, 'palazzo': 1.1, 'flared': 1.2}[l['leg']])
            S('pants.rise', rise)
        else:
            shape = l['skirt_shape']
            base = {'straight': 'Skirt2', 'pencil': 'PencilSkirt', 'a_line': 'SkirtCircle', 'circle': 'SkirtCircle',
                    'pleated': 'SkirtManyPanels', 'tiered': 'SkirtLevels', 'high_low': 'AsymmSkirtCircle'}[shape]
            S('meta.bottom', base)
            for key in ('skirt', 'flare-skirt', 'pencil-skirt', 'levels-skirt'):
                S(f'{key}.length', max(0.2, skirt_len) if key in ('pencil-skirt', 'levels-skirt') else skirt_len)
                S(f'{key}.rise', rise)
            S('flare-skirt.suns', {'a_line': 0.35, 'circle': 1.0, 'pleated': 0.5, 'high_low': 0.6}.get(shape, 0.5))
            S('flare-skirt.skirt-many-panels.n_panels', 12)
            S('levels-skirt.num_levels', 3); S('levels-skirt.level_ruffle', 1.3)
            if shape == 'pencil':
                S('pencil-skirt.flare', 0.9)
                if l['slit'] != 'none': S(f"pencil-skirt.{ {'front': 'front', 'side': 'left', 'back': 'back'}[l['slit']] }_slit", 0.4)
        # separates get a waistband; a dress / jumpsuit joins its bodice at the waist
        if t in ('skirt', 'pants', 'shorts') and l['waistband'] != 'none':
            S('meta.wb', 'FittedWB' if l['waistband'] == 'band' else 'StraightWB')
            S('waistband.width', 0.25 if l['waistband'] == 'band' else 0.35)
    return d


def _set(d, path, v):
    node = d
    keys = path.split('.')
    for k in keys[:-1]: node = node[k]
    node[keys[-1]]['v'] = v


# ------------------------------------------------------------------ build the pattern
def build(g, out_dir, body_yaml=None, name='garment'):
    sys.path.insert(0, GC)
    from assets.garment_programs.meta_garment import MetaGarment
    from assets.bodies.body_params import BodyParameters
    body = BodyParameters(body_yaml or os.path.join(GC, 'assets/bodies/mean_female.yaml'))
    os.makedirs(out_dir, exist_ok=True)
    pat = MetaGarment(name, body, design(g)).assembly()
    pat.serialize(out_dir, tag='', to_subfolder=False, with_3d=False, with_text=False, view_ids=False)
    return os.path.join(out_dir, f'{name}_specification.json')


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    gs = parse(json.load(open(src)))
    for i, g in enumerate(gs):
        print(g['type'], build(g, out, sys.argv[3] if len(sys.argv) > 3 else None, name=f'g{i}_{g["type"]}'))
