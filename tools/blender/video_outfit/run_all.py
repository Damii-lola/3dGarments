# python3 tools/blender/video_outfit/run_all.py: the whole outfit from scratch in the running live session
# (Blender with its UI: see README; the site connected with ?blender=1 so the body is there)
import os, subprocess, sys, time
D = os.path.dirname(os.path.abspath(__file__))
SEND = os.path.join(D, '..', 'send.py')
STEPS = ['0_landmarks', '1a_pants_blockout', '1b_pants_shrinkwrap', '1c_pants_shape', '1d_pants_grab',
         '1e_shirt_blockout', '1f_shirt_shape', '2a_multires',
         '2_b1_sleeve_front', '2_b2_sleeve_back', '2_b3_elbow', '2_b3b_elbow_back', '2_b4_hem_front', '2_b4b_hem_back',
         '2_b4c_hem_side', '2_b5_armpit', '2_p1_bunch_front', '2_p2_bunch_back', '2_p3_bunch_side', '2_p4_knee',
         '2_p5_crotch', '3a_multires_up', '3_d1_shirt_front', '3_d2_shirt_back', '3_d3_shirt_side', '3_d4_pants_front',
         '3_d5_pants_side', '3_d6_pocket', '3_d8_neckrib', '4a_finalize', '4_solidify']
start = sys.argv[1] if len(sys.argv) > 1 else STEPS[0]
for s in STEPS[STEPS.index(start):]:
    t = time.time(); f = os.path.join(D, s + '.py')
    # brush batches (they queue strokes) go through the driver, the rest is one exec
    brush = 'sculpt_drag_q' in open(f).read() or 'bunch(' in open(f).read() or 'seam(' in open(f).read()
    cmd = ['python3', os.path.join(D, 'drive.py'), f] if brush else ['python3', SEND, '-f', f]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(f'{s}: {time.time() - t:.1f} s', (r.stdout.strip().splitlines() or [''])[-1])
    if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)
