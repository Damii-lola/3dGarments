/**
 * The template catalogue: one entry per garment type. Each says
 *   cut(body)      where it ends on this body (hem height, sleeve length…) — from the body's landmarks
 *   torso / sleeve how it stands off the body (ease, how straight it falls, the sleeve's tube)
 *   paint(prep)    its DEFAULT texture in the shared layout (frame.js): alpha = where the fabric is, RGB = the look
 *   hides(prep)    the body skin it covers (drawn under it, never through it)
 *   layer          1 next to the skin … higher = worn over lower
 */
import { ATLAS, RECT, smooth } from './frame.js';

/* ------------------------------------------------------------------ painting helpers */

function canvas2(w = ATLAS, h = ATLAS) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * Paint each panel texel by `fn(info) → [r, g, b, a] | null`, where info tells what the texel is on the body:
 *   torso: { part: 'front'|'back', u, v, y, th, p: [x, y, z] }   sleeve: { part: 'sleeveR'|'sleeveL', u (around), v (along), along }
 */
function paintPanels(prep, fn) {
  const c = canvas2(), x = c.getContext('2d', { willReadFrequently: true }), img = x.createImageData(ATLAS, ATLAS), d = img.data;
  const { torso, arms, body } = prep;
  const put = (px, py, col) => { if (!col) return; const o = (py * ATLAS + px) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = col[3] ?? 255; };
  if (torso) for (const [part, rect] of [['front', RECT.torsoFront], ['back', RECT.torsoBack]]) {
    for (let j = 0; j < rect[3]; j++) {
      const v = (j + 0.5) / rect[3], y = body.yOfV(v);
      if (y > torso.rows[0] || y < torso.rows[torso.rows.length - 1]) continue;
      const H = torso.halves(y)[part];
      for (let i = 0; i < rect[2]; i++) {
        const u = (i + 0.5) / rect[2], th = torso.thOfU(H, u);
        put(rect[0] + i, rect[1] + j, fn({ part, u, v, y, th, p: torso.at(th, y) }));
      }
    }
  }
  for (const [side, rect] of [['r', RECT.sleeveR], ['l', RECT.sleeveL]]) {
    const A = arms[side]; if (!A) continue;
    for (let i = 0; i < rect[2]; i++) {
      const v = (i + 0.5) / rect[2], along = A.aOfV(v);
      for (let j = 0; j < rect[3]; j++) put(rect[0] + i, rect[1] + j, fn({ part: side === 'r' ? 'sleeveR' : 'sleeveL', u: (j + 0.5) / rect[3], v, along }));
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ men's plain crew neck tee */

const TEE_WHITE = [242, 242, 239];

const teeCrew = {
  id: 'men/tee_crew', name: 'Plain crew neck tee', sex: 'male', category: 'tshirt', layer: 2,
  cut: (body) => {
    const L = body.L;
    return {
      hemY: L.crotch + 0.035,                                  // just above the crotch: covers the waistband, a regular length
      sleeveEnd: 0.62 * body.joint('upperarm_r').distanceTo(body.joint('lowerarm_r')),   // mid upper arm
      neck: body.neck, neckBase: L.neckBase,
    };
  },
  torso: {
    // regular fit: ~1 cm off the chest at the sides, ~2 cm front and back; it sits on the shoulders and the neck
    ease: (th, y, L) => {
      const full = 0.003 + 0.005 * Math.cos(th) ** 2;
      if (y >= L.neckBase) return 0.001;
      return 0.002 + (full - 0.002) * smooth(L.neckBase, L.shoulder - 0.05, y) ** 0.7;
    },
    fall: 0.15,                                                 // it comes in under the chest only gently (no cling to the waist)
    cap: 0.09,                                                 // the shoulder runs on over the top of the deltoid
  },
  sleeve: {
    // a short sleeve: a straight, open tube — as wide as the arm's widest point under it (the deltoid, the biceps) plus
    // ease, never narrowing toward its hem
    start: -0.04,                                              // it starts inside the torso's shoulder (overlapping it)
    // a short sleeve: a straight, open tube round the upper arm — its radius the arm's widest under the sleeve (past
    // the cap), the same all along, plus ease (more underneath: it hangs open)
    shape: (bins, NA, gap) => {
      let rMax = 0;
      for (const b of bins) if (b.along > 0.06) { let m = 0; for (const r of b.R) m += r / NA; rMax = Math.max(rMax, m); }
      // its root comes out of the shoulder: from the arm's own surface (under the torso's cap) out to the tube by 9 cm
      // along; past that the tube, flaring a little to its hem
      return bins.map((b) => {
        const t = smooth(0.05, 0.11, b.along), flare = Math.max(0, b.along - 0.1) * 0.06;
        return Float64Array.from({ length: NA }, (_, a) => {
          const under = Math.max(0, -Math.cos((a / NA) * Math.PI * 2)), tube = rMax + gap + 0.008 + flare + 0.01 * under;
          // (inside the torso's shoulder at first — it comes out from under it, no edge)
          return (b.R[a] + gap - 0.004) * (1 - t) + Math.max(tube, b.R[a] + gap + 0.004) * t;
        });
      });
    },
  },
  /** the crew neck's line: a curve round the neck, low at the front, just under the nape at the back */
  neckY(prep, p) {
    const { cut } = prep, t = Math.atan2(p[0] - cut.neck.x, p[2] - cut.neck.z), c = Math.cos(t);
    return cut.neckBase + 0.016 - 0.062 * ((1 + c) / 2) ** 3 - 0.012 * ((1 - c) / 2) ** 3;
  },
  paint(prep) {
    const { cut } = prep, self = teeCrew;
    seed = 7;
    return paintPanels(prep, (t) => {
      const knit = 1 + (rnd() - 0.5) * 0.035;
      const col = (k, add = 0) => [TEE_WHITE[0] * k * knit + add, TEE_WHITE[1] * k * knit + add, TEE_WHITE[2] * k * knit + add, 255];
      if (t.part === 'front' || t.part === 'back') {
        const top = self.neckY(prep, t.p), below = top - t.y, up = t.y - cut.hemY;
        if (below < 0 || up < 0) return null;
        // the rib neckband: 18 mm, fine vertical ribs, a seam under it
        if (below < 0.018) { const rib = Math.sin(t.u * (t.part === 'front' ? 900 : 700)) > 0 ? 0.985 : 0.95; return col(rib * (below < 0.002 ? 0.93 : 1)); }
        if (below < 0.0215) return col(below < 0.0195 ? 0.88 : 0.97);
        // the hem: turned up 22 mm, its topstitching (two rows), the fold's shade at the very edge
        if (up < 0.003) return col(0.9);
        if (Math.abs(up - 0.022) < 0.0008 || Math.abs(up - 0.0285) < 0.0008) return col(0.9);
        // the side seams
        if (t.u < 0.004 || t.u > 0.996) return col(0.93);
        return col(1);
      }
      if (t.along > cut.sleeveEnd || t.along < 0.01) return null;   // (the top of its start under the shoulder)     // (it starts under the torso's shoulder)
      const end = cut.sleeveEnd - t.along;
      if (end < 0.003) return col(0.9);
      if (Math.abs(end - 0.022) < 0.0008 || Math.abs(end - 0.0285) < 0.0008) return col(0.9);
      if (Math.abs(t.u - 0.5) < 0.004) return col(0.93);                   // the underarm seam
      return col(1);
    });
  },
  hides(prep) {
    const { body, cut, arms } = prep, { Q, n, region, skin } = body, out = new Set();
    for (let i = 0; i < n; i++) {
      if (!skin(i)) continue;
      const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2], r = region[i];
      if (r === 'torso' || r.startsWith('leg')) {
        if (y > cut.hemY + 0.02 && y < teeCrew.neckY(prep, [x, y, z]) - 0.02) out.add(i);
      } else if (r.startsWith('arm')) {
        const A = arms[r.slice(4)]; if (!A) continue;
        const [along] = A.frame(x, y, z);
        if (along < cut.sleeveEnd - 0.02) out.add(i);
      }
    }
    return out;
  },
};

export const TEMPLATES = { [teeCrew.id]: teeCrew };
