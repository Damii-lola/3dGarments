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

/** the body's bone weights smoothed over the body's own surface (~5 cm): a garment stands off the skin, and the
 *  skin's own weights change from torso to arm within a few cm — copied as they are, the fabric folds into a groove at
 *  the shoulder when the arm comes down from the T-pose. Smoothed along the body's surface (never through space), so
 *  the two thighs, close across the gap but far apart on the skin, never mix. */
function softBodyWeights(human, rounds = 24) {
  const g = human.active.mesh.geometry, n = g.attributes.position.count;
  const BI = g.attributes.skinIndex.array, BW = g.attributes.skinWeight.array, idx = g.index.array;
  const P = g.attributes.position.array;
  // welded adjacency: split vertices (UV seams) at the same place count as one
  const weld = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    const j = seen.get(k); if (j === undefined) { seen.set(k, i); weld[i] = i; } else weld[i] = j;
  }
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  let cur = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = new Map();
    for (let k = 0; k < 4; k++) { const w = BW[i * 4 + k]; if (w > 0) m.set(BI[i * 4 + k], (m.get(BI[i * 4 + k]) || 0) + w); }
    cur[i] = m;
  }
  for (let it = 0; it < rounds; it++) {
    const nxt = new Array(n);
    for (let i = 0; i < n; i++) {
      if (weld[i] !== i) continue;
      const ns = nb[i]; if (!ns.size) { nxt[i] = cur[i]; continue; }
      const o = new Map(); for (const [b, x] of cur[i]) o.set(b, x * 0.5);
      const f = 0.5 / ns.size;
      for (const u of ns) for (const [b, x] of cur[u]) o.set(b, (o.get(b) || 0) + x * f);
      nxt[i] = o;
    }
    for (let i = 0; i < n; i++) if (weld[i] !== i) nxt[i] = nxt[weld[i]];
    cur = nxt;
  }
  return cur;
}

/** skin a rest-space garment like the body under it: each vertex blends the (surface-smoothed) bone weights of the
 *  6 nearest body vertices (rest positions, 2 cm hash grid; inverse-square distance); THEN smoothed again across the
 *  GARMENT's own mesh (a few rounds) before picking the 4 strongest bones — a seam welds two pattern pieces into one
 *  vertex, and its neighbours either side can come from quite different placements (front panel vs. sleeve cap), so
 *  the raw per-vertex nearest-body blend can jump sharply right at that line; smoothing over the garment's own
 *  topology (not just the body's) is what actually levels that jump out, and it's what stopped the shoulder tearing
 *  once the arm came down a long way from the T-pose it was sewn in */
const K = 10;
function smoothGarmentWeights(maps, idx, rounds = 10) {
  const m = maps.length, nbr = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  let cur = maps;
  for (let it = 0; it < rounds; it++) {
    const nxt = new Array(m);
    for (let v = 0; v < m; v++) {
      const ns = nbr[v]; if (!ns.size) { nxt[v] = cur[v]; continue; }
      const o = new Map(); for (const [b, x] of cur[v]) o.set(b, x * 0.5);
      const f = 0.5 / ns.size;
      for (const u of ns) for (const [b, x] of cur[u]) o.set(b, (o.get(b) || 0) + x * f);
      nxt[v] = o;
    }
    cur = nxt;
  }
  return cur;
}
function skinLikeBody(human, P, idx) {
  const g = human.active.mesh.geometry;
  const R = restPositions(human), n = R.length / 3, S = 0.02, grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const part = g.attributes._part?.array;
  for (let i = 0; i < n; i++) {
    if (part && part[i] > 0.5 && part[i] < 3.5) continue;          // eyes etc. (skin 0, fabric 4 are fine)
    const k = key(Math.floor(R[i * 3] / S), Math.floor(R[i * 3 + 1] / S), Math.floor(R[i * 3 + 2] / S));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
  }
  const SW = softBodyWeights(human);
  const m = P.length / 3, si = new Uint16Array(m * 4), sw = new Float32Array(m * 4);
  const bi = new Int32Array(K), bd = new Float64Array(K);
  const maps = new Array(m);
  for (let v = 0; v < m; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S);
    bi.fill(-1); bd.fill(Infinity);
    for (let r = 0; r < 8; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const a = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
        for (const i of a) {
          // only the body on the garment vertex's own side of the centre line: where the trouser legs press together
          // between the thighs, the other thigh is nearer than 1 cm, and its weights pulled the fabric across
          const bx = R[i * 3];
          if ((x > 0.0005 && bx < -0.003) || (x < -0.0005 && bx > 0.003)) continue;
          const d = (bx - x) ** 2 + (R[i * 3 + 1] - y) ** 2 + (R[i * 3 + 2] - z) ** 2;
          if (d >= bd[K - 1]) continue;
          let j = K - 1; while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; bi[j] = bi[j - 1]; j--; }
          bd[j] = d; bi[j] = i;
        }
      }
      // every vertex in the next shell is ≥ r·S away: stop once the K found are all nearer than that
      if (bi[K - 1] >= 0 && bd[K - 1] <= (r * S) ** 2) break;
    }
    const w = new Map();
    for (let j = 0; j < K; j++) {
      const i = bi[j]; if (i < 0) continue;
      const f = 1 / (bd[j] + 1e-6);
      for (const [b, x] of SW[i]) w.set(b, (w.get(b) || 0) + x * f);
    }
    maps[v] = w;
  }
  const smoothed = idx ? smoothGarmentWeights(maps, idx) : maps;
  for (let v = 0; v < m; v++) {
    const top = [...smoothed[v]].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const s = top.reduce((t, e) => t + e[1], 0) || 1;
    top.forEach(([b, x], k) => { si[v * 4 + k] = b; sw[v * 4 + k] = x / s; });
  }
  return { si, sw };
}

/** Build a SkinnedMesh that covers the armhole zone using the body's own skin triangles.
 *  The shirt cloth sim leaves an uncovered crescent at each back-armhole junction; this
 *  patch reuses the body geometry (correct skinning, correct normals) and colors it to
 *  match the shirt.  Zone: y ∈ [1.10, 1.54] m, |x| > 0.08 m, z < 0.08 m (back + side). */
function addArmholePatches(human, col) {
  const body = human.active.mesh;
  const bGeo = body.geometry;
  const R    = restPositions(human);
  const bIdx = bGeo.index.array;
  const part = bGeo.attributes._part?.array;
  const bNrm = bGeo.attributes.normal?.array;
  const bSI  = bGeo.attributes.skinIndex?.array;
  const bSW  = bGeo.attributes.skinWeight?.array;

  // skin triangles in the back-armhole zone (both sides)
  const patchTris = [];
  for (let t = 0; t < bIdx.length; t += 3) {
    const [a, b, c] = [bIdx[t], bIdx[t + 1], bIdx[t + 2]];
    if (part && (part[a] > 0.5 || part[b] > 0.5 || part[c] > 0.5)) continue;
    let ok = true;
    for (const v of [a, b, c]) {
      const vy = R[v * 3 + 1], ax = Math.abs(R[v * 3]), vz = R[v * 3 + 2];
      // zone 1: back shoulder crescent (z < −0.05 keeps off the arm)
      const inBack     = vy >= 1.15 && vy <= 1.50 && ax >= 0.08 && ax <= 0.20 && vz < -0.05;
      // zone 2: front/top shoulder junction (wider y + x bands cover the cap area)
      const inJunction = vy >= 1.35 && vy <= 1.78 && ax >= 0.07 && ax <= 0.30;
      if (!inBack && !inJunction) { ok = false; break; }
    }
    if (ok) patchTris.push(a, b, c);
  }
  if (!patchTris.length) return null;

  // compact to unique verts
  const vertSet = new Set(patchTris);
  const verts   = [...vertSet];
  const reIdx   = new Map(verts.map((v, i) => [v, i]));
  const m = verts.length;
  const P   = new Float32Array(m * 3);
  const nrm = new Float32Array(m * 3);
  const si  = bSI ? new Uint16Array(m * 4)  : null;
  const sw  = bSW ? new Float32Array(m * 4) : null;
  const OFFSET = 0.003; // 3 mm outside bodysuit

  for (let i = 0; i < m; i++) {
    const v  = verts[i];
    const nx = bNrm ? bNrm[v * 3]     : 0;
    const ny = bNrm ? bNrm[v * 3 + 1] : 0;
    const nz = bNrm ? bNrm[v * 3 + 2] : 0;
    P[i * 3]     = R[v * 3]     + nx * OFFSET;
    P[i * 3 + 1] = R[v * 3 + 1] + ny * OFFSET;
    P[i * 3 + 2] = R[v * 3 + 2] + nz * OFFSET;
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
    if (si) si.set(bSI.subarray(v * 4, v * 4 + 4), i * 4);
    if (sw) sw.set(bSW.subarray(v * 4, v * 4 + 4), i * 4);
  }
  const remapped = new Uint32Array(patchTris.map(v => reIdx.get(v)));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',  new THREE.BufferAttribute(P,   3));
  geo.setAttribute('normal',    new THREE.BufferAttribute(nrm, 3));
  if (si) geo.setAttribute('skinIndex',  new THREE.Uint16BufferAttribute(si, 4));
  if (sw) geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(remapped, 1));

  const c = col?.color || [0.92, 0.92, 0.9];
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace),
    roughness: 0.92, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.FrontSide,
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
  body.parent.add(mesh);
  console.log(`[blender] armhole patch: ${m} verts ${patchTris.length / 3} tris`);
  return mesh;
}

/** the body's skin a rest-space garment covers (Body.setHidden discards it): every skin vertex with a garment vertex
 *  within 4 cm, — except near the garment's open edges (4 rings in); only skin within 4 cm of the fabric, where
 *  the skin must still show (neckline, hems, sleeve ends) */
function coveredSkin(human, P, idx) {
  const g = human.active.mesh.geometry, R = restPositions(human), part = g.attributes._part?.array;
  const m = P.length / 3, S = 0.04, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  // the garment's boundary, and two rings in from it
  const ec = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`; ec.set(k, (ec.get(k) || 0) + 1);
  }
  const nbr = Array.from({ length: m }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
  let edge = new Set();
  for (const [k, c] of ec) if (c === 1) for (const v of k.split(',')) edge.add(+v);
  for (let r = 0; r < 4; r++) { const nx = new Set(edge); for (const v of edge) for (const u of nbr[v]) nx.add(u); edge = nx; }
  for (let v = 0; v < m; v++) {
    const k = key(Math.floor(P[v * 3] / S), Math.floor(P[v * 3 + 1] / S), Math.floor(P[v * 3 + 2] / S));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v);
  }
  const hide = new Set(), n = R.length / 3;
  for (let i = 0; i < n; i++) {
    if (part && part[i] > 0.5) continue;
    const x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2], cx = Math.floor(x / S), cy = Math.floor(y / S), cz = Math.floor(z / S);
    let best = -1, bd = 0.04 * 0.04;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
      for (const v of a) { const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = v; } }
    }
    if (best < 0 || edge.has(best)) continue;
    hide.add(i);                                                     // (inside it, or poking through it: either way covered)
  }
  return hide;
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
      : new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace), roughness: 0.92, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.FrontSide });
  };
  const hides = new Map();
  const armholePatches = new Map();
  const applyHide = () => { const all = new Set(); for (const h of hides.values()) for (const i of h) all.add(i); human.active.setHidden?.(all); };
  const drop = (id) => {
    const o = meshes.get(id); if (o) { o.removeFromParent(); o.geometry.dispose(); meshes.delete(id); }
    const p = armholePatches.get(id); if (p) { p.removeFromParent(); p.geometry.dispose(); armholePatches.delete(id); }
    if (hides.delete(id)) applyHide();
  };
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
        const { si, sw } = skinLikeBody(human, P, idx);
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        o = new THREE.SkinnedMesh(geo, material(col));
        hides.set(m.id, coveredSkin(human, P, idx)); applyHide();
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
      // casts a shadow (onto the body, the ground), but doesn't RECEIVE one: a cloth seam's sharp little fold,
      // caught edge-on to the light in some poses, self-shadow-acnes into a bright crack across the fabric there —
      // worse than losing the (minor) self-shadow nicety a sewn, mostly-smooth garment barely needs anyway
      o.castShadow = m.style !== 'wire';
      o.receiveShadow = false;
      o.frustumCulled = false;
      meshes.set(m.id, o);
    } else {
      const a = o.geometry.attributes.position;
      a.array.set(P);
      a.needsUpdate = true;
      if (rest) {
        const { si, sw } = skinLikeBody(human, P, o.geometry.index.array);
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
