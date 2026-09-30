"""
ChatGarment (Bian et al., CVPR 2025; Apache-2.0: github.com/biansy000/ChatGarment) on a Kaggle T4 ×2:
photos of people wearing clothes → GarmentCode sewing patterns (2D panels + stitches), which our own
pipeline sews and drapes on the model.

LLaVA-1.5-7B + ChatGarment's LoRA, in fp16 (T4: no bfloat16, no flash-attention), the LoRA merged and the
model split over both GPUs. Prepended by tools/garment_ml/kernel.py with common/progress.py (note, sh,
stage, fetch) and MODEL / TOPIC / INPUTS. Live progress: https://ntfy.sh/<TOPIC>.
"""
import base64, glob, io, json, os, shutil, sys, zipfile
from PIL import Image

TMP, W, OUT = '/tmp/cg', '/tmp/w', f'{WORK}/out'
for d in (TMP, W, OUT): os.makedirs(d, exist_ok=True)
N = 6


KAGGLE_PLACE = '''def kaggle_place(model):
        """merge the LoRA, then split the fp16 model over the GPUs"""
        import gc
        from accelerate import infer_auto_device_map, dispatch_model
        model = model.merge_and_unload().half()
    meta = [n for n, p in list(model.named_parameters()) + list(model.named_buffers()) if p.is_meta]
    print("still on meta:", meta[:10], len(meta), flush=True)
    if meta: raise RuntimeError(f"{len(meta)} tensors never loaded, e.g. {meta[:5]}")
        model.eval()
        gc.collect()
        n = torch.cuda.device_count()
        mem = {i: torch.cuda.get_device_properties(i).total_memory for i in range(n)}
        print('GPUs', n, {i: m // 2**30 for i, m in mem.items()}, flush=True)
        # GPU 0 also holds the vision tower, the activations and the KV cache
        max_memory = {i: f"{max(1, int(mem[i] / 2**30 - (3.5 if i == 0 else 1.2)))}GiB" for i in range(n)}
        max_memory["cpu"] = "40GiB"
        dmap = infer_auto_device_map(model, max_memory=max_memory, dtype=torch.float16,
                                     no_split_module_classes=["LlamaDecoderLayer", "CLIPEncoderLayer", "CLIPVisionEmbeddings"])
        print("device map:", sorted(set(map(str, dmap.values()))), flush=True)
        return dispatch_model(model, device_map=dmap)
'''


def patch_script(CG, IMGS):
    """ChatGarment's inference script adapted to Kaggle T4s → scripts/kaggle_imggen.py; returns its arguments"""
    src = open(f'{CG}/scripts/evaluate_garment_v2_imggen_1float.py').read()
    rep = [
        ("attn_implementation = 'flash_attention_2'", "attn_implementation = 'eager'"),
        ('import deepspeed\n', ''),
        ('torch_dtype=(torch.bfloat16 if training_args.bf16 else None),', 'torch_dtype=torch.float16, low_cpu_mem_usage=True,'),
        ('vision_tower.to(dtype=torch.bfloat16 if training_args.bf16 else torch.float16, device=training_args.device)',
         'vision_tower.to(dtype=torch.float16)'),
        ('assert args.precision == "bf16"\n    model = model.bfloat16().cuda()', 'model = model.half()'),
        ('state_dict = torch.load(resume_path, map_location="cpu")', 'state_dict = torch.load(resume_path, map_location="cpu", mmap=True)'),
        ('model.load_state_dict(state_dict, strict=True)\n    model = model.bfloat16().cuda()\n    device = model.device',
         'model.load_state_dict(state_dict, strict=True, assign=True)\n    del state_dict\n    model = kaggle_place(model)\n    device = torch.device("cuda:0")'),
        ('assert args.precision == "bf16"\n            image_clip = image_clip.bfloat16()', 'image_clip = image_clip.half()'),
    ]
    for a, b in rep:
        if a not in src: raise RuntimeError(f'patch target not found: {a[:70]}')
        src = src.replace(a, b)
    src = src.replace('def main(args):', KAGGLE_PLACE + '\n\ndef main(args):', 1)
    open(f'{CG}/scripts/kaggle_imggen.py', 'w').write(src)

    args = ('--lora_enable True --lora_r 128 --lora_alpha 256 --mm_projector_lr 2e-5 '
            '--model_name_or_path liuhaotian/llava-v1.5-7b --version v1 --data_path ./ '
            f'--data_path_eval {IMGS} --image_folder ./ --vision_tower openai/clip-vit-large-patch14-336 '
            '--mm_projector_type mlp2x_gelu --mm_vision_select_layer -2 --mm_use_im_start_end False '
            '--mm_use_im_patch_token False --image_aspect_ratio pad --group_by_modality_length True '
            '--fp16 True --bf16 False --output_dir ./checkpoints/llava-v1.5-7b-task-lora --num_train_epochs 1 '
            '--per_device_train_batch_size 1 --per_device_eval_batch_size 1 --gradient_accumulation_steps 1 '
            '--evaluation_strategy no --save_strategy no --learning_rate 2e-4 --weight_decay 0. --warmup_ratio 0.03 '
            '--lr_scheduler_type cosine --logging_steps 1 --model_max_length 3072 --gradient_checkpointing True '
            '--dataloader_num_workers 1 --lazy_preprocess True --report_to none')

    return args


def run():
    gpu = subprocess.run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', shell=True, capture_output=True, text=True).stdout.strip()
    note(f'started on {gpu.replace(chr(10), " + ") or "NO GPU"} · {len(INPUTS)} photos')

    stage(1, N, 'code + dependencies')
    CG, GC = f'{TMP}/ChatGarment', f'{TMP}/GarmentCodeRC'
    sh(f'rm -rf {CG} {GC} && git clone -q --depth 1 https://github.com/biansy000/ChatGarment {CG} && '
       f'git clone -q --depth 1 https://github.com/biansy000/GarmentCodeRC {GC}', 'ChatGarment + GarmentCode source')
    sh('pip install -q "transformers==4.37.2" "tokenizers==0.15.2" "sentencepiece>=0.2" "peft==0.10.0" "accelerate==0.32.0" '
       'easydict "einops==0.6.1" "einops-exts==0.0.4" "timm==0.6.13" shortuuid svgwrite svgpathtools pyyaml scipy json-repair '
       'cairosvg psutil matplotlib tensorboard opencv-python-headless',
       'Python dependencies', 'pip')
    sh('(which apt-get && (apt-get install -y -q libcairo2 >/dev/null 2>&1 || true)); python -c "import cairosvg"', 'Cairo (SVG → PNG for GarmentCode)', 'pip')
    sh(f'pip install -q --no-deps -e {CG}', 'ChatGarment package', 'pip')
    sh(f'pip install -q --no-deps -e {GC}', 'GarmentCode package', 'pip', optional=True)
    # ChatGarment's training module imports DeepSpeed at load time; inference never calls it
    STUB = f'{TMP}/stubs'
    os.makedirs(f'{STUB}/deepspeed/runtime/zero', exist_ok=True)
    open(f'{STUB}/deepspeed/__init__.py', 'w').write('from . import zero\ndef initialize(*a, **k):\n    raise RuntimeError("no DeepSpeed (inference only)")\n')
    open(f'{STUB}/deepspeed/zero.py', 'w').write('class GatheredParameters:\n    def __init__(self, *a, **k): pass\n    def __enter__(self): return self\n    def __exit__(self, *a): return False\n')
    open(f'{STUB}/deepspeed/runtime/__init__.py', 'w').write('')
    open(f'{STUB}/deepspeed/runtime/zero/__init__.py', 'w').write('')
    open(f'{STUB}/deepspeed/runtime/zero/partition_parameters.py', 'w').write('class ZeroParamStatus:\n    NOT_AVAILABLE = 0\n    AVAILABLE = 1\n    INFLIGHT = 2\n')
    for f in [f'{CG}/llava/garment_utils_v2.py', f'{CG}/run_garmentcode_sim.py']:
        if os.path.exists(f):
            txt = open(f).read()                      # read first: open(f, 'w') would empty it
            open(f, 'w').write(txt.replace('/is/cluster/fast/sbian/github/GarmentCodeV2/', GC + '/'))
    if not os.path.exists(f'{CG}/assets'): os.symlink(f'{GC}/assets', f'{CG}/assets')
    for d in (GC, CG):
        if not os.path.exists(f'{d}/system.json') and os.path.exists(f'{GC}/system.template.json'): shutil.copy(f'{GC}/system.template.json', f'{d}/system.json')

    stage(2, N, 'downloading ALL weights: ChatGarment checkpoint + LLaVA-1.5-7B + CLIP ViT-L/336')
    got = fetch([('dirkneu/chatgarment-ckpt', ''), ('liuhaotian/llava-v1.5-7b', ''), ('openai/clip-vit-large-patch14-336', '')], W,
                skip=lambda p: p.endswith(('.h5', '.msgpack')) or p.startswith('flax'))
    LLAVA, CLIP = got['liuhaotian/llava-v1.5-7b'], got['openai/clip-vit-large-patch14-336']
    CK = f'{CG}/checkpoints/try_7b_lr1e_4_v3_garmentcontrol_4h100_v4_final'
    os.makedirs(CK, exist_ok=True)
    os.symlink(f'{W}/chatgarment-ckpt/pytorch_model.bin', f'{CK}/pytorch_model.bin')
    cfg = json.load(open(f'{LLAVA}/config.json')); cfg['mm_vision_tower'] = CLIP; json.dump(cfg, open(f'{LLAVA}/config.json', 'w'))

    stage(3, N, 'photos')
    IMGS = f'{TMP}/imgs'; os.makedirs(IMGS, exist_ok=True)
    for name, b64 in INPUTS.items(): Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGB').save(f'{IMGS}/{name}.png')
    note(f'{len(INPUTS)} photos: {", ".join(INPUTS)}')

    stage(4, N, 'patching the inference script for T4 (fp16, eager attention, 2 GPUs)')
    args = patch_script(CG, IMGS)
    args = args.replace('liuhaotian/llava-v1.5-7b', LLAVA).replace('openai/clip-vit-large-patch14-336', CLIP)

    stage(5, N, 'ChatGarment: photo → sewing pattern (loads the 7B model, then each photo)')
    env = f'cd {CG} && HF_HOME={TMP}/hf PYTHONPATH={STUB}:{CG}:{GC} TOKENIZERS_PARALLELISM=false'
    sh(f'{env} python scripts/kaggle_imggen.py {args}', 'ChatGarment inference', 'inference')

    stage(6, N, 'results')
    per = {}
    for p in glob.glob(f'{CG}/runs/**/vis_new/valid_garment_*', recursive=True):
        gid = os.path.basename(p).replace('valid_garment_', '')
        specs = glob.glob(f'{p}/**/*_specification.json', recursive=True)
        txt = f'{p}/output.txt'
        per[gid] = {'answer': open(txt).read()[-3000:] if os.path.exists(txt) else '', 'specs': []}
        for s in specs:
            dst = f'{OUT}/{gid}__{os.path.basename(s)}'
            shutil.copy(s, dst); per[gid]['specs'].append(os.path.basename(dst))
        for png in glob.glob(f'{p}/**/*.png', recursive=True)[:6]: shutil.copy(png, f'{OUT}/{gid}__{os.path.basename(png)}')
    json.dump(per, open(f'{WORK}/summary.json', 'w'), indent=1)
    n = sum(len(v['specs']) for v in per.values())
    note(f'✅ FINISHED in {(time.time() - T0) / 60:.0f} min · {n} sewing patterns for {len(per)}/{len(INPUTS)} photos: ' +
         ', '.join(f'{k} ({len(v["specs"])})' for k, v in per.items()), title=f'{MODEL} · done', prio=4)


crash_guard(run)
