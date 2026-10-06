# python3 drive.py <batch.py> [shot.png]: exec fold_lib + the batch (it looks and queues strokes), then play the
# strokes one by one: each must finish (Blender's depsgraph quiet for 0.4 s after it started) before the next
import subprocess, sys, time, json
from PIL import ImageGrab
import os
L = os.path.dirname(os.path.abspath(__file__))
SEND = os.path.join(L, '..', 'send.py')
def send(code):
    r = subprocess.run(['python3', SEND, code], capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:]); raise SystemExit(1)
    return r.stdout
t0 = time.time()
print(send("STATE['queue'] = []\n" + open(f'{L}/fold_lib.py').read() + '\n' + open(sys.argv[1]).read()).strip())
n = 0
while True:
    left = int(send('print(run_next())').strip() or 0)
    sent = time.time()
    # wait: the stroke's updates start after this exec returns; done when they've been quiet for 0.4 s
    while True:
        time.sleep(0.15)
        st = json.loads(send("import json; print(json.dumps([STATE.get('dg_time', 0), STATE.get('stroke_sent', 0)]))"))
        if st[0] > st[1] and time.time() - st[0] > 0.4: break
        if time.time() - sent > 30: print('timeout'); break
    n += 1
    if left == 0: break
print(f'{n} strokes in {time.time() - t0:.1f} s')
if len(sys.argv) > 2:
    time.sleep(0.5)
    ImageGrab.grab(xdisplay=':55').crop((0, 60, 1585, 975)).save(sys.argv[2])
