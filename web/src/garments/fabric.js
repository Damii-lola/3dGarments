/**
 * Fabric: the photographed garment turned into a physically based cloth surface.
 *
 * The colour is the photo itself — nothing is painted on. What a flat photo lacks, the surface
 * gets from the photo and from real fabric structure:
 *
 *   de-lighting   the flat-lay's lighting falloff (a smooth brightness gradient across the photo)
 *                 is divided out, so the studio lights the garment instead of the photographer's lamp.
 *                 Only a low-order fit is removed: prints, colour blocks and seams stay exactly as shot.
 *   edge bleed    transparent pixels take their nearest opaque colour, so mipmapped / alpha-tested
 *                 edges never pick up a dark background fringe
 *   detail normal the photo's own high-frequency relief (wrinkles, seams, stitching, knit, pile)
 *                 becomes a normal map, so it catches the studio light
 *   weave         per material, at the real thread scale (metres per UV known from the fit): denim
 *                 twill + warp slubs, jersey knit wales, plain weave, satin float, wool / fleece fuzz,
 *                 leather grain — bump + tonal variation, faded before it can alias
 *   cloth BRDF    sheen at grazing angles (fibres), roughness per material with fibre variation;
 *                 the inside layer is darker (it only sees light that leaks in)
 */
import * as THREE from 'three';

/* ================================================================ image processing */

/** separable box blur (radius r) of a Float32 plane, repeated n times (≈ gaussian) */
export function blur(src, w, h, r, n = 2) {
  const out = Float32Array.from(src), tmp = new Float32Array(src.length);
  const line = new Float32Array(Math.max(w, h)), k = 1 / (2 * r + 1);
  for (let it = 0; it < n; it++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let x = -r; x <= r; x++) s += out[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        line[x] = s * k;
        s += out[o + Math.min(w - 1, x + r + 1)] - out[o + Math.max(0, x - r)];
      }
      tmp.set(line.subarray(0, w), o);
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        line[y] = s * k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
      for (let y = 0; y < h; y++) out[y * w + x] = line[y];
    }
  }
  return out;
}

/** least-squares fit of a quadratic surface to (x, y, v) samples; returns f(x, y) */
function fitQuadratic(xs, ys, vs) {
  const n = xs.length, M = Array.from({ length: 6 }, () => new Float64Array(7));
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], row = [1, x, y, x * x, x * y, y * y];
    for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) M[r][c] += row[r] * row[c]; M[r][6] += row[r] * vs[i]; }
  }
  for (let r = 0; r < 6; r++) M[r][r] += 1e-6 * n;
  for (let c = 0; c < 6; c++) {
    let p = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 6; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 7; k++) M[r][k] -= f * M[c][k]; }
  }
  const k = M.map((r, i) => r[6] / r[i]);
  return (x, y) => k[0] + k[1] * x + k[2] * y + k[3] * x * x + k[4] * x * y + k[5] * y * y;
}

const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (l) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };

/**
 * Process one panel (a cut-out photo) in place: de-light, bleed edges; returns its relief height
 * (0 = flat) for the normal map.
 * @param panels [{ x, w, h }] rectangles of the atlas that hold one photo each
 */
export function prepareFabric(canvas, panels, { delight = 0.8 } = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const lum = new Float32Array(W * H), op = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    op[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    lum[i] = 0.2126 * toLin(d[i * 4]) + 0.7152 * toLin(d[i * 4 + 1]) + 0.0722 * toLin(d[i * 4 + 2]);
  }

  /* ---- de-light, per panel: remove the smooth lighting gradient (not the design) ---- */
  const LUT = new Float32Array(256); for (let c = 0; c < 256; c++) LUT[c] = toLin(c);
  for (const p of panels) {
    const xs = [], ys = [], vs = [];
    const step = Math.max(2, Math.round(Math.sqrt((p.w * p.h) / 6000)));
    for (let y = 0; y < p.h; y += step) for (let x = p.x; x < p.x + p.w; x += step) {
      const i = y * W + x;
      if (!op[i] || lum[i] < 1e-4) continue;
      xs.push((x - p.x) / p.h); ys.push(y / p.h); vs.push(Math.log(lum[i]));
    }
    if (xs.length < 50) continue;
    // robust: fit, drop the samples that are far off (prints, logos, colour blocks), refit
    let f = fitQuadratic(xs, ys, vs);
    const res = vs.map((v, i) => Math.abs(v - f(xs[i], ys[i])));
    const cut = [...res].sort((a, b) => a - b)[Math.floor(res.length * 0.6)] * 1.5 + 1e-3;
    const keep = res.map((r) => r <= cut);
    f = fitQuadratic(xs.filter((_, i) => keep[i]), ys.filter((_, i) => keep[i]), vs.filter((_, i) => keep[i]));
    // normalise to the panel's median level; a gentle correction, clamped (never flattens a design)
    const lv = xs.map((x, i) => f(x, ys[i])).sort((a, b) => a - b), mid = lv[lv.length >> 1];
    for (let y = 0; y < p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      const i = y * W + x;
      if (!d[i * 4 + 3]) continue;
      const g = Math.exp(-delight * Math.max(-0.5, Math.min(0.5, f((x - p.x) / p.h, y / p.h) - mid)));
      for (let c = 0; c < 3; c++) d[i * 4 + c] = toSrgb(LUT[d[i * 4 + c]] * g);
      lum[i] *= g;
    }
  }

  /* ---- detail relief from the photo: high-pass of log-luminance ---- */
  const L = new Float32Array(W * H);
  let mean = 0, cnt = 0;
  for (let i = 0; i < W * H; i++) if (op[i]) { mean += Math.log(lum[i] + 1e-3); cnt++; }
  mean /= cnt || 1;
  for (let i = 0; i < W * H; i++) L[i] = op[i] ? Math.log(lum[i] + 1e-3) : mean;
  const S = Math.max(1, Math.round(H / 170));                          // ~0.6 % of the photo: folds, seams
  const low = blur(L, W, H, S * 3), fine = blur(L, W, H, 1, 1);
  const rel = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) rel[i] = op[i] ? Math.max(-0.6, Math.min(0.6, fine[i] - low[i])) : 0;

  /* ---- edge bleed: soft-edged and transparent pixels take the nearest solid colour (a cut-out's
     anti-aliased rim still holds some of the backdrop, which would show as a pale fringe) ---- */
  let filled = new Uint8Array(W * H), front = [];
  for (let i = 0; i < W * H; i++) filled[i] = d[i * 4 + 3] > 245 ? 1 : 0;
  for (let i = 0; i < W * H; i++) if (!filled[i]) {
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && filled[i - 1]) || (x < W - 1 && filled[i + 1]) || (y > 0 && filled[i - W]) || (y < H - 1 && filled[i + W])) front.push(i);
  }
  for (let pass = 0; pass < 12 && front.length; pass++) {
    const next = [], done = [];
    for (const i of front) {
      if (filled[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let r = 0, g = 0, b = 0, k = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && filled[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; k++; }
      }
      if (!k) continue;
      d[i * 4] = r / k; d[i * 4 + 1] = g / k; d[i * 4 + 2] = b / k;
      done.push(i);
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !filled[j]) next.push(j);
    }
    for (const i of done) filled[i] = 1;
    front = next;
  }
  ctx.putImageData(img, 0, 0);

  /* ---- normal map (tangent space; rows go down = +v, as the texture is uploaded without flip) ---- */
  const nc = document.createElement('canvas');
  nc.width = W; nc.height = H;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(W, H), nd = nimg.data;
  const k = 3.2;                                                          // relief strength
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const dx = (rel[y * W + Math.min(W - 1, x + 1)] - rel[y * W + Math.max(0, x - 1)]) * k;
    const dy = (rel[Math.min(H - 1, y + 1) * W + x] - rel[Math.max(0, y - 1) * W + x]) * k;
    const l = Math.hypot(dx, dy, 1);
    nd[i * 4] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    nd[i * 4 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);            // +v runs down the image
    nd[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    nd[i * 4 + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  return nc;
}

/* ================================================================ materials */

/** weave families by material word (the AI's label) */
const WEAVE = {
  denim: 1, chambray: 1, twill: 1, chino: 1, gabardine: 1,
  cotton: 3, linen: 3, poplin: 3, canvas: 3, oxford: 3, polyester: 3, nylon: 3,
  jersey: 2, knit: 2, spandex: 2, lycra: 2, rayon: 2, modal: 2, viscose: 2,
  silk: 4, satin: 4, chiffon: 4,
  wool: 5, fleece: 5, cashmere: 5, velvet: 5, corduroy: 5, terry: 5,
  leather: 6, suede: 6, vinyl: 6,
};
/** [roughness, sheen, sheen roughness] */
const BRDF = { 1: [0.9, 0.3, 0.7], 2: [0.85, 0.45, 0.6], 3: [0.82, 0.35, 0.65], 4: [0.38, 0.6, 0.3], 5: [0.96, 0.85, 0.8], 6: [0.5, 0.05, 0.5] };
/** threads (or knit loops) per metre across u, v — real densities */
const DENSITY = { 1: [2600, 2600], 2: [1300, 1500], 3: [3200, 3200], 4: [6000, 6000], 5: [900, 900], 6: [700, 700] };

const WEAVE_GLSL = /* glsl */ `
uniform int uWeave; uniform vec2 uMetres; uniform vec2 uDensity; uniform float uInner;
float fh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fn2(vec2 x) { vec3 p = vec3(x, 0.37); vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh3(i), fh3(i + vec3(1,0,0)), f.x), mix(fh3(i + vec3(0,1,0)), fh3(i + vec3(1,1,0)), f.x), f.y); }
// relief height (0…1) and tone multiplier of the weave at metric position m (metres)
vec2 weave(vec2 m) {
  vec2 t = m * uDensity;                                  // thread coordinates
  float fw = clamp(max(length(fwidth(t)) - 0.35, 0.0) * 1.2, 0.0, 1.0);   // 0 = resolved, 1 = sub-pixel
  float h = 0.5, tone = 1.0;
  if (uWeave == 1) {                                        // 3/1 twill: diagonal wales + warp slubs
    float d = fract((t.x + t.y) * 0.25);
    h = smoothstep(0.1, 0.45, d) * (1.0 - smoothstep(0.55, 0.9, d));
    float slub = fn2(vec2(m.x * 1400.0, m.y * 35.0)) * 0.7 + fn2(vec2(m.x * 3100.0, m.y * 90.0)) * 0.3;
    tone = 0.9 + 0.2 * slub;                                // indigo warp: streaks along the leg
  } else if (uWeave == 2) {                                 // jersey: columns of V loops
    vec2 c = fract(t) - 0.5;
    h = 1.0 - smoothstep(0.0, 0.5, abs(abs(c.x) * 2.0 - 0.5 + c.y * 0.6));
    tone = 0.96 + 0.08 * fn2(m * 900.0);                    // heather
  } else if (uWeave == 3) {                                 // plain weave
    vec2 c = sin(t * 3.14159);
    h = 0.5 + 0.5 * c.x * c.y;
    tone = 0.97 + 0.06 * fn2(vec2(m.x * 2500.0, m.y * 60.0));
  } else if (uWeave == 4) {                                 // satin: long floats along the warp
    h = 0.5 + 0.5 * sin(t.x * 3.14159) * 0.6;
    tone = 1.0;
  } else if (uWeave == 5) {                                 // wool / fleece pile
    h = fn2(t * 1.3) * 0.6 + fn2(t * 3.1) * 0.4;
    tone = 0.93 + 0.14 * fn2(m * 400.0);
  } else if (uWeave == 6) {                                 // leather grain
    vec2 c = t * 1.7;
    h = 1.0 - pow(abs(fn2(c) - 0.5) * 2.0, 0.6);
    tone = 0.95 + 0.1 * fn2(m * 250.0);
  }
  return vec2(mix(h, 0.5, fw), tone);
}`;

/**
 * @param opts { map, normalMap, material (label), metresPerUV: [mu, mv], inner: bool }
 */
export function createFabricMaterial({ map, normalMap, material, metresPerUV = [1, 1], inner = false }) {
  const key = String(material || '').toLowerCase().split(/[^a-z]+/).find((w) => WEAVE[w]);
  const kind = key ? WEAVE[key] : 3;
  const [rough, sheen, sheenRough] = BRDF[kind];
  const uniforms = {
    uWeave: { value: kind },
    uMetres: { value: new THREE.Vector2(...metresPerUV) },
    uDensity: { value: new THREE.Vector2(...DENSITY[kind]) },
    uInner: { value: inner ? 1 : 0 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    normalMap: inner ? null : normalMap,
    normalScale: new THREE.Vector2(1, 1),
    alphaTest: 0.5,
    roughness: rough,
    metalness: 0,
    specularIntensity: kind === 6 ? 0.6 : kind === 4 ? 0.7 : 0.35,
    sheen,
    sheenRoughness: sheenRough,
    sheenColor: new THREE.Color('#ffffff'),
    side: THREE.FrontSide,
  });
  mat.name = inner ? 'fabric-inner' : 'fabric';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WEAVE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec2 wv = weave(vMapUv * uMetres);
diffuseColor.rgb *= wv.y;
diffuseColor.rgb *= mix(1.0, 0.5, uInner);               // the inside only sees leaked light
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * (0.9 + 0.2 * wv.x), 0.05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // weave relief as a bump on top of the photo's own relief
  float hw = wv.x * 0.00035;
  vec2 dH = vec2(dFdx(hw), dFdy(hw));
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  normal = normalize(abs(det) * normal - g);
}`)
      // fibre sheen takes the fabric's own tint (dyed fibres), lifted toward white
      .replace('#include <lights_fragment_begin>', `material.sheenColor = mix(vec3(1.0), diffuseColor.rgb * 1.6 + 0.12, 0.65) * material.sheenColor;
#include <lights_fragment_begin>`);
  };
  mat.customProgramCacheKey = () => `fabric${kind}${inner ? 'i' : 'o'}`;
  return mat;
}
