/**
 * Cloth: position-based dynamics (XPBD, small steps) with distance constraints for stretch, bending
 * (across every pair of triangles) and seams, gravity, damping, and collision against a point
 * collider (the posed skin and whatever is worn underneath, each point with its outward normal).
 */

export class Cloth {
  constructor(pos) {
    this.n = pos.length / 3;
    this.x = Float32Array.from(pos);
    this.p = Float32Array.from(pos);
    this.w = new Float32Array(this.n).fill(1);
    this.groups = [];                 // { a, b, rest, alpha }
    this.near = new Int32Array(this.n).fill(-1);
    this.stick = 1;
    this.anchors = null;              // { idx: Uint32Array, t: Float32Array (xyz per anchor), k } — pulled toward t
  }

  /** a set of distance constraints; returns the group (its rest lengths may be changed later) */
  addGroup(pairs, rest, alpha) {
    const g = { a: new Uint32Array(pairs.length / 2), b: new Uint32Array(pairs.length / 2), rest: Float32Array.from(rest), alpha };
    for (let k = 0; k < g.a.length; k++) { g.a[k] = pairs[k * 2]; g.b[k] = pairs[k * 2 + 1]; }
    this.groups.push(g);
    return g;
  }

  /**
   * One frame: `sub` small steps of dt/sub.
   * @param col collider (makeCollider), thick: how far off it the cloth stays (m)
   */
  step(dt, sub, gravity, col, thick, damp = 0.995, iters = 2) {
    const h = dt / sub, { x, p, w, n } = this;
    const gy = gravity * h * h;
    if (col) this.#refresh(col);
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        if (!w[i]) continue;
        const o = i * 3;
        const vx = (x[o] - p[o]) * damp, vy = (x[o + 1] - p[o + 1]) * damp, vz = (x[o + 2] - p[o + 2]) * damp;
        p[o] = x[o]; p[o + 1] = x[o + 1]; p[o + 2] = x[o + 2];
        x[o] += vx; x[o + 1] += vy + gy; x[o + 2] += vz;
      }
      for (let it = 0; it < iters; it++) for (const g of this.groups) {
        const { a, b, rest } = g, at = g.alpha / (h * h);
        for (let k = 0; k < a.length; k++) {
          const i = a[k] * 3, j = b[k] * 3, wi = w[a[k]], wj = w[b[k]], ws = wi + wj;
          if (!ws) continue;
          const dx = x[i] - x[j], dy = x[i + 1] - x[j + 1], dz = x[i + 2] - x[j + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 1e-9) continue;
          const l = -(d - rest[k]) / (ws + at) / d;
          x[i] += dx * l * wi; x[i + 1] += dy * l * wi; x[i + 2] += dz * l * wi;
          x[j] -= dx * l * wj; x[j + 1] -= dy * l * wj; x[j + 2] -= dz * l * wj;
        }
      }
      // strain limit: woven / knit fabric gives a few percent, then stops (hard, whatever the compliance)
      for (let it = 0; it < 2; it++) for (const g of this.groups) {
        if (!g.limit) continue;
        const { a, b, rest } = g, lim = g.limit;
        for (let k = 0; k < a.length; k++) {
          const i = a[k] * 3, j = b[k] * 3, wi = w[a[k]], wj = w[b[k]], ws = wi + wj;
          if (!ws) continue;
          const dx = x[i] - x[j], dy = x[i + 1] - x[j + 1], dz = x[i + 2] - x[j + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz), max = rest[k] * lim;
          if (d <= max) continue;
          const l = -(d - max) / ws / d;
          x[i] += dx * l * wi; x[i + 1] += dy * l * wi; x[i + 2] += dz * l * wi;
          x[j] -= dx * l * wj; x[j + 1] -= dy * l * wj; x[j + 2] -= dz * l * wj;
        }
      }
      if (col) this.#collide(col, thick);
      // the floor: a long hem rests on it (and slides a little less than on skin)
      for (let i = 0; i < n; i++) {
        const o = i * 3 + 1;
        if (x[o] < thick) { x[o] = thick; x[o - 1] = p[o - 1] + (x[o - 1] - p[o - 1]) * 0.3; x[o + 1] = p[o + 1] + (x[o + 1] - p[o + 1]) * 0.3; }
      }
      if (this.anchors) {
        const { idx, t, k } = this.anchors;
        for (let q = 0; q < idx.length; q++) {
          const o = idx[q] * 3;
          x[o] += (t[q * 3] - x[o]) * k; x[o + 1] += (t[q * 3 + 1] - x[o + 1]) * k; x[o + 2] += (t[q * 3 + 2] - x[o + 2]) * k;
        }
      }
    }
  }

  #refresh(col) {
    const { x, n, near } = this;
    for (let i = 0; i < n; i++) near[i] = col.nearest(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]);
  }

  #collide(col, thick) {
    const { x, p, n, near } = this, P = col.pts, N = col.nrm;
    for (let i = 0; i < n; i++) {
      const c = near[i];
      if (c < 0) continue;
      const o = i * 3, q = c * 3;
      const d = (x[o] - P[q]) * N[q] + (x[o + 1] - P[q + 1]) * N[q + 1] + (x[o + 2] - P[q + 2]) * N[q + 2];
      if (d >= thick) continue;
      const k = thick - d;
      x[o] += N[q] * k; x[o + 1] += N[q + 1] * k; x[o + 2] += N[q + 2] * k;
      // friction: cloth resting on skin barely slides (static below ~1 mm per step, then kinetic)
      const vx = x[o] - p[o], vy = x[o + 1] - p[o + 1], vz = x[o + 2] - p[o + 2];
      const vn = vx * N[q] + vy * N[q + 1] + vz * N[q + 2];
      const tx = vx - vn * N[q], ty = vy - vn * N[q + 1], tz = vz - vn * N[q + 2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz), f = !this.stick ? 0 : tl < this.stick * k * 4 + 2e-4 ? 1 : 0.85;
      x[o] -= tx * f; x[o + 1] -= ty * f; x[o + 2] -= tz * f;
    }
  }
}

/** points + outward normals on a hash grid; nearest(x, y, z) → point index or −1 (within ~2 cells) */
export function makeCollider(pts, nrm, cell = 0.03) {
  const grid = new Map();
  const key = (a, b, c) => ((a + 1024) * 2048 + (b + 1024)) * 2048 + (c + 1024);
  const count = pts.length / 3;
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  return {
    pts, nrm, cell,
    nearest(x, y, z) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let best = -1, bd = (cell * 1.5) ** 2;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const l = grid.get(key(cx + a, cy + b, cz + c));
        if (!l) continue;
        for (const i of l) {
          const dx = pts[i * 3] - x, dy = pts[i * 3 + 1] - y, dz = pts[i * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      return best;
    },
  };
}
