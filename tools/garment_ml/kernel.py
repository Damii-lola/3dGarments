"""
Any of our garment models on a Kaggle GPU, from the command line:

    export KAGGLE_API_TOKEN=...            # never commit it; only in your shell
    (gated Hugging Face data — GarmageSet — is read with a Kaggle *secret* named HF_TOKEN that you add yourself in
     the kernel's editor: Add-ons → Secrets; the token is never put in a kernel's code)
    STAGE=prep python tools/garment_ml/kernel.py push garmagenet     # a model trained in steps: one kernel per stage;
    KERNEL_SOURCES=3dgarments-garmagenet-prep STAGE=vae ...           #   a later stage reads an earlier one's output
    python tools/garment_ml/kernel.py push   <model> <photo.png> [...]   # prints the live progress page
    python tools/garment_ml/kernel.py status <model>
    python tools/garment_ml/kernel.py fetch  <model>                     # → tools/garment_ml/<model>/out/

<model> is a folder here with a run.py (chatgarment, aipparel, hunyuan3d, garmagenet). Its run.py gets
common/progress.py prepended, and MODEL / TOPIC / INPUTS (the photos, base64) filled in.
"""
import base64, json, os, secrets, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


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


STAGE = os.environ.get('STAGE', '')           # a model trained in steps (garmagenet): prep / vae / ldm / gen


def slug(model): return f'3dgarments-{model}' + (f'-{STAGE}' if STAGE else '')


def push(model, pngs):
    topic = f'3dg-{model}{"-" + STAGE if STAGE else ""}-{secrets.token_hex(6)}'
    inputs = {os.path.splitext(os.path.basename(p))[0]: base64.b64encode(open(p, 'rb').read()).decode() for p in pngs}
    head = f'MODEL = {model!r}\nSTAGE = {STAGE!r}\nTOPIC = {topic!r}\nINPUTS = {json.dumps(inputs)}\n'

    src = head + open(f'{HERE}/common/progress.py').read() + '\n\n# ======== ' + model + '\n' + open(f'{HERE}/{model}/run.py').read()
    k = tempfile.mkdtemp()
    open(f'{k}/run.py', 'w').write(src)
    json.dump({'id': f'{user()}/{slug(model)}', 'title': f'3dGarments {model}', 'code_file': 'run.py', 'language': 'python',
               'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True, 'machine_shape': 'NvidiaTeslaT4',
               'dataset_sources': [], 'competition_sources': [],
               # an earlier stage's output, mounted at /kaggle/input/<its slug>
               'kernel_sources': [f'{user()}/{s}' for s in os.environ.get('KERNEL_SOURCES', '').split(',') if s]},
              open(f'{k}/kernel-metadata.json', 'w'), indent=1)
    kg('kernels', 'push', '-p', k)
    open(f'{HERE}/{model}/.topic', 'w').write(topic)
    print(f'\nlive progress: https://ntfy.sh/{topic}')


def main():
    if len(sys.argv) < 3: sys.exit(__doc__)
    cmd, model = sys.argv[1], sys.argv[2]
    if cmd == 'push': push(model, sys.argv[3:])
    elif cmd == 'status': kg('kernels', 'status', f'{user()}/{slug(model)}')
    elif cmd == 'fetch':
        out = os.path.join(HERE, model, 'out'); os.makedirs(out, exist_ok=True)
        kg('kernels', 'output', f'{user()}/{slug(model)}', '-p', out)
    else: sys.exit(__doc__)


main()
