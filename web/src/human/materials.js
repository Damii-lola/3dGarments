/**
 * Human materials.
 *
 * Skin: MeshPhysicalMaterial + a small shader patch:
 *   - tone-driven albedo with region masks (lips, areolae, nails, eyelids, ears, mouth)
 *   - red-biased wrap lighting as a cheap subsurface-scattering approximation
 *   - procedural pore bump + low-frequency mottling, so it never reads as plastic
 */
import * as THREE from 'three';
import { assetUrl } from './assets.js';

export const SKIN_TONES = [
  { id: 'porcelain', label: 'Porcelain', hex: '#efd8c8' },
  { id: 'fair', label: 'Fair', hex: '#e4c1a8' },
  { id: 'light', label: 'Light', hex: '#d3a98b' },
  { id: 'medium', label: 'Medium', hex: '#bb8f70' },
  { id: 'tan', label: 'Tan', hex: '#9d7150' },
  { id: 'brown', label: 'Brown', hex: '#7c533a' },
  { id: 'deep', label: 'Deep', hex: '#5c3c2a' },
  { id: 'ebony', label: 'Ebony', hex: '#3d291e' },
];

const loader = new THREE.TextureLoader();
let masks = null;
function maskTextures() {
  if (!masks) {
    const load = (f) => {
      const t = loader.load(assetUrl(f));
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    };
    masks = { a: load('skin_a.png'), b: load('skin_b.png'), detail: load('detail.png') };
  }
  return masks;
}

const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export function createSkinMaterial({ tone = SKIN_TONES[2].hex, hairColor = '#2a1c14', brows = 1, stubble = 0 } = {}) {
  const { a, b, detail } = maskTextures();
  const uniforms = {
    uMaskA: { value: a },
    uMaskB: { value: b },
    uDetail: { value: detail },
    uHair: { value: new THREE.Color(hairColor) },
    uBrows: { value: brows },
    uStubble: { value: stubble },
    uScalp: { value: 0 },
    uSSS: { value: new THREE.Vector3(0.55, 0.26, 0.14) },
    uPore: { value: 0.35 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tone),
    roughness: 0.52,
    metalness: 0,
    specularIntensity: 0.55,
    specularColor: new THREE.Color('#ffffff'),
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#ffb59e'),
    clearcoat: 0.04,
    clearcoatRoughness: 0.5,
  });
  mat.name = 'skin';
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMaskA; uniform sampler2D uMaskB; uniform sampler2D uDetail; uniform vec3 uSSS; uniform float uPore;
uniform vec3 uHair; uniform float uBrows; uniform float uStubble; uniform float uScalp;
varying vec3 vRest;
${NOISE}
vec4 mA; vec4 mB; vec4 mD;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
mA = texture2D(uMaskA, vUv); mB = texture2D(uMaskB, vUv); mD = texture2D(uDetail, vUv);
{
  vec3 tone = diffuseColor.rgb;
  // mottling: large soft patches + faint freckle-scale variation
  float m1 = n3(vRest * 9.0), m2 = n3(vRest * 42.0);
  tone *= 1.0 + (m1 - 0.5) * 0.10 + (m2 - 0.5) * 0.05;
  tone = mix(tone, tone * vec3(1.04, 0.93, 0.92), mB.b * 0.35 * smoothstep(0.3, 0.8, n3(vRest * 4.0 + 3.1)));
  vec3 lips = tone * vec3(0.80, 0.50, 0.52);
  vec3 areola = tone * vec3(0.70, 0.50, 0.46);
  vec3 nails = mix(tone, vec3(0.93, 0.80, 0.78), 0.55);
  diffuseColor.rgb = tone;
  diffuseColor.rgb = mix(diffuseColor.rgb, tone * vec3(0.97, 0.86, 0.85), mB.r * 0.6);   // ears
  diffuseColor.rgb = mix(diffuseColor.rgb, tone * vec3(0.90, 0.80, 0.80), mA.a * 0.7);   // eyelids
  diffuseColor.rgb = mix(diffuseColor.rgb, lips, mA.r);
  diffuseColor.rgb = mix(diffuseColor.rgb, areola, mA.g * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, nails, mA.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.09, 0.09), mB.g);                 // inside mouth
  // stubble: fine dark dots in the beard region; scalp: hair roots under short hair
  vec3 sq = vRest * 2200.0;
  float dotFade = 1.0 - smoothstep(0.35, 0.9, length(fwidth(sq)));
  float dots = mix(0.5, smoothstep(0.5, 0.75, n3(sq)), dotFade);
  float stub = mD.b * uStubble;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(1.0), uHair / max(tone, vec3(0.02)), 0.35), stub * 0.55); // blue-grey shadow
  diffuseColor.rgb = mix(diffuseColor.rgb, uHair, stub * dots * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHair * 0.8, mD.g * uScalp);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHair * 0.9, clamp(mD.r * 1.15, 0.0, 1.0) * uBrows);   // eyebrows
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.36, mA.r);
roughnessFactor = mix(roughnessFactor, 0.22, mA.b);
roughnessFactor *= 0.92 + 0.16 * n3(vRest * 60.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // pores: bump from high-frequency noise, faded out before it can alias
  vec3 q = vRest * 1400.0;
  float fw = length(fwidth(q));
  float amt = uPore * (1.0 - smoothstep(0.5, 1.6, fw)) * (1.0 - mA.b) * (1.0 - mA.r * 0.7);
  if (amt > 0.001) {
    float hgt = n3(q) * 0.6 + n3(q * 2.3) * 0.4;
    vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * amt * 0.012;
    vec3 vSigmaX = normalize(dFdx(-vViewPosition)), vSigmaY = normalize(dFdy(-vViewPosition));
    vec3 R1 = cross(vSigmaY, normal), R2 = cross(normal, vSigmaX);
    float det = dot(vSigmaX, R1);
    vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
    normal = normalize(abs(det) * normal - grad);
  }
}`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{
  // subsurface approximation: light wraps further around for red than for blue
  float nl = dot( geometryNormal, directLight.direction );
  vec3 wrapped = clamp( ( vec3( nl ) + uSSS ) / ( 1.0 + uSSS ), 0.0, 1.0 );
  wrapped *= mix( vec3( 1.0 ), vec3( 1.0, 0.78, 0.68 ), clamp( 1.0 - nl * 2.0, 0.0, 1.0 ) * 0.55 );
  reflectedLight.directDiffuse += directLight.color * wrapped * BRDF_Lambert( material.diffuseColor );
}`,
      ));
  };
  mat.userData.setSkin = ({ tone: t, hairColor: h, brows: br, stubble: st, scalp: sc } = {}) => {
    if (t) mat.color.set(t);
    if (h) uniforms.uHair.value.set(h);
    if (br != null) uniforms.uBrows.value = br;
    if (st != null) uniforms.uStubble.value = st;
    if (sc != null) uniforms.uScalp.value = sc;
  };
  mat.userData.uniforms = uniforms;
  return mat;
}

let eyeTex = null;
export function createEyeMaterial() {
  if (!eyeTex) {
    eyeTex = loader.load(assetUrl('eye.png'));
    eyeTex.colorSpace = THREE.SRGBColorSpace;
    eyeTex.anisotropy = 8;
  }
  // the cornea shell maps to the texture's transparent patch: cut it away to reveal the iris
  const m = new THREE.MeshPhysicalMaterial({ map: eyeTex, alphaTest: 0.5, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 0.7 });
  m.name = 'eyes';
  return m;
}

/**
 * Eyelashes: the MakeHuman lash helpers are solid strips; cut them into
 * individual tapered hairs from their UVs. Upper lashes live at v 0.927–0.947
 * (root at the low edge), lower lashes at v 0.967–0.985 (root at the high edge).
 */
function createLashMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#120d0a', roughness: 0.65, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  m.name = 'lashes';
  m.defines = { USE_UV: '' };
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE.replace(/n3|h3/g, (s) => `${s}l`)}`)
      .replace('#include <alphatest_fragment>', `{
  bool upper = vUv.y < 0.957;
  float t = upper ? (vUv.y - 0.927) / 0.020 : (0.985 - vUv.y) / 0.018;   // 0 root … 1 tip
  float along = vUv.x * (upper ? 1500.0 : 900.0);
  float id = floor(along);
  float jitter = h3l(vec3(id, upper ? 1.0 : 2.0, 0.0));
  float len = (upper ? 0.75 : 0.45) + 0.25 * jitter;
  float cx = fract(along) - 0.5 + (jitter - 0.5) * 0.3 + t * t * (jitter - 0.5) * 0.4;
  float width = mix(0.34, 0.06, clamp(t / len, 0.0, 1.0));
  float strand = 1.0 - smoothstep(width * 0.6, width, abs(cx));
  diffuseColor.a = strand * (1.0 - smoothstep(len * 0.85, len, t)) * step(0.0, t);
}
#include <alphatest_fragment>`);
  };
  return m;
}

let uwMask = null;
/**
 * Seamless knit underwear on the body surface: pushed ~2 mm out along the normal,
 * outline alpha-cut from the painted mask (channel 0 briefs, 1 boxers, 2 bra),
 * with an elastic band along every edge.
 */
export function createFabricMaterial({ color = '#2c2c30', channel = 0 } = {}) {
  if (!uwMask) {
    uwMask = loader.load(assetUrl('underwear.png'));
    uwMask.colorSpace = THREE.NoColorSpace;
    uwMask.anisotropy = 4;
  }
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.8, metalness: 0, sheen: 1, sheenRoughness: 0.65, sheenColor: new THREE.Color('#8e8e98'),
    alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.name = 'fabric';
  m.defines = { USE_UV: '' };
  const ch = ['r', 'g', 'b'][channel];
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: uwMask };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\ntransformed += objectNormal * 0.0022;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uMask;\nvarying vec3 vRest;\nfloat gBand;\n${NOISE}`)
      .replace('#include <alphatest_fragment>', `float mk = texture2D(uMask, vUv).${ch};
diffuseColor.a = mk + 0.001;
gBand = 1.0 - smoothstep(0.6, 0.66, mk);            // elastic band along the edge
diffuseColor.rgb *= mix(1.0, 0.72, gBand);
#include <alphatest_fragment>`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, gBand);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 q = vRest * vec3(2200.0, 560.0, 2200.0);
  float fw = length(fwidth(q));
  float amt = (1.0 - smoothstep(0.6, 1.8, fw)) * (1.0 - gBand * 0.6);
  float hgt = sin(q.x + q.z + n3(vRest * 300.0) * 2.0) * 0.5 + n3(q * 0.5) * 0.5 + gBand * sin(vRest.y * 9000.0) * 0.8;
  vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * amt * 0.01;
  vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
}`);
  };
  m.customProgramCacheKey = () => `fabric-${ch}`;
  return m;
}

export function createSimpleMaterials() {
  return {
    lashes: createLashMaterial(),
    teeth: Object.assign(new THREE.MeshPhysicalMaterial({ color: '#e9e3d6', roughness: 0.3, clearcoat: 0.6 }), { name: 'teeth' }),
    tongue: Object.assign(new THREE.MeshPhysicalMaterial({ color: '#a8545a', roughness: 0.45 }), { name: 'tongue' }),
  };
}
