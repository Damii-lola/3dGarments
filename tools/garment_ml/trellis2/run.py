"""
TRELLIS.2 (microsoft/TRELLIS.2, MIT) on a Kaggle GPU: the full model, built from source, every garment
cut-out → a textured 3D garment (GLB).

Runs as a Kaggle script kernel (T4, internet on). kernel.py fills in TOPIC and INPUTS when it pushes.
Progress (every stage, the weights download in %, each garment) goes to https://ntfy.sh/<TOPIC> — open
that page in a browser to watch it live; everything is also in the kernel log.

Stages: 1 PyTorch + xformers · 2 build the CUDA extensions (nvdiffrast, nvdiffrec, CuMesh, FlexGEMM,
o-voxel) · 3 download ALL TRELLIS.2-4B weights (+ its sparse-structure decoder and DINOv3), each file
checked against its SHA-256 · 4 load · 5 generate every garment (1024 cascade, falling back to 512 on
out-of-memory) · 6 done: /kaggle/working/out/<name>.glb + summary.json
"""
import base64, hashlib, json, os, subprocess, sys, time, traceback, urllib.request

TOPIC = '__TOPIC__'
INPUTS = {}  # name → base64 PNG (RGBA cut-out), filled in by kernel.py

WORK, W, OUT = '/kaggle/working', '/tmp/weights', '/kaggle/working/out'
os.makedirs(OUT, exist_ok=True); os.makedirs(W, exist_ok=True)
T0 = time.time()
summary = {'stages': {}, 'garments': {}}


def note(msg, title=None, prio=3):
    line = f'[{(time.time() - T0) / 60:5.1f} min] {msg}'
    print(line, flush=True)
    try:
        req = urllib.request.Request(f'https://ntfy.sh/{TOPIC}', data=line.encode(), method='POST',
                                     headers={'Title': title or 'TRELLIS.2 on Kaggle', 'Priority': str(prio)})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print('  (progress post failed:', e, ')', flush=True)


def sh(cmd, what, log, optional=False):
    t = time.time()
    lf = f'{WORK}/logs_{log}.txt'
    start = os.path.getsize(lf) if os.path.exists(lf) else 0
    with open(lf, 'a') as f:
        r = subprocess.run(cmd, shell=True, stdout=f, stderr=subprocess.STDOUT, env={**os.environ})
    if r.returncode:
        out = open(lf, errors='replace').read()[start:]
        errs = [l for l in out.splitlines() if 'error' in l.lower() and 'warning' not in l.lower()][:15]
        note(f'{"⚠" if optional else "✗"} {what} FAILED (exit {r.returncode}){" — optional, continuing" if optional else ""}:\n' + '\n'.join(errs or out.splitlines()[-20:]), prio=4 if optional else 5)
        if optional: return False
        raise SystemExit(1)
    note(f'✓ {what} ({time.time() - t:.0f}s)')
    return True


def stage(n, name):
    summary['stages'][name] = round((time.time() - T0) / 60, 1)
    note(f'STAGE {n}/6 · {name}', title=f'TRELLIS.2 · stage {n}/6')


try:
    gpu = subprocess.run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', shell=True, capture_output=True, text=True).stdout.strip()
    note(f'started on {gpu or "NO GPU"} · {len(INPUTS)} garments to make')

    # ------------------------------------------------------------------ 1. PyTorch + xformers
    stage(1, 'PyTorch 2.6 (CUDA 12.4) + xformers + dependencies')
    sh('pip install -q torch==2.6.0 torchvision==0.21.0 xformers==0.0.29.post3 --index-url https://download.pytorch.org/whl/cu124', 'PyTorch 2.6 + xformers', 'pip')
    sh('pip install -q imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh "transformers>=4.56" pandas '
       'zstandard kornia timm lpips safetensors huggingface_hub "triton>=3.2" '
       'git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8', 'Python dependencies', 'pip')

    # ------------------------------------------------------------------ 2. build the CUDA extensions (for this GPU)
    stage(2, 'building the CUDA extensions (5)')
    os.environ.update(TORCH_CUDA_ARCH_LIST='7.5', MAX_JOBS='4', ATTN_BACKEND='xformers', SPARSE_ATTN_BACKEND='xformers')
    # the linker needs libcuda at build time: CUDA's stub library (the real driver is used at run time)
    stubs = next((d for d in ['/usr/local/cuda/lib64/stubs', '/usr/local/cuda/targets/x86_64-linux/lib/stubs'] if os.path.isdir(d)), '')
    os.environ['LIBRARY_PATH'] = ':'.join(x for x in [stubs, '/usr/local/cuda/lib64', os.environ.get('LIBRARY_PATH', '')] if x)
    sh('rm -rf /tmp/TRELLIS.2 /tmp/ext && git clone -q -b main --recursive https://github.com/microsoft/TRELLIS.2.git /tmp/TRELLIS.2 && mkdir -p /tmp/ext', 'TRELLIS.2 source', 'build')
    # (nvdiffrec only renders preview videos with environment light: optional — the GLBs don't need it)
    exts = [
        ('nvdiffrast', 'git clone -q -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast', '/tmp/ext/nvdiffrast', False),
        ('CuMesh', 'git clone -q --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/CuMesh', '/tmp/ext/CuMesh', False),
        ('FlexGEMM', 'git clone -q --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/FlexGEMM', '/tmp/ext/FlexGEMM', False),
        ('o-voxel', 'true', '/tmp/TRELLIS.2/o-voxel', False),
        ('nvdiffrec renderutils', 'git clone -q -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git /tmp/ext/nvdiffrec', '/tmp/ext/nvdiffrec', True),
    ]
    for i, (name, clone, path, opt) in enumerate(exts, 1):
        sh(clone, f'{name}: source', 'build')
        sh(f'pip install -v --no-build-isolation --no-deps {path}', f'{name}: compiled + installed ({i}/{len(exts)})', 'build', optional=opt)

    # ------------------------------------------------------------------ 3. the weights: ALL of them, verified
    stage(3, 'downloading the full TRELLIS.2-4B weights')

    def tree(repo, prefix=''):
        with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/tree/main/{prefix}?recursive=1') as r:
            return [f for f in json.load(r) if f['type'] == 'file']

    files = [('microsoft/TRELLIS.2-4B', f) for f in tree('microsoft/TRELLIS.2-4B')]
    files += [('microsoft/TRELLIS-image-large', f) for f in tree('microsoft/TRELLIS-image-large', 'ckpts') if 'ss_dec_conv3d_16l8_fp16' in f['path']]
    files += [('camenduru/dinov3-vitl16-pretrain-lvd1689m', f) for f in tree('camenduru/dinov3-vitl16-pretrain-lvd1689m')]
    total = sum(f.get('size', 0) for _, f in files)
    note(f'{len(files)} files, {total / 1e9:.2f} GB in all (TRELLIS.2-4B: every checkpoint, 512 + 1024)')
    done, last, t_dl = 0, 0.0, time.time()
    for repo, f in files:
        dst = f'{W}/{repo.split("/")[1]}/{f["path"]}'
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        size, sha = f.get('size', 0), (f.get('lfs') or {}).get('oid')
        for attempt in range(5):
            have = os.path.getsize(dst) if os.path.exists(dst) else 0
            if have >= size and size: break
            try:
                req = urllib.request.Request(f'https://huggingface.co/{repo}/resolve/main/{f["path"]}', headers={'Range': f'bytes={have}-'} if have else {})
                with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'ab' if have else 'wb') as out:
                    while True:
                        b = r.read(8 << 20)
                        if not b: break
                        out.write(b); have += len(b)
                        pct = (done + have) / total * 100
                        if pct - last >= 2.5 or pct >= 99.99:
                            last = pct
                            el = time.time() - t_dl; spd = (done + have) / max(el, 1e-3)
                            note(f'⬇ weights {pct:5.1f}% · {(done + have) / 1e9:.2f}/{total / 1e9:.2f} GB · {spd / 1e6:.0f} MB/s · '
                                 f'ETA {(total - done - have) / max(spd, 1) / 60:.1f} min · {f["path"].split("/")[-1]}', title='TRELLIS.2 · downloading')
                break
            except Exception as e:
                note(f'⚠ {f["path"]}: {e} — resuming (try {attempt + 2}/5)', prio=4); time.sleep(5 * (attempt + 1))
        if size and os.path.getsize(dst) != size:
            note(f'✗ {f["path"]}: {os.path.getsize(dst)} of {size} bytes', prio=5); raise SystemExit(1)
        if sha:
            h = hashlib.sha256()
            with open(dst, 'rb') as fh:
                for b in iter(lambda: fh.read(64 << 20), b''): h.update(b)
            if h.hexdigest() != sha:
                note(f'✗ {f["path"]}: checksum mismatch — deleting, re-run', prio=5); os.remove(dst); raise SystemExit(1)
        done += size
    note(f'✓ all weights downloaded and verified (SHA-256): {total / 1e9:.2f} GB in {(time.time() - t_dl) / 60:.1f} min')

    # the checkpoints are bf16; a T4 has no bf16 → fp16 (weights are cast as they load)
    for fn in os.listdir(f'{W}/TRELLIS.2-4B/ckpts'):
        if fn.endswith('.json'):
            p = f'{W}/TRELLIS.2-4B/ckpts/{fn}'; c = json.load(open(p))
            if c.get('args', {}).get('dtype') == 'bfloat16': c['args']['dtype'] = 'float16'; json.dump(c, open(p, 'w'))
    pj = f'{W}/TRELLIS.2-4B/pipeline.json'; cfg = json.load(open(pj))
    cfg['args']['models']['sparse_structure_decoder'] = f'{W}/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16'
    cfg['args']['image_cond_model']['args']['model_name'] = f'{W}/dinov3-vitl16-pretrain-lvd1689m'
    cfg['args'].pop('rembg_model', None)          # our inputs are already cut out (RGBA): no background remover
    json.dump(cfg, open(pj, 'w'), indent=1)
    p = '/tmp/TRELLIS.2/trellis2/pipelines/trellis2_image_to_3d.py'; s = open(p).read()
    s = s.replace("pipeline.rembg_model = getattr(rembg, args['rembg_model']['name'])(**args['rembg_model']['args'])",
                  "pipeline.rembg_model = getattr(rembg, args['rembg_model']['name'])(**args['rembg_model']['args']) if args.get('rembg_model') else None")
    open(p, 'w').write(s)

    # ------------------------------------------------------------------ 4. load
    stage(4, 'loading TRELLIS.2')
    os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
    sys.path.insert(0, '/tmp/TRELLIS.2')
    import torch
    from PIL import Image
    import io
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    import o_voxel
    pipe = Trellis2ImageTo3DPipeline.from_pretrained(f'{W}/TRELLIS.2-4B')
    pipe.low_vram = True
    pipe.cuda()
    note(f'✓ loaded · torch {torch.__version__} · GPU memory {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB')

    # ------------------------------------------------------------------ 5. every garment
    stage(5, f'making {len(INPUTS)} garments')
    for i, (name, b64) in enumerate(INPUTS.items(), 1):
        img = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
        img.save(f'{OUT}/{name}_input.png')
        info = {}
        for kind in ('1024_cascade', '512'):
            try:
                t = time.time(); torch.cuda.reset_peak_memory_stats()
                note(f'▶ {i}/{len(INPUTS)} {name}: generating ({kind})')
                mesh = pipe.run(img, seed=1, pipeline_type=kind)[0]
                mesh.simplify(16777216)
                glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                                                 attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                                                 decimation_target=400000, texture_size=2048, remesh=True, remesh_band=1, remesh_project=0, verbose=False)
                glb.export(f'{OUT}/{name}.glb', extension_webp=True)
                info = {'pipeline': kind, 'seconds': round(time.time() - t), 'peak_gpu_gb': round(torch.cuda.max_memory_allocated() / 1e9, 1),
                        'glb_mb': round(os.path.getsize(f'{OUT}/{name}.glb') / 1e6, 1)}
                note(f'✓ {i}/{len(INPUTS)} {name}: {info}')
                break
            except torch.cuda.OutOfMemoryError:
                note(f'⚠ {name}: out of GPU memory at {kind}, trying 512', prio=4)
                torch.cuda.empty_cache()
            except Exception as e:
                info = {'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-1500:]}
                note(f'✗ {name}: {info["error"]}\n{info["trace"][-600:]}', prio=5)
                torch.cuda.empty_cache()
                break
        summary['garments'][name] = info
        json.dump(summary, open(f'{WORK}/summary.json', 'w'), indent=1)

    stage(6, 'done')
    ok = [n for n, g in summary['garments'].items() if 'glb_mb' in g]
    note(f'✅ FINISHED in {(time.time() - T0) / 60:.0f} min · {len(ok)}/{len(INPUTS)} garments made: {", ".join(ok)}', title='TRELLIS.2 · done', prio=4)
except SystemExit:
    raise
except Exception as e:
    note(f'✗ crashed: {type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}', prio=5)
    raise
finally:
    json.dump(summary, open(f'{WORK}/summary.json', 'w'), indent=1)
