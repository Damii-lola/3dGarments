"""Minimal glTF 2.0 binary writer: one (optionally skinned) triangle mesh."""
import json
import struct

import numpy as np

FLOAT, UINT, USHORT = 5126, 5125, 5123
TYPE = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}


def write(path, positions, normals, faces, attrs=None, skin=None, name='body'):
    """
    positions/normals: (N,3) metres. faces: (F,3). attrs: {'_NAME': (N,) or (N,k) float arrays}.
    skin: {'names': [...], 'parents': [...], 'heads': (B,3) world rest positions, 'rot': (B,4) world
    rest orientations xyzw, 'joints': (N,4) uint16, 'weights': (N,4) float}.
    """
    blob = bytearray()
    views, accessors = [], []

    def add(arr, comp, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes}
        if target:
            v['target'] = target
        views.append(v)
        n = arr.shape[0]
        k = 1 if arr.ndim == 1 else int(np.prod(arr.shape[1:]))
        acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': n, 'type': TYPE[k]}
        if minmax:
            acc['min'] = arr.min(0).tolist()
            acc['max'] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    prim = {'attributes': {
        'POSITION': add(positions.astype(np.float32), FLOAT, 34962, True),
        'NORMAL': add(normals.astype(np.float32), FLOAT, 34962),
    }, 'indices': add(faces.astype(np.uint32).ravel(), UINT, 34963), 'mode': 4}
    for k, a in (attrs or {}).items():
        prim['attributes'][k] = add(np.asarray(a, np.float32), FLOAT, 34962)
    nodes = [{'name': name, 'mesh': 0}]
    gltf = {'asset': {'version': '2.0', 'generator': '3dGarments tools/body'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
            'meshes': [{'name': name, 'primitives': [prim]}]}
    if skin is not None:
        prim['attributes']['JOINTS_0'] = add(skin['joints'].astype(np.uint16), USHORT, 34962)
        prim['attributes']['WEIGHTS_0'] = add(skin['weights'].astype(np.float32), FLOAT, 34962)
        B = len(skin['names'])
        heads, rot = np.asarray(skin['heads'], float), np.asarray(skin['rot'], float)
        world = [_mat(heads[i], rot[i]) for i in range(B)]
        first = len(nodes)
        for i in range(B):
            p = skin['parents'][i]
            local = world[i] if p < 0 else np.linalg.inv(world[p]) @ world[i]
            t, q = _decompose(local)
            nodes.append({'name': skin['names'][i], 'translation': t.tolist(), 'rotation': q.tolist()})
        for i in range(B):
            kids = [first + j for j in range(B) if skin['parents'][j] == i]
            if kids:
                nodes[first + i]['children'] = kids
        roots = [first + i for i in range(B) if skin['parents'][i] < 0]
        ibm = np.stack([np.linalg.inv(w).T.ravel() for w in world]).astype(np.float32)  # column-major
        gltf['skins'] = [{'joints': list(range(first, first + B)), 'inverseBindMatrices': add(ibm, FLOAT),
                          'skeleton': roots[0]}]
        nodes[0]['skin'] = 0
        gltf['scenes'][0]['nodes'] = [0] + roots
    gltf['buffers'] = [{'byteLength': len(blob)}]
    gltf['bufferViews'] = views
    gltf['accessors'] = accessors
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat_to_quat(R):
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1) * 2
        return np.array([(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4])
    i = int(np.argmax(np.diag(R)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = np.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
    q = np.zeros(4)
    q[i] = s / 4
    q[j] = (R[j, i] + R[i, j]) / s
    q[k] = (R[k, i] + R[i, k]) / s
    q[3] = (R[k, j] - R[j, k]) / s
    return q


def _mat(t, q):
    M = np.eye(4)
    M[:3, :3] = quat_to_mat(q)
    M[:3, 3] = t
    return M


def _decompose(M):
    q = mat_to_quat(M[:3, :3])
    return M[:3, 3], q / np.linalg.norm(q)
