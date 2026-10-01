/**
 * Morph targets blended on the CPU, not in the vertex shader.
 *
 * three.js evaluates morphs on the GPU with a loop of texelFetch()es into a morph texture array. Some Android GPU
 * drivers get that loop wrong once several targets are active: the body came apart on a phone (a lumpy jaw, a torn
 * waistband, a cut thigh) as soon as a body-shape slider moved, while desktops and software rendering were fine.
 *
 * Here the morphs stay where they are (geometry.morphAttributes, mesh.morphTargetInfluences: everything on the CPU
 * that reads them keeps working), but the shaders never touch them: the weighted sum of the targets is computed on
 * the CPU when the weights change (two vec3 attributes, `morphPos` and `morphNrm`) and simply added in the vertex
 * shader, in every pass that draws the mesh (its materials and its shadow).
 */
import * as THREE from 'three';

const PARS = 'attribute vec3 morphPos;\nattribute vec3 morphNrm;';

function patch(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace('#include <morphnormal_vertex>', 'objectNormal += morphNrm;')
    .replace('#include <morphtarget_vertex>', 'transformed += morphPos;');
}

/** a material's shaders take the CPU-blended morphs (its own onBeforeCompile still runs first) */
function patchMaterial(m) {
  if (!m || m.userData.cpuMorphs) return;
  m.userData.cpuMorphs = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (shader, renderer) { prev?.call(this, shader, renderer); patch(shader); };
  m.customProgramCacheKey = function () { return `${prevKey.call(this)}|cpumorph`; };
  m.needsUpdate = true;
}

/**
 * @param mesh a (Skinned)Mesh with relative morph targets (geometry.morphTargetsRelative)
 * @returns update() — blends now (also done automatically before each draw when the weights changed)
 */
export function useCpuMorphs(mesh) {
  const g = mesh.geometry, n = g.attributes.position.count;
  const P = new THREE.BufferAttribute(new Float32Array(n * 3), 3), N = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  P.setUsage(THREE.DynamicDrawUsage); N.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('morphPos', P);
  g.setAttribute('morphNrm', N);
  for (const m of [].concat(mesh.material)) patchMaterial(m);
  // the shadow: three's own depth material would still run the morph loop
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchMaterial(mesh.customDepthMaterial);

  let key = '', arrays = null;
  const update = () => {
    const infl = mesh.morphTargetInfluences || [], mp = g.morphAttributes.position || [], mn = g.morphAttributes.normal || [];
    const k = `${mp.length}:${infl.join(',')}`;
    if (k === key && arrays === mp) return;            // (new targets installed: shape.js builds them after load)
    key = k; arrays = mp;
    const p = P.array, q = N.array;
    p.fill(0); q.fill(0);
    for (let t = 0; t < mp.length; t++) {
      const w = infl[t];
      if (!w) continue;
      const d = mp[t].array;
      for (let i = 0; i < p.length; i++) p[i] += d[i] * w;
      const dn = mn[t]?.array;
      if (dn) for (let i = 0; i < q.length; i++) q[i] += dn[i] * w;
    }
    P.needsUpdate = true; N.needsUpdate = true;
  };
  const prevBefore = mesh.onBeforeRender;
  mesh.onBeforeRender = function (...a) { update(); prevBefore?.apply(this, a); };
  mesh.onBeforeShadow = function () { update(); };
  update();
  return update;
}
