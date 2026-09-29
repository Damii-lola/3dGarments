/**
 * Body material: one physically based surface for every skin option.
 *
 *   clay  uniform grey sculpt/mannequin finish (satin, neutral light wrap)
 *   skin  the chosen tone, with a red-biased light wrap (cheap subsurface scattering) and a warm sheen
 *
 * A faint procedural micro-texture (in body space, so no UVs needed) keeps large surfaces from
 * looking like plastic under studio light. Models tag each vertex with a part (_PART, see
 * tools/body/prepare.py): 0 skin, 1 eye (iris + pupil drawn around the eyeball centre), 4 fabric
 * (underwear), 5 teeth, 6 tongue.
 */
import * as THREE from 'three';

const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export function createBodyMaterial({ tone = '#bb8b64', clay = false, eyes = {} } = {}) {
  const uniforms = {
    uSSS: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
    uClay: { value: 0 },
    uEyeL: { value: new THREE.Vector3().fromArray(eyes.l || [0, -9, 0]) },
    uEyeR: { value: new THREE.Vector3().fromArray(eyes.r || [0, -9, 0]) },
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nattribute float _part;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvPart = _part;\n// clothing sits a hair off the skin so it never z-fights or sinks in\nif (_part > 3.5 && _part < 4.5) transformed += objectNormal * 0.0025;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSSS; uniform float uClay; uniform vec3 uEyeL; uniform vec3 uEyeR;\nvarying vec3 vRest; varying float vPart;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float isFabric = step(3.5, vPart) * step(vPart, 4.5);
{
  vec3 grey = diffuseColor.rgb;
  if (vPart > 0.5 && vPart < 1.5) {                       // eye: sclera, iris, pupil around the eyeball centre
    vec3 d = normalize(vRest - (vRest.x > 0.0 ? uEyeL : uEyeR));
    float t = d.z;
    float iris = smoothstep(0.925, 0.935, t), pupil = smoothstep(0.978, 0.984, t);
    float limbal = smoothstep(0.915, 0.93, t) * (1.0 - smoothstep(0.935, 0.955, t));
    vec3 sclera = mix(vec3(0.9, 0.87, 0.84), grey * 1.12, uClay);
    vec3 irisC = mix(vec3(0.3, 0.2, 0.13) * (0.8 + 0.4 * n3(vRest * 900.0)), grey * 0.72, uClay);
    vec3 pupilC = mix(vec3(0.02), grey * 0.35, uClay);
    diffuseColor.rgb = mix(mix(sclera, irisC, iris), pupilC, pupil) * (1.0 - 0.35 * limbal);
  } else if (isFabric > 0.5) {                               // underwear: always black knit, whatever the skin
    diffuseColor.rgb = vec3(0.012, 0.012, 0.014) * (0.9 + 0.2 * n3(vRest * 2200.0));
  } else if (vPart > 4.5 && vPart < 5.5) {                  // teeth
    diffuseColor.rgb = mix(vec3(0.91, 0.89, 0.84), grey * 1.1, uClay);
  } else if (vPart > 5.5) {                                  // tongue
    diffuseColor.rgb = mix(vec3(0.66, 0.33, 0.35), grey * 0.8, uClay);
  }
}
{
  // soft mottling (skin) / barely-there casting grain (clay)
  float m1 = n3(vRest * 9.0), m2 = n3(vRest * 42.0);
  diffuseColor.rgb *= 1.0 + mix((m1 - 0.5) * 0.08 + (m2 - 0.5) * 0.04, (m2 - 0.5) * 0.025, uClay);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor *= 0.93 + 0.14 * n3(vRest * 60.0);
roughnessFactor = mix(roughnessFactor, 0.78, isFabric);
if (vPart > 0.5 && vPart < 1.5) roughnessFactor = 0.12;`)
      .replace('#include <lights_fragment_begin>', `material.sheenColor *= 1.0 - isFabric; // no warm skin sheen on the black fabric
#include <lights_fragment_begin>`)
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
