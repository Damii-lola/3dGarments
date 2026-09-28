/**
 * Parametric body model. Everything in metres, y up, body faces +z.
 * The same functions drive the mannequin mesh AND garment wrapping,
 * so clothes always sit exactly on the surface you see.
 */
import * as THREE from 'three';

export const DEFAULT_BODY = { heightCm: 172, chestCm: 96, waistCm: 80, hipsCm: 98 };

export const ellipsePerimeter = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
const rxFromCirc = (c, k) => c / (Math.PI * (3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k))));

/** Monotone cubic (Fritsch–Carlson): smooth, never overshoots. */
function spline(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export function createBody(params = DEFAULT_BODY) {
  const p = { ...DEFAULT_BODY, ...params };
  const H = p.heightCm / 100;
  const k = H / 1.72;

  const chest = { rx: rxFromCirc(p.chestCm / 100, 0.7) }; chest.rz = chest.rx * 0.7;
  const waist = { rx: rxFromCirc(p.waistCm / 100, 0.76) }; waist.rz = waist.rx * 0.76;
  const hips = { rx: rxFromCirc(p.hipsCm / 100, 0.72) }; hips.rz = hips.rx * 0.72;
  const neckR = 0.057 * k;
  const shoulderRx = Math.max(0.198 * k, chest.rx * 1.1);

  const L = {
    height: H, headCenter: 0.93 * H, chin: 0.87 * H, neckBase: 0.835 * H, shoulder: 0.8 * H,
    armpit: 0.755 * H, chest: 0.72 * H, waist: 0.615 * H, hip: 0.52 * H, crotch: 0.47 * H,
    knee: 0.285 * H, ankle: 0.045 * H,
  };

  // torso cross-section control points (bottom → top)
  const T = [
    [0.458, hips.rx * 0.22, hips.rz * 0.3],
    [0.472, hips.rx * 0.6, hips.rz * 0.6],
    [0.492, hips.rx * 0.93, hips.rz * 0.94],
    [0.52, hips.rx, hips.rz],
    [0.57, (hips.rx + waist.rx) / 2 * 1.01, (hips.rz + waist.rz) / 2],
    [0.615, waist.rx, waist.rz],
    [0.67, (waist.rx + chest.rx) / 2, (waist.rz + chest.rz) / 2 * 1.02],
    [0.72, chest.rx, chest.rz],
    [0.762, chest.rx * 1.03, chest.rz * 0.98],
    [0.792, shoulderRx * 0.95, chest.rz * 0.84],
    [0.812, shoulderRx * 0.76, chest.rz * 0.64],
    [0.826, neckR * 1.55, neckR * 1.45],
    [0.842, neckR * 1.06, neckR * 1.06],
    [0.885, neckR, neckR],
  ];
  const ty = T.map((t) => t[0] * H);
  const fx = spline(ty, T.map((t) => t[1]));
  const fz = spline(ty, T.map((t) => t[2]));
  const torsoBottom = ty[0], torsoTop = ty[ty.length - 1];
  const torsoRadii = (y) => ({ rx: fx(y), rz: fz(y) });

  // legs
  const legTop = 0.515 * H;
  const legX = hips.rx * 0.47;
  const spread = THREE.MathUtils.degToRad(2.2);
  const legCenterX = (y) => legX + Math.max(0, legTop - y) * Math.tan(spread);
  const LR = [
    [0.02, 0.031], [0.045, 0.033], [0.1, 0.042], [0.16, 0.054], [0.225, 0.061], [0.285, 0.051],
    [0.34, 0.06], [0.4, 0.073], [0.46, 0.086], [0.515, 0.092],
  ];
  const legRaw = spline(LR.map((r) => r[0] * H), LR.map((r) => r[1] * k));
  const thighBoost = Math.max(1, (hips.rx * 0.52) / (0.092 * k));
  const legRadiusRaw = (y) => legRaw(y) * (y > 0.34 * H ? 1 + (thighBoost - 1) * Math.min(1, (y - 0.34 * H) / (0.175 * H)) : 1);
  const legRadius = legRadiusRaw;
  // mannequin only: tuck the top of each thigh inside the pelvis so there is no visible cap
  const legMeshRadius = (y) => {
    const t = Math.min(1, Math.max(0, (y - 0.47 * H) / (0.035 * H)));
    return legRadiusRaw(y) * (1 - 0.22 * t * t * (3 - 2 * t));
  };

  // arms (relaxed A-pose)
  const armAngle = THREE.MathUtils.degToRad(64); // below horizontal
  const armLength = 0.335 * H;
  const AR = [[0, 0.05], [0.04, 0.048], [0.16, 0.04], [0.19, 0.035], [0.24, 0.037], [0.33, 0.025], [0.335, 0.024]];
  const armRadius = spline(AR.map((r) => r[0] * H), AR.map((r) => r[1] * k));
  const arm = {
    angle: armAngle,
    length: armLength,
    radius: (a) => armRadius(Math.max(0, Math.min(armLength, a))),
    joint: (side) => new THREE.Vector3(side * shoulderRx * 0.84, 0.788 * H, -0.004 * k),
    dir: (side) => new THREE.Vector3(side * Math.cos(armAngle), -Math.sin(armAngle), 0),
  };

  /** Outer envelope used for garments: torso, and below the hips the hull around both legs. */
  const shellRadii = (y) => {
    const yc = Math.min(torsoTop, Math.max(torsoBottom, y));
    let { rx, rz } = torsoRadii(yc);
    if (y < L.hip) {
      const lr = legRadius(Math.min(y, legTop));
      rx = Math.max(rx, legCenterX(y) + lr * 1.02);
      // fabric below the hips hangs: keep the hip cross-section's proportions
      rz = Math.max(rz, lr * 1.04, rx * (hips.rz / hips.rx) * 0.94);
    }
    return { rx, rz };
  };

  // Highest point of the torso at horizontal offset |x| (shoulder line seen from the front).
  const topTable = [];
  for (let i = 0; i <= 80; i++) {
    const y = torsoTop - (i / 80) * (torsoTop - L.armpit);
    topTable.push([y, torsoRadii(y).rx]);
  }
  const supportY = (x) => {
    const ax = Math.abs(x);
    for (const [y, rx] of topTable) if (rx >= ax) return y;
    return L.armpit;
  };
  const quarterArc = (y) => { const { rx, rz } = shellRadii(y); return ellipsePerimeter(rx, rz) / 4; };

  return {
    params: p, H, k, L, chest, waist, hips, neckR, shoulderRx,
    torsoBottom, torsoTop, torsoRadii, shellRadii, quarterArc, supportY,
    legTop, legCenterX, legRadius, legMeshRadius, arm,
  };
}
