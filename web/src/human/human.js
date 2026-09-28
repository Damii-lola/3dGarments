/**
 * A fully rigged, shape-able human built from MakeHuman data.
 *
 *   const human = new Human(await loadHumanAssets());
 *   scene.add(human.object);
 *   human.setShape({ gender: 1, muscle: 0.7 });   // re-morphs AND re-fits the skeleton
 *   human.setPose({ upperarm_l: [0, 0, -50] });   // per-bone local euler degrees
 *
 * World space: metres, y up, the body faces +z, feet on y = 0.
 *
 * Bone frames (rest): y runs head → tail. For limbs/spine, x = y × (+z) so a
 * positive x rotation always swings the bone tip FORWARD. Hand and finger
 * bones use the palm instead: positive x curls toward the palm. Poses are
 * authored for the left side; the right side is the mirror (x, −y, −z).
 */
import * as THREE from 'three';
import { DEFAULT_SHAPE, targetWeights } from './modifiers.js';
import { createSkinMaterial, createEyeMaterial, createSimpleMaterials, createFabricMaterial } from './materials.js';
import { Hair } from './hair.js';

const DM = 0.1; // MakeHuman decimetres → metres
const HAND_CHAIN = /^(hand|thumb|index|middle|ring|pinky)_/;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Human {
  constructor(assets, { shape = DEFAULT_SHAPE, pose = {}, skin = {}, hair = {} } = {}) {
    const { manifest, sections: S } = assets;
    this.assets = assets;
    this.N = manifest.vertexCount;
    this.base = S.base;
    this.P = new Float32Array(this.N * 3); // morphed, MakeHuman space
    this.W = new Float32Array(this.N * 3); // rest, metres
    this.normalsOrig = new Float32Array(this.N * 3);
    this.shape = { ...DEFAULT_SHAPE };
    this.pose = {};
    this.object = new THREE.Group();
    this.object.name = 'human';

    /* ---------- bones ---------- */
    this.boneDefs = manifest.bones;
    this.bones = manifest.bones.map((b) => Object.assign(new THREE.Bone(), { name: b.name }));
    this.boneIndex = Object.fromEntries(manifest.bones.map((b, i) => [b.name, i]));
    manifest.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : this.object).add(this.bones[i]));
    this.skeleton = new THREE.Skeleton(this.bones);
    this.rest = this.bones.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), world: new THREE.Matrix4() }));
    this.jointNames = manifest.joints.map((j) => j.name);
    this.jointVerts = manifest.joints.map((j) => Uint16Array.from(j.verts));
    this.joints = manifest.joints.map(() => new THREE.Vector3());
    this.jointByName = Object.fromEntries(manifest.joints.map((j, i) => [j.name, i]));

    /* ---------- body (+ lashes, teeth, tongue) ---------- */
    const src = S['render.src'];
    this.src = src;
    const R = src.length;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(R * 3), 3);
    this.nrm = new THREE.BufferAttribute(new Float32Array(R * 3), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', this.nrm);
    geo.setAttribute('uv', new THREE.BufferAttribute(S['render.uv'], 2));
    const { index: si, weight: sw } = { index: S['skin.index'], weight: S['skin.weight'] };
    const skinIndex = new Uint16Array(R * 4), skinWeight = new Float32Array(R * 4);
    for (let r = 0; r < R; r++) for (let k = 0; k < 4; k++) {
      skinIndex[r * 4 + k] = si[src[r] * 4 + k];
      skinWeight[r * 4 + k] = sw[src[r] * 4 + k] / 65535;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    const parts = ['body', 'lashes', 'teeth', 'tongue'];
    const idx = [], ranges = {};
    for (const p of parts) { ranges[p] = [idx.length, S[`index.${p}`].length]; for (const i of S[`index.${p}`]) idx.push(i); }
    geo.setIndex(idx);
    parts.forEach((p, m) => geo.addGroup(ranges[p][0], ranges[p][1], m));
    this.bodyTrisOrig = Uint32Array.from(idx, (r) => src[r]); // normals on the unsplit mesh: no seams
    this.helperIndex = { tights: S['index.tights'], skirt: S['index.skirt'], hair: S['index.hair'] };

    this.skin = createSkinMaterial(skin);
    const simple = createSimpleMaterials();
    this.body = new THREE.SkinnedMesh(geo, [this.skin, simple.lashes, simple.teeth, simple.tongue]);
    this.body.name = 'human:body';
    this.body.castShadow = this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    this.object.add(this.body);

    /* ---------- underwear: the body's own surface, pushed out a hair, outline cut by a painted mask ---------- */
    const ugeo = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) ugeo.setAttribute(k, geo.attributes[k]);
    this.underwearIndex = { briefs: S['index.briefs'], boxers: S['index.boxers'], bra: S['index.bra'] };
    this.underwearMats = { briefs: createFabricMaterial({ channel: 0 }), boxers: createFabricMaterial({ channel: 1 }), bra: createFabricMaterial({ channel: 2 }) };
    this.underwear = new THREE.SkinnedMesh(ugeo, [this.underwearMats.bra, this.underwearMats.briefs]);
    this.underwear.name = 'human:underwear';
    this.underwear.castShadow = this.underwear.receiveShadow = true;
    this.underwear.frustumCulled = false;
    this.object.add(this.underwear);
    this.underwearStyle = 'auto';

    /* ---------- eyes (mhclo proxy fitted to the base mesh) ---------- */
    this.eye = { ref: S['eye.ref'], w: S['eye.w'], off: S['eye.off'], src: S['eye.src'], scale: manifest.eyeScale };
    const ER = S['eye.src'].length;
    const egeo = new THREE.BufferGeometry();
    this.eyePos = new THREE.BufferAttribute(new Float32Array(ER * 3), 3);
    egeo.setAttribute('position', this.eyePos);
    egeo.setAttribute('uv', new THREE.BufferAttribute(S['eye.uv'], 2));
    egeo.setIndex(new THREE.BufferAttribute(S['eye.index'], 1));
    const head = this.boneIndex.head;
    egeo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(ER * 4).map((_, i) => (i % 4 ? 0 : head)), 4));
    egeo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(ER * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
    this.eyes = new THREE.SkinnedMesh(egeo, createEyeMaterial());
    this.eyes.name = 'human:eyes';
    this.eyes.frustumCulled = false;
    this.eyes.castShadow = true;
    this.object.add(this.eyes);

    // sole vertices: used to keep the feet on the floor in any pose
    this.soleVerts = null;

    this.setShape(shape);
    this.setUnderwear({ style: 'auto' });
    this.hair = new Hair(this);
    this.setHair({ style: 'none', ...hair });
    this.setPose(pose);
  }

  /** @param opts { style?: keyof HAIR_STYLES, color?: css colour } */
  setHair({ style, color } = {}) {
    if (color) { this.hair.setColor(color); this.skin.userData.setSkin({ hairColor: color }); }
    if (style) {
      this.hair.setStyle(style);
      // hair roots darken the scalp under the shells, which makes the hairline read as real
      this.skin.userData.setSkin({ scalp: style === 'none' ? 0 : style === 'buzz' ? 0.75 : 0.6 });
    }
  }

  /**
   * @param opts { style?: 'auto' | 'none' | 'briefs' | 'boxers' | 'set' (bra + briefs), color?: css colour }
   * 'auto' dresses by gender: a set for female bodies, boxer briefs for male bodies.
   */
  setUnderwear({ style, color } = {}) {
    if (style) this.underwearStyle = style;
    if (color) for (const m of Object.values(this.underwearMats)) m.color.set(color);
    let st = this.underwearStyle;
    if (st === 'auto') st = this.shape.gender < 0.5 ? 'set' : 'boxers';
    const U = this.underwearIndex;
    const top = st === 'set' ? U.bra : new Uint32Array(0);
    const bottom = st === 'set' || st === 'briefs' ? U.briefs : st === 'boxers' ? U.boxers : new Uint32Array(0);
    const idx = new Uint32Array(top.length + bottom.length);
    idx.set(top, 0); idx.set(bottom, top.length);
    const g = this.underwear.geometry;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.clearGroups();
    g.addGroup(0, top.length, 0);
    g.addGroup(top.length, bottom.length, 1);
    this.underwear.material[1] = st === 'boxers' ? this.underwearMats.boxers : this.underwearMats.briefs;
    this.underwear.visible = idx.length > 0;
    this.underwearResolved = st;
  }

  /* ================================================================ shape */

  /**
   * Real measurements a shape WOULD have, without morphing the whole mesh: only a few
   * probe vertices are evaluated (binary search into each sparse target).
   *   height — crown to sole (m)
   *   width  — shoulder width, point to point (biacromial): straight across between the
   *            outer edges of the tops of the shoulders, the garment-sizing measurement (m)
   */
  measure(shape) {
    if (!this.probe) {
      const B = this.base, top = [], sole = [], left = [], right = [];
      const J = (n) => { const v = this.jointVerts[this.jointByName[n]]; let y = 0; for (const i of v) y += B[i * 3 + 1]; return y / v.length; };
      // shoulder points (acromion): the outer edge of the top of the shoulder, where a sleeve seam sits
      const yS = J('joint-l-shoulder') + 0.15;
      const band = [];
      for (let i = 0; i < 13380; i++) {
        const y = B[i * 3 + 1];
        if (y > 8.25) top.push(i);
        if (y < -7.95) sole.push(i);
        if (Math.abs(y - yS) < 0.1) band.push(i);
      }
      const x = (i) => B[i * 3];
      left.push(...band.filter((i) => x(i) > 0.8).sort((p, q) => x(q) - x(p)).slice(0, 4));
      right.push(...band.filter((i) => x(i) < -0.8).sort((p, q) => x(p) - x(q)).slice(0, 4));
      this.probe = { top, sole, left, right, all: [...new Set([...top, ...sole, ...left, ...right])] };
    }
    const s = { ...this.shape, ...shape };
    const { top, sole, left, right, all } = this.probe;
    const P = new Map(all.map((v) => [v, [this.base[v * 3], this.base[v * 3 + 1]]]));
    const step = this.assets.manifest.targetStep;
    for (const [name, w] of targetWeights(s, this.assets.targets.keys())) {
      const { index, delta } = this.assets.targets.get(name);
      for (const v of all) {
        let lo = 0, hi = index.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (index[mid] < v) lo = mid + 1;
          else if (index[mid] > v) hi = mid - 1;
          else { const p = P.get(v); p[0] += delta[mid * 3] * w * step; p[1] += delta[mid * 3 + 1] * w * step; break; }
        }
      }
    }
    const max = (vs, k) => Math.max(...vs.map((v) => P.get(v)[k]));
    const min = (vs, k) => Math.min(...vs.map((v) => P.get(v)[k]));
    return { height: (max(top, 1) - min(sole, 1)) * DM, width: (max(left, 0) - min(right, 0)) * DM };
  }

  estimateHeight(shape) { return this.measure(shape).height; }

  /**
   * Solve a 0…1 (or −1…1) parameter for a target measurement. Every target blends
   * linearly on each half of its range, so probing both ends and the middle inverts it exactly.
   * @param get   (x) => measurement (cm) for parameter value x
   */
  static solve(get, want, lo, hi, mid = (lo + hi) / 2) {
    const [a, b, c] = [lo, mid, hi].map(get);
    if (want <= b) return Math.max(lo, Math.min(mid, lo + (mid - lo) * (want - a) / ((b - a) || 1)));
    return Math.max(mid, Math.min(hi, mid + (hi - mid) * (want - b) / ((c - b) || 1)));
  }

  /** The `height` macro value that gives a standing height of `cm`, all else equal. */
  heightParamFor(cm, shape = this.shape) {
    return Human.solve((h) => this.measure({ ...shape, height: h }).height * 100, cm, 0, 1);
  }

  setShape(shape) {
    this.shape = { ...this.shape, ...shape };
    const { P, W, base, N } = this;
    P.set(base);
    for (const [name, w] of targetWeights(this.shape, this.assets.targets.keys())) {
      const { index, delta } = this.assets.targets.get(name);
      const k = w * this.assets.manifest.targetStep;
      for (let i = 0; i < index.length; i++) {
        const o = index[i] * 3, d = i * 3;
        P[o] += delta[d] * k; P[o + 1] += delta[d + 1] * k; P[o + 2] += delta[d + 2] * k;
      }
    }
    // metres, feet on the floor
    let minY = Infinity;
    for (let i = 0; i < 13380; i++) minY = Math.min(minY, P[i * 3 + 1]);
    for (let i = 0; i < N; i++) {
      W[i * 3] = P[i * 3] * DM; W[i * 3 + 1] = (P[i * 3 + 1] - minY) * DM; W[i * 3 + 2] = P[i * 3 + 2] * DM;
    }
    this.heightM = 0;
    for (let i = 0; i < 13380; i++) this.heightM = Math.max(this.heightM, W[i * 3 + 1]);

    this.#updateBodyGeometry();
    this.#updateEyes();
    this.#fitSkeleton();
    this.hair?.rebuild();
    if (this.underwearStyle === 'auto' && this.underwear) this.setUnderwear({});
    this.#applyPose();
  }

  #updateBodyGeometry() {
    this.#computeNormals();
    const { W, src, normalsOrig: NO } = this;
    const pos = this.pos.array, nrm = this.nrm.array;
    for (let r = 0; r < src.length; r++) {
      const o = src[r] * 3, d = r * 3;
      pos[d] = W[o]; pos[d + 1] = W[o + 1]; pos[d + 2] = W[o + 2];
      const l = Math.hypot(NO[o], NO[o + 1], NO[o + 2]) || 1;
      nrm[d] = NO[o] / l; nrm[d + 1] = NO[o + 1] / l; nrm[d + 2] = NO[o + 2] / l;
    }
    this.pos.needsUpdate = this.nrm.needsUpdate = true;
    this.body.geometry.computeBoundingSphere();
  }

  #computeNormals() {
    const { W, normalsOrig: NO, bodyTrisOrig: T } = this;
    NO.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      _v1.set(W[b] - W[a], W[b + 1] - W[a + 1], W[b + 2] - W[a + 2]);
      _v2.set(W[c] - W[a], W[c + 1] - W[a + 1], W[c + 2] - W[a + 2]);
      _v3.crossVectors(_v1, _v2); // area-weighted
      for (const o of [a, b, c]) { NO[o] += _v3.x; NO[o + 1] += _v3.y; NO[o + 2] += _v3.z; }
    }
  }

  #updateEyes() {
    const { ref, w, off, src, scale } = this.eye;
    const W = this.W;
    const sc = ['x', 'y', 'z'].map((a, i) => {
      const [v1, v2, f] = scale[a];
      return Math.abs(W[v1 * 3 + i] - W[v2 * 3 + i]) / (f * DM);
    });
    const out = this.eyePos.array;
    for (let r = 0; r < src.length; r++) {
      const v = src[r], d = r * 3;
      for (let c = 0; c < 3; c++) {
        out[d + c] = w[v * 3] * W[ref[v * 3] * 3 + c] + w[v * 3 + 1] * W[ref[v * 3 + 1] * 3 + c]
          + w[v * 3 + 2] * W[ref[v * 3 + 2] * 3 + c] + off[v * 3 + c] * sc[c] * DM;
      }
    }
    this.eyePos.needsUpdate = true;
    this.eyes.geometry.computeVertexNormals();
    this.eyes.geometry.computeBoundingSphere();
  }

  /** Joint centres from the (morphed) joint cubes, then bone rest frames. */
  #fitSkeleton() {
    const { W } = this;
    this.jointVerts.forEach((verts, j) => {
      const p = this.joints[j].set(0, 0, 0);
      for (const v of verts) p.x += W[v * 3], p.y += W[v * 3 + 1], p.z += W[v * 3 + 2];
      p.divideScalar(verts.length);
    });
    const J = (name) => this.joints[this.boneDefs[this.boneIndex[name]].head];
    const palm = {};
    for (const [s, sign] of [['l', 1], ['r', -1]]) {
      const w = J(`hand_${s}`), a = J(`index_01_${s}`), b = J(`pinky_01_${s}`);
      const n = new THREE.Vector3().crossVectors(_v1.subVectors(a, w), _v2.subVectors(b, w)).normalize();
      if (n.x * sign < 0) n.negate(); // point out of the back of the hand (away from the body)
      palm[s] = n;
    }
    this.palm = palm;

    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    const FWD = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);
    this.boneDefs.forEach((b, i) => {
      const h = this.joints[b.head], t = this.joints[b.tail];
      const R = this.rest[i];
      if (b.parent < 0) {
        R.world.makeTranslation(h.x, 0, h.z);
      } else {
        Y.subVectors(t, h).normalize();
        if (HAND_CHAIN.test(b.name)) {
          X.crossVectors(Y, _v1.copy(palm[b.name.endsWith('_l') ? 'l' : 'r']).negate());
        } else {
          X.crossVectors(Y, FWD);
          if (X.lengthSq() < 0.04) X.crossVectors(Y, DOWN);
        }
        X.normalize();
        Z.crossVectors(X, Y).normalize();
        X.crossVectors(Y, Z);
        R.world.makeBasis(X, Y, Z).setPosition(h);
      }
    });
    // parent-relative rest transforms
    const inv = new THREE.Matrix4();
    this.boneDefs.forEach((b, i) => {
      const R = this.rest[i];
      _m.copy(R.world);
      if (b.parent >= 0) _m.premultiply(inv.copy(this.rest[b.parent].world).invert());
      _m.decompose(R.p, R.q, _v2);
    });
    // bind in rest pose
    this.bones.forEach((bone, i) => { bone.position.copy(this.rest[i].p); bone.quaternion.copy(this.rest[i].q); bone.scale.set(1, 1, 1); });
    this.object.updateMatrixWorld(true);
    this.skeleton.calculateInverses();
    this.body.bind(this.skeleton, this.body.matrixWorld);
    this.underwear.bind(this.skeleton, this.underwear.matrixWorld);
    this.eyes.bind(this.skeleton, this.eyes.matrixWorld);
    this.#pickSoles();
  }

  #pickSoles() {
    const W = this.W, out = [];
    for (let i = 0; i < 13380; i++) if (W[i * 3 + 1] < 0.035) out.push(i);
    this.soleVerts = out;
  }

  /* ================================================================ pose */

  /**
   * @param pose { boneName: [x, y, z] degrees, ... , $root?: [x, y, z] metres offset, $ground?: bool }
   *             Use `mirrorPose()` from poses.js to author one side.
   */
  setPose(pose) {
    this.pose = pose || {};
    this.#applyPose();
  }

  #applyPose() {
    const pose = this.pose;
    this.bones.forEach((bone, i) => {
      const R = this.rest[i];
      bone.position.copy(R.p);
      const r = pose[bone.name];
      if (r) {
        _e.set(THREE.MathUtils.degToRad(r[0] || 0), THREE.MathUtils.degToRad(r[1] || 0), THREE.MathUtils.degToRad(r[2] || 0), 'XZY');
        bone.quaternion.copy(R.q).multiply(_q.setFromEuler(_e));
      } else {
        bone.quaternion.copy(R.q);
      }
    });
    const root = this.bones[0];
    if (pose.$root) root.position.add(_v1.fromArray(pose.$root));
    this.object.updateMatrixWorld(true);
    if (pose.$ground !== false) {
      root.position.y -= this.lowestPoint();
      this.object.updateMatrixWorld(true);
    }
  }

  /** Lowest skinned sole vertex, in the human's local space. */
  lowestPoint() {
    this.skeleton.update();
    const bm = this.skeleton.boneMatrices; // boneWorld × boneInverse
    const si = this.assets.sections['skin.index'], sw = this.assets.sections['skin.weight'];
    const W = this.W;
    const toLocal = _m.copy(this.object.matrixWorld).invert();
    const bind = this.body.bindMatrix;
    const p = _v1, acc = _v2, tmp = _v3, M = new THREE.Matrix4();
    let min = Infinity;
    for (const v of this.soleVerts) {
      p.fromArray(W, v * 3).applyMatrix4(bind);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw[v * 4 + k] / 65535;
        if (!w) continue;
        M.fromArray(bm, si[v * 4 + k] * 16);
        acc.addScaledVector(tmp.copy(p).applyMatrix4(M), w);
      }
      acc.applyMatrix4(toLocal);
      if (acc.y < min) min = acc.y;
    }
    return Number.isFinite(min) ? min : 0;
  }

  /** World position of a joint in the current pose (e.g. for camera framing). */
  bonePosition(name, target = new THREE.Vector3()) {
    return this.bones[this.boneIndex[name]].getWorldPosition(target);
  }

  /** @param opts { tone?, clay?: bool (uniform grey sculpt look), stubble?, brows?, hairColor? } */
  setSkin(opts = {}) {
    this.skin.userData.setSkin(opts);
    if (opts.clay != null) {
      this.eyes.material.userData.setClay(opts.clay, opts.tone);
      this.body.material[1].color.set(opts.clay ? '#35363a' : '#120d0a'); // lashes
    }
  }

  dispose() {
    this.hair.dispose();
    for (const m of Object.values(this.underwearMats)) m.dispose();
    this.body.geometry.dispose();
    this.eyes.geometry.dispose();
    for (const m of [...this.body.material, this.eyes.material]) m.dispose();
    this.skeleton.dispose();
  }
}
