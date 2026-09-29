"""
Run ChatGarment on Kaggle from the command line — no notebook UI needed.

    export KAGGLE_API_TOKEN=...            # never commit it; it lives only in your shell
    python tools/garment_ml/chatgarment/kernel.py push [photos_dir]   # upload photos + start a GPU run
    python tools/garment_ml/chatgarment/kernel.py status              # queued / running / complete / error
    python tools/garment_ml/chatgarment/kernel.py fetch               # download log, summary, patterns

Needs `pip install kaggle` (≥ 1.7, reads KAGGLE_API_TOKEN) and network access to www.kaggle.com.
The kernel is private, with GPU (T4 ×2) and internet on; the photos go up as a private dataset.
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SLUG_K, SLUG_D = '3dgarments-chatgarment', '3dgarments-test-photos'


def kg(*args, check=True):
    r = subprocess.run(['kaggle', *args], text=True, capture_output=True)
    print((r.stdout + r.stderr).strip())
    if check and r.returncode: sys.exit(r.returncode)
    return r.stdout


def user():
    if os.environ.get('KAGGLE_USERNAME'): return os.environ['KAGGLE_USERNAME']
    out = subprocess.run(['kaggle', 'config', 'view'], text=True, capture_output=True).stdout
    for line in out.splitlines():
        if 'username' in line: return line.split(':', 1)[1].strip()
    sys.exit('set KAGGLE_USERNAME (your Kaggle user name)')


def push(photos=None):
    u = user()
    if photos:
        d = tempfile.mkdtemp()
        for f in os.listdir(photos):
            if f.lower().endswith(('.png', '.jpg', '.jpeg')): shutil.copy(os.path.join(photos, f), d)
        json.dump({'title': '3dGarments test photos', 'id': f'{u}/{SLUG_D}', 'licenses': [{'name': 'other'}]}, open(f'{d}/dataset-metadata.json', 'w'))
        r = subprocess.run(['kaggle', 'datasets', 'version', '-p', d, '-m', 'photos', '-r', 'zip'], text=True, capture_output=True)
        if r.returncode: kg('datasets', 'create', '-p', d, '-r', 'zip')
    k = tempfile.mkdtemp()
    shutil.copy(f'{HERE}/run.py', k)
    json.dump({
        'id': f'{u}/{SLUG_K}', 'title': '3dGarments ChatGarment', 'code_file': 'run.py', 'language': 'python',
        'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'machine_shape': 'NvidiaTeslaT4', 'dataset_sources': [f'{u}/{SLUG_D}'] if photos else [],
        'competition_sources': [], 'kernel_sources': [],
    }, open(f'{k}/kernel-metadata.json', 'w'), indent=1)
    kg('kernels', 'push', '-p', k)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'push': push(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == 'status': kg('kernels', 'status', f'{user()}/{SLUG_K}')
    elif cmd == 'fetch':
        out = os.path.join(HERE, 'out'); os.makedirs(out, exist_ok=True)
        kg('kernels', 'output', f'{user()}/{SLUG_K}', '-p', out)
        s = os.path.join(out, 'summary.json')
        if os.path.exists(s): print(open(s).read()[:4000])
    else: sys.exit(__doc__)


main()
