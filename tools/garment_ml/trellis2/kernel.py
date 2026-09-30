"""
TRELLIS.2 on Kaggle from the command line.

    export KAGGLE_API_TOKEN=...          # never commit it; it lives only in your shell
    python tools/garment_ml/trellis2/kernel.py push <cut-out.png> [...]   # start a GPU run; prints the live progress page
    python tools/garment_ml/trellis2/kernel.py status
    python tools/garment_ml/trellis2/kernel.py fetch                      # GLBs + summary + logs → tools/garment_ml/trellis2/out/
"""
import base64, json, os, secrets, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SLUG = '3dgarments-trellis2'


def kg(*args, check=True):
    r = subprocess.run(['kaggle', *args], text=True, capture_output=True)
    print((r.stdout + r.stderr).strip())
    if check and r.returncode: sys.exit(r.returncode)
    return r.stdout


def user():
    out = subprocess.run(['kaggle', 'config', 'view'], text=True, capture_output=True).stdout
    for line in out.splitlines():
        if 'username' in line: return line.split(':', 1)[1].strip()
    return os.environ.get('KAGGLE_USERNAME') or sys.exit('set KAGGLE_USERNAME')


def push(pngs):
    topic = f'3dg-trellis2-{secrets.token_hex(6)}'
    inputs = {os.path.splitext(os.path.basename(p))[0]: base64.b64encode(open(p, 'rb').read()).decode() for p in pngs}
    src = open(f'{HERE}/run.py').read().replace("TOPIC = '__TOPIC__'", f"TOPIC = '{topic}'").replace('INPUTS = {}', f'INPUTS = {json.dumps(inputs)}')
    k = tempfile.mkdtemp()
    open(f'{k}/run.py', 'w').write(src)
    json.dump({'id': f'{user()}/{SLUG}', 'title': '3dGarments TRELLIS2', 'code_file': 'run.py', 'language': 'python',
               'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True, 'machine_shape': 'NvidiaTeslaT4',
               'dataset_sources': [], 'competition_sources': [], 'kernel_sources': []}, open(f'{k}/kernel-metadata.json', 'w'), indent=1)
    kg('kernels', 'push', '-p', k)
    open(f'{HERE}/.topic', 'w').write(topic)
    print(f'\nlive progress: https://ntfy.sh/{topic}')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'push': push(sys.argv[2:])
    elif cmd == 'status': kg('kernels', 'status', f'{user()}/{SLUG}')
    elif cmd == 'fetch':
        out = os.path.join(HERE, 'out'); os.makedirs(out, exist_ok=True)
        kg('kernels', 'output', f'{user()}/{SLUG}', '-p', out)
    else: sys.exit(__doc__)


main()
