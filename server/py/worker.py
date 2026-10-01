"""
pattern.py kept running (services/patterns.js): one request per line on stdin → one line on stdout,
{"ok": <pattern.py's output>} or {"error": "..."}. Python, numpy, svgpathtools and GarmentCode are imported once
(re-importing them for every pattern cost seconds on a small server).
"""
import io, json, sys, traceback

import pattern

# warm GarmentCode's own imports too (pattern.main imports them lazily)
try:
    sys.path.insert(0, pattern.ngl.GC)
    import assets.garment_programs.meta_garment  # noqa: F401
    import assets.bodies.body_params  # noqa: F401
    import combine  # noqa: F401
except Exception:
    pass

out = sys.stdout
sys.stdout = sys.stderr                    # stray prints never corrupt the protocol
out.write('{"ready": true}\n'); out.flush()
for line in sys.stdin:
    if not line.strip(): continue
    buf = io.StringIO()
    try:
        sys.stdin, real_in = io.StringIO(line), sys.stdin
        sys.stdout = buf
        try: pattern.main()
        finally: sys.stdin, sys.stdout = real_in, sys.stderr
        res = '{"ok": ' + (buf.getvalue() or 'null') + '}'
    except BaseException as e:             # SystemExit included (an invalid request)
        msg = str(e) or e.__class__.__name__
        traceback.print_exc(file=sys.stderr)
        res = json.dumps({'error': msg[-300:]})
    out.write(res.replace('\n', ' ') + '\n'); out.flush()
