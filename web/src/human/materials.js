/**
 * Body material: one physically based surface for every skin option.
 *
 *   clay  uniform grey sculpt/mannequin finish (satin, neutral light wrap)
 *   skin  the chosen tone, with a red-biased light wrap (cheap subsurface scattering) and a warm sheen
 *
 * A faint procedural micro-texture (in body space, so no UVs needed) keeps large surfaces from
 * looking like plastic under studio light.
 */
import * as THREE from 'three';

const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export function createBodyMaterial({ tone = '#8e8f93', clay = true } = {}) {
  const uniforms = {
    uSSS: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
    uClay: { value: 1 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tone),
    roughness: 0.55,
    metalness: 0,
    specularIntensity: 0.4,
    sheen: 0.3,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#d8d8dc'),
  });
  mat.name = 'body';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSSS; uniform float uClay;\nvarying vec3 vRest;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  // soft mottling (skin) / barely-there casting grain (clay)
  float m1 = n3(vRest * 9.0), m2 = n3(vRest * 42.0);
  diffuseColor.rgb *= 1.0 + mix((m1 - 0.5) * 0.08 + (m2 - 0.5) * 0.04, (m2 - 0.5) * 0.025, uClay);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor *= 0.93 + 0.14 * n3(vRest * 60.0);`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{
  // subsurface approximation: light wraps further around for red than for blue
  float nl = dot( geometryNormal, directLight.direction );
  vec3 wrapped = clamp( ( vec3( nl ) + uSSS ) / ( 1.0 + uSSS ), 0.0, 1.0 );
  wrapped *= mix( vec3( 1.0 ), vec3( 1.0, 0.78, 0.68 ), clamp( 1.0 - nl * 2.0, 0.0, 1.0 ) * 0.55 * ( 1.0 - uClay ) );
  reflectedLight.directDiffuse += directLight.color * wrapped * BRDF_Lambert( material.diffuseColor );
}`,
      ));
  };
  mat.userData.setSkin = ({ tone: t, clay: c } = {}) => {
    if (t) mat.color.set(t);
    if (c != null) {
      uniforms.uClay.value = c ? 1 : 0;
      uniforms.uSSS.value.set(...(c ? [0.3, 0.3, 0.3] : [0.55, 0.26, 0.14]));
      mat.sheenColor.set(c ? '#d8d8dc' : '#ffb59e');
      mat.roughness = c ? 0.55 : 0.5;
    }
  };
  mat.userData.setSkin({ tone, clay });
  return mat;
}
