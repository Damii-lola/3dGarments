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
import { assetUrl } from './assets.js';
import { buildShape, SHAPE_TARGETS } from './shape.js';

const HAND_CHAIN = /^(hand|thumb|index|middle|ring|pinky)_/;
const FWD = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

const eulerQ = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(
  THREE.MathUtils.degToRad(r[0] || 0), THREE.MathUtils.degToRad(r[1] || 0), THREE.MathUtils.degToRad(r[2] || 0), 'XZY'));
/** Pose value `{ hang: true, out?, fwd?, twist?, extra? }` = solve the limb so it hangs clear of the body. */
const isHang = (v) => !!(v && !Array.isArray(v) && v.hang);

/** One loaded body model: mesh, skeleton, pose-zero frames and measuring data. */
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
    for (const [k, v] of [['_part', 0], ['_edge', 9], ['_band', 9]]) {
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
    mesh.frustumCulled = false;
    const extras = mesh.userData || {};
    this.bones = mesh.skeleton.bones;
    this.boneIndex = Object.fromEntries(this.bones.map((b, i) => [b.name, i]));
    this.parents = this.bones.map((b) => this.bones.indexOf(b.parent));
    this.widthDx = extras.widthBoneDx || this.bones.map(() => 0);
    this.probes = extras.shoulderProbes || null;

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
    this.#dominantBones();
    this.rebind(0);
    this.#measureArms();
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
    // each arm's own skin (upper arm + forearm), for the straight-arm check of the hang solver
    const pack = (vs) => {
      const P = { n: vs.length, verts: Uint32Array.from(vs), base: new Float32Array(vs.length * 3), dPos: new Float32Array(vs.length * 3), rest: new Float32Array(vs.length * 3), bi: new Uint16Array(vs.length * 4), bw: new Float32Array(vs.length * 4) };
      vs.forEach((v, n) => {
        for (let k = 0; k < 3; k++) { P.base[n * 3 + k] = pos.getComponent(v, k); P.dPos[n * 3 + k] = morph ? morph.getComponent(v, k) : 0; }
        for (let k = 0; k < 4; k++) { P.bi[n * 4 + k] = si.getComponent(v, k); P.bw[n * 4 + k] = sw.getComponent(v, k); }
      });
      return P;
    };
    const part = this.mesh.geometry.attributes._part;
    this.armSet = {};
    for (const s of ['l', 'r']) {
      const own = new Set([bi[`upperarm_${s}`], bi[`lowerarm_${s}`]]), vs = [];
      for (let v = 0; v < n; v++) if (own.has(this.dom[v]) && (!part || part.getX(v) === 0)) vs.push(v);
      const st = Math.max(1, Math.floor(vs.length / 900));
      this.armSet[s] = pack(vs.filter((_, i) => i % st === 0));
    }
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
    const sets = [this.torso, ...Object.values(this.armSet || {})];
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
    this.pose = {};
    this.morphs = {};
    this.posture = 0;
    this.setSex('female');
  }

  get active() { return this.bodies[this.sex]; }
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
    if (pose.$ground !== false) {
      root.position.y -= this.lowestPoint();
      this.object.updateMatrixWorld(true);
    }
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

  /**
   * How far the arm's OUTER contour (seen from the front) bulges past the straight line from the
   * shoulder's outer edge to the wrist's outer edge, in metres. A muscular forearm hanging straight
   * down pushes the elbow outside that line — the arm then reads as bent outward.
   */
  #armBow(s, sh, wr) {
    const B = this.active, sg = s === 'l' ? 1 : -1, { X, Y } = this.#skinPacked(B.armSet[s]);
    const yT = sh.y - 0.06, yB = wr.y + 0.01, n = Math.max(2, Math.round((yT - yB) / 0.01));
    const outer = new Float32Array(n + 1).fill(-1);
    for (let i = 0; i < X.length; i++) {
      const k = Math.round((yT - Y[i]) / (yT - yB) * n);
      if (k >= 0 && k <= n) outer[k] = Math.max(outer[k], sg * X[i]);
    }
    let top = 0, bot = n;
    while (top < n && outer[top] < 0) top++;
    while (bot > 0 && outer[bot] < 0) bot--;
    let bow = 0;
    for (let k = top + 3; k <= bot - 3; k++) {
      if (outer[k] < 0) continue;
      const chord = outer[top] + (outer[bot] - outer[top]) * (k - top) / (bot - top);
      bow = Math.max(bow, outer[k] - chord);
    }
    return bow;
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
    if (isHang(U)) {
      const a = ua.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      let out = 0;
      // (the arm may rest a little into the lats: soft tissue gives, so the radius is taken small)
      while (out < 50 && !this.#clear(a, dir(out, U.fwd || 0), A.upper, (A.rUpper + B.armGrowth(s, 'upper')) * 0.48, (A.rUpper + B.armGrowth(s, 'upper')) * 0.42, sg, 0.002, [0.6, 0.8, 1])) out += 0.5;
      this.#aim(ua, dir(out + (U.out || 0), U.fwd || 0), sg * (U.twist || 0), U.extra);
    }
    if (isHang(F)) {
      la.updateWorldMatrix(true, false);
      const a = la.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      // the forearm never angles back in past the upper arm (that reads as an elbow bent outward):
      // it starts from the upper arm's own tilt, which gives the natural carrying angle
      const sh = ua.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      const upOut = THREE.MathUtils.radToDeg(Math.atan2(sg * (a.x - sh.x), sh.y - a.y));
      let out = Math.max(0, upOut - 3);
      while (out < 50 && !this.#clear(a, dir(out, F.fwd || 0), A.fore, (A.rFore + B.armGrowth(s, 'fore')) * 0.9, (A.rFore + B.armGrowth(s, 'fore')) * 0.7, sg, 0.012, [0.4, 0.7, 1, 1.25, 1.45], 0.3)) out += 0.5;   // (past 1: the hand, so it rests beside the thigh, not in it)
      this.#aim(la, dir(out + (F.out || 0), F.fwd || 0), sg * (F.twist || 0), F.extra);
      // straight arm: tilt the forearm out until the arm's outer contour runs straight from the
      // shoulder to the wrist (a thick forearm hanging plumb makes the elbow bulge out)
      const hd = B.bones[B.boneIndex[`hand_${s}`]];
      const wrist = () => hd.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      // (capped: a heavy forearm can't make a perfect line, and past ~15° off the upper arm it looks posed)
      const cap = Math.min(upOut + 15, 21);
      for (let it = 0; it < 30 && out + 1 <= cap && this.#armBow(s, sh, wrist()) > 0.003; it++) {
        out += 1;
        this.#aim(la, dir(out + (F.out || 0), F.fwd || 0), sg * (F.twist || 0), F.extra);
      }
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
