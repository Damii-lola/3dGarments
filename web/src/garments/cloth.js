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

/** points + outward normals on a grid; nearest(x, y, z) → point index or −1 (within 1.5 cells).
 *  The grid is dense over the points' box (flat arrays: the cells' start offsets and the points sorted by cell,
 *  their coordinates copied in that order) — the query runs every cloth step for every cloth point */
export function makeCollider(pts, nrm, cell = 0.03) {
  const count = pts.length / 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!count) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
  const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1, nz = Math.floor((z1 - z0) / cell) + 1;
  const cellOf = new Int32Array(count), start = new Int32Array(nx * ny * nz + 1);
  for (let i = 0; i < count; i++) {
    const c = (Math.floor((pts[i * 3] - x0) / cell) * ny + Math.floor((pts[i * 3 + 1] - y0) / cell)) * nz + Math.floor((pts[i * 3 + 2] - z0) / cell);
    cellOf[i] = c; start[c + 1]++;
  }
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1), ids = new Int32Array(count), S = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = fill[cellOf[i]]++;
    ids[k] = i; S[k * 3] = pts[i * 3]; S[k * 3 + 1] = pts[i * 3 + 1]; S[k * 3 + 2] = pts[i * 3 + 2];
  }
  const r2 = (cell * 1.5) ** 2;
  return {
    pts, nrm, cell,
    nearest(x, y, z) {
      const cx = Math.floor((x - x0) / cell), cy = Math.floor((y - y0) / cell), cz = Math.floor((z - z0) / cell);
      if (cx < -1 || cy < -1 || cz < -1 || cx > nx || cy > ny || cz > nz) return -1;
      let best = -1, bd = r2;
      const ax = Math.max(0, cx - 1), bx = Math.min(nx - 1, cx + 1), ay = Math.max(0, cy - 1), by = Math.min(ny - 1, cy + 1);
      const az = Math.max(0, cz - 1), bz = Math.min(nz - 1, cz + 1);
      for (let a = ax; a <= bx; a++) for (let b = ay; b <= by; b++) {
        const row = (a * ny + b) * nz;
        // the cells along z are contiguous: one run of points
        for (let k = start[row + az], e = start[row + bz + 1]; k < e; k++) {
          const dx = S[k * 3] - x, dy = S[k * 3 + 1] - y, dz = S[k * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
      }
      return best < 0 ? -1 : ids[best];
    },
  };
}
