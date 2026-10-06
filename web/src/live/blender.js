/**
 * The live link to Blender (tools/blender/live.py): ?blender=1 (or ?blender=ws://host:port).
 *
 * - Sends the body EXACTLY as it stands on screen: sex + every vertex's world position (pose, height, width, every
 *   shape slider). Blender puts it on its own copy of the same model (same vertices, same order), so whatever is
 *   modelled there is modelled on this body. Re-sent whenever the body changes.
 * - Draws what Blender streams back (the meshes in its "Garments" collection, live: cloth frames as they simulate)
 *   in world space, on the body.
 * A small badge shows the link's state. Reconnects every 2 s while Blender isn't there.
 */
import * as THREE from 'three';

const b64 = (buf) => {
  const u = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s, T) => {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
};

/** world positions of the body as drawn (CPU morphs + skinning + the model's transform) */
function bodyPositions(human) {
  const B = human.active, mesh = B.mesh, g = mesh.geometry;
  mesh.userData.cpuMorphUpdate?.();
  human.object.updateMatrixWorld(true);
  mesh.skeleton.update();
  const P = g.attributes.position.array, MP = g.attributes.morphPos?.array, n = P.length / 3;
  const out = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3] + (MP ? MP[i * 3] : 0), P[i * 3 + 1] + (MP ? MP[i * 3 + 1] : 0), P[i * 3 + 2] + (MP ? MP[i * 3 + 2] : 0));
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}

/** the same body in the rig's rest pose: every shape slider (CPU morphs), no skinning, mesh space */
function restPositions(human) {
  const g = human.active.mesh.geometry;
  const P = g.attributes.position.array, MP = g.attributes.morphPos?.array, out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) out[i] = P[i] + (MP ? MP[i] : 0);
  return out;
}

/** skin a rest-space garment like the body under it: each vertex copies the bone weights of the nearest body vertex
 *  (rest positions, 2 cm hash grid), so it follows every pose the site shows */
function skinLikeBody(human, P) {
  const mesh = human.active.mesh, g = mesh.geometry;
  const R = restPositions(human), n = R.length / 3, S = 0.02, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / S)},${Math.floor(y / S)},${Math.floor(z / S)}`;
  const part = g.attributes._part?.array;
  for (let i = 0; i < n; i++) {
    if (part && part[i] > 0.5 && part[i] < 3.5) continue;          // eyes etc. (skin 0, fabric 4 are fine)
    const k = key(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]);
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
  }
  const m = P.length / 3, si = new Uint16Array(m * 4), sw = new Float32Array(m * 4);
  const BI = g.attributes.skinIndex.array, BW = g.attributes.skinWeight.array;
  for (let v = 0; v < m; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 8 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const a = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
        for (const i of a) { const d = (R[i * 3] - x) ** 2 + (R[i * 3 + 1] - y) ** 2 + (R[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
    }
    if (best < 0) best = 0;
    for (let k = 0; k < 4; k++) { si[v * 4 + k] = BI[best * 4 + k]; sw[v * 4 + k] = BW[best * 4 + k]; }
  }
  return { si, sw };
}

/** a cheap fingerprint of everything that moves the body */
function bodyKey(human) {
  const B = human.active, mesh = B.mesh;
  mesh.updateMatrixWorld(true);
  const bones = B.bones.map((b) => b.quaternion.toArray().map((x) => x.toFixed(4)).join(',')).join(';');
  return `${human.sex}|${(mesh.morphTargetInfluences || []).map((x) => x.toFixed(4)).join(',')}|${mesh.matrixWorld.elements.map((x) => x.toFixed(4)).join(',')}|${bones}`;
}

export function connectBlender({ human, stage, url = 'ws://127.0.0.1:8790' }) {
  const group = new THREE.Group();
  group.name = 'blender-live';
  stage.scene ? stage.scene.add(group) : stage.root.parent.add(group);
  const meshes = new Map();
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:50;padding:6px 10px;border-radius:8px;font:12px/1.2 system-ui,sans-serif;background:rgba(20,20,20,.75);color:#fff;pointer-events:none';
  document.body.append(badge);
  const say = (s, ok) => { badge.textContent = `Blender: ${s}`; badge.style.background = ok ? 'rgba(22,110,60,.85)' : 'rgba(20,20,20,.75)'; };

  let ws = null, lastKey = '', timer = 0;
  const sendBody = (force = false) => {
    if (!ws || ws.readyState !== 1 || !human) return;
    const k = bodyKey(human);
    if (!force && k === lastKey) return;
    lastKey = k;
    ws.send(JSON.stringify({ t: 'body', sex: human.sex, pos: b64(bodyPositions(human)), rest: b64(restPositions(human)) }));
  };

  const material = (m) => {
    const c = m.color || [0.92, 0.92, 0.9];
    return m.style === 'wire'
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), wireframe: true, transparent: true, opacity: 0.35 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  };
  const drop = (id) => { const o = meshes.get(id); if (o) { o.removeFromParent(); o.geometry.dispose(); meshes.delete(id); } };
  const onMesh = (m) => {
    const rest = m.space === 'rest';
    let o = meshes.get(m.id);
    const P = unb64(m.pos, Float32Array);
    if (!o || m.idx || o.userData.rest !== rest) {
      const idx = m.idx ? unb64(m.idx, Uint32Array) : o.geometry.index.array;
      const col = m.color ? m : o.userData.msg;
      drop(m.id);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      if (rest) {
        // modelled on the rest-pose body: rigged like the body under it, so it wears the site's pose
        const { si, sw } = skinLikeBody(human, P);
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        o = new THREE.SkinnedMesh(geo, material(col));
        const body = human.active.mesh;
        o.bind(body.skeleton, body.bindMatrix);
        body.parent.add(o);
      } else {
        o = new THREE.Mesh(geo, material(col));
        group.add(o);
      }
      geo.computeVertexNormals();
      o.name = `blender:${m.id}`;
      o.userData = { rest, msg: { color: col.color, style: col.style } };
      o.castShadow = o.receiveShadow = m.style !== 'wire';
      o.frustumCulled = false;
      meshes.set(m.id, o);
    } else {
      const a = o.geometry.attributes.position;
      a.array.set(P);
      a.needsUpdate = true;
      if (rest) {
        const { si, sw } = skinLikeBody(human, P);
        o.geometry.attributes.skinIndex.array.set(si); o.geometry.attributes.skinIndex.needsUpdate = true;
        o.geometry.attributes.skinWeight.array.set(sw); o.geometry.attributes.skinWeight.needsUpdate = true;
      }
      o.geometry.computeVertexNormals();
    }
    stage.invalidate(2);
  };

  const open = () => {
    say('connecting…');
    try { ws = new WebSocket(url); } catch { return setTimeout(open, 2000); }
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello' })); lastKey = ''; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { say(`live (Blender ${m.blender})`, true); sendBody(true); }
      else if (m.t === 'mesh') onMesh(m);
      else if (m.t === 'remove') { drop(m.id); stage.invalidate(2); }
      else if (m.t === 'error') console.warn('[blender]', m.msg);
    };
    ws.onclose = () => { say('not connected (start tools/blender/live.py)'); ws = null; setTimeout(open, 2000); };
  };
  open();
  // the body changes on sliders, poses, sex: send it when it settles (checked 4× a second, cheap fingerprint)
  timer = setInterval(() => sendBody(false), 250);
  return { group, meshes, get socket() { return ws; }, sendBody, close() { clearInterval(timer); ws?.close(); badge.remove(); for (const id of [...meshes.keys()]) drop(id); group.removeFromParent(); } };
}
