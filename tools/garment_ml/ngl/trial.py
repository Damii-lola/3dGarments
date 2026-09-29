"""
NGL trial: real photos → the live API's vision model (POST /api/ngl/describe) → GarmentCode patterns,
plus a sheet per photo: the photo, what the model said, the pattern(s).

    python trial.py photos_dir out_dir [api=https://threedgarments.onrender.com]
"""
import base64, glob, json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ngl

src, out = sys.argv[1], sys.argv[2]
api = sys.argv[3] if len(sys.argv) > 3 else 'https://threedgarments.onrender.com'
os.makedirs(out, exist_ok=True)
results = {}
for p in sorted(glob.glob(os.path.join(src, '*'))):
    if not p.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')): continue
    name = os.path.splitext(os.path.basename(p))[0][:20]
    body = json.dumps({'image': base64.b64encode(open(p, 'rb').read()).decode()}).encode()
    t = time.time()
    try:
        req = urllib.request.Request(f'{api}/api/ngl/describe', data=body, headers={'Content-Type': 'application/json'})
        r = json.load(urllib.request.urlopen(req, timeout=120))
    except Exception as e:
        err = e.read().decode()[:300] if hasattr(e, 'read') else str(e)
        print(name, 'API error', err); results[name] = {'error': err}; continue
    gs = ngl.parse(r.get('raw', '')) or r.get('garments', [])
    built = []
    for i, g in enumerate(gs):
        try: built.append(ngl.build(g, os.path.join(out, name), name=f'{i}_{g["type"]}'))
        except Exception as e: built.append(f'build failed: {e}')
    results[name] = {'seconds': round(time.time() - t, 1), 'garments': gs, 'raw': r.get('raw'), 'patterns': built}
    print(name, f'{time.time() - t:.1f}s', [g['type'] for g in gs])
json.dump(results, open(os.path.join(out, 'results.json'), 'w'), indent=1)
