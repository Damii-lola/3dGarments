"""
Hunyuan3D 2.1 (Tencent, 2025; github.com/Tencent-Hunyuan/Hunyuan3D-2.1) on a Kaggle T4 ×2: every garment cut-out
(our cleaned photo cut: accessories off, wrinkles smoothed) → a 3D garment. Shape: Hunyuan3D-Shape-2.1 (3.3B DiT,
flow matching, fp16, ~10 GB); texture: Hunyuan3D-Paint-2.1 (multiview PBR diffusion; 21 GB on the reference setup,
here 6 views at 512 with its DINOv2-giant on the second GPU — optional: a garment whose texture doesn't fit still
comes back as a shape, which is what our pipeline mainly takes from it, as it does TRELLIS.2's).

Prepended by tools/garment_ml/kernel.py with common/progress.py (note, sh, stage, fetch) and MODEL / TOPIC /
INPUTS (name → base64 RGBA PNG cut-out). Live progress: https://ntfy.sh/<TOPIC>.
Out: /kaggle/working/out/<name>_shape.glb (+ <name>_textured.glb) + summary.json
"""
import base64, gc, glob, io, json, os, shutil, subprocess, sys, time
from PIL import Image

TMP, W, OUT = '/tmp/hy', '/tmp/w', f'{WORK}/out'
for d in (TMP, W, OUT): os.makedirs(d, exist_ok=True)
N = 6
SEEDS = [1234, 7]


def run():
    gpu = subprocess.run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', shell=True, capture_output=True, text=True).stdout.strip()
    note(f'started on {gpu.replace(chr(10), " + ") or "NO GPU"} · {len(INPUTS)} garments')

    stage(1, N, 'code + dependencies + CUDA extensions')
    HY = f'{TMP}/Hunyuan3D-2.1'
    sh(f'rm -rf {HY} && git clone -q --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 {HY}', 'Hunyuan3D 2.1 source')
    # its own pins where they matter (diffusers / transformers APIs); no Blender, no gradio, no open3d, no deepspeed
    sh('pip install -q "diffusers==0.30.0" "transformers==4.46.0" "huggingface_hub==0.30.2" "accelerate>=1.1.1" '
       'trimesh pymeshlab pygltflib xatlas omegaconf einops opencv-python-headless scikit-image timm torchdiffeq '
       'realesrgan basicsr pybind11 ninja pytorch-lightning safetensors',
       'Python dependencies', 'pip')
    # Blender is only used to write the textured GLB (we write it with trimesh): a stub keeps its imports working
    STUB = f'{TMP}/stubs'; os.makedirs(f'{STUB}/bpy', exist_ok=True)
    open(f'{STUB}/bpy/__init__.py', 'w').write('def __getattr__(name):\n    raise RuntimeError("no Blender here (bpy." + name + ")")\n')
    paint_ok = sh(f'cd {HY}/hy3dpaint/custom_rasterizer && TORCH_CUDA_ARCH_LIST="7.5" MAX_JOBS=4 pip install -q --no-build-isolation -e .',
                  'custom_rasterizer (CUDA, sm_75)', 'build', optional=True)
    paint_ok = sh(f'cd {HY}/hy3dpaint/DifferentiableRenderer && bash compile_mesh_painter.sh', 'mesh painter (C++)', 'build', optional=True) and paint_ok
    os.makedirs(f'{HY}/hy3dpaint/ckpt', exist_ok=True)
    if paint_ok:
        paint_ok = sh(f'curl -sSfL -o {HY}/hy3dpaint/ckpt/RealESRGAN_x4plus.pth https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
                      'Real-ESRGAN x4 weights', 'build', optional=True)

    stage(2, N, 'downloading ALL weights: Hunyuan3D-2.1 (shape DiT + VAE + PBR paint) + DINOv2-giant')
    fetch([('tencent/Hunyuan3D-2.1', '')], f'{W}/tencent', skip=lambda p: p.endswith(('.py', '.md')) and '/' not in p)
    fetch([('facebook/dinov2-giant', '')], W, skip=lambda p: p.endswith(('.h5', '.msgpack')) or p == 'pytorch_model.bin')
    MP = f'{W}/tencent/Hunyuan3D-2.1'

    stage(3, N, 'garments')
    IMGS = f'{TMP}/imgs'; os.makedirs(IMGS, exist_ok=True)
    for name, b64 in INPUTS.items():
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
        k = 1024 / max(im.size)                         # a small cut-out, enlarged (the conditioner sees 518 px)
        if k > 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        im.save(f'{IMGS}/{name}.png')
    note(f'{len(INPUTS)} garments: {", ".join(INPUTS)}')

    sys.path[:0] = [STUB, f'{HY}/hy3dshape', f'{HY}/hy3dpaint', HY]
    os.environ['HY3DGEN_MODELS'] = W
    import torch
    try:
        from torchvision_fix import apply_fix; apply_fix()
    except Exception as e:
        note(f'(torchvision fix: {e})')
    summary = {}

    stage(4, N, 'Hunyuan3D-Shape-2.1: cut-out → shape (fp16)')
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
    from hy3dshape.postprocessors import FloaterRemover, DegenerateFaceRemover, FaceReducer
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2.1', device='cuda:0', dtype=torch.float16)
    note(f'shape model loaded · GPU 0 {torch.cuda.memory_allocated(0) / 2**30:.1f} GiB')
    for i, name in enumerate(INPUTS, 1):
        img = Image.open(f'{IMGS}/{name}.png')
        best = None
        for seed in SEEDS:
            t = time.time()
            try:
                mesh = pipe(image=img, num_inference_steps=50, guidance_scale=5.0, octree_resolution=384, num_chunks=20000,
                            generator=torch.Generator('cuda:0').manual_seed(seed))[0]
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache(); note(f'⚠ {name}: out of memory at 384 — 256')
                mesh = pipe(image=img, num_inference_steps=50, guidance_scale=5.0, octree_resolution=256, num_chunks=8000,
                            generator=torch.Generator('cuda:0').manual_seed(seed))[0]
            mesh = FloaterRemover()(mesh); mesh = DegenerateFaceRemover()(mesh); mesh = FaceReducer()(mesh, max_facenum=120000)
            # the one whose silhouette from the front fills the cut-out best (both seeds usually agree)
            ext = mesh.bounds[1] - mesh.bounds[0]
            score = abs((ext[0] / max(ext[1], 1e-6)) - img.width / img.height)
            note(f'  {i}/{len(INPUTS)} {name} seed {seed}: {len(mesh.faces)} faces, aspect off by {score:.2f} ({time.time() - t:.0f}s)')
            if best is None or score < best[0]: best = (score, seed, mesh)
        best[2].export(f'{OUT}/{name}_shape.glb')
        summary[name] = {'shape': f'{name}_shape.glb', 'seed': best[1], 'faces': len(best[2].faces)}
        note(f'✓ {i}/{len(INPUTS)} {name}: shape (seed {best[1]})')
    del pipe; gc.collect(); torch.cuda.empty_cache()

    stage(5, N, 'Hunyuan3D-Paint-2.1: PBR texture (6 views, 512; optional)')
    if not paint_ok:
        note('⚠ texture skipped: its CUDA extensions did not build — shapes only', prio=4)
    else:
        try:
            src = open(f'{HY}/hy3dpaint/utils/multiview_utils.py').read()
            a = '''        model_path = huggingface_hub.snapshot_download(
            repo_id=config.multiview_pretrained_path,
            allow_patterns=["hunyuan3d-paintpbr-v2-1/*"],
        )'''
            if a not in src: raise RuntimeError('multiview_utils: download call not found')
            src = src.replace(a, '        model_path = config.multiview_pretrained_path')
            # DINOv2-giant on the second GPU (the paint model alone nearly fills a T4), its features handed back
            b = '            self.dino_v2 = self.dino_v2.to(self.device)'
            if b not in src: raise RuntimeError('multiview_utils: dino placement not found')
            src = src.replace(b, '            self.dino_v2 = self.dino_v2.to("cuda:1" if torch.cuda.device_count() > 1 else self.device)')
            c = '            dino_hidden_states = self.dino_v2(input_images[0])'
            if c not in src: raise RuntimeError('multiview_utils: dino call not found')
            src = src.replace(c, '            dino_hidden_states = self.dino_v2(input_images[0]).to(self.pipeline.device)')
            open(f'{HY}/hy3dpaint/utils/multiview_utils.py', 'w').write(src)
            os.chdir(HY)
            from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
            conf = Hunyuan3DPaintConfig(6, 512)
            conf.realesrgan_ckpt_path = f'{HY}/hy3dpaint/ckpt/RealESRGAN_x4plus.pth'
            conf.multiview_cfg_path = f'{HY}/hy3dpaint/cfgs/hunyuan-paint-pbr.yaml'
            conf.custom_pipeline = f'{HY}/hy3dpaint/hunyuanpaintpbr'
            conf.multiview_pretrained_path = f'{MP}/hunyuan3d-paintpbr-v2-1'
            conf.dino_ckpt_path = f'{W}/dinov2-giant'
            conf.render_size, conf.texture_size = 1024, 2048
            paint = Hunyuan3DPaintPipeline(conf)
            note(f'paint model loaded · GPU 0 {torch.cuda.memory_allocated(0) / 2**30:.1f} GiB · GPU 1 {torch.cuda.memory_allocated(1) / 2**30 if torch.cuda.device_count() > 1 else 0:.1f} GiB')
            import trimesh
            for i, name in enumerate(INPUTS, 1):
                t = time.time()
                try:
                    wd = f'{TMP}/paint_{name}'; os.makedirs(wd, exist_ok=True)
                    shutil.copy(f'{OUT}/{name}_shape.glb', f'{wd}/shape.glb')
                    objp = paint(mesh_path=f'{wd}/shape.glb', image_path=f'{IMGS}/{name}.png', output_mesh_path=f'{wd}/textured.obj', save_glb=False)
                    trimesh.load(objp, force='mesh').export(f'{OUT}/{name}_textured.glb')
                    summary[name]['textured'] = f'{name}_textured.glb'
                    note(f'✓ {i}/{len(INPUTS)} {name}: texture ({time.time() - t:.0f}s)')
                except torch.cuda.OutOfMemoryError as e:
                    torch.cuda.empty_cache(); note(f'⚠ {name}: texture out of GPU memory — shape only ({str(e)[:120]})', prio=4)
                except Exception as e:
                    import traceback
                    note(f'⚠ {name}: texture failed — shape only: {type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}', prio=4)
        except Exception as e:
            import traceback
            note(f'⚠ texture model failed to load — shapes only: {type(e).__name__}: {e}\n{traceback.format_exc()[-1200:]}', prio=4)

    stage(6, N, 'results')
    json.dump(summary, open(f'{WORK}/summary.json', 'w'), indent=1)
    note(f'✅ FINISHED in {(time.time() - T0) / 60:.0f} min · {len(summary)}/{len(INPUTS)} shapes, '
         f'{sum("textured" in v for v in summary.values())} textured: {", ".join(summary)}', title=f'{MODEL} · done', prio=4)


crash_guard(run)
