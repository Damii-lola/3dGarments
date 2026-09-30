"""
Shared by every model kernel on Kaggle (prepended to its run.py by tools/garment_ml/kernel.py):

  note(msg)            a line in the log AND on the live progress page https://ntfy.sh/<TOPIC>
  sh(cmd, what)        a shell step, its output in /kaggle/working/logs_<log>.txt; on failure the real errors go to
                       the progress page
  stage(n, total, s)   a stage header
  fetch(repos, root)   Hugging Face files downloaded with ONE running percentage over all of them (speed, ETA),
                       resumed after a dropped connection (5 tries each), every LFS file checked against its SHA-256
"""
import hashlib, json, os, subprocess, time, traceback, urllib.request

WORK = '/kaggle/working'
T0 = time.time()


def note(msg, title=None, prio=3):
    line = f'[{(time.time() - T0) / 60:5.1f} min] {msg}'
    print(line, flush=True)
    try:
        req = urllib.request.Request(f'https://ntfy.sh/{TOPIC}', data=line.encode(), method='POST',
                                     headers={'Title': title or f'{MODEL} on Kaggle', 'Priority': str(prio)})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print('  (progress post failed:', e, ')', flush=True)


def sh(cmd, what, log='build', optional=False):
    t = time.time()
    lf = f'{WORK}/logs_{log}.txt'
    start = os.path.getsize(lf) if os.path.exists(lf) else 0
    with open(lf, 'a') as f:
        r = subprocess.run(cmd, shell=True, stdout=f, stderr=subprocess.STDOUT)
    if r.returncode:
        out = open(lf, errors='replace').read()[start:]
        errs = [l for l in out.splitlines() if 'error' in l.lower() and 'warning' not in l.lower()][:15]
        tail = [l for l in out.splitlines() if l.strip()][-25:]
        note(f'{"⚠" if optional else "✗"} {what} FAILED (exit {r.returncode}){" — optional, continuing" if optional else ""}:\n'
             + '\n'.join(errs[:6] + ['--- last lines ---'] + tail), prio=4 if optional else 5)
        if optional: return False
        raise SystemExit(1)
    note(f'✓ {what} ({time.time() - t:.0f}s)')
    return True


def stage(n, total, name):
    note(f'STAGE {n}/{total} · {name}', title=f'{MODEL} · stage {n}/{total}')


def hf_tree(repo, prefix=''):
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/tree/main/{prefix}?recursive=1', timeout=60) as r:
        return [f for f in json.load(r) if f['type'] == 'file']


def fetch(repos, root, skip=lambda path: False):
    """repos: [(repo, prefix)] → root/<repo name>/<path>. Returns {repo: local dir}."""
    files = []
    for repo, prefix in repos:
        files += [(repo, f) for f in hf_tree(repo, prefix) if not skip(f['path'])]
    total = sum(f.get('size', 0) for _, f in files)
    note(f'⬇ {len(files)} files, {total / 1e9:.2f} GB in all: ' + ', '.join(r for r, _ in repos))
    done, last, t_dl = 0, -10.0, time.time()
    for repo, f in files:
        dst = f'{root}/{repo.split("/")[1]}/{f["path"]}'
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        size, sha = f.get('size', 0), (f.get('lfs') or {}).get('oid')
        for attempt in range(5):
            have = os.path.getsize(dst) if os.path.exists(dst) else 0
            if size and have >= size: break
            try:
                req = urllib.request.Request(f'https://huggingface.co/{repo}/resolve/main/{f["path"]}',
                                             headers={'Range': f'bytes={have}-'} if have else {})
                with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'ab' if have else 'wb') as out:
                    while True:
                        b = r.read(8 << 20)
                        if not b: break
                        out.write(b); have += len(b)
                        pct = (done + have) / max(total, 1) * 100
                        if pct - last >= 2.5:
                            last = pct
                            spd = (done + have) / max(time.time() - t_dl, 1e-3)
                            note(f'⬇ {pct:5.1f}% · {(done + have) / 1e9:.2f}/{total / 1e9:.2f} GB · {spd / 1e6:.0f} MB/s · '
                                 f'ETA {(total - done - have) / max(spd, 1) / 60:.1f} min · {repo.split("/")[1]}/{f["path"].split("/")[-1]}',
                                 title=f'{MODEL} · downloading')
                if not size: break
            except Exception as e:
                note(f'⚠ {f["path"]}: {e} — resuming (try {attempt + 2}/5)', prio=4); time.sleep(5 * (attempt + 1))
        if size and os.path.getsize(dst) != size:
            note(f'✗ {repo}/{f["path"]}: {os.path.getsize(dst)} of {size} bytes', prio=5); raise SystemExit(1)
        if sha:
            h = hashlib.sha256()
            with open(dst, 'rb') as fh:
                for b in iter(lambda: fh.read(64 << 20), b''): h.update(b)
            if h.hexdigest() != sha:
                os.remove(dst); note(f'✗ {repo}/{f["path"]}: checksum mismatch (deleted)', prio=5); raise SystemExit(1)
        done += size
    note(f'✓ downloaded + verified (SHA-256): {total / 1e9:.2f} GB in {(time.time() - t_dl) / 60:.1f} min')
    return {repo: f'{root}/{repo.split("/")[1]}' for repo, _ in repos}


def crash_guard(fn):
    try:
        fn()
    except SystemExit:
        raise
    except Exception as e:
        note(f'✗ crashed: {type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}', prio=5)
        raise
