/**
 * Procedural studio mannequin generated from the body model.
 */
import * as THREE from 'three';

function tube(rings, segs, ringAt, { capStart = true, capEnd = true } = {}) {
  // ringAt(i, j) -> Vector3  (i ring index, j segment index)
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= segs; j++) {
    const v = ringAt(i, j % segs);
    pos.push(v.x, v.y, v.z);
  }
  const W = segs + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ring, flip) => {
    const c = new THREE.Vector3();
    for (let j = 0; j < segs; j++) { const v = ringAt(ring, j); c.x += v.x; c.y += v.y; c.z += v.z; }
    c.divideScalar(segs);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < segs; j++) {
      const a = ring * W + j, b = ring * W + j + 1;
      flip ? idx.push(ci, b, a) : idx.push(ci, a, b);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildMannequin(body, { color = '#d8d2c8' } = {}) {
  const group = new THREE.Group();
  group.name = 'mannequin';
  const mat = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.48, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color('#ffffff'),
  });
  const add = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  const S = 96;

  // torso + neck
  const R = 110, y0 = body.torsoBottom, y1 = body.torsoTop;
  add(tube(R, S, (i, j) => {
    const y = y0 + (y1 - y0) * (i / R);
    const { rx, rz } = body.torsoRadii(y);
    const th = (j / S) * Math.PI * 2;
    return new THREE.Vector3(rx * Math.sin(th), y, rz * Math.cos(th));
  }));

  // head
  const k = body.k;
  const head = add(new THREE.SphereGeometry(1, 64, 48));
  head.scale.set(0.076 * k, 0.108 * k, 0.09 * k);
  head.position.set(0, body.L.headCenter, 0.008 * k);

  // legs
  for (const side of [-1, 1]) {
    const LR = 120, ya = 0.022 * body.H, yb = body.legTop - 0.012 * body.H;
    add(tube(LR, 64, (i, j) => {
      const y = ya + (yb - ya) * (i / LR);
      const r = body.legMeshRadius(y);
      const th = (j / 64) * Math.PI * 2;
      return new THREE.Vector3(side * body.legCenterX(y) + r * Math.sin(th), y, r * 1.03 * Math.cos(th));
    }));
    const foot = add(new THREE.SphereGeometry(1, 40, 24));
    foot.scale.set(0.043 * k, 0.03 * k, 0.118 * k);
    foot.position.set(side * body.legCenterX(0.02 * body.H), 0.026 * body.H, 0.045 * k);
  }

  // arms
  for (const side of [-1, 1]) {
    const J = body.arm.joint(side), D = body.arm.dir(side);
    const N = new THREE.Vector3(-D.y, D.x, 0), Z = new THREE.Vector3(0, 0, 1);
    const AR = 90, a0 = -0.035 * k, a1 = body.arm.length;
    add(tube(AR, 48, (i, j) => {
      const a = a0 + (a1 - a0) * (i / AR);
      const r = body.arm.radius(a) * (a < 0 ? Math.sqrt(Math.max(0, 1 - (a / a0) ** 2)) * 0.9 + 0.1 : 1);
      const th = (j / 48) * Math.PI * 2;
      return J.clone().addScaledVector(D, a).addScaledVector(N, r * Math.cos(th)).addScaledVector(Z, r * Math.sin(th));
    }));
    const hand = add(new THREE.SphereGeometry(1, 32, 24));
    hand.scale.set(0.026 * k, 0.078 * k, 0.046 * k);
    hand.position.copy(J.clone().addScaledVector(D, a1 + 0.07 * k));
    hand.rotation.z = side * (Math.PI / 2 - body.arm.angle);
  }

  return group;
}

export function buildBase() {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.36, 0.022, 96),
    new THREE.MeshPhysicalMaterial({ color: '#1b1d22', roughness: 0.25, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.2 }),
  );
  base.position.y = 0.011;
  base.receiveShadow = true;
  return base;
}

export const BASE_HEIGHT = 0.022;
