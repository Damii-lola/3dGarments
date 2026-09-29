"""
Kaggle CPU job: download ChatGarment's checkpoint once and keep it as this kernel's output, so the GPU
runs (run.py) attach it instead of downloading 14 GB every time. Verified by its sha256.
"""
import hashlib, os, subprocess, time

URLS = ['https://huggingface.co/dirkneu/chatgarment-ckpt/resolve/main/pytorch_model.bin',
        'https://huggingface.co/SeonbinKyndof/chatgarment-checkpoint/resolve/main/pytorch_model.bin']
SIZE, SHA = 14987210682, '3d6ca6dc52d4400d5603ac0dcb163aeb82d1021d99c90686253f6cc4a72b8a3a'
dst = '/kaggle/working/pytorch_model.bin'
t0 = time.time()
for url in URLS:
    for attempt in range(40):
        subprocess.run(['curl', '-sS', '-L', '--http1.1', '-C', '-', '--retry', '3', '--speed-limit', '1000000',
                        '--speed-time', '60', '-o', dst, url])
        have = os.path.getsize(dst) if os.path.exists(dst) else 0
        print(f'[{time.time() - t0:6.0f}s] {have / 2**30:.2f} / {SIZE / 2**30:.2f} GB', flush=True)
        if have >= SIZE: break
    if os.path.exists(dst) and os.path.getsize(dst) == SIZE: break
h = hashlib.sha256()
with open(dst, 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 24), b''): h.update(chunk)
ok = h.hexdigest() == SHA
print('sha256', h.hexdigest(), 'OK' if ok else 'MISMATCH', flush=True)
open('/kaggle/working/sha256.txt', 'w').write(h.hexdigest() + ('  OK\n' if ok else '  MISMATCH\n'))
if not ok:
    os.remove(dst)
    raise SystemExit('checkpoint hash mismatch')
