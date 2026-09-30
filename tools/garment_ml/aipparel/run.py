"""
AIpparel (Nakayama et al., CVPR 2025 Highlight; github.com/georgeNakayama/AIpparel-Code) on a Kaggle T4 ×2:
photo (+ our garment words) → a sewing pattern (panels as edge loops, their 3D placement, and stitches) in
GarmentCodeData's format, generated token by token by a LLaVA-1.5-7B fine-tuned on 120k GarmentCode garments.

Its checkpoint is ONE 27 GB fp32 file (the whole model). On Kaggle: loaded memory-mapped (no 27 GB of RAM), each
tensor turned fp16 as it's assigned (T4: no bfloat16), and the model split over both GPUs — the embedding, the
vision tower, the last layers, the norm, the LM head and AIpparel's regression heads on GPU 0 (its code builds
its masks with .cuda(), i.e. GPU 0), the first layers on GPU 1. Prepended by tools/garment_ml/kernel.py with
common/progress.py (note, sh, stage, fetch) and MODEL / TOPIC / INPUTS. Live progress: https://ntfy.sh/<TOPIC>.
"""
import base64, glob, io, json, os, shutil, subprocess, time
from PIL import Image

TMP, W, OUT = '/tmp/ap', '/tmp/w', f'{WORK}/out'
for d in (TMP, W, OUT): os.makedirs(d, exist_ok=True)
N = 6

# our garment words for the test photos (server/src/shared/ngl.js readings), as AIpparel's text prompt
DESCRIPTIONS = {
    'tee': 'A fitted short-sleeve knit t-shirt with a crew neckline, hip length, straight hem.',
    'cargo': 'Loose straight-leg cargo trousers, full length, with an elastic drawstring waistband and side pockets.',
    'plaid': 'An oversized cropped short-sleeve shirt with a collar and an open front.',
    'set': 'A fitted cropped short-sleeve t-shirt with a crew neckline, and wide-leg floor-length trousers.',
    'skirt': 'A straight mini skirt with a low-rise waistband.',
}

# the model built on the meta device, the checkpoint assigned in fp16, then split over the GPUs
KAGGLE_LOAD = '''
def kaggle_load(cfg, dataset, torch_dtype):
    import gc, time
    from accelerate import init_empty_weights, dispatch_model
    kw = dict(cfg.model)
    config, kw = AIpparelForCausalLM.config_class.from_pretrained(cfg.version, return_unused_kwargs=True, **kw)
    with init_empty_weights():
        model = AIpparelForCausalLM(config, **kw, vision_tower=cfg.vision_tower,
                                    panel_edge_indices=dataset.panel_edge_type_indices, gt_stats=dataset.gt_stats)
    return model


def kaggle_fill(model, path, llava):
    import gc, time
    t = time.time()
    try:
        sd = torch.load(path, map_location="cpu", mmap=True, weights_only=False)
    except Exception as e:
        print("mmap load failed (", e, ") - plain load", flush=True)
        sd = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(sd, dict) and "state_dict" in sd and not any(k.startswith("model.") for k in sd):
        sd = sd["state_dict"]
    keys = list(sd)
    print("checkpoint:", len(keys), "tensors, e.g.", keys[:4], flush=True)
    for pre in ("module.", "base_model.model."):
        if keys and all(k.startswith(pre) for k in keys):
            sd = {k[len(pre):]: v for k, v in sd.items()}
    own = dict(model.named_parameters()); own.update(dict(model.named_buffers()))
    # the vocabulary must be the one AIpparel was trained with (its garment tokens' ids)
    rows, have = sd["model.embed_tokens.weight"].shape[0], own["model.embed_tokens.weight"].shape[0]
    if rows != have:
        raise RuntimeError(f"vocabulary: checkpoint {rows} tokens, tokenizer {have} - the garment token ids would not match")
    # LLaVA-1.5's vision projector (AIpparel kept it frozen: not in its checkpoint)
    lsd = torch.load(f"{llava}/pytorch_model-00002-of-00002.bin", map_location="cpu", mmap=True, weights_only=False)
    proj = {k: v for k, v in lsd.items() if k.startswith("model.mm_projector.")}
    print("LLaVA projector:", {k: tuple(v.shape) for k, v in proj.items()}, flush=True)
    for k, v in proj.items():
        if k not in sd: sd[k] = v
    del lsd
    bad = [(k, tuple(v.shape), tuple(own[k].shape)) for k, v in sd.items() if k in own and own[k].shape != v.shape]
    if bad: print("shape mismatches:", bad[:10], flush=True)
    half = {}
    for k in list(sd):
        v = sd.pop(k)
        if k in own and own[k].shape == v.shape:
            half[k] = v.to(torch.float16) if v.is_floating_point() else v.clone()
    del sd; gc.collect()
    res = model.load_state_dict(half, strict=False, assign=True)
    del half; gc.collect()
    print("missing:", len(res.missing_keys), res.missing_keys[:8], "unexpected:", len(res.unexpected_keys), flush=True)
    model = model.half()
    meta = [n for n, p in list(model.named_parameters()) + list(model.named_buffers()) if p.is_meta]
    print("still on meta:", len(meta), meta[:8], flush=True)
    if meta:
        raise RuntimeError(f"{len(meta)} tensors never loaded, e.g. {meta[:5]}")
    print(f"checkpoint loaded in {time.time() - t:.0f}s", flush=True)
    return model


def kaggle_place(model):
    from accelerate import dispatch_model
    n = torch.cuda.device_count()
    L = len(model.get_model().layers)
    first = L * 9 // 16 if n > 1 else 0          # layers [0, first) on GPU 1, the rest (and everything else) on GPU 0
    dmap = {"lm_head": 0}
    for name, _ in model.get_model().named_children():
        if name == "layers":
            for i in range(L): dmap[f"model.layers.{i}"] = 1 if i < first else 0
        else:
            dmap[f"model.{name}"] = 0
    print("GPUs", n, "- layers 0..%d on GPU 1, the rest on GPU 0" % (first - 1), flush=True)
    model.config.use_cache = True
    model.eval()
    model = dispatch_model(model, device_map=dmap)
    for i in range(n): print(f"GPU {i}: {torch.cuda.memory_allocated(i) / 2**30:.1f} GiB", flush=True)
    return model
'''


def patch_script(AP):
    """AIpparel's inference script adapted to Kaggle T4s → scripts/kaggle_inference.py"""
    src = open(f'{AP}/scripts/inference.py').read()
    rep = [

        ('    model.enable_input_require_grads()\n    model.gradient_checkpointing_enable()\n', ''),
        ('    vision_tower.to(dtype=torch_dtype, device="cuda")', '    vision_tower.to(dtype=torch_dtype)'),
        ('''    state_dict = torch.load(cfg.pre_trained, map_location='cpu')
    model.load_state_dict(state_dict, strict=False)
    model = model.to("cuda")''', '    model = kaggle_place(kaggle_fill(model, cfg.pre_trained, cfg.version))'),
        ('num_workers=12,', 'num_workers=0,'),
    ]
    # the model built on the meta device (from_pretrained would download and load LLaVA's own 13 GB first)
    a = src.index('    model = AIpparelForCausalLM.from_pretrained('); b = src.index('\n    )\n', a) + len('\n    )\n')
    src = src[:a] + '    model = kaggle_load(cfg, dataset, torch_dtype)\n' + src[b:]
    for a, b in rep:
        if a not in src: raise RuntimeError(f'patch target not found: {a[:70]}')
        src = src.replace(a, b)
    src = src.replace('@hydra.main(', KAGGLE_LOAD + '\n\n@hydra.main(', 1)
    # one input failing doesn't stop the others
    L = src.split('\n')
    i0 = next(i for i, l in enumerate(L) if l.startswith('    for i, input_dict in enumerate(val_loader):'))
    i1 = next(i for i, l in enumerate(L) if l.startswith('if __name__'))
    body = [l for l in L[i0 + 1:i1]]
    while body and not body[-1].strip(): body.pop()
    body = ['    ' + l if l.strip() else l for l in body]
    L = L[:i0 + 1] + ['        try:', '            import time as _t; _t0 = _t.time()'] + body + [
        '        except Exception as e:',
        '            import traceback; traceback.print_exc()',
        '            print("INPUT FAILED", i, type(e).__name__, e, flush=True)',
        '            continue',
        '        print("INPUT DONE", i, f"{_t.time() - _t0:.0f}s", flush=True)', '', ''] + L[i1:]
    open(f'{AP}/scripts/kaggle_inference.py', 'w').write('\n'.join(L))


def run():
    gpu = subprocess.run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', shell=True, capture_output=True, text=True).stdout.strip()
    note(f'started on {gpu.replace(chr(10), " + ") or "NO GPU"} · {len(INPUTS)} photos')

    stage(1, N, 'code + dependencies')
    AP = f'{TMP}/AIpparel'
    sh(f'rm -rf {AP} && git clone -q --depth 1 https://github.com/georgeNakayama/AIpparel-Code {AP}', 'AIpparel source')
    # its own pins where they matter (generation internals: transformers 4.31); no DeepSpeed / flash-attn / wandb
    # generation internals need transformers 4.31 (what AIpparel was built on). Its tokenizers pin (<0.14) has no wheel
    # for Kaggle's Python, and without the library transformers 4.31 reads LLaVA's AddedToken entries as 3 NEW tokens
    # (every garment token id then off by 3): tokenizers 0.15.2 (abi3 wheel; token ids checked identical to 0.13.3
    # on AIpparel's prompts) with transformers' version table relaxed
    sh('pip install -q --no-deps "transformers==4.31.0" && pip install -q "tokenizers==0.15.2" "sentencepiece>=0.1.99" "accelerate==0.32.0" '
       '"huggingface_hub>=0.16,<0.25" "hydra-core==1.3.2" "omegaconf==2.3.0" safetensors regex einops svgpathtools cairosvg scipy matplotlib opencv-python-headless',
       'Python dependencies', 'pip')
    import importlib.util
    dv = os.path.join(os.path.dirname(importlib.util.find_spec('transformers').origin), 'dependency_versions_table.py')
    txt = open(dv).read(); a = '"tokenizers": "tokenizers>=0.11.1,!=0.11.3,<0.14"'
    if a not in txt: raise RuntimeError('transformers version table: tokenizers pin not found')
    open(dv, 'w').write(txt.replace(a, '"tokenizers": "tokenizers>=0.11.1,!=0.11.3"'))
    sh('python -c "import transformers, tokenizers, sentencepiece, hydra; print(transformers.__version__, tokenizers.__version__)"', 'dependencies import', 'pip')
    sh('(which apt-get && (apt-get install -y -q libcairo2 >/dev/null 2>&1 || true)); python -c "import cairosvg"', 'Cairo (pattern SVG → PNG)', 'pip')

    stage(2, N, 'downloading ALL weights: AIpparel checkpoint (27 GB) + LLaVA-1.5-7B projector shard/config/tokenizer + CLIP ViT-L/14')
    # only what inference reads: AIpparel's checkpoint (not its datasets); LLaVA's config + tokenizer and the shard with
    # its vision projector (AIpparel's checkpoint has every other weight; the projector stayed LLaVA's); CLIP's safetensors
    got = fetch([('georgeNakayama/AIpparel', ''), ('liuhaotian/llava-v1.5-7b', ''), ('openai/clip-vit-large-patch14', '')], W,
                skip=lambda p: p.endswith(('.zip', '.parquet', '.tar.gz', '.h5', '.msgpack')) or p.startswith(('flax', 'tf_', 'rust'))
                or (p.startswith('pytorch_model') and p != 'pytorch_model-00002-of-00002.bin'))
    CKPT = f'{W}/AIpparel/aipparel_pretrained.pth'
    LLAVA, CLIP = got['liuhaotian/llava-v1.5-7b'], got['openai/clip-vit-large-patch14']
    note('weights: ' + ', '.join(f'{os.path.relpath(p, W)} {os.path.getsize(p) / 1e9:.2f} GB' for p in glob.glob(f'{W}/**/*', recursive=True) if os.path.isfile(p) and os.path.getsize(p) > 5e7))

    stage(3, N, 'photos')
    IMGS = f'{TMP}/imgs'; os.makedirs(IMGS, exist_ok=True)
    items = []
    for name, b64 in INPUTS.items():
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGB')
        # AIpparel saw square renders of one garment set, centred: the photo padded square on white
        s = max(im.size); sq = Image.new('RGB', (s, s), (255, 255, 255)); sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
        p = f'{IMGS}/{name}.png'; sq.save(p)
        items.append({'type': 'image', 'inputs': {'image_path': p}, 'name': name, 'mode': 'image'})
        if name in DESCRIPTIONS:
            items.append({'type': 'text_image', 'inputs': {'image_path': p, 'description': DESCRIPTIONS[name]}, 'name': name, 'mode': 'text_image'})
    json.dump(items, open(f'{TMP}/inputs.json', 'w'), indent=1)
    note(f'{len(items)} requests: ' + ', '.join(f'{it["name"]}/{it["mode"]}' for it in items))

    stage(4, N, 'patching the inference script for T4 (fp16, meta-device load, 2 GPUs)')
    patch_script(AP)

    stage(5, N, 'AIpparel: photo → sewing pattern (loads the 7B model, then each request)')
    run_dir = f'{TMP}/run'
    over = (f'pre_trained={CKPT} inference_json={TMP}/inputs.json version={LLAVA} vision_tower={CLIP} precision=fp16 '
            f'hydra.run.dir={run_dir}')
    env = f'cd {AP} && HF_HOME={TMP}/hf PYTHONPATH={AP} TOKENIZERS_PARALLELISM=false'
    import threading
    stop = threading.Event()
    def follow():
        seen, lf = 0, f'{WORK}/logs_inference.txt'
        while not stop.wait(20):
            if not os.path.exists(lf): continue
            lines = open(lf, errors='replace').read().splitlines()
            for l in lines[seen:]:
                if l.startswith(('INPUT DONE', 'INPUT FAILED', 'still on meta', 'missing:', 'checkpoint', 'GPUs', 'GPU ', 'Total parameters', 'mmap', 'LLaVA projector', 'shape mismatches', 'RuntimeError', 'Added')):
                    note('  ' + l[:300])
            seen = len(lines)
    threading.Thread(target=follow, daemon=True).start()
    try:
        sh(f'{env} python scripts/kaggle_inference.py --config-name aipparel_inference --config-path ../configs {over}', 'AIpparel inference', 'inference')
    finally:
        stop.set()

    stage(6, N, 'results')
    per = {}
    for d in sorted(glob.glob(f'{run_dir}/inference/sample_*')):
        i = int(d.rsplit('_', 1)[1]); it = items[i] if i < len(items) else {'name': f'sample{i}', 'mode': '?'}
        key = f'{it["name"]}__{it["mode"]}'
        per[key] = {'files': []}
        for f in glob.glob(f'{d}/**/*', recursive=True):
            if os.path.isfile(f) and not f.endswith('input.png'):
                dst = f'{OUT}/{key}__{os.path.basename(f)}'; shutil.copy(f, dst); per[key]['files'].append(os.path.basename(dst))
    json.dump(per, open(f'{WORK}/summary.json', 'w'), indent=1)
    n = sum(any(f.endswith('specification.json') for f in v['files']) for v in per.values())
    note(f'✅ FINISHED in {(time.time() - T0) / 60:.0f} min · sewing patterns for {n}/{len(items)} requests: ' +
         ', '.join(per), title=f'{MODEL} · done', prio=4)


crash_guard(run)
