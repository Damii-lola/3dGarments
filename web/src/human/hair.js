/**
 * Shell-textured head hair.
 *
 * The scalp (painted in tools/human/paint.py) is copied into N stacked shells,
 * each pushed out along the normal and combed along a flow direction. The
 * fragment shader carves strands out of the shells with a 3D cell pattern keyed
 * on the strand ROOT, so hairs stay put as the head moves and never swim.
 * Far away, strands fade into their average coverage so nothing sparkles.
 *
 * Every shell vertex copies the skin weights of the scalp vertex it grew from.
 */
import * as THREE from 'three';
import { assetUrl } from './assets.js';

export const HAIR_STYLES = {
  none: { label: 'Bald' },
  buzz: { label: 'Buzz cut', length: 0.0045, shells: 10, lean: 0.2, droop: 0, flow: 'crown', density: 0.95 },
  crop: { label: 'Short crop', length: 0.02, shells: 30, lean: 0.9, droop: 0.25, flow: 'crown', density: 0.9, volume: 1.0 },
  quiff: { label: 'Swept back', length: 0.03, shells: 34, lean: 1.4, droop: 0.1, flow: 'back', density: 0.9, volume: 1.2 },
  sleek: { label: 'Sleek bun', length: 0.007, shells: 18, lean: 1.8, droop: 0, flow: 'bun', density: 1, bun: 0.052 },
  pony: { label: 'Low bun', length: 0.007, shells: 18, lean: 1.8, droop: 0, flow: 'low', density: 1, bun: 0.048, low: true },
};

export const HAIR_COLORS = [
  { id: 'black', label: 'Black', hex: '#0d0a09' },
  { id: 'darkbrown', label: 'Dark brown', hex: '#23160f' },
  { id: 'brown', label: 'Brown', hex: '#4a2e1c' },
  { id: 'auburn', label: 'Auburn', hex: '#6b2d17' },
  { id: 'blonde', label: 'Blonde', hex: '#a3814f' },
  { id: 'platinum', label: 'Platinum', hex: '#d1c2a4' },
  { id: 'grey', label: 'Grey', hex: '#8d8a86' },
];

const MAX_SHELLS = 40;
let detailTex = null;

export class Hair {
  constructor(human) {
    this.human = human;
    this.style = 'none';
    this.uniforms = {
      uColor: { value: new THREE.Color(HAIR_COLORS[1].hex) },
      uDetail: { value: null },
      uDensity: { value: 1 },
      uFreq: { value: 1300 },
    };
    if (!detailTex) {
      detailTex = new THREE.TextureLoader().load(assetUrl('detail.png'));
      detailTex.colorSpace = THREE.NoColorSpace;
    }
    this.uniforms.uDetail.value = detailTex;
    this.material = createHairMaterial(this.uniforms);
    this.mesh = null;

    // scalp triangles (render-vertex ids) from the body index
    const scalp = human.assets.sections['render.scalp'];
    const body = human.assets.sections['index.body'];
    const tris = [];
    for (let t = 0; t < body.length; t += 3) {
      const a = body[t], b = body[t + 1], c = body[t + 2];
      if (Math.max(scalp[a], scalp[b], scalp[c]) > 4) tris.push(a, b, c);
    }
    const verts = [...new Set(tris)];
    this.scalpVerts = verts;
    const local = new Map(verts.map((v, i) => [v, i]));
    this.scalpTris = tris.map((v) => local.get(v));
  }

  setStyle(style) {
    this.style = HAIR_STYLES[style] ? style : 'none';
    this.rebuild();
  }

  setColor(hex) { this.uniforms.uColor.value.set(hex); }

  /** Call after the body shape changes. */
  rebuild() {
    const human = this.human;
    if (this.mesh) { human.object.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const S = HAIR_STYLES[this.style];
    if (!S || !S.length) return;

    const W = human.W, NO = human.normalsOrig, src = human.src;
    const bodyGeo = human.body.geometry;
    const skinI = bodyGeo.attributes.skinIndex.array, skinW = bodyGeo.attributes.skinWeight.array;
    const uv = bodyGeo.attributes.uv.array;
    const J = (n) => human.joints[human.jointByName[n]];
    const top = J('joint-head-2'), base = J('joint-head');
    const up = new THREE.Vector3().subVectors(top, base).normalize();
    const crown = top.clone().addScaledVector(new THREE.Vector3(0, 0, -1), 0.045).addScaledVector(up, -0.01);
    const bunC = S.low
      ? base.clone().add(new THREE.Vector3(0, 0.015, -0.1))
      : top.clone().add(new THREE.Vector3(0, -0.035, -0.105));

    const nV = this.scalpVerts.length;
    const K = Math.min(MAX_SHELLS, S.shells);
    const bunGeo = S.bun ? new THREE.SphereGeometry(1, 28, 20) : null;
    const nB = bunGeo ? bunGeo.attributes.position.count : 0;
    const total = (nV + nB) * K;
    const pos = new Float32Array(total * 3), root = new Float32Array(total * 3), dir = new Float32Array(total * 3), perp = new Float32Array(total * 3);
    const tt = new Float32Array(total), uvs = new Float32Array(total * 2), mask = new Float32Array(total);
    const si = new Uint16Array(total * 4), sw = new Float32Array(total * 4);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3(), tmp = new THREE.Vector3();
    const headBone = human.boneIndex.head;

    let o = 0;
    for (let k = 0; k < K; k++) {
      const t = (k + 1) / K;
      for (let i = 0; i < nV; i++, o++) {
        const r = this.scalpVerts[i], v = src[r];
        p.fromArray(W, v * 3);
        n.fromArray(NO, v * 3).normalize();
        // comb direction, tangent to the scalp
        if (S.flow === 'crown') d.subVectors(p, crown).addScaledVector(up, -0.02);
        else if (S.flow === 'back') d.set(0, 0.25, -1).add(tmp.subVectors(p, crown).multiplyScalar(0.8));
        else d.subVectors(bunC, p);
        d.addScaledVector(n, -d.dot(n)).normalize();
        const len = S.length * (S.volume || 1);
        tmp.copy(p).addScaledVector(n, len * t * (0.35 + 0.65 * (S.volume ? 1 : 0.6)))
          .addScaledVector(d, S.length * t * S.lean)
          .addScaledVector(up, -S.length * S.droop * t * t);
        tmp.toArray(pos, o * 3);
        p.toArray(root, o * 3);
        d.toArray(dir, o * 3);
        tmp.crossVectors(n, d).normalize().toArray(perp, o * 3);
        tt[o] = t;
        uvs[o * 2] = uv[r * 2]; uvs[o * 2 + 1] = uv[r * 2 + 1];
        mask[o] = 1;
        for (let q = 0; q < 4; q++) { si[o * 4 + q] = skinI[r * 4 + q]; sw[o * 4 + q] = skinW[r * 4 + q]; }
      }
      if (bunGeo) {
        const bp = bunGeo.attributes.position.array;
        const R = S.bun;
        for (let i = 0; i < nB; i++, o++) {
          n.fromArray(bp, i * 3);
          p.copy(n).multiply(tmp.set(1, 0.82, 0.9)).multiplyScalar(R * 0.72).add(bunC);
          d.set(-n.z, 0, n.x).addScaledVector(n, 0).normalize(); // swirl around the bun
          if (!Number.isFinite(d.x) || d.lengthSq() < 1e-6) d.set(1, 0, 0);
          tmp.copy(p).addScaledVector(n, R * 0.28 * t).addScaledVector(d, R * 0.25 * t);
          tmp.toArray(pos, o * 3);
          p.toArray(root, o * 3);
          d.toArray(dir, o * 3);
          tmp.crossVectors(n, d).normalize().toArray(perp, o * 3);
          tt[o] = t;
          mask[o] = 0; // no hairline on the bun
          si[o * 4] = headBone; sw[o * 4] = 1;
        }
      }
    }
    const index = [];
    for (let k = 0; k < K; k++) {
      const off = k * (nV + nB);
      for (const v of this.scalpTris) index.push(off + v);
      if (bunGeo) for (const v of bunGeo.index.array) index.push(off + nV + v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aPerp', new THREE.BufferAttribute(perp, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    g.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(index);
    g.computeVertexNormals();
    bunGeo?.dispose();
    this.uniforms.uDensity.value = S.density ?? 1;
    this.uniforms.uFreq.value = S.length < 0.006 ? 1700 : 1300;
    const mesh = new THREE.SkinnedMesh(g, this.material);
    mesh.name = 'human:hair';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    human.object.add(mesh);
    human.object.updateMatrixWorld(true);
    mesh.bind(human.skeleton, mesh.matrixWorld);
    this.mesh = mesh;
  }

  dispose() {
    if (this.mesh) { this.human.object.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.material.dispose();
  }
}

function createHairMaterial(uniforms) {
  // shells are indexed inner → outer, so one draw call blends them in the right order
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.75, metalness: 0, specularIntensity: 0.25, envMapIntensity: 0.5,
    transparent: true, alphaTest: 0.01, depthWrite: true, side: THREE.DoubleSide,
  });
  m.name = 'hair';
  m.defines = { USE_UV: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aRoot; attribute vec3 aDir; attribute vec3 aPerp; attribute float aT; attribute float aMask;
varying vec3 vRoot; varying vec3 vHairDir; varying vec3 vDirO; varying vec3 vPerp; varying float vT; varying float vMask;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRoot = aRoot; vT = aT; vMask = aMask; vDirO = aDir; vPerp = aPerp;
vHairDir = normalize(normalMatrix * aDir);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uColor; uniform sampler2D uDetail; uniform float uDensity; uniform float uFreq;
varying vec3 vRoot; varying vec3 vHairDir; varying vec3 vDirO; varying vec3 vPerp; varying float vT; varying float vMask;
float hh1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hh1(i), hh1(i + 1.0), f); }
float hh3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3h(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh3(i), hh3(i + vec3(1,0,0)), f.x), mix(hh3(i + vec3(0,1,0)), hh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh3(i + vec3(0,0,1)), hh3(i + vec3(1,0,1)), f.x), mix(hh3(i + vec3(0,1,1)), hh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gStreak;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float hairline = mix(1.0, texture2D(uDetail, vUv).g, vMask);
vec3 P = normalize(vPerp), D = normalize(vDirO);
float across = dot(vRoot, P), along = dot(vRoot, D);
float wave = (n1(along * 60.0 + across * 30.0) - 0.5) * 0.0015;
float xf = (across + wave) * uFreq * 2.2;
float fine = n1(xf) * 0.6 + n1(xf * 2.7 + 5.0) * 0.4;
fine = mix(fine, 0.5, smoothstep(0.35, 1.0, fwidth(xf)));        // no sparkle when hairs are sub-pixel
float clump = n1((across + wave * 2.0) * 240.0 + 3.0);
float streak = clamp(fine * 0.55 + clump * 0.45, 0.0, 1.0);
gStreak = streak;
// strands end at different heights: tufty outer boundary, thinner at the hairline
float tip = mix(0.5, 1.05, n3h(vRoot * 140.0)) * mix(0.7, 1.1, clump) * mix(0.25, 1.0, smoothstep(0.05, 0.7, hairline));
float thr = vT / max(tip, 0.05);
float aa = max(fwidth(streak) * 1.5, 0.04);
float a = smoothstep(thr * 0.9 - aa, thr * 0.9 + aa, streak * uDensity + 0.08);
a *= smoothstep(0.0, 0.55, hairline + (streak - 0.5) * 0.35);          // soft, wispy hairline
if (vT < 0.12) a = max(a, smoothstep(0.35, 0.75, hairline));          // inner layer covers the scalp
a *= mix(1.0, 0.85, vT);
diffuseColor.a = a;
float shade = mix(0.35, 1.0, pow(vT, 0.6));
diffuseColor.rgb = uColor * shade * (0.72 + 0.56 * streak);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  // Kajiya–Kay: primary (white, sharp) + secondary (tinted, broad) bands, jittered per strand
  vec3 T = normalize(vHairDir + normal * (gStreak - 0.5) * 0.35);
  vec3 V = normalize(vViewPosition);
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 L = directionalLights[i].direction;
    vec3 H = normalize(L + V);
    float th1 = dot(normalize(T + normal * 0.08), H), th2 = dot(normalize(T - normal * 0.12), H);
    float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 110.0);
    float s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 28.0);
    float vis = smoothstep(-0.1, 0.3, dot(normal, L));
    reflectedLight.directSpecular += directionalLights[i].color * vis * (s1 * 0.05 + s2 * 0.12 * uColor / max(max(uColor.r, uColor.g), 0.05) * 0.5) * (0.4 + 0.6 * vT);
  }
  #endif
}`);
  };
  return m;
}
