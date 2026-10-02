/**
 * A template worn on the body: its 3D garment built on the frame's surfaces (frame.js), textured by ONE PNG in the
 * shared layout (frame.js RECT) — the PNG's alpha is the cut (neckline, hem, sleeve length), its pixels the look.
 *
 *   const worn = wearTemplate(human, TEMPLATES['men/tee_crew'], { texture })   texture: canvas | image | URL (default:
 *                                                                              the template's own painted default)
 *   worn.mesh, worn.hide (body vertices it covers), worn.dispose()
 */
import * as THREE from 'three';
import { useCpuMorphs } from '../human/cpumorph.js';
import { wearSkin } from './skinwear.js';
import { ATLAS, RECT, measureBody, torsoSurface, armSurface, bindToBody, unskin } from './frame.js';

const GAP = 0.004;          // m: the first layer over the skin (clears the underwear, 2.5 mm off it)
const PER_LAYER = 0.005;    // m: each layer over the one under it

/** everything a template's builder and painter need about this body, in its layout */
export function prepare(human, tpl) {
  const body = measureBody(human), L = body.L, cut = tpl.cut(body);
  const gap = GAP + PER_LAYER * Math.max(0, (tpl.layer || 1) - 1);
  const torso = tpl.torso && torsoSurface(body, {
    y0: L.neckTop, y1: cut.hemY - 0.03,
    ease: (th, y) => gap + tpl.torso.ease(th, y, L), fall: tpl.torso.fall ?? 0.05, fallFrom: tpl.torso.fallFrom ?? null, span: tpl.torso.span ?? 0.025, cap: tpl.torso.cap ?? 0, minGap: gap + 0.001,
  });
  const arms = {};
  if (tpl.sleeve) for (const side of ['r', 'l']) {
    const a1 = cut.sleeveEnd + 0.03;
    arms[side] = armSurface(body, side, { a0: tpl.sleeve.start ?? -0.05, a1, shape: (bins, NA) => tpl.sleeve.shape(bins, NA, gap), meet: tpl.sleeve.meet && torso ? { outside: torso.outside, len: tpl.sleeve.meet, over: 0.0015 } : null });
  }
  return { body, L, cut, torso, arms };
}

/** the garment's mesh: grids on the surfaces, UVs in the layout */
export function buildGeometry(prep, tpl) {
  const { torso, arms, body, cut } = prep;
  const pos = [], uv = [], idx = [];
  const grid = (rows, cols, fn, flip = false) => {
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const [p, t] = fn(r / rows, c / cols); pos.push(...p); uv.push(...t); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      if (flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
    }
  };
  const U = (rect, u, v) => [(rect[0] + u * rect[2]) / ATLAS, 1 - (rect[1] + v * rect[3]) / ATLAS];
  if (torso) {
    const ys = torso.rows, H = ys.map((y) => torso.halves(y));
    for (const [key, rect, flip] of [['front', RECT.torsoFront, false], ['back', RECT.torsoBack, false]]) {
      const NC = 72;
      grid(ys.length - 1, NC, (fr, fc) => {
        const k = Math.round(fr * (ys.length - 1)), y = ys[k], th = torso.thOfU(H[k][key], fc);
        const v = Math.max(0, Math.min(1, prep.body.vOfY(y)));
        return [torso.at(th, y), U(rect, flip ? 1 - fc : fc, v)];
      });
    }
  }
  for (const side of Object.keys(arms)) {
    const A = arms[side]; if (!A) continue;
    const rect = side === 'r' ? RECT.sleeveR : RECT.sleeveL, a0 = tpl.sleeve.start ?? -0.05, a1 = cut.sleeveEnd + 0.03, NR = Math.ceil((a1 - a0) / 0.006), NC = 64;
    grid(NR, NC, (fr, fc) => {
      const along = a0 + fr * (a1 - a0), phi = fc * Math.PI * 2;
      return [A.at(phi, along), U(rect, Math.max(0, Math.min(1, A.vOfA(along))), fc)];
    }, side === 'l');          // (the left arm runs the other way: wound the other way, to face out)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** normals of the rest-pose mesh (the skinning turns them with it), welded across the seams (one per position) */
function weldNormals(geo) {
  geo.computeVertexNormals();
  // normals welded across seams (the side seams, the sleeves' seam): one normal per position
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, acc = new Map();
  for (let i = 0; i < P.length / 3; i++) {
    const k = `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    let a = acc.get(k); if (!a) acc.set(k, (a = [0, 0, 0, []])); a[0] += N[i * 3]; a[1] += N[i * 3 + 1]; a[2] += N[i * 3 + 2]; a[3].push(i);
  }
  for (const [x, y, z, l] of acc.values()) { const s = Math.hypot(x, y, z) || 1; for (const i of l) { N[i * 3] = x / s; N[i * 3 + 1] = y / s; N[i * 3 + 2] = z / s; } }
}

function textureOf(src) {
  const t = src instanceof THREE.Texture ? src : new THREE.CanvasTexture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function wearTemplate(human, tpl, { texture = null } = {}) {
  if (tpl.kind === 'skin') return wearSkin(human, tpl);
  const B = human.active, mesh = B.mesh;
  B.ensureShape?.();
  const prep = prepare(human, tpl);
  const geo = buildGeometry(prep, tpl);
  // on the body: bones and shape morphs of the skin under each vertex (the rest position without the current morphs)
  const P = geo.attributes.position.array, bound = bindToBody(prep.body, P);
  weldNormals(geo);                                   // (on the garment as it stands: smooth)
  unskin(mesh, P, bound.si, bound.sw, geo.attributes.normal.array);
  for (let i = 0; i < P.length; i++) P[i] -= bound.delta[i];
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bound.si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(bound.sw, 4));
  geo.morphAttributes.position = bound.morph.map((a) => new THREE.Float32BufferAttribute(a, 3));
  geo.morphTargetsRelative = true;
  const canvas = texture || tpl.paint(prep);
  const map = textureOf(canvas);
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.93, metalness: 0 });
  const garment = new THREE.SkinnedMesh(geo, mat);
  garment.name = `template:${tpl.id}`;
  garment.frustumCulled = false;
  garment.castShadow = garment.receiveShadow = true;
  garment.morphTargetInfluences = mesh.morphTargetInfluences;
  garment.bind(mesh.skeleton, mesh.bindMatrix);
  useCpuMorphs(garment);
  garment.customDepthMaterial.map = map; garment.customDepthMaterial.alphaTest = 0.5;
  const blend = garment.onBeforeRender;
  garment.onBeforeRender = function (...a) { garment.morphTargetInfluences = mesh.morphTargetInfluences; return blend.apply(this, a); };
  mesh.parent.add(garment);
  B.layers.add(garment);
  const hide = tpl.hides(prep);
  return {
    tpl, mesh: garment, hide, canvas, prep,
    dispose() { B.layers.delete(garment); garment.removeFromParent(); geo.dispose(); map.dispose(); mat.dispose(); },
  };
}
