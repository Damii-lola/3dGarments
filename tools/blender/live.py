"""
LIVE BLENDER ↔ SITE: Blender holds the app's own body models and streams what is modelled on them to the site,
live. No templates: clothing is modelled here, directly on the body the site is showing.

  blender -b -P tools/blender/live.py            (headless: a server loop)
  blender     -P tools/blender/live.py            (with the UI: the same server on a 50 ms timer, so you can model by hand)

1. IMPORTS the built models web/public/body/{male,female}.glb (rig, skin weights, the width morph, vertex tags: the
   same 18 264 / 20 829 vertices, in the same order, as the site).
2. SERVES a WebSocket on ws://127.0.0.1:8790 (loopback only).
   - The SITE connects (?blender=1) and sends the body exactly as it stands on screen: sex + every vertex's world
     position (its pose, height, width and shape sliders included). It lands on the Blender body as the shape
     key "site": cloth simulated here collides with exactly what the site shows. Each slider change re-sends it.
   - Blender sends back every object in the collection "Garments" (evaluated: cloth at its current frame, every
     modifier applied) as a mesh in the site's coordinates. The site draws it on the body, live.
   - CONTROL clients (tools/blender/send.py, the local CLI used to model) run Python in Blender's session. They must
     present the token written to ~/.3dg-blender-token (0600) at start; a browser never gets to run code.
   - Browser origins are allow-listed (localhost dev servers + the GitHub Pages site); a connection from any other
     page is refused, so a random website can't talk to your Blender.

Coordinates: the site is y-up (metres, facing +z); Blender is z-up. app (x, y, z) ↔ Blender (x, -z, y).
"""
import bpy, bmesh, sys, os, json, base64, hashlib, socket, selectors, struct, secrets, traceback, io, time, contextlib, signal
from array import array
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HOST, PORT = '127.0.0.1', int(os.environ.get('LIVE_PORT', 8790))
TOKEN_FILE = os.path.expanduser('~/.3dg-blender-token')
ORIGINS = ('http://localhost:', 'http://127.0.0.1:', 'https://damii-lola.github.io')
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
GARMENTS = 'Garments'
DEBUG = bool(os.environ.get('LIVE_DEBUG'))
# a client that disconnects mid-send must not kill Blender (its embedded Python doesn't ignore SIGPIPE)
with contextlib.suppress(Exception):
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)


# ---------------------------------------------------------------- coordinates
def to_blender(p):  # app (x, y, z) → Blender
    return (p[0], -p[2], p[1])


def to_app(p):
    return (p[0], p[2], -p[1])


# ---------------------------------------------------------------- the models
def import_models():
    """Both bodies, each with its rig, in its own collection; the active one is shown."""
    for s in ('male', 'female'):
        if bpy.data.collections.get(s):
            continue
        coll = bpy.data.collections.new(s)
        bpy.context.scene.collection.children.link(coll)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, 'web', 'public', 'body', f'{s}.glb'), merge_vertices=False)
        for o in set(bpy.data.objects) - before:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            if o.type == 'MESH' and o.parent is None and not o.data.attributes.get('_PART'):
                bpy.data.objects.remove(o)          # the importer's bone-display shapes
                continue
            coll.objects.link(o)
            if o.type == 'MESH':
                o.name = f'body_{s}'
            elif o.type == 'ARMATURE':
                o.name = f'rig_{s}'
    if not bpy.data.collections.get(GARMENTS):
        bpy.context.scene.collection.children.link(bpy.data.collections.new(GARMENTS))
    bpy.context.scene.gravity = (0, 0, -9.81)


STATE = {'sex': None, 'body_version': 0}


def body(sex=None):
    return bpy.data.objects.get(f'body_{sex or STATE["sex"] or "male"}')


def set_active(sex):
    if sex == STATE['sex']:
        return
    STATE['sex'] = sex
    for s in ('male', 'female'):
        c = bpy.data.collections[s]
        c.hide_viewport = c.hide_render = (s != sex)
        b = body(s)
        col = next((m for m in b.modifiers if m.type == 'COLLISION'), None)
        if s == sex and col is None:
            b.modifiers.new('collision', 'COLLISION')
            b.collision.thickness_outer = 0.002
            b.collision.thickness_inner = 0.02
            b.collision.cloth_friction = 15
        elif s != sex and col is not None:
            b.modifiers.remove(col)


def apply_site_body(sex, pos):
    """The site's body as it stands (world positions, app coords) → shape key 'site' on the Blender body, with the
    armature muted (the positions are already posed). Same vertex order, so it is an exact copy."""
    set_active(sex)
    b = body(sex)
    me = b.data
    n = len(me.vertices)
    if len(pos) != n * 3:
        raise ValueError(f'site sent {len(pos) // 3} vertices, the {sex} body has {n}')
    if me.shape_keys is None:
        b.shape_key_add(name='Basis')
    key = me.shape_keys.key_blocks.get('site') or b.shape_key_add(name='site', from_mix=False)
    inv = b.matrix_world.inverted()
    co = array('f', [0.0]) * (n * 3)
    for i in range(n):
        v = inv @ Vector(to_blender(pos[i * 3:i * 3 + 3]))
        co[i * 3], co[i * 3 + 1], co[i * 3 + 2] = v
    key.data.foreach_set('co', co)
    for k in me.shape_keys.key_blocks:
        k.value = 1.0 if k.name == 'site' else 0.0
    key.value = 1.0
    me.shape_keys.use_relative = True
    for m in b.modifiers:
        if m.type == 'ARMATURE':
            m.show_viewport = m.show_render = False
    me.update()
    STATE['body_version'] += 1


# ---------------------------------------------------------------- garments → the site
def garment_payload(ob, with_topology):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        me.calc_loop_triangles()
        mw = ob.matrix_world
        n = len(me.vertices)
        co = array('f', [0.0]) * (n * 3)
        me.vertices.foreach_get('co', co)
        out = array('f', [0.0]) * (n * 3)
        for i in range(n):
            w = mw @ Vector((co[i * 3], co[i * 3 + 1], co[i * 3 + 2]))
            out[i * 3], out[i * 3 + 1], out[i * 3 + 2] = to_app(w)
        msg = {'t': 'mesh', 'id': ob.name, 'n': n, 'pos': base64.b64encode(out.tobytes()).decode()}
        if with_topology:
            tri = array('I', [0]) * (len(me.loop_triangles) * 3)
            me.loop_triangles.foreach_get('vertices', tri)
            msg['idx'] = base64.b64encode(tri.tobytes()).decode()
            col = ob.get('color') or (ob.active_material.diffuse_color[:3] if ob.active_material else (0.92, 0.92, 0.9))
            msg['color'] = [float(c) for c in col]
            msg['style'] = ob.get('style', 'cloth')
        return msg
    finally:
        ev.to_mesh_clear()


# ---------------------------------------------------------------- a tiny WebSocket server (stdlib only)
class Client:
    def __init__(self, sock, addr):
        self.sock, self.addr = sock, addr
        self.buf = b''
        self.open = False
        self.role = None          # 'site' | 'control'
        self.sent = {}            # garment name → (topology signature) last sent
        self.out = bytearray()

    def send(self, obj):
        data = json.dumps(obj).encode()
        n = len(data)
        head = bytes([0x81]) + (bytes([n]) if n < 126 else (bytes([126]) + struct.pack('>H', n) if n < 65536 else bytes([127]) + struct.pack('>Q', n)))
        self.out += head + data
        self.flush()

    def flush(self, block=False):
        while self.out:
            try:
                k = self.sock.send(self.out)
                del self.out[:k]
            except BlockingIOError:
                if not block:
                    return
                time.sleep(0.002)
            except OSError:
                self.out.clear()
                return


class Server:
    def __init__(self):
        self.sel = selectors.DefaultSelector()
        self.lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.lsock.bind((HOST, PORT))
        self.lsock.listen(8)
        self.lsock.setblocking(False)
        self.sel.register(self.lsock, selectors.EVENT_READ)
        self.clients = []
        self.token = secrets.token_hex(16)
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(f'{self.token}\n{PORT}\n')
        mod = sys.modules[__name__]
        self.ns = {'bpy': bpy, 'bmesh': bmesh, 'Vector': Vector, 'live': mod, 'push': push, 'step': step,
                   'new_garment': new_garment, 'body': body, 'STATE': STATE}
        print(f'[live] ws://{HOST}:{PORT}  (control token in {TOKEN_FILE})', flush=True)

    # ------------------------------------------------ IO
    def poll(self, timeout=0.0):
        for key, _ in self.sel.select(timeout):
            if key.fileobj is self.lsock:
                try:
                    s, addr = self.lsock.accept()
                except BlockingIOError:
                    continue
                s.setblocking(False)
                c = Client(s, addr)
                self.clients.append(c)
                self.sel.register(s, selectors.EVENT_READ, c)
            else:
                self.read(key.data)
        for c in self.clients:
            c.flush()

    def close(self, c):
        with contextlib.suppress(Exception):
            self.sel.unregister(c.sock)
        with contextlib.suppress(Exception):
            c.sock.close()
        if c in self.clients:
            self.clients.remove(c)

    def read(self, c):
        try:
            data = c.sock.recv(1 << 20)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            return self.close(c)
        if not data:
            return self.close(c)
        c.buf += data
        if DEBUG:
            print(f'[live] read {len(data)} from {c.role or "?"}, buffered {len(c.buf)}', flush=True)
        if not c.open:
            if b'\r\n\r\n' not in c.buf:
                return
            head, c.buf = c.buf.split(b'\r\n\r\n', 1)
            lines = head.decode('latin1').split('\r\n')
            h = {k.strip().lower(): v.strip() for k, v in (l.split(':', 1) for l in lines[1:] if ':' in l)}
            origin = h.get('origin', '')
            if origin and not origin.startswith(ORIGINS):
                c.sock.sendall(b'HTTP/1.1 403 Forbidden\r\n\r\n')
                print(f'[live] refused origin {origin}', flush=True)
                return self.close(c)
            c.browser = bool(origin)
            acc = base64.b64encode(hashlib.sha1((h.get('sec-websocket-key', '') + GUID).encode()).digest()).decode()
            c.sock.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                            f'Sec-WebSocket-Accept: {acc}\r\n\r\n').encode())
            c.open = True
        while True:
            frame = self.parse(c)
            if frame is None:
                break
            op, payload = frame
            if DEBUG:
                print(f'[live] frame op {op} len {len(payload)} from {c.role}', flush=True)
            if op == 8:
                return self.close(c)
            if op == 9:
                continue
            if op in (1, 2):
                try:
                    self.handle(c, json.loads(payload))
                except Exception as e:
                    traceback.print_exc()
                    c.send({'t': 'error', 'msg': f'{type(e).__name__}: {e}'})

    def parse(self, c):
        b = c.buf
        if len(b) < 2:
            return None
        op, ln, i = b[0] & 0x0F, b[1] & 0x7F, 2
        masked = b[1] & 0x80
        if ln == 126:
            if len(b) < 4: return None
            ln, i = struct.unpack('>H', b[2:4])[0], 4
        elif ln == 127:
            if len(b) < 10: return None
            ln, i = struct.unpack('>Q', b[2:10])[0], 10
        mask = b[i:i + 4] if masked else None
        i += 4 if masked else 0
        if len(b) < i + ln:
            return None
        payload = b[i:i + ln]
        if mask:
            payload = bytes(x ^ mask[k & 3] for k, x in enumerate(payload)) if ln < 4096 else _unmask(payload, mask)
        c.buf = b[i + ln:]
        if op >= 8:                                        # control frames (close/ping/pong) are never fragmented
            return op, payload
        if not (b[0] & 0x80):                              # a fragment: browsers split big messages (op, then 0s)
            if op:
                c.frag_op = op
            c.frag = getattr(c, 'frag', b'') + payload
            return self.parse(c)
        if op == 0:                                        # the last fragment: the message has the first one's op
            payload, c.frag, op = getattr(c, 'frag', b'') + payload, b'', getattr(c, 'frag_op', 1)
        return op, payload

    # ------------------------------------------------ messages
    def handle(self, c, m):
        t = m.get('t')
        if t == 'hello':
            c.role = 'control' if (m.get('token') == self.token and not c.browser) else 'site'
            c.send({'t': 'hello', 'role': c.role, 'blender': bpy.app.version_string, 'sex': STATE['sex']})
            if c.role == 'site':
                self.push(only=c, full=True)
            return
        if t == 'body' and c.role == 'site':
            pos = array('f')
            pos.frombytes(base64.b64decode(m['pos']))
            apply_site_body(m['sex'], pos)
            c.send({'t': 'status', 'msg': f'body received: {m["sex"]}, {len(pos) // 3} vertices'})
            self.push()                                     # anything built on the body follows it
            for o in self.clients:
                if o.role == 'control':
                    o.send({'t': 'body', 'sex': m['sex'], 'version': STATE['body_version']})
            return
        if t == 'exec' and c.role == 'control':
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                try:
                    exec(m['code'], self.ns)
                    err = None
                except Exception:
                    err = traceback.format_exc()
            self.push()
            c.send({'t': 'result', 'out': out.getvalue(), 'err': err})
            return
        c.send({'t': 'error', 'msg': f'not allowed: {t} as {c.role}'})

    def push(self, only=None, full=False):
        """every garment → every site client (topology only when it changed or on first sight)"""
        coll = bpy.data.collections.get(GARMENTS)
        obs = [o for o in (coll.all_objects if coll else []) if o.type == 'MESH' and not o.hide_get()]
        names = {o.name for o in obs}
        for c in ([only] if only else self.clients):
            if c.role != 'site':
                continue
            for name in list(c.sent):
                if name not in names:
                    c.send({'t': 'remove', 'id': name})
                    del c.sent[name]
            for o in obs:
                sig = (len(o.data.vertices), len(o.data.polygons), tuple(m.type for m in o.modifiers if m.show_viewport))
                topo = full or c.sent.get(o.name) != sig
                c.send(garment_payload(o, topo))
                c.sent[o.name] = sig
            c.flush(block=True)

    def serve(self):
        while True:
            self.poll(0.05)


def _unmask(payload, mask):
    n = len(payload)
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(payload, 'little') ^ int.from_bytes(m, 'little')).to_bytes(n, 'little')


# ---------------------------------------------------------------- helpers for the modelling session (control clients)
def push():
    """stream the garments to the site now (call inside long loops, e.g. every few cloth frames)"""
    SERVER.push()
    SERVER.poll(0)


def step(frames=1, every=2):
    """advance the scene (cloth) by `frames`, streaming every `every` frames"""
    scn = bpy.context.scene
    for k in range(frames):
        scn.frame_set(scn.frame_current + 1)
        if (k + 1) % every == 0 or k == frames - 1:
            push()


def new_garment(name, mesh_data=None, color=(0.92, 0.92, 0.9)):
    """an empty mesh object in the Garments collection"""
    me = mesh_data or bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[GARMENTS].objects.link(ob)
    ob['color'] = list(color)
    return ob


SERVER = None
if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_models()
    set_active('male')
    SERVER = Server()
    if bpy.app.background:
        SERVER.serve()
    else:
        bpy.app.timers.register(lambda: (SERVER.poll(0), 0.05)[1], persistent=True)
