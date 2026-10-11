/**
 * Template garments: a plain static mesh (a .glb with no skeleton and no morph targets) that is
 * FITTED to the mannequin and then FOLLOWS it whenever the body changes (width, height, belly,
 * bust, pose …).
 *
 *  fit()     once per garment / body:
 *              1. align  — search a uniform scale + vertical / depth offset so the garment sits on
 *                          the torso (no landmarks to hand-author: the loss is "outside the skin,
 *                          close to it")
 *              2. wrap   — every vertex keeps its own distance from the skin, clamped into
 *                          [snug, snug + slack] along the skin normal, so it never sinks into the
 *                          body and never floats (sleeves swing in onto the arms); the offsets are
 *                          smoothed so the cloth doesn't tear, then re-checked for penetration
 *              3. bind   — each vertex is tied to the skin triangle under it (barycentric)
 *  follow()  after every shape / pose change: the garment moves by what its anchors moved
 *            (displacement transfer), so it grows with the belly, widens with the shoulders …
 *
 * Space: everything is in the human's local space (the garment is a child of human.object, so the
 * height scale applies to it for free). The garment model is expected +Y up, +Z front.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** bones whose skin the garment may rest on (torso + upper limbs + neck) */
const SURFACE_BONES = new Set([
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r',
  'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'neck_01', 'thigh_l', 'thigh_r',
]);

export const FIT_DEFAULTS = {
  snug: 0.004,        // m: gap between the skin and the garment's inner face
  slack: 0.03,        // m: how far the body of the garment may stand off the skin (looseness)
  slackArm: 0.010,    // m: sleeves hug the arm (no balloon sleeves)
  slackHem: 0.008,    // m: the bottom hem hugs the hips (no flared corners)
  hemBelow: -0.40,    // model units: vertices below this height belong to the hem
  thickness: 0.0078,  // garment wall thickness in the model's own units (measured on the source mesh)
  shoulderEase: 1.08, // garment shoulder seam width = shoulder-joint distance × this
  seamHalf: 0.29,     // model units: half width of the shoulder seam (where the sleeve starts)
  seamY: 0.40,        // model units: height of the shoulder seam
};

/* ------------------------------------------------------------------ geometry helpers */

const _bary = [0, 0, 0];
/** squared distance from p to triangle abc; barycentric weights of the closest point in _bary (Ericson) */
function closestTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u = 1, v = 0, w = 0;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; w = 0; }
  else if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; v = 0; }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - w; }
  else { const k = 1 / (va + vb + vc); v = vb * k; w = vc * k; u = 1 - v - w; }
  _bary[0] = u; _bary[1] = v; _bary[2] = w;
  const qx = ax * u + bx * v + cx * w - px, qy = ay * u + by * v + cy * w - py, qz = az * u + bz * v + cz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}

/** orthonormal frame of triangle (a, b, c) (offsets into P): rows e1 (along ab), e2, normal -> E[0..8] */
function frame(P, a, b, c, E) {
  let e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const l1 = Math.hypot(e1x, e1y, e1z) || 1; e1x /= l1; e1y /= l1; e1z /= l1;
  const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
  let nx = e1y * acz - e1z * acy, ny = e1z * acx - e1x * acz, nz = e1x * acy - e1y * acx;
  const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
  E[0] = e1x; E[1] = e1y; E[2] = e1z;
  E[3] = ny * e1z - nz * e1y; E[4] = nz * e1x - nx * e1z; E[5] = nx * e1y - ny * e1x; // e2 = n × e1
  E[6] = nx; E[7] = ny; E[8] = nz;
}

/** the skin as a triangle soup with a uniform grid for closest-point queries */
class Surface {
  constructor(P, tri, cell = 0.02, region = null) {
    this.P = P; this.tri = tri; this.cell = cell; this.region = region; // region[t]: 1 = arm triangle
    const n = P.length / 3;
    this.N = new Float32Array(n * 3);
    this.#normals();
    this.grid = new Map();
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      const lo = [0, 1, 2].map((k) => Math.min(P[a + k], P[b + k], P[c + k]));
      const hi = [0, 1, 2].map((k) => Math.max(P[a + k], P[b + k], P[c + k]));
      for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
        for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
          for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
            const key = Surface.key(x, y, z);
            let l = this.grid.get(key);
            if (!l) this.grid.set(key, l = []);
            l.push(t / 3);
          }
    }
    // result of the last query()
    this.t = -1; this.d2 = Infinity; this.u = 0; this.v = 0; this.w = 0;
    this.nx = 0; this.ny = 0; this.nz = 1;
  }

  static key(x, y, z) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }

  #normals() {
    const { P, tri, N } = this;
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area-weighted
      for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
    }
    for (let i = 0; i < N.length; i += 3) {
      const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
      N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
    }
  }

  /** closest skin point to p; fills this.{t,d2,u,v,w,nx,ny,nz}; returns false when nothing is within `reach` */
  query(px, py, pz, reach = 0.16) {
    const { P, tri, grid, cell } = this;
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
    const maxR = Math.ceil(reach / cell);
    this.d2 = Infinity; this.t = -1;
    // grow the search one shell of cells at a time; after shell R everything within R*cell has been seen
    for (let R = 0; R <= maxR; R++) {
      for (let x = cx - R; x <= cx + R; x++) {
        const ex = x === cx - R || x === cx + R;
        for (let y = cy - R; y <= cy + R; y++) {
          const ey = ex || y === cy - R || y === cy + R;
          for (let z = cz - R; z <= cz + R; z += (ey || R === 0) ? 1 : 2 * R) {
            const l = grid.get(Surface.key(x, y, z));
            if (!l) continue;
            for (let q = 0; q < l.length; q++) {
              const t = l[q], a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
              const d2 = closestTri(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
              if (d2 < this.d2) { this.d2 = d2; this.t = t; this.u = _bary[0]; this.v = _bary[1]; this.w = _bary[2]; }
            }
          }
        }
      }
      if (this.t >= 0 && this.d2 <= (R * cell) ** 2) break;
    }
    if (this.t < 0 || this.d2 > reach * reach) return false;
    const N = this.N, a = tri[this.t * 3] * 3, b = tri[this.t * 3 + 1] * 3, c = tri[this.t * 3 + 2] * 3;
    const { u, v, w } = this;
    const nx = N[a] * u + N[b] * v + N[c] * w, ny = N[a + 1] * u + N[b + 1] * v + N[c + 1] * w, nz = N[a + 2] * u + N[b + 2] * v + N[c + 2] * w;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nx = nx / l; this.ny = ny / l; this.nz = nz / l;
    return true;
  }

  /** closest point of the last query */
  point(out) {
    const { P, tri, t, u, v, w } = this;
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    out[0] = P[a] * u + P[b] * v + P[c] * w; out[1] = P[a + 1] * u + P[b + 1] * v + P[c + 1] * w; out[2] = P[a + 2] * u + P[b + 2] * v + P[c + 2] * w;
    return out;
  }
}

/* ------------------------------------------------------------------ the garment */

export class TemplateGarment {
  /**
   * @param url   .glb (one mesh, +Y up, +Z front)
   * @param human the Human the garment is worn by
   */
  static async load(url, human, opts = {}) {
    const gltf = await new GLTFLoader().loadAsync(url);
    let src = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    if (!src) throw new Error('template has no mesh');
    src.updateWorldMatrix(true, false);
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    const g = new TemplateGarment(geo, human, opts);
    g.fit();
    return g;
  }

  constructor(geometry, human, opts = {}) {
    this.human = human;
    this.opts = { ...FIT_DEFAULTS, ...opts };
    this.base = Float32Array.from(geometry.attributes.position.array);   // model space, as authored
    this.index = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: this.base.length / 3 }, (_, i) => i);
    const n = this.base.length / 3;
    // garment vertex normals of the source (before any fitting): which face of the wall a vertex is on
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', new THREE.BufferAttribute(this.base, 3));
    tmp.setIndex(new THREE.BufferAttribute(this.index, 1));
    tmp.computeVertexNormals();
    this.baseN = Float32Array.from(tmp.attributes.normal.array);
    tmp.dispose();
    this.#adjacency(n);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.base), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.baseN), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.index, 1));
    if (geometry.attributes.uv) this.geometry.setAttribute('uv', geometry.attributes.uv.clone());
    this.material = new THREE.MeshStandardMaterial({ color: opts.color || '#d9d6cf', roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = 'template-garment';
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
    human.object.add(this.object);
    this.sex = null;
    this.stats = {};
    // coalesce: one shape change fires the listeners twice (shape, then pose)
    this.onHuman = () => { if (this.pending) return; this.pending = true; queueMicrotask(() => { this.pending = false; this.update(); clearTimeout(this.settleTimer); this.settleTimer = setTimeout(() => this.settle(), 180); }); };
    human.listeners.add(this.onHuman);
  }

  setColor(c) { this.material.color.set(c); }
  /** texture map for the garment's own UVs: a THREE.Texture, an image URL, or null (glTF convention: v runs down) */
  async setTexture(t) {
    if (typeof t === 'string') t = await new THREE.TextureLoader().loadAsync(t);
    if (t) { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; }
    this.material.map = t || null; this.material.needsUpdate = true;
  }
  /** UV test pattern: red grows with u, green with v, 1/16 grid lines, a corner mark at (0,0) */
  showChecker(on) {
    if (on && !this.checker) {
      const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
      const x = c.getContext('2d'), img = x.createImageData(S, S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const o = (j * S + i) * 4; img.data[o] = 60 + 195 * i / S; img.data[o + 1] = 60 + 195 * j / S; img.data[o + 2] = 90; img.data[o + 3] = 255; }
      x.putImageData(img, 0, 0);
      x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 2;
      for (let k = 0; k <= 16; k++) { x.beginPath(); x.moveTo(k * S / 16, 0); x.lineTo(k * S / 16, S); x.moveTo(0, k * S / 16); x.lineTo(S, k * S / 16); x.stroke(); }
      x.fillStyle = '#fff'; x.fillRect(0, 0, 90, 90); x.fillStyle = '#000'; x.font = 'bold 40px sans-serif'; x.fillText('0,0', 10, 55);
      this.checker = new THREE.CanvasTexture(c); this.checker.colorSpace = THREE.SRGBColorSpace; this.checker.flipY = false;
    }
    this.material.map = on ? this.checker : null; this.material.needsUpdate = true;
  }
  /** the garment's UV layout (triangle outlines) as a canvas — what the texture generator paints onto */
  uvCanvas(size = 1024) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), uv = this.geometry.attributes.uv?.array, ix = this.index;
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
    if (!uv) return c;
    x.strokeStyle = '#222'; x.lineWidth = 1; x.beginPath();
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = ix[t + e], b = ix[t + (e + 1) % 3];
      x.moveTo(uv[a * 2] * size, uv[a * 2 + 1] * size); x.lineTo(uv[b * 2] * size, uv[b * 2 + 1] * size);
    }
    x.stroke();
    return c;
  }
  setSlack(m) { this.opts.slack = m; this.fit(); }

  dispose() {
    clearTimeout(this.settleTimer);
    this.human.listeners.delete(this.onHuman);
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  /* -------------------------------------------------------------- the skin */

  /** 1 for triangles on the arms (their dominant bone is an arm bone), else 0 */
  #regions(tri, ids) {
    const B = this.human.active, names = B.bones.map((b) => b.name), r = new Uint8Array(tri.length / 3);
    for (let t = 0; t < r.length; t++) { const nm = names[B.dom[ids[tri[t * 3]]]]; r[t] = nm.startsWith('upperarm') || nm.startsWith('lowerarm') ? 1 : 0; }
    return r;
  }

  /** the skin triangles the garment may rest on, with their current (skinned + morphed) positions */
  #skin() {
    const { human } = this;
    const B = human.active, mesh = B.mesh, g = mesh.geometry;
    human.object.updateMatrixWorld(true);
    if (!this.ids) {
      const dom = B.dom, names = B.bones.map((b) => b.name), idx = g.index.array;
      const inSet = (v) => SURFACE_BONES.has(names[dom[v]]);
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) if (inSet(idx[t]) && inSet(idx[t + 1]) && inSet(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      this.tri = Uint32Array.from(keep);
      this.ids = Array.from(new Set(keep)).sort((a, b) => a - b);
      this.slot = new Map(this.ids.map((v, i) => [v, i]));
      this.sexOfIds = human.sex;
    }
    return { ids: this.ids, P: this.#positions(this.ids) };
  }

  #positions(ids, out) {
    const { human } = this;
    const mesh = human.active.mesh;
    human.object.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(human.object.matrixWorld).invert().multiply(mesh.matrixWorld);
    const P = out || new Float32Array(ids.length * 3), v = new THREE.Vector3();
    for (let i = 0; i < ids.length; i++) {
      mesh.getVertexPosition(ids[i], v);
      v.applyMatrix4(m);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    return P;
  }

  /* -------------------------------------------------------------- fitting */

  fit() {
    const t0 = performance.now();
    const { human, opts } = this;
    this.ids = null;
    this.sex = human.sex;
    const { ids, P } = this.#skin();
    const slot = this.slot;
    const tri = Uint32Array.from(this.tri, (v) => slot.get(v));      // triangles in slot space
    this.fitP = P;                                                    // skin at fit time (slot space)
    if (opts.prefit) return this.#fitPrefit(ids, tri, t0);
    const skin = new Surface(P, tri, 0.02, this.#regions(tri, ids));

    /* ---- 1. align: uniform scale + height + depth ---- */
    const bp = (n) => human.bonePosition(n, new THREE.Vector3());
    const shL = bp('upperarm_l'), shR = bp('upperarm_r');
    const jointDist = Math.abs(shL.x - shR.x);
    const s0 = (jointDist * opts.shoulderEase) / (2 * opts.seamHalf);
    const ty0 = (shL.y + shR.y) / 2 + 0.015 - opts.seamY * s0;
    // depth centre of the chest
    const spine = bp('spine_02');
    const tz0 = spine.z;

    const n = this.base.length / 3, base = this.base;
    const sample = [];
    for (let i = 0; i < n; i += Math.ceil(n / 500)) sample.push(i);
    const score = (s, ty, tz) => {
      let loss = 0;
      for (const i of sample) {
        const x = base[i * 3] * s, y = base[i * 3 + 1] * s + ty, z = base[i * 3 + 2] * s + tz;
        if (!skin.query(x, y, z, 0.2)) { loss += 0.2; continue; }
        const c = skin.point([0, 0, 0]);
        const sd = (x - c[0]) * skin.nx + (y - c[1]) * skin.ny + (z - c[2]) * skin.nz;
        const d = Math.sqrt(skin.d2);
        loss += sd < 0 ? 4 * Math.min(d, 0.08) + 0.01 : Math.max(0, Math.min(d, 0.15) - 0.03); // inside is much worse than loose
      }
      return loss / sample.length;
    };
    let best = { s: s0, ty: ty0, tz: tz0, l: Infinity };
    const grid = (c, ds, dy, dz, k) => {
      for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) for (let d = -1; d <= 1; d++) {
        const s = c.s * (1 + a * ds), ty = c.ty + b * dy, tz = c.tz + d * dz, l = score(s, ty, tz);
        if (l < best.l) best = { s, ty, tz, l };
      }
    };
    grid({ s: s0, ty: ty0, tz: tz0 }, 0.07, 0.025, 0.02, 2);
    const c1 = { ...best };
    grid(c1, 0.02, 0.008, 0.007, 1);
    const tAlign = performance.now() - t0;
    this.fitInfo = { s0, scale: best.s, ty: best.ty, tz: best.tz, jointDist, loss: best.l };

    const G = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { G[i * 3] = base[i * 3] * best.s; G[i * 3 + 1] = base[i * 3 + 1] * best.s + best.ty; G[i * 3 + 2] = base[i * 3 + 2] * best.s + best.tz; }

    /* ---- 2. wrap, 3. bind ---- */
    this.thick = opts.thickness * best.s;
    this.hem = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.hem[i] = base[i * 3 + 1] < opts.hemBelow ? 1 : 0;
    this.inner = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!skin.query(G[i * 3], G[i * 3 + 1], G[i * 3 + 2], 0.25)) continue;
      this.inner[i] = this.baseN[i * 3] * skin.nx + this.baseN[i * 3 + 1] * skin.ny + this.baseN[i * 3 + 2] * skin.nz < 0 ? 1 : 0;
    }
    this.#wrap(G, skin, [10, 4, 0, 0]);
    this.#bind(G, skin, P, tri, ids);

    this.skin = skin;
    this.stats.fitMs = performance.now() - t0;
    this.stats.alignMs = tAlign;
    this.stats.skinTris = tri.length / 3;
    this.#write(G);
    return this.fitInfo;
  }

  /**
   * The garment was modelled directly on the mannequin (Blender, imported from the mannequin .glb, same
   * origin / scale): nothing to align or wrap. Bind it to the mannequin's REST skin, then update() carries it
   * to whatever the body does now (arms lowered, sliders …).
   */
  #fitPrefit(ids, tri, t0) {
    const g = this.human.active.mesh.geometry.attributes.position, mesh = this.human.active.mesh;
    this.human.object.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(this.human.object.matrixWorld).invert().multiply(mesh.matrixWorld);
    const P = new Float32Array(ids.length * 3), v = new THREE.Vector3();
    for (let i = 0; i < ids.length; i++) { v.fromBufferAttribute(g, ids[i]).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    const skin = new Surface(P, tri, 0.02, this.#regions(tri, ids));
    const G = Float32Array.from(this.base);
    this.fitInfo = { prefit: true, scale: 1 };
    this.inner = new Uint8Array(G.length / 3).fill(1);   // single-layer garment: its surface IS the cloth
    this.thick = 0; this.hem = new Uint8Array(G.length / 3);
    this.#bind(G, skin, P, tri, ids);
    this.skin = skin;
    this.stats.fitMs = performance.now() - t0;
    this.update();
    this.settleTimer = setTimeout(() => this.settle(), 60);   // the pose differs from the rest pose it was modelled in
    return this.fitInfo;
  }

  /**
   * Keep every vertex's own gap to the skin, clamped into [lo, lo + slack] along the skin normal
   * (lo: snug for the wall's inner face, snug + thickness for its outer face). Each pass can smooth
   * the offsets first; the last passes (0) only enforce the bounds. Edits G in place.
   */
  #wrap(G, skin, passes) {
    const { opts, inner, thick } = this, n = G.length / 3, D = new Float32Array(n * 3), pt = [0, 0, 0];
    for (const smooth of passes) {
      for (let i = 0; i < n; i++) {
        const x = G[i * 3] + D[i * 3], y = G[i * 3 + 1] + D[i * 3 + 1], z = G[i * 3 + 2] + D[i * 3 + 2];
        if (!skin.query(x, y, z, 0.25)) continue;
        skin.point(pt);
        const sd = (x - pt[0]) * skin.nx + (y - pt[1]) * skin.ny + (z - pt[2]) * skin.nz;
        const lo = opts.snug + (inner[i] ? 0 : thick);
        // a prefit garment keeps its own looseness: only the lower bound (never inside the skin) applies
        const slack = opts.prefit ? 1 : this.hem[i] ? Math.min(opts.slack, opts.slackHem) : skin.region?.[skin.t] ? Math.min(opts.slack, opts.slackArm) : opts.slack;
        const hi = lo + slack;
        const want = sd < lo ? lo : sd > hi ? hi : sd;
        D[i * 3] += skin.nx * (want - sd); D[i * 3 + 1] += skin.ny * (want - sd); D[i * 3 + 2] += skin.nz * (want - sd);
      }
      if (smooth) this.#smooth(D, smooth);
    }
    for (let i = 0; i < n * 3; i++) G[i] += D[i];
  }

  /** tie each garment vertex to the skin triangle under it, in that triangle's local frame; G becomes the rest state */
  #bind(G, skin, P, tri, ids) {
    const n = G.length / 3;
    this.fitG = G;
    this.anchorU = new Uint32Array(n * 3);   // 3 indices into the "used" skin vertices per garment vertex
    this.weight = new Float32Array(n * 3);   // barycentric weights of the anchor point
    this.local = new Float32Array(n * 3);    // offset from the anchor point in the triangle frame (e1, e2, normal)
    const slotToUsed = new Map(), usedSlots = [];
    const useSlot = (sl) => { let u = slotToUsed.get(sl); if (u === undefined) { u = usedSlots.length; slotToUsed.set(sl, u); usedSlots.push(sl); } return u; };
    const E = new Float32Array(9);
    for (let i = 0; i < n; i++) {
      if (!skin.query(G[i * 3], G[i * 3 + 1], G[i * 3 + 2], 0.3)) { this.weight[i * 3] = 1; this.anchorU[i * 3] = this.anchorU[i * 3 + 1] = this.anchorU[i * 3 + 2] = useSlot(tri[0]); continue; }
      const sl = [tri[skin.t * 3], tri[skin.t * 3 + 1], tri[skin.t * 3 + 2]];
      for (let k = 0; k < 3; k++) this.anchorU[i * 3 + k] = useSlot(sl[k]);
      this.weight[i * 3] = skin.u; this.weight[i * 3 + 1] = skin.v; this.weight[i * 3 + 2] = skin.w;
      frame(P, sl[0] * 3, sl[1] * 3, sl[2] * 3, E);
      const q0 = P[sl[0] * 3] * skin.u + P[sl[1] * 3] * skin.v + P[sl[2] * 3] * skin.w;
      const q1 = P[sl[0] * 3 + 1] * skin.u + P[sl[1] * 3 + 1] * skin.v + P[sl[2] * 3 + 1] * skin.w;
      const q2 = P[sl[0] * 3 + 2] * skin.u + P[sl[1] * 3 + 2] * skin.v + P[sl[2] * 3 + 2] * skin.w;
      const ox = G[i * 3] - q0, oy = G[i * 3 + 1] - q1, oz = G[i * 3 + 2] - q2;
      this.local[i * 3] = ox * E[0] + oy * E[1] + oz * E[2];
      this.local[i * 3 + 1] = ox * E[3] + oy * E[4] + oz * E[5];
      this.local[i * 3 + 2] = ox * E[6] + oy * E[7] + oz * E[8];
    }
    this.usedIds = usedSlots.map((sl) => ids[sl]);
    this.usedP = new Float32Array(usedSlots.length * 3);
  }

  /**
   * After the body stopped changing: re-check the garment against the NEW skin (push out anything
   * that sank in, pull in anything that drifted loose) and make that the new rest state. update()
   * is fast but approximate while a slider is moving; this makes the result exact once it stops.
   */
  settle() {
    if (!this.fitG || this.human.sex !== this.sex) return;
    const t0 = performance.now();
    this.update();
    const { ids, P } = this.#skin();
    const slot = this.slot, tri = Uint32Array.from(this.tri, (v) => slot.get(v));
    const skin = new Surface(P, tri, 0.02, this.#regions(tri, ids));
    const G = Float32Array.from(this.geometry.attributes.position.array);
    this.#wrap(G, skin, [3, 0]);
    this.#bind(G, skin, P, tri, ids);
    this.#write(G);
    this.stats.settleMs = performance.now() - t0;
    this.onSettled?.();
  }

  /** the garment's positions after the skin moved: each vertex rides on its skin triangle (position + rotation) */
  update() {
    if (!this.fitG) return;
    if (this.human.sex !== this.sex) { this.fit(); return; }
    const t0 = performance.now();
    this.#positions(this.usedIds, this.usedP);
    const n = this.fitG.length / 3, out = this.geometry.attributes.position.array;
    const { anchorU, weight, local, usedP } = this, E = this.#E;
    for (let i = 0; i < n; i++) {
      const a = anchorU[i * 3] * 3, b = anchorU[i * 3 + 1] * 3, c = anchorU[i * 3 + 2] * 3;
      frame(usedP, a, b, c, E);
      const u = weight[i * 3], v = weight[i * 3 + 1], w = weight[i * 3 + 2];
      const lx = local[i * 3], ly = local[i * 3 + 1], lz = local[i * 3 + 2];
      out[i * 3] = usedP[a] * u + usedP[b] * v + usedP[c] * w + lx * E[0] + ly * E[3] + lz * E[6];
      out[i * 3 + 1] = usedP[a + 1] * u + usedP[b + 1] * v + usedP[c + 1] * w + lx * E[1] + ly * E[4] + lz * E[7];
      out[i * 3 + 2] = usedP[a + 2] * u + usedP[b + 2] * v + usedP[c + 2] * w + lx * E[2] + ly * E[5] + lz * E[8];
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.stats.followMs = performance.now() - t0;
  }
  #E = new Float32Array(9);

  /**
   * How well the garment sits on the CURRENT skin (rebuilds the skin surface, so it is slow — for tests).
   * @returns { inside: fraction of vertices below the skin, worstMm: deepest penetration, floatingMm: 95th-percentile gap }
   */
  audit() {
    const { ids, P } = this.#skin();
    const slot = this.slot, tri = Uint32Array.from(this.tri, (v) => slot.get(v));
    const skin = new Surface(P, tri), pos = this.geometry.attributes.position.array, n = pos.length / 3, pt = [0, 0, 0];
    let inside = 0, worst = 0; const gaps = [], deep = [];
    const B = this.human.active, names = B.bones.map((b) => b.name);
    for (let i = 0; i < n; i++) {
      if (!skin.query(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0.3)) continue;
      skin.point(pt);
      const sd = (pos[i * 3] - pt[0]) * skin.nx + (pos[i * 3 + 1] - pt[1]) * skin.ny + (pos[i * 3 + 2] - pt[2]) * skin.nz;
      if (sd < 0) {
        inside++; worst = Math.max(worst, -sd);
        deep.push({ i, mm: -sd * 1000, x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2], bone: names[B.dom[ids[tri[skin.t * 3]]]] });
      }
      gaps.push(Math.abs(sd));
    }
    gaps.sort((a, b) => a - b);
    deep.sort((a, b) => b.mm - a.mm);
    return { deep: deep.slice(0, 400), vertices: n, inside: inside / n, worstMm: worst * 1000, gap95Mm: gaps[Math.floor(gaps.length * 0.95)] * 1000, ids: ids.length };
  }

  #write(G) {
    this.geometry.attributes.position.array.set(G);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /** CSR adjacency of the garment mesh, for smoothing the offsets */
  #adjacency(n) {
    const deg = new Uint32Array(n + 1), idx = this.index;
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { deg[idx[t + k] + 1] += 2; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const nb = new Uint32Array(deg[n]), fill = Uint32Array.from(deg.subarray(0, n));
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = idx[t + k], b = idx[t + (k + 1) % 3], c = idx[t + (k + 2) % 3];
      nb[fill[a]++] = b; nb[fill[a]++] = c;
    }
    this.adjStart = deg; this.adj = nb;
  }

  #smooth(D, iterations) {
    const n = D.length / 3, { adjStart, adj } = this, tmp = new Float32Array(D.length);
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const a = adjStart[i], b = adjStart[i + 1], c = b - a;
        let x = 0, y = 0, z = 0;
        for (let j = a; j < b; j++) { x += D[adj[j] * 3]; y += D[adj[j] * 3 + 1]; z += D[adj[j] * 3 + 2]; }
        tmp[i * 3] = c ? 0.5 * D[i * 3] + 0.5 * x / c : D[i * 3];
        tmp[i * 3 + 1] = c ? 0.5 * D[i * 3 + 1] + 0.5 * y / c : D[i * 3 + 1];
        tmp[i * 3 + 2] = c ? 0.5 * D[i * 3 + 2] + 0.5 * z / c : D[i * 3 + 2];
      }
      D.set(tmp);
    }
  }
}
