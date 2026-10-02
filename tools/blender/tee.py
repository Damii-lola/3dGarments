"""
Men's plain crew-neck tee, made in Blender (headless) on the body as it stands in the app (A-pose export):

  blender -b -P tools/blender/tee.py -- <body.obj> <body.json> <out.obj> [frames]

1. the garment's surface is cut from the body's own skin (one continuous piece: torso and sleeves) with clean
   planes — the neckline (lower at the front), the hem, each sleeve's hem square to the arm;
2. smoothed (no muscles), subdivided, and pushed out to its cut: close at the chest and shoulders, wider below
   (a straight body) and at the sleeve hems;
3. UV unwrapped (seams down the sides and under the sleeves);
4. DRAPED: Blender's cloth simulation (cotton), gravity, colliding with the body (and its underwear) — the fabric
   settles on the shoulders and hangs, with its own folds;
5. written out as OBJ in the app's coordinates (metres, y up, facing +z).
Coordinates are kept as the app's (y up): the scene's gravity points down -y.
"""
import bpy, bmesh, sys, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
BODY, META, OUT = argv[0], argv[1], argv[2]
FRAMES = int(argv[3]) if len(argv) > 3 else 60
meta = json.load(open(META))
L, J = meta['L'], {k: Vector(v) for k, v in meta['joints'].items()}

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.gravity = (0, -9.81, 0)

bpy.ops.wm.obj_import(filepath=BODY, forward_axis='Y', up_axis='Z')    # (no axis change: y stays up)
body = bpy.context.selected_objects[0]
body.name = 'body'

# ---------------------------------------------------------------- 1. the garment cut from the skin
tee = body.copy(); tee.data = body.data.copy(); tee.name = 'tee'
scn.collection.objects.link(tee)
bpy.context.view_layer.objects.active = tee

HEM = L['crotch'] + 0.02
SLEEVE = 0.92 * (J['lowerarm_l'] - J['upperarm_l']).length
NECK = J['neck_01']

def arm_frame(p, s):
    S, E = J['upperarm_' + s], J['lowerarm_' + s]
    a = (E - S).normalized()
    return (p - S).dot(a), a, S

bm = bmesh.new(); bm.from_mesh(tee.data)
bm.verts.ensure_lookup_table()
def keep(v):
    p = v.co
    if p.y < HEM - 0.04 or p.y > L['neckTop'] + 0.02: return False
    # the head and the neck above the neckline
    if p.y > NECK.y + 0.06: return False
    for s in ('l', 'r'):
        al, a, S = arm_frame(p, s)
        if al > SLEEVE + 0.04 and (p - (S + a * al)).length < 0.12: return False
    if abs(p.x) > 0.6: return False
    return True
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v)], context='VERTS')
# the largest connected piece only (the torso + the arms' tops; stray bits of hands / legs out)
bm.verts.ensure_lookup_table()
seen, pieces = set(), []
for v in bm.verts:
    if v in seen: continue
    comp, st = [], [v]; seen.add(v)
    while st:
        u = st.pop(); comp.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w not in seen: seen.add(w); st.append(w)
    pieces.append(comp)
pieces.sort(key=len, reverse=True)
bmesh.ops.delete(bm, geom=[v for c in pieces[1:] for v in c], context='VERTS')

# clean cut lines: bisect with planes, the outer side cleared
def cut(co, no):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
cut(Vector((0, HEM, 0)), Vector((0, -1, 0)))                               # the hem
# the crew neck: a plane tipped forward (low at the front, just under the nape at the back)
front_low, back_low = 0.022, -0.012
c = Vector((0, NECK.y + 0.012, NECK.z))
nrm = Vector((0, 1, (front_low - back_low) / 0.12)).normalized()
cut(c + Vector((0, -0.01, 0)), nrm)
for s in ('l', 'r'):
    S, E = J['upperarm_' + s], J['lowerarm_' + s]
    a = (E - S).normalized()
    cut(S + a * SLEEVE, a)                                                  # each sleeve's hem, square to the arm
bm.to_mesh(tee.data); bm.free()

# ---------------------------------------------------------------- 2. smooth, subdivide, push out to its cut
def mod_apply(obj, m):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)

m = tee.modifiers.new('smooth', 'LAPLACIANSMOOTH'); m.iterations = 30; m.lambda_factor = 1.2; m.use_volume_preserve = True
mod_apply(tee, m)
m = tee.modifiers.new('sub', 'SUBSURF'); m.levels = 1; m.subdivision_type = 'SIMPLE'
mod_apply(tee, m)
m = tee.modifiers.new('smooth2', 'CORRECTIVE_SMOOTH'); m.iterations = 10; m.smooth_type = 'SIMPLE'
mod_apply(tee, m)

def sm(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

me = tee.data
me.calc_normals() if hasattr(me, 'calc_normals') else None
cx = 0.0
for v in me.vertices:
    p = v.co.copy()
    # torso: out from the body's vertical axis — 4 mm at the chest and shoulders, widening below (sides more)
    axis = Vector((0, p.y, NECK.z + 0.03))
    d = Vector((p.x, 0, p.z - axis.z)); r = d.length or 1; d /= r
    loose = 1 - sm(L['waist'], L['armpit'] - 0.03, p.y)
    side = (d.x) ** 2
    torso_off = 0.004 + loose * (0.025 + 0.035 * side)
    # sleeves: out from the arm's axis — 4 mm over the shoulder, ~2.5 cm by the hem
    arm_w, arm_off = 0.0, Vector()
    for s in ('l', 'r'):
        al, a, S = arm_frame(p, s)
        if al < -0.02: continue
        q = S + a * al; rr = p - q
        if rr.length > 0.11: continue
        w = sm(-0.02, 0.06, al)
        if w > arm_w:
            arm_w = w
            arm_off = rr.normalized() * (0.004 + 0.025 * sm(0.04, SLEEVE, al))
    off = (d * torso_off) * (1 - arm_w) + arm_off * arm_w
    v.co = p + off

# ---------------------------------------------------------------- 3. UVs
bpy.ops.object.select_all(action='DESELECT'); tee.select_set(True); bpy.context.view_layer.objects.active = tee
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- 4. drape
col = body.modifiers.new('collision', 'COLLISION')
body.collision.thickness_outer = 0.004
body.collision.thickness_inner = 0.01
body.collision.cloth_friction = 5.0
cl = tee.modifiers.new('cloth', 'CLOTH')
st = cl.settings
st.quality = 10
st.mass = 0.25                         # cotton jersey, kg/m²
st.air_damping = 1.0
st.tension_stiffness = 15; st.compression_stiffness = 15; st.shear_stiffness = 8; st.bending_stiffness = 0.6
st.tension_damping = 5; st.compression_damping = 5; st.shear_damping = 5
cs = cl.collision_settings
cs.collision_quality = 4
cs.distance_min = 0.003
cs.use_self_collision = True
cs.self_distance_min = 0.002
cl.point_cache.frame_start = 1; cl.point_cache.frame_end = FRAMES
scn.frame_start = 1; scn.frame_end = FRAMES
for f in range(1, FRAMES + 1):
    scn.frame_set(f)
    if f % 10 == 0: print('frame', f, flush=True)
mod_apply(tee, cl)

# ---------------------------------------------------------------- 5. out
bpy.ops.object.select_all(action='DESELECT'); tee.select_set(True)
bpy.ops.wm.obj_export(filepath=OUT, export_selected_objects=True, forward_axis='Y', up_axis='Z',
                      export_uv=True, export_normals=True, export_materials=False, apply_modifiers=True)
print('written', OUT, len(tee.data.vertices), 'verts')
