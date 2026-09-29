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
  constructor(sex, gltf, material) {
    this.sex = sex;
    this.root = gltf.scene;
    this.root.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
    const mesh = this.mesh;
    mesh.material = [material]; // array: the lab swaps in debug materials by index
    if (!mesh.geometry.groups.length) mesh.geometry.addGroup(0, Infinity, 0);
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
    this.#pickSoles();
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
    const hipY = head('thigh_l').y - 0.12;
    const list = [];
    for (let v = 0; v < n; v++) {
      const b = this.dom[v];
      if (torsoBones.has(b) || (thighs.has(b) && pos.getY(v) > hipY)) list.push(v);
    }
    const step = Math.max(1, Math.floor(list.length / 6000)); // plenty to test clearance against
    this.torsoVerts = Uint32Array.from(list.filter((_, i) => i % step === 0));
    this.torsoPos = new Float32Array(this.torsoVerts.length * 3);
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
    const material = createBodyMaterial();
    const [male, female] = await Promise.all(['male', 'female'].map((s) => loader.loadAsync(assetUrl(`${s}.glb`))));
    return new Human({ male: new Body('male', male, material), female: new Body('female', female, material) }, material);
  }

  constructor(bodies, material) {
    this.bodies = bodies;
    this.skin = material;
    this.object = new THREE.Group();
    this.object.name = 'human';
    for (const b of Object.values(bodies)) { b.root.visible = false; this.object.add(b.root); }
    this.scale = 1;
    this.pose = {};
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
    this.#applyPose();
  }

  /** @param shape { width?: morph −1…1.5 (≈ ±20 % shoulders per unit), scale?: uniform } */
  setShape({ width, scale } = {}) {
    if (width != null) this.active.rebind(width);
    if (scale != null) { this.scale = scale; this.object.scale.setScalar(scale); }
    this.#applyPose();
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

  #skinTorso() {
    const B = this.active;
    this.body.skeleton.update();
    B.torsoVerts.forEach((v, n) => this.#skinned(v, _v3).toArray(B.torsoPos, n * 3));
  }

  /** Is the segment from `a` along unit `d` (length L, radius r) clear of the torso on side `sg` by `gap`? */
  #clear(a, d, L, r0, r1, sg, gap, ts) {
    const T = this.active.torsoPos;
    for (const t of ts) {
      const px = a.x + d.x * L * t, py = a.y + d.y * L * t, pz = a.z + d.z * L * t;
      const r = r0 + (r1 - r0) * t;
      const limit = sg * px - r - gap;
      for (let i = 0; i < T.length; i += 3) {
        if (Math.abs(T[i + 1] - py) > 0.02 || Math.abs(T[i + 2] - pz) > r) continue;
        if (sg * T[i] > limit) return false;
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
      while (out < 50 && !this.#clear(a, dir(out, U.fwd || 0), A.upper, A.rUpper * 0.85, A.rUpper * 0.7, sg, 0.002, [0.6, 0.8, 1])) out += 0.5;
      this.#aim(ua, dir(out + (U.out || 0), U.fwd || 0), sg * (U.twist || 0), U.extra);
    }
    if (isHang(F)) {
      la.updateWorldMatrix(true, false);
      const a = la.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      let out = 0;
      while (out < 50 && !this.#clear(a, dir(out, F.fwd || 0), A.fore, A.rFore * 0.9, A.rFore * 0.7, sg, 0.01, [0.4, 0.7, 1])) out += 0.5;
      this.#aim(la, dir(out + (F.out || 0), F.fwd || 0), sg * (F.twist || 0), F.extra);
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
  setSkin(opts = {}) { this.skin.userData.setSkin(opts); }

  dispose() {
    for (const b of Object.values(this.bodies)) { b.mesh.geometry.dispose(); b.mesh.skeleton.dispose(); }
    this.skin.dispose();
  }
}
