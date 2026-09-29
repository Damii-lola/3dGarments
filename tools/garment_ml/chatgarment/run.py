"""
ChatGarment on a Kaggle GPU notebook: garment photos → GarmentCode sewing patterns.

    photos (/kaggle/input/<dataset>/*.png|jpg, plus ChatGarment's own examples)
      → ChatGarment (LLaVA-1.5-7B + LoRA, Apache-2.0: https://github.com/biansy000/ChatGarment)
      → per photo: the model's garment description + GarmentCode pattern specification JSON
        (2D panels + stitches) — the sewing pattern our in-browser cloth simulation drapes
      → /kaggle/working/chatgarment_out.zip + summary.json

Adapted to Kaggle's free GPUs (T4 ×2 / P100: no bfloat16, no flash-attention, 15–16 GB each):
fp16, eager attention, the model built on the CPU, the checkpoint memory-mapped and its LoRA merged,
then the 7B model split across the GPUs (accelerate). Everything is logged to /kaggle/working/log.txt.
"""
import glob, json, os, re, shutil, subprocess, sys, time, zipfile

T0 = time.time()
WORK = '/kaggle/working'
TMP = '/tmp/cg'
os.makedirs(TMP, exist_ok=True)
LOG = open(f'{WORK}/log.txt', 'a')


def log(*a):
    s = f'[{time.time() - T0:7.0f}s] ' + ' '.join(str(x) for x in a)
    print(s, flush=True)
    LOG.write(s + '\n'); LOG.flush()


def sh(cmd, check=True):
    log('$', cmd)
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    out = (r.stdout + r.stderr)[-4000:]
    if out.strip(): log(out)
    if check and r.returncode: raise RuntimeError(f'failed ({r.returncode}): {cmd}')
    return r


def summary(**kw):
    path = f'{WORK}/summary.json'
    data = json.load(open(path)) if os.path.exists(path) else {}
    data.update(kw)
    json.dump(data, open(path, 'w'), indent=1)


summary(stage='start')
sh('nvidia-smi', check=False)
sh('df -h /tmp /kaggle/working | tail -3', check=False)
sh('free -g', check=False)

# ------------------------------------------------------------------ code
CG, GC = f'{TMP}/ChatGarment', f'{TMP}/GarmentCodeRC'
if not os.path.exists(CG): sh(f'git clone -q --depth 1 https://github.com/biansy000/ChatGarment {CG}')
if not os.path.exists(GC): sh(f'git clone -q --depth 1 https://github.com/biansy000/GarmentCodeRC {GC}')
summary(stage='cloned')

# dependencies (keep Kaggle's own torch / numpy; ChatGarment pins the rest)
sh('pip install -q "transformers==4.37.2" "tokenizers==0.15.1" "sentencepiece==0.1.99" "peft==0.10.0" '
   '"accelerate==0.32.0" easydict "einops==0.6.1" "einops-exts==0.0.4" "timm==0.6.13" shortuuid '
   'svgwrite svgpathtools CairoSVG pyyaml scipy')
sh(f'pip install -q --no-deps -e {CG}')
sh(f'pip install -q --no-deps -e {GC}', check=False)
summary(stage='installed')

# GarmentCode: its repo on the path, its assets beside ChatGarment, a system config
for f in [f'{CG}/llava/garment_utils_v2.py', f'{CG}/run_garmentcode_sim.py']:
    s = open(f).read().replace('/is/cluster/fast/sbian/github/GarmentCodeV2/', GC + '/')
    open(f, 'w').write(s)
if not os.path.exists(f'{CG}/assets'): os.symlink(f'{GC}/assets', f'{CG}/assets')
if not os.path.exists(f'{GC}/system.json'): shutil.copy(f'{GC}/system.template.json', f'{GC}/system.json')
if not os.path.exists(f'{CG}/system.json'): shutil.copy(f'{GC}/system.template.json', f'{CG}/system.json')

# ------------------------------------------------------------------ weights (the authors' SharePoint link)
CK = f'{CG}/checkpoints/try_7b_lr1e_4_v3_garmentcontrol_4h100_v4_final'
os.makedirs(CK, exist_ok=True)
if not os.path.exists(f'{CK}/pytorch_model.bin'):
    url = ('https://sjtueducn-my.sharepoint.com/:u:/g/personal/biansiyuan_sjtu_edu_cn/'
           'EQayoB8ie7ZIsFrjLWdBASQBFexZHXcGjrS6ghgGCjIMzw?e=o60Y65&download=1')
    dl = f'{TMP}/weights.download'
    sh(f'curl -sSL --retry 5 -o {dl} "{url}"')
    kind = sh(f'file -b {dl}').stdout.strip()
    size = os.path.getsize(dl)
    log('weights file:', kind, size // 2**20, 'MB')
    summary(weights={'type': kind, 'mb': size // 2**20})
    if size < 50 * 2**20: raise RuntimeError('the weights link did not give the checkpoint (see log.txt)')
    if 'Zip' in kind:
        with zipfile.ZipFile(dl) as z: z.extractall(f'{TMP}/weights')
        found = glob.glob(f'{TMP}/weights/**/pytorch_model.bin', recursive=True)
        if not found: raise RuntimeError('no pytorch_model.bin inside the weights zip')
        shutil.move(found[0], f'{CK}/pytorch_model.bin')
        os.remove(dl)
    else:
        shutil.move(dl, f'{CK}/pytorch_model.bin')
summary(stage='weights')

# ------------------------------------------------------------------ photos
IMGS = f'{TMP}/imgs'
os.makedirs(IMGS, exist_ok=True)
for p in glob.glob('/kaggle/input/**/*', recursive=True) + glob.glob(f'{CG}/example_data/example_imgs/*'):
    if p.lower().endswith(('.png', '.jpg', '.jpeg')):
        name = os.path.basename(p)
        if '/kaggle/input/' not in p: name = 'example_' + name[:12] + os.path.splitext(name)[1]
        shutil.copy(p, f'{IMGS}/{os.path.splitext(name)[0]}.png' if name.lower().endswith('.png') else f'{IMGS}/{name}')
# ChatGarment reads .png / .jpg only
for p in glob.glob(f'{IMGS}/*.jpeg'): os.rename(p, p[:-5] + '.jpg')
photos = sorted(os.listdir(IMGS))
log('photos:', len(photos), photos)
summary(photos=photos)

# ------------------------------------------------------------------ inference script, patched for Kaggle GPUs
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
     'model.load_state_dict(state_dict, strict=True)\n    del state_dict\n    model = kaggle_place(model)\n    device = torch.device("cuda:0")'),
    ('assert args.precision == "bf16"\n            image_clip = image_clip.bfloat16()', 'image_clip = image_clip.half()'),
]
for a, b in rep:
    if a not in src: raise RuntimeError(f'patch target not found: {a[:70]}')
    src = src.replace(a, b)
src = src.replace('def main(args):', '''def kaggle_place(model):
    """merge the LoRA, then split the fp16 model over the GPUs"""
    import gc
    from accelerate import infer_auto_device_map, dispatch_model
    model = model.merge_and_unload()
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


def main(args):''', 1)
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
env = f'cd {CG} && HF_HOME={TMP}/hf PYTHONPATH={CG}:{GC} TOKENIZERS_PARALLELISM=false'
summary(stage='inference')
r = sh(f'{env} python scripts/kaggle_imggen.py {args} 2>&1 | tee {WORK}/inference.log | tail -60', check=False)

# ------------------------------------------------------------------ results
res = glob.glob(f'{CG}/runs/**/vis_new', recursive=True)
specs = glob.glob(f'{CG}/runs/**/*_specification.json', recursive=True)
log('results:', res, len(specs), 'specifications')
out = f'{WORK}/chatgarment_out.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d in res:
        for p in glob.glob(f'{d}/**/*', recursive=True):
            if os.path.isfile(p) and os.path.getsize(p) < 30 * 2**20: z.write(p, os.path.relpath(p, os.path.dirname(d)))
per = {}
for p in glob.glob(f'{CG}/runs/**/vis_new/valid_garment_*/output.txt', recursive=True):
    gid = p.split('/')[-2].replace('valid_garment_', '')
    per[gid] = {'answer': open(p).read()[-3000:],
                'specs': [os.path.relpath(s, os.path.dirname(p)) for s in glob.glob(f'{os.path.dirname(p)}/**/*_specification.json', recursive=True)]}
summary(stage='done' if specs else 'failed', specifications=len(specs), results=per, minutes=round((time.time() - T0) / 60, 1))
log('done in', round((time.time() - T0) / 60, 1), 'min')
