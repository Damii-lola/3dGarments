/**
 * The studio's human: the rigged body models in public/body (male.glb, female.glb — built by
 * tools/body/prepare.py from assets/*.fbx), with real-measurement shape controls and the pose library.
 *
 *   const human = await Human.load();
 *   scene.add(human.object);
 *   human.setSex('female');
 *   human.setShape({ width: 0.2, scale: 1.02 });   // width morph (−1…1.5), uniform scale
 *   human.setPose(composePose('stand'));
 *
 * World space: metres, y up, the body faces +z, feet on y = 0.
 *
 * Bone frames: y runs head → tail, x = y × (+z), so a positive x rotation swings a limb FORWARD;
 * hand and finger bones use the palm (+x curls toward it). Limb bones are re-based on "pose zero"
 * (rig.js) — the stance the pose library was authored against — whatever the model's bind pose.
 * Poses are authored for the left side; the right side is the mirror (x, −y, −z).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ZERO_DIRS, ZERO_PALM } from './rig.js';
import { createBodyMaterial } from './materials.js';
import { useCpuMorphs, patchMaterial } from './cpumorph.js';
import { assetUrl } from './assets.js';
import { buildShape, SHAPE_TARGETS } from './shape.js';

const HAND_CHAIN = /^(hand|thumb|index|middle|ring|pinky)_/;
/**
 * How each model's arms hang (calibrated on front silhouettes against reference photos):
 *   lat      how much of the upper arm's radius must clear the chest / lats (less = rests further in)
 *   follow   forearm tilt relative to the upper arm, degrees (+ out, − back toward the thigh)
 *   maxOut   upper-arm tilt cap, degrees (a heavy body's arm rests into the soft tissue instead)
 *   minOut   upper-arm tilt floor, degrees: a visible gap under the armpit whatever the lats do
 *   upperGap extra clearance (metres) the hang solver requires between the arm surface and torso;
 *            default 0.002 (2 mm) — raise it to push the arm visibly away from the lat/chest skin
 * The male's upper arm hangs with a small clearance (≥ 6°) from the shoulder; the forearm
 * continues in the same plane. More abduction, or a forearm angled forward relative to the upper
 * arm, creates a visible elbow kink and makes the arm look bent inward from the front.
 */
const ARM_FIT = { female: { lat: 0.48, follow: 1, maxOut: 90, minOut: 0 }, male: { lat: 0.72, follow: 1, maxOut: 90, minOut: 6, upperGap: 0.045 } };
const armFit = (sex) => ({ ...ARM_FIT[sex], ...(globalThis.__armFit?.[sex] || {}) });
/**
 * Armpit skinning fix. A model sculpted with raised arms (A-pose) has its lats and armpit skin
 * stretched out toward the arm and bound 100 % to the spine: when the arm comes down that skin
 * stays flared like a wing, fills the armpit and glues the upper arm to the torso. Torso skin
 * below and beside the shoulder joint gets a share of the upper arm's weight (up to `max`, fading
 * out by `reach` metres from the joint), so it tucks in as the arm lowers — like a real armpit.
 */
const ARMPIT = { male: { reach: 0.2, max: 0.55 }, female: null };
const FWD = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

const eulerQ = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(
  THREE.MathUtils.degToRad(r[0] || 0), THREE.MathUtils.degToRad(r[1] || 0), THREE.MathUtils.degToRad(r[2] || 0), 'XZY'));
/** Pose value `{ hang: true, out?, fwd?, twist?, extra? }` = solve the limb so it hangs clear of the body. */
const isHang = (v) => !!(v && !Array.isArray(v) && v.hang);

/** One loaded body model: mesh, skeleton, pose-zero frames and measuring data. */
/**
 * The bodysuit: a skin-tight black layer over the whole body — head, hands and every finger, feet and toes — on
 * the body's own geometry and skeleton (so it follows every pose and shape exactly), its skin pushed out along the
 * normals (suitGaps: 1.5 mm, and smoothly over the underwear). Invisible in normal use; shown for testing (?suit=1, human.setSuit(true), the lab's "suit" box).
 */
const SUIT_GAP = 0.0015;   // m (1.5 mm) off the skin
const SINK = 0.002;        // m: prepare.py sinks the skin under the underwear 2 mm (it can't poke through it)
/**
 * Per-vertex gap (the `suitGap` attribute): 1.5 mm off the skin everywhere. The skin under the underwear was sunk
 * 2 mm in prepare.py: the suit gets those 2 mm back there (blended across the underwear's edge), so it runs smooth.
 * (The underwear itself isn't drawn while the suit is shown: Human#setSuit.)
 */
function suitGaps(g) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, part = g.attributes._part.array, n = P.length / 3;
  const gap = new Float32Array(n).fill(SUIT_GAP);
  const C = 0.025, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) if (part[i] > 3.5 && part[i] < 4.5) {
    const k = key(Math.floor(P[i * 3] / C), Math.floor(P[i * 3 + 1] / C), Math.floor(P[i * 3 + 2] / C));
    if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
  }
  if (!grid.size) return { gap, nrm: Float32Array.from(N) };
  // under the underwear: a fabric point just outside this skin point (≤ 4 cm out, ≤ 2.5 cm sideways)
  const under = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (part[i] > 3.5 && part[i] < 4.5) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
    search: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(key(cx + a, cy + b, cz + c)); if (!l) continue;
      for (const j of l) {
        const dx = P[j * 3] - x, dy = P[j * 3 + 1] - y, dz = P[j * 3 + 2] - z, along = dx * nx + dy * ny + dz * nz;
        if (along <= 0 || along > 0.04) continue;
        if (dx * dx + dy * dy + dz * dz - along * along < 0.025 * 0.025) { under[i] = 1; break search; }
      }
    }
  }
  // blended across the edge: neighbour averaging on the skin
  const idx = g.index.array, nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nb[a].push(b); nb[b].push(a); }
  let w = under;
  for (let it = 0; it < 10; it++) {
    const next = w.slice();
    for (let i = 0; i < n; i++) if (nb[i].length) { let s = 0; for (const j of nb[i]) s += w[j]; next[i] = (w[i] + s / nb[i].length) / 2; }
    w = next;
  }
  for (let i = 0; i < n; i++) gap[i] = SUIT_GAP + SINK * Math.min(1, w[i] * 1.6);
  // the suit's own normals: the body's, smoothed across that band — the sink's step is baked into the body's
  // normals and would draw a line around the underwear's outline (muscle detail elsewhere is kept)
  const nrm = Float32Array.from(N), band = new Uint8Array(n);
  for (let i = 0; i < n; i++) band[i] = w[i] > 0.01 ? 1 : 0;
  for (let it = 0; it < 8; it++) {
    const next = nrm.slice();
    for (let i = 0; i < n; i++) {
      if (!band[i] || !nb[i].length) continue;
      let x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
      for (const j of nb[i]) { x += nrm[j * 3]; y += nrm[j * 3 + 1]; z += nrm[j * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      next[i * 3] = x / l; next[i * 3 + 1] = y / l; next[i * 3 + 2] = z / l;
    }
    nrm.set(next);
  }
  return { gap, nrm };
}

function makeSuit(mesh) {
  const g = mesh.geometry;
  const { gap, nrm } = suitGaps(g);
  g.setAttribute('suitGap', new THREE.BufferAttribute(gap, 1));
  g.setAttribute('suitNrm', new THREE.BufferAttribute(nrm, 3));
  // the offset along the rest-pose normal (morphed, not yet skinned): it goes through the skinning with the point.
  // (From the normal attribute itself: the shadow's depth shader has no objectNormal.)
  const offset = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float suitGap;\nattribute vec3 suitNrm;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = suitNrm;')
      .replace('#include <skinning_vertex>', 'transformed += normalize(suitNrm + morphNrm) * suitGap;\n#include <skinning_vertex>');
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.55, metalness: 0 });
  mat.onBeforeCompile = offset;
  mat.customProgramCacheKey = () => 'bodysuit';
  patchMaterial(mat);                          // the morphs come from the body's CPU blend (cpumorph.js)
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = offset;
  depth.customProgramCacheKey = () => 'bodysuit-depth';
  patchMaterial(depth);
  // the skin's triangles only (group 0: the underwear's group 1 has no material here, so it isn't drawn)
  const suit = new THREE.SkinnedMesh(g, [mat]);
  suit.name = 'bodysuit';
  suit.visible = false;
  suit.frustumCulled = false;
  suit.castShadow = suit.receiveShadow = true;
  suit.customDepthMaterial = depth;
  suit.bind(mesh.skeleton, mesh.bindMatrix);
  suit.onBeforeRender = () => {
    suit.morphTargetInfluences = mesh.morphTargetInfluences;   // (shape.js replaces the array when it adds targets)
    mesh.userData.cpuMorphUpdate?.();
  };
  mesh.parent.add(suit);
  return suit;
}

class Body {
  constructor(sex, gltf) {
    this.sex = sex;
    this.root = gltf.scene;
    this.root.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
    const mesh = this.mesh;
    this.material = createBodyMaterial({ eyes: mesh.userData?.eyes });
    // garments render double-sided (their own group): a source garment folds over itself in places
    // (the boxers' pouch), and its back face must read as cloth, not a hole
    this.clothMaterial = createBodyMaterial({ eyes: mesh.userData?.eyes, side: THREE.DoubleSide });
    mesh.material = [this.material, this.clothMaterial]; // array: the lab swaps in debug materials by index
    const g = mesh.geometry;
    for (const [k, v] of [['_part', 0], ['_edge', 9], ['_band', 9], ['_hide', 0]]) {
      if (!g.attributes[k]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
    }
    {
      // skin triangles first (group 0), garment triangles last (group 1)
      const idx = g.index.array, part = g.attributes._part.array, T = idx.length / 3;
      const skinT = [], clothT = [];
      for (let t = 0; t < T; t++) {
        const cloth = part[idx[t * 3]] > 3.5 && part[idx[t * 3]] < 4.5 && part[idx[t * 3 + 1]] > 3.5 && part[idx[t * 3 + 2]] > 3.5;
        (cloth ? clothT : skinT).push(t);
      }
      const out = new idx.constructor(idx.length);
      [...skinT, ...clothT].forEach((t, k) => { out[k * 3] = idx[t * 3]; out[k * 3 + 1] = idx[t * 3 + 1]; out[k * 3 + 2] = idx[t * 3 + 2]; });
      g.setIndex(new THREE.BufferAttribute(out, 1));
      g.clearGroups();
      g.addGroup(0, skinT.length * 3, 0);
      if (clothT.length) g.addGroup(skinT.length * 3, clothT.length * 3, 1);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    // morphs blended on the CPU (some Android GPUs break three's morph-texture loop: the body came apart)
    useCpuMorphs(mesh);
    mesh.frustumCulled = false;
    this.suit = makeSuit(mesh);
    const extras = mesh.userData || {};
    this.bones = mesh.skeleton.bones;
    this.boneIndex = Object.fromEntries(this.bones.map((b, i) => [b.name, i]));
    this.parents = this.bones.map((b) => this.bones.indexOf(b.parent));
    this.widthDx = extras.widthBoneDx || this.bones.map(() => 0);
    this.probes = extras.shoulderProbes || null;
    this.weightListeners = new Set();   // called when skin weights change at runtime (worn garments copy them)
    this.layers = new Set();            // garments layered on the bodysuit (garments/layer.js): re-bound with the body

    // bind pose, in mesh space (the glb root carries no transform)
    this.root.updateMatrixWorld(true);
    this.bindPos = this.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    this.bindQuat = this.bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
    this.baseHeight = box.max.y - box.min.y;
    this.width = null;

    // pose zero: world orientation of every bone (limbs from rig.js, the rest as bound)
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    this.zeroQuat = this.bones.map((b, i) => {
      const d = ZERO_DIRS[b.name];
      if (!d) return this.bindQuat[i].clone();
      Y.fromArray(d).normalize();
      if (HAND_CHAIN.test(b.name)) X.crossVectors(Y, _v1.fromArray(ZERO_PALM[b.name.endsWith('_l') ? 'l' : 'r']).negate());
      else if (/^(foot|ball)_/.test(b.name)) X.crossVectors(Y, _v1.set(0, 1, 0)); // same rule as tools/body/prepare.py
      else {
        X.crossVectors(Y, FWD);
        if (X.lengthSq() < 0.04) X.crossVectors(Y, DOWN);
      }
      X.normalize();
      Z.crossVectors(X, Y).normalize();
      X.crossVectors(Y, Z);
      return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z));
    });
    this.zeroLocal = this.bones.map((b, i) => {
      const p = this.parents[i];
      return p < 0 ? this.zeroQuat[i].clone() : this.zeroQuat[p].clone().invert().multiply(this.zeroQuat[i]);
    });
    if (ARMPIT[sex]) this.#armpitWeights(ARMPIT[sex]);
    this.#dominantBones();
    this.rebind(0);
    this.#measureArms();
  }

  #armpitWeights({ reach, max }) {
    const g = this.mesh.geometry, P = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const part = g.attributes._part, bi = this.boneIndex;
    const torso = new Set(['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'].map((n) => bi[n]).filter((x) => x != null));
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const v = new THREE.Vector3();
    this.armpit = { l: [], r: [] };
    this.armpitK = { l: null, r: null };
    for (const s of ['l', 'r']) {
      const sg = s === 'l' ? 1 : -1, arm = bi[`upperarm_${s}`], A = this.bindPos[arm];
      for (let i = 0; i < P.count; i++) {
        if (part && part.getX(i) !== 0) continue;
        v.fromBufferAttribute(P, i);
        if (sg * v.x <= 0 || v.y > A.y - 0.01) continue;
        let wt = 0;
        for (let k = 0; k < 4; k++) if (torso.has(si.getComponent(i, k))) wt += sw.getComponent(i, k);
        if (wt < 0.05) continue;
        // lateral: from 12 cm inside the joint (the ribcage) out to the joint; fades with distance
        const lat = smooth(sg * A.x - 0.12, sg * A.x - 0.03, sg * v.x);
        const w = max * lat * (1 - smooth(0.05, reach, v.distanceTo(A))) * wt;
        if (w < 0.01) continue;
        // the bound weights (w0) and the armpit weights (w1: `w` moved from the torso bones to the
        // upper arm); applyArmpit() blends between them by how far the arm is lowered
        const bones = [], w0 = [], w1 = [];
        const put = (b, a, c) => { let j = bones.indexOf(b); if (j < 0) { j = bones.push(b) - 1; w0.push(0); w1.push(0); } w0[j] += a; w1[j] += c; };
        for (let k = 0; k < 4; k++) {
          const b = si.getComponent(i, k), x = sw.getComponent(i, k);
          if (x) put(b, x, torso.has(b) ? x * (1 - w / wt) : x);
        }
        put(arm, 0, w);
        this.armpit[s].push({ i, bones, w0, w1 });
      }
    }
    this.applyArmpit({ l: 1, r: 1 });
  }

  /**
   * Blend the armpit weights per side: k = 1 with the arm hanging (the lats tuck in with it),
   * 0 once it is raised toward the bind pose and above (the armpit keeps its hollow and the
   * side of the torso isn't dragged up with an overhead arm).
   */
  applyArmpit(k) {
    if (!this.armpit) return;
    const g = this.mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    let changed = false;
    for (const s of ['l', 'r']) {
      const f = Math.round(k[s] * 50) / 50;          // quantised: only rewrite when it really moves
      if (f === this.armpitK[s]) continue;
      this.armpitK[s] = f;
      changed = true;
      for (const { i, bones, w0, w1 } of this.armpit[s]) {
        const w = bones.map((b, j) => [b, w0[j] + (w1[j] - w0[j]) * f]).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = w.reduce((a, [, x]) => a + x, 0) || 1;
        for (let c = 0; c < 4; c++) { si.setComponent(i, c, w[c]?.[0] ?? 0); sw.setComponent(i, c, w[c] ? w[c][1] / sum : 0); }
      }
    }
    if (changed) {
      si.needsUpdate = sw.needsUpdate = true;
      for (const f of this.weightListeners) f();
    }
  }

  /** hide skin (and underwear) vertices: whatever a worn garment fully covers (a Set of vertex indices) */
  setHidden(set, deep = null) {
    const g = this.mesh.geometry, a = g.attributes._hide;
    a.array.fill(0);
    // deep: skin a garment covers but can't sit on (an arm pressed against a sleeve): sunk ~4 cm, not ~1 cm
    for (const i of set) a.array[i] = deep?.has(i) ? 3.5 : 1;
    // the skin just past a garment's edge sinks a little too: the triangles that cross the edge then slope
    // under the fabric instead of poking through it (a ragged saw-tooth at a waistband / hem)
    if (set.size && g.index) {
      const idx = g.index.array, ring = new Set();
      for (let t = 0; t < idx.length; t += 3) {
        const p = idx[t], q = idx[t + 1], r = idx[t + 2], hp = a.array[p] >= 1, hq = a.array[q] >= 1, hr = a.array[r] >= 1;
        if ((hp || hq || hr) && !(hp && hq && hr)) { if (!hp) ring.add(p); if (!hq) ring.add(q); if (!hr) ring.add(r); }
      }
      for (const i of ring) a.array[i] = 0.45;
    }
    a.needsUpdate = true;
  }

  /** Put the skeleton on the (width-morphed) body in its bind pose and bind it there. */
  rebind(width) {
    if (width === this.width) return;
    this.width = width;
    const mesh = this.mesh;
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = width;
    const world = this.bindPos.map((p, i) => p.clone().add(_v1.set(this.widthDx[i] * width, 0, 0)));
    this.bones.forEach((b, i) => {
      const p = this.parents[i];
      if (p < 0) {
        b.position.copy(world[i]);
        b.quaternion.copy(this.bindQuat[i]);
      } else {
        const inv = _q.copy(this.bindQuat[p]).invert();
        b.position.copy(world[i]).sub(world[p]).applyQuaternion(inv);
        b.quaternion.copy(inv).multiply(this.bindQuat[i]);
      }
      b.scale.set(1, 1, 1);
    });
    this.root.updateMatrixWorld(true);
    mesh.skeleton.calculateInverses();
    mesh.bind(mesh.skeleton, mesh.matrixWorld);
    this.suit.bind(mesh.skeleton, mesh.bindMatrix);
    for (const m of this.layers || []) m.bind(mesh.skeleton, mesh.bindMatrix);
    // pose zero keeps each bone's offset from its parent, expressed in the parent's frame
    this.localPos = this.bones.map((b) => b.position.clone());
    if (!this.soleVerts) this.#pickSoles(); // rest-pose soles: the same for every width
    if (this.shape) this.shape.apply({ ...this.morphs, width });
    this.#refreshTorso();
  }

  /** Shoulder point to point (m) of the unscaled body at a width setting (the morph is linear). */
  shoulderWidth(width = this.width) {
    if (!this.probes) return 0.4;
    const pos = this.mesh.geometry.attributes.position;
    const morph = this.mesh.geometry.morphAttributes.position?.[0];
    const x = (i) => pos.getX(i) + (morph ? morph.getX(i) * width : 0);
    return Math.abs(x(this.probes.l) - x(this.probes.r));
  }

  #dominantBones() {
    const g = this.mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    this.dom = new Uint16Array(si.count);
    for (let i = 0; i < si.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) { bw = w; best = si.getComponent(i, k); }
      }
      this.dom[i] = best;
    }
  }

  /** For hanging arms: segment lengths, limb radii and the torso/hip points the arms must clear. */
  #measureArms() {
    const pos = this.mesh.geometry.attributes.position, bi = this.boneIndex, n = pos.count;
    const head = (name) => this.bindPos[bi[name]];
    const radius = (bone, a, b) => {
      const ab = new THREE.Vector3().subVectors(b, a), len2 = ab.lengthSq(), d = [];
      for (let v = 0; v < n; v++) {
        if (this.dom[v] !== bi[bone]) continue;
        _v2.fromBufferAttribute(pos, v).sub(a);
        const t = Math.max(0, Math.min(1, _v2.dot(ab) / len2));
        d.push(_v3.copy(ab).multiplyScalar(t).sub(_v2).length());
      }
      d.sort((x, y) => x - y);
      return d.length ? d[Math.floor(d.length * 0.7)] : 0.04;
    };
    this.arm = {};
    for (const s of ['l', 'r']) {
      const sh = head(`upperarm_${s}`), el = head(`lowerarm_${s}`), wr = head(`hand_${s}`);
      this.arm[s] = {
        upper: sh.distanceTo(el), fore: el.distanceTo(wr),
        rUpper: radius(`upperarm_${s}`, sh, el), rFore: radius(`lowerarm_${s}`, el, wr),
      };
    }
    const torsoBones = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03'].map((k) => bi[k]).filter((x) => x != null));
    const thighs = new Set([bi.thigh_l, bi.thigh_r]);
    const hipY = head('thigh_l').y - 0.3;  // down to mid-thigh: the hands hang beside it
    const list = [];
    for (let v = 0; v < n; v++) {
      const b = this.dom[v];
      if (torsoBones.has(b) || (thighs.has(b) && pos.getY(v) > hipY)) list.push(v);
    }
    const step = Math.max(1, Math.floor(list.length / 6000)); // plenty to test clearance against
    const verts = list.filter((_, i) => i % step === 0), N = verts.length;
    // packed for the fast skinning in Human#skinTorso: rest position, width morph delta, 4 bones + weights
    const morph = this.mesh.geometry.morphAttributes.position?.[0];
    const si = this.mesh.geometry.attributes.skinIndex, sw = this.mesh.geometry.attributes.skinWeight;
    const t = this.torso = {
      n: N, verts: Uint32Array.from(verts), base: new Float32Array(N * 3), dPos: new Float32Array(N * 3), rest: new Float32Array(N * 3),
      bi: new Uint16Array(N * 4), bw: new Float32Array(N * 4), x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
    };
    verts.forEach((v, n) => {
      for (let k = 0; k < 3; k++) {
        t.base[n * 3 + k] = pos.getComponent(v, k);
        t.dPos[n * 3 + k] = morph ? morph.getComponent(v, k) : 0;
      }
      for (let k = 0; k < 4; k++) { t.bi[n * 4 + k] = si.getComponent(v, k); t.bw[n * 4 + k] = sw.getComponent(v, k); }
    });
    this.#refreshTorso();
  }

  /**
   * Build the body-shape morph targets (shape.js) the first time this body is shown; before that
   * the mesh carries only the width target.
   */
  ensureShape() {
    if (this.shape) return this.shape;
    this.shape = buildShape(this.mesh, this.bones, this.sex, this.bindPos);
    this.shape.install();
    // how much each target thickens each arm segment (mean push along the normal), for the hang solver
    const g = this.mesh.geometry, nrm = g.attributes.normal.array, bi = this.boneIndex;
    this.armGrow = {};
    for (const s of ['l', 'r']) {
      this.armGrow[s] = {};
      for (const [seg, bone] of [['upper', `upperarm_${s}`], ['fore', `lowerarm_${s}`]]) {
        const verts = [];
        for (let v = 0; v < this.dom.length; v++) if (this.dom[v] === bi[bone]) verts.push(v * 3);
        const out = {};
        for (const k of SHAPE_TARGETS) {
          const d = this.shape.deltas[k];
          let sum = 0;
          for (const o of verts) sum += d[o] * nrm[o] + d[o + 1] * nrm[o + 1] + d[o + 2] * nrm[o + 2];
          out[k] = verts.length ? sum / verts.length : 0;
        }
        this.armGrow[s][seg] = out;
      }
    }
    this.setMorphs(this.morphs);
    return this.shape;
  }

  /** @param morphs { belly, waist, bust, chest, glutes, hips, thighs, fat, muscle, core } influences */
  setMorphs(morphs = {}) {
    this.morphs = { ...morphs };
    this.shape?.apply({ ...this.morphs, width: this.width });
    this.#refreshTorso();
  }

  /** extra radius (m) of an arm segment from the current morphs */
  armGrowth(s, seg) {
    const g = this.armGrow?.[s]?.[seg];
    if (!g) return 0;
    let r = 0;
    for (const k of SHAPE_TARGETS) r += (this.morphs?.[k] || 0) * g[k];
    return r;
  }

  /** the torso sample the arms must clear, in the current shape (rest space) */
  #refreshTorso() {
    if (!this.torso) return;
    const sets = [this.torso];
    const p = this.shape ? this.shape.positions({ ...this.morphs, width: this.width }) : null;
    const w = this.width || 0;
    for (const t of sets) {
      if (p) for (let n = 0; n < t.n; n++) { const v = t.verts[n] * 3; t.rest[n * 3] = p[v]; t.rest[n * 3 + 1] = p[v + 1]; t.rest[n * 3 + 2] = p[v + 2]; }
      else for (let i = 0; i < t.rest.length; i++) t.rest[i] = t.base[i] + t.dPos[i] * w;
    }
  }

  #pickSoles() {
    const pos = this.mesh.geometry.attributes.position, out = [];
    let min = Infinity;
    for (let i = 0; i < pos.count; i++) min = Math.min(min, pos.getY(i));
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < min + 0.03) out.push(i);
    this.soleVerts = out;
  }
}

export class Human {
  /** Load both bodies (small) so switching sex is instant. */
  static async load() {
    const loader = new GLTFLoader();
    const [male, female] = await Promise.all(['male', 'female'].map((s) => loader.loadAsync(assetUrl(`${s}.glb`))));
    return new Human({ male: new Body('male', male), female: new Body('female', female) });
  }

  constructor(bodies) {
    this.bodies = bodies;
    this.object = new THREE.Group();
    this.object.name = 'human';
    for (const b of Object.values(bodies)) { b.root.visible = false; this.object.add(b.root); }
    this.scale = 1;
    this.listeners = new Set();   // called after every shape / pose change (worn garments follow)
    this.pose = {};
    this.morphs = {};
    this.posture = 0;
    this.setSex('female');
  }

  get active() { return this.bodies[this.sex]; }

  /** the bodysuit (testing): shown on both models (each is visible only when it's the active one) */
  setSuit(on) {
    this.suitOn = !!on;
    for (const b of Object.values(this.bodies)) {
      b.suit.visible = this.suitOn;
      // the body inside isn't drawn (a skin crease would poke through a 1.5 mm suit), nor is its underwear
      b.material.visible = b.clothMaterial.visible = !this.suitOn;
    }
  }
  get body() { return this.active.mesh; }
  get bones() { return this.active.bones; }
  get boneIndex() { return this.active.boneIndex; }
  get skeleton() { return this.active.mesh.skeleton; }
  get heightM() { return this.active.baseHeight * this.scale; }

  setSex(sex) {
    if (!this.bodies[sex] || sex === this.sex) return;
    this.sex = sex;
    for (const [k, b] of Object.entries(this.bodies)) b.root.visible = k === sex;
    this.active.ensureShape();
    this.active.setMorphs(this.morphs);
    this.#applyPose();
  }

  /**
   * @param shape { width?: morph −1…1.5 (≈ ±20 % shoulders per unit), scale?: uniform,
   *   morphs?: { belly, waist, bust, chest, glutes, hips, thighs, fat, muscle, core } (shape.js) }
   */
  setShape({ width, scale, morphs } = {}) {
    if (width != null) this.active.rebind(width);
    if (scale != null) { this.scale = scale; this.object.scale.setScalar(scale); }
    if (morphs) { this.morphs = { ...morphs }; this.active.setMorphs(this.morphs); }
    this.#applyPose();
  }

  /** Posture: −1 upright (chest up, shoulders back) … 0 neutral … +1 rounded (slouched, head forward). */
  setPosture(v) {
    this.posture = v || 0;
    this.#applyPose();
  }

  /** per-bone posture offsets (degrees, pose axes: +x flexes forward) */
  #postureRot(name) {
    const v = this.posture;
    if (!v) return null;
    switch (name) {
      case 'spine_01': return [v * 2, 0, 0];
      case 'spine_02': return [v * 5, 0, 0];
      case 'spine_03': return [v * 7, 0, 0];
      case 'neck_01': return [v * 9, 0, 0];
      case 'head': return [-v * 16, 0, 0];
      case 'clavicle_l': case 'clavicle_r': return [v * 9, 0, 0];
      default: return null;
    }
  }

  /** Real measurements of the active body: { height (m), width: shoulder point to point (m) }. */
  measure({ width = this.active.width, scale = this.scale } = {}) {
    return { height: this.active.baseHeight * scale, width: this.active.shoulderWidth(width) * scale };
  }

  /* ================================================================ pose */

  setPose(pose) {
    this.pose = pose || {};
    this.#applyPose();
  }

  #applyPose() {
    const B = this.active, pose = this.pose;
    B.bones.forEach((bone, i) => {
      bone.position.copy(B.localPos[i]);
      bone.quaternion.copy(B.zeroLocal[i]);
      const r = pose[bone.name];
      if (Array.isArray(r)) bone.quaternion.multiply(eulerQ(r));
      const p = this.#postureRot(bone.name);
      if (p) bone.quaternion.multiply(eulerQ(p));
    });
    const root = B.bones[0];
    if (pose.$root) root.position.add(_v1.fromArray(pose.$root));
    this.object.updateMatrixWorld(true);
    const hang = ['l', 'r'].filter((s) => isHang(pose[`upperarm_${s}`]) || isHang(pose[`lowerarm_${s}`]));
    if (hang.length) {
      this.#skinTorso();
      for (const s of hang) this.#hangArm(s);
    }
    if (B.armpit) {
      // armpit weights by arm elevation (angle of shoulder → elbow from straight down): full up to
      // 25°, gone by 70° (the bind pose is ~58°, where any weights give the same shape — seamless)
      const k = {};
      for (const s of ['l', 'r']) {
        const a = B.bones[B.boneIndex[`upperarm_${s}`]].getWorldPosition(_v1), e = B.bones[B.boneIndex[`lowerarm_${s}`]].getWorldPosition(_v2);
        const d = e.sub(a).normalize().transformDirection(_m.copy(this.object.matrixWorld).invert());
        const elev = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, -d.y))));
        const t = Math.min(1, Math.max(0, (elev - 25) / 45));
        k[s] = 1 - t * t * (3 - 2 * t);
      }
      B.applyArmpit(k);
    }
    if (pose.$ground !== false) {
      root.position.y -= this.lowestPoint();
      this.object.updateMatrixWorld(true);
    }
    for (const f of this.listeners) f(this);
  }

  /** skinned position of vertex i, in the human's (unscaled) local space */
  #skinned(i, out) {
    const m = this.body;
    out.fromBufferAttribute(m.geometry.attributes.position, i);
    m.applyBoneTransform(i, out);
    return out.applyMatrix4(m.matrixWorld).applyMatrix4(_m.copy(this.object.matrixWorld).invert());
  }

  /**
   * Skin the torso sample (in the current body shape) into the human's local space, sorted by height so
   * #clear only visits the thin slice it tests. Typed-array skinning: this runs on every slider tick.
   */
  #skinTorso() {
    const T = this.active.torso, N = T.n;
    const { X, Y, Z } = this.#skinPacked(T);
    // counting sort into 1 cm slices (a comparator sort is the slow part otherwise)
    let y0 = Infinity, y1 = -Infinity;
    for (let n = 0; n < N; n++) { y0 = Math.min(y0, Y[n]); y1 = Math.max(y1, Y[n]); }
    const S = Math.floor((y1 - y0) / 0.01) + 1, start = new Uint32Array(S + 1), slot = (y) => Math.floor((y - y0) / 0.01);
    for (let n = 0; n < N; n++) start[slot(Y[n]) + 1]++;
    for (let k = 0; k < S; k++) start[k + 1] += start[k];
    const fill = start.slice(0, S);
    for (let n = 0; n < N; n++) { const o = fill[slot(Y[n])]++; T.x[o] = X[n]; T.y[o] = Y[n]; T.z[o] = Z[n]; }
    Object.assign(T, { y0, S, start });
  }

  /** skin a packed vertex set (rest positions + 4 weights) into the human's local space */
  #skinPacked(T) {
    const B = this.active, m = B.mesh, N = T.n;
    m.skeleton.update();
    const bm = m.skeleton.boneMatrices, R = T.rest;
    const P = m.bindMatrix.elements;
    const M = _m.copy(this.object.matrixWorld).invert().multiply(m.matrixWorld).multiply(m.bindMatrixInverse).elements;
    const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const bx = R[n * 3], by = R[n * 3 + 1], bz = R[n * 3 + 2];
      const vx = P[0] * bx + P[4] * by + P[8] * bz + P[12], vy = P[1] * bx + P[5] * by + P[9] * bz + P[13], vz = P[2] * bx + P[6] * by + P[10] * bz + P[14];
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        const wt = T.bw[n * 4 + k];
        if (!wt) continue;
        const o = T.bi[n * 4 + k] * 16;
        sx += wt * (bm[o] * vx + bm[o + 4] * vy + bm[o + 8] * vz + bm[o + 12]);
        sy += wt * (bm[o + 1] * vx + bm[o + 5] * vy + bm[o + 9] * vz + bm[o + 13]);
        sz += wt * (bm[o + 2] * vx + bm[o + 6] * vy + bm[o + 10] * vz + bm[o + 14]);
      }
      X[n] = M[0] * sx + M[4] * sy + M[8] * sz + M[12];
      Y[n] = M[1] * sx + M[5] * sy + M[9] * sz + M[13];
      Z[n] = M[2] * sx + M[6] * sy + M[10] * sz + M[14];
    }
    return { X, Y, Z };
  }


  /** Is the segment from `a` along unit `d` (length L, radius r) clear of the torso on side `sg` by `gap`? */
  #clear(a, d, L, r0, r1, sg, gap, ts, hook = 0) {
    const { x: TX, y: TY, z: TZ, y0, S, start } = this.active.torso;
    for (const t of ts) {
      // past t = 1 the points are the hand, whose relaxed fingers curl in toward the body by `hook`
      const px = a.x + d.x * L * t - sg * hook * L * Math.max(0, t - 1), py = a.y + d.y * L * t, pz = a.z + d.z * L * t;
      const r = r0 + (r1 - r0) * t;
      const limit = sg * px - r - gap;
      const k0 = Math.floor((py - 0.02 - y0) / 0.01), k1 = Math.floor((py + 0.02 - y0) / 0.01);
      if (k1 < 0 || k0 >= S) continue;
      for (let i = start[Math.max(0, k0)], e = start[Math.min(S, k1 + 1)]; i < e; i++) {
        if (Math.abs(TY[i] - py) > 0.02) continue;
        if (Math.abs(TZ[i] - pz) > r) continue;
        if (sg * TX[i] > limit) return false;
      }
    }
    return true;
  }

  /**
   * Let an arm hang naturally: the upper arm points down, tilted out only as far as it takes to
   * clear the chest/lats; the forearm hangs with a soft bend, tilted out only as far as it takes to
   * clear the hips. Works for any body and width.
   */
  #hangArm(s) {
    const B = this.active;
    const sg = s === 'l' ? 1 : -1;
    const A = B.arm[s];
    const U = this.pose[`upperarm_${s}`], F = this.pose[`lowerarm_${s}`];
    const ua = B.bones[B.boneIndex[`upperarm_${s}`]], la = B.bones[B.boneIndex[`lowerarm_${s}`]];
    const toLocal = new THREE.Matrix4().copy(this.object.matrixWorld).invert();
    const rad = THREE.MathUtils.degToRad;
    const dir = (out, fwd) => new THREE.Vector3(sg * Math.sin(rad(out)), -Math.cos(rad(out)) * Math.cos(rad(fwd)), Math.cos(rad(out)) * Math.sin(rad(fwd)));
    const fit = armFit(B.sex);
    const elbow = () => { la.updateWorldMatrix(true, false); return la.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal); };
    const shoulder = ua.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
    // forearm: continues the upper arm's line (+1°, a hint of carrying angle), never angles back in
    // past it (that reads as an elbow bent outward), and tilts out only as far as the hips and
    // thighs require (the hand included, following its fingers' curl, so it rests beside the thigh)
    const forearm = () => {
      const a = elbow();
      const upOut = THREE.MathUtils.radToDeg(Math.atan2(sg * (a.x - shoulder.x), shoulder.y - a.y));
      let out = Math.max(fit.minFore ?? 0, upOut + fit.follow);
      while (out < 50 && !this.#clear(a, dir(out, F.fwd || 0), A.fore, (A.rFore + B.armGrowth(s, 'fore')) * 0.9, (A.rFore + B.armGrowth(s, 'fore')) * 0.7, sg, 0.012, [0.4, 0.7, 1, 1.25, 1.45], 0.3)) out += 0.5;
      return { out, upOut };
    };
    let upper = 0;
    if (isHang(U)) {
      // (the arm may rest a little into the lats: soft tissue gives, so the radius is taken small)
      while (upper < 50 && !this.#clear(shoulder, dir(upper, U.fwd || 0), A.upper, (A.rUpper + B.armGrowth(s, 'upper')) * fit.lat, (A.rUpper + B.armGrowth(s, 'upper')) * fit.lat * 0.875, sg, fit.upperGap ?? 0.002, [0.6, 0.8, 1])) upper += 0.5;
      upper = Math.max(fit.minOut, Math.min(upper, fit.maxOut)) + (U.out || 0);
      this.#aim(ua, dir(upper, U.fwd || 0), sg * (U.twist || 0), U.extra);
    }
    if (isHang(F)) {
      let f = forearm();
      // the whole arm hangs straight: if the hips push the forearm out more than 8° past the upper
      // arm, the upper arm tilts out instead of the elbow tucking into the waist
      for (let it = 0; isHang(U) && it < 30 && f.out - f.upOut > 8 + Math.max(0, fit.follow); it++) {
        upper += 1;
        this.#aim(ua, dir(upper, U.fwd || 0), sg * (U.twist || 0), U.extra);
        f = forearm();
      }
      this.#aim(la, dir(f.out + (F.out || 0), F.fwd || 0), sg * (F.twist || 0), F.extra);
    }
  }

  /** Point a bone's +y along `dirLocal` (human space), then twist about it and add euler `extra`. */
  #aim(bone, dirLocal, twistDeg, extra) {
    const B = this.active, i = B.bones.indexOf(bone);
    bone.parent.updateWorldMatrix(true, false);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const restWorld = parentQ.clone().multiply(B.zeroLocal[i]);
    const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(restWorld);
    const want = dirLocal.clone().transformDirection(this.object.matrixWorld);
    const world = new THREE.Quaternion().setFromUnitVectors(cur, want).multiply(restWorld);
    bone.quaternion.copy(parentQ.invert().multiply(world))
      .multiply(new THREE.Quaternion().setFromAxisAngle(_v1.set(0, 1, 0), THREE.MathUtils.degToRad(twistDeg)));
    if (extra) bone.quaternion.multiply(eulerQ(extra));
    bone.updateMatrixWorld(true);
  }

  /** Lowest skinned sole vertex, in the human's local space. */
  lowestPoint() {
    this.body.skeleton.update();
    let min = Infinity;
    for (const v of this.active.soleVerts) min = Math.min(min, this.#skinned(v, _v2).y);
    return Number.isFinite(min) ? min : 0;
  }

  /** World position of a joint in the current pose (e.g. for camera framing). */
  bonePosition(name, target = new THREE.Vector3()) {
    const b = this.bones[this.boneIndex[name]];
    return b ? b.getWorldPosition(target) : target.set(0, this.heightM * 0.5, 0);
  }

  /** @param opts { tone?: css colour, clay?: bool (uniform grey sculpt look) } */
  setSkin(opts = {}) { for (const b of Object.values(this.bodies)) for (const m of [b.material, b.clothMaterial]) m.userData.setSkin(opts); }

  dispose() {
    for (const b of Object.values(this.bodies)) { b.mesh.geometry.dispose(); b.mesh.skeleton.dispose(); b.material.dispose(); }
  }
}
