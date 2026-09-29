/**
 * Pose library.
 *
 * Angles are degrees in each bone's anatomical frame (see human.js):
 *   x  flex:  + swings a limb / the spine forward, + curls fingers into the palm, − bends the knee
 *   y  twist: + turns the bone's front toward the body's left (spine/head), + rotates a left arm inward
 *   z  side:  + moves a limb outward/up (abduction), − brings it in toward the body
 *
 * Poses are written ANATOMICALLY: `l` and `r` use the same meaning on both sides
 * ("outward" is outward), `both` applies to both, `c` is the centre line.
 * `buildPose()` turns that into per-bone values for the rig.
 */

const SIDE_BONES = /^(clavicle|upperarm|lowerarm|hand|thumb_0\d|index_0\d|middle_0\d|ring_0\d|pinky_0\d|thigh|calf|foot|ball)$/;

export function mirrorName(name) {
  return name.endsWith('_l') ? `${name.slice(0, -2)}_r` : name.endsWith('_r') ? `${name.slice(0, -2)}_l` : name;
}

/** { c, both, l, r, $root } → { bone: [x, y, z] } */
export function buildPose({ c = {}, both = {}, l = {}, r = {}, ...rest } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('$')) out[k] = v;
  for (const [k, v] of Object.entries(c)) out[k] = Array.isArray(v) ? [...v] : { ...v };
  const put = (side, name, v) => {
    const key = `${name}_${side}`;
    // right side = mirror image: flex stays, twist and side flip
    const mirror = (e) => (side === 'l' ? [...e] : [e[0], -e[1], -e[2]]);
    // hang specs are anatomical (Human mirrors them); only their euler `extra` needs mirroring
    out[key] = Array.isArray(v) ? mirror(v) : { ...v, ...(v.extra ? { extra: mirror(v.extra) } : {}) };
  };
  for (const [k, v] of Object.entries(both)) { put('l', k, v); put('r', k, v); }
  for (const [k, v] of Object.entries(l)) put('l', k, v);
  for (const [k, v] of Object.entries(r)) put('r', k, v);
  return out;
}

/** Plain `{ bone_l: [...] }` authoring (left side only) → both sides. */
export function sym(pose) {
  const both = {}, c = {}, extra = {};
  for (const [k, v] of Object.entries(pose)) {
    if (k.startsWith('$')) extra[k] = v;
    else if (k.endsWith('_l')) both[k.slice(0, -2)] = v;
    else if (!k.endsWith('_r')) c[k] = v;
  }
  const out = buildPose({ c, both, ...extra });
  for (const [k, v] of Object.entries(pose)) if (k.endsWith('_r')) out[k] = v;
  return out;
}

/* ---------------------------------------------------------------- hands */

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const hand = (curl, spread = 0, thumb = [0, 0, 0]) => {
  const out = {};
  FINGERS.forEach((f, i) => {
    const s = (i - 1.2) * spread;
    out[`${f}_01`] = [curl[0] + i * (curl[3] || 0), 0, s];
    out[`${f}_02`] = [curl[1] + i * (curl[3] || 0), 0, 0];
    out[`${f}_03`] = [curl[2], 0, 0];
  });
  out.thumb_01 = [thumb[0], 0, thumb[2] || 0];
  out.thumb_02 = [thumb[1], 0, 0];
  out.thumb_03 = [thumb[1] * 1.2, 0, 0];
  return out;
};

export const HANDS = {
  relaxed: { label: 'Relaxed', pose: hand([9, 20, 12, 3.5], -1.6, [8, 10, -12]) },  // fingers together, curling a little more toward the pinky; thumb along the index
  soft: { label: 'Soft', pose: hand([16, 24, 14, 4], -0.5, [10, 14, -18]) },
  open: { label: 'Open', pose: hand([2, 3, 2, 0], 5, [-5, 2, 10]) },
  fist: { label: 'Fist', pose: hand([80, 95, 60, 3], 0, [25, 40, -10]) },
  point: { label: 'Point', pose: { ...hand([80, 95, 60, 3], 0, [25, 40, -10]), index_01: [0, 0, 0], index_02: [2, 0, 0], index_03: [2, 0, 0] } },
};

const withHands = (pose, left = 'relaxed', right = left) => {
  const l = { ...HANDS[left].pose, ...(pose.l || {}) };
  const r = { ...HANDS[right].pose, ...(pose.r || {}) };
  return { ...pose, l, r };
};

/* ---------------------------------------------------------------- body poses */

// relaxed arms: collarbones dropped (no shrug); each arm HANGS — the solver in human.js points it
// down and tilts it out only as far as this body's chest, lats and hips require, so the whole
// arm stays beside the body (never swung behind it or sunk into it); soft elbow, palm to thigh
const armsDown = {
  clavicle: [0, 0, -4],
  upperarm: { hang: true, fwd: 2 },
  lowerarm: { hang: true, fwd: 10, twist: 16 },   // palm to the thigh, rolled ~15° back (a relaxed forearm)
  hand: [-8, 0, -4],                                 // back of the hand in line with the forearm; the fingers curl toward the thigh
};
// hand on the hip: abducted, rotated inward, elbow back — calibrated in the lab
const onHip = { clavicle: [0, 0, -3], upperarm: [-25, 85, -3], lowerarm: [58, 0, 0], hand: [0, 0, -20] };

export const POSES = {
  stand: {
    label: 'Relaxed',
    pose: withHands({ both: { ...armsDown, thigh: [0, 0, -6] } }),
  },
  catalog: {
    label: 'Catalogue',
    pose: withHands({ both: { ...armsDown, upperarm: { hang: true, fwd: 2, out: 2 }, lowerarm: { hang: true, fwd: 10, out: 2, twist: 18 }, thigh: [0, 0, 1.5] } }, 'soft'),
  },
  contrapposto: {
    label: 'Contrapposto',
    pose: withHands({
      c: { pelvis: [0, -4, 5], spine_01: [0, 1, -2], spine_02: [0, 3, -3], spine_03: [0, 2, -2], neck_01: [0, 0, -2], head: [-2, 4, 4] },
      l: { ...armsDown, thigh: [0, 0, -6], calf: [0, 0, 0], foot: [0, 0, 0] },
      r: { ...armsDown, lowerarm: { hang: true, fwd: 16, twist: 16 }, thigh: [9, -6, -2], calf: [-16, 0, 0], foot: [4, 0, 0] },
    }, 'relaxed', 'soft'),
  },
  hips: {
    label: 'Hands on hips',
    pose: withHands({
      c: { spine_03: [-2, 0, 0], head: [-2, 0, 0] },
      both: { ...onHip, thigh: [0, 0, 3] },
    }, 'soft'),
  },
  onehip: {
    label: 'One hand on hip',
    pose: withHands({
      c: { pelvis: [0, -3, 4], spine_02: [0, 3, -3], spine_03: [0, 2, -2], head: [-3, 6, 5] },
      l: { ...onHip, thigh: [0, 0, -5] },
      r: { ...armsDown, thigh: [7, -5, -1], calf: [-12, 0, 0], foot: [3, 0, 0] },
    }, 'soft', 'relaxed'),
  },
  walk: {
    label: 'Walking',
    pose: withHands({
      c: { pelvis: [0, 6, 0], spine_02: [2, -4, 0], spine_03: [0, -3, 0], head: [-2, 1, 0] },
      l: { upperarm: [-30, -12, -40], lowerarm: [14, 40, 0], thigh: [26, 0, 0], calf: [-8, 0, 0], foot: [-6, 0, 0] },
      r: { upperarm: [10, -18, -39], lowerarm: [28, 40, 0], thigh: [-16, 0, 0], calf: [-22, 0, 0], foot: [14, 0, 0] },
    }, 'relaxed'),
  },
  stride: {
    label: 'Power stance',
    pose: withHands({
      c: { spine_03: [-3, 0, 0], head: [-3, 0, 0] },
      both: { ...onHip, thigh: [0, 0, 9], calf: [0, 0, 0], foot: [0, 0, -6] },
    }, 'fist'),
  },
  thinking: {
    label: 'Hand to chin',
    pose: withHands({
      c: { spine_02: [3, 0, 0], head: [4, -4, 3] },
      l: { upperarm: [5, 40, -42], lowerarm: [95, 30, 0], hand: [0, 0, 0] },
      r: { upperarm: [55, 30, -28], lowerarm: [135, 0, 0], hand: [-15, 0, 10], thigh: [4, 0, -2] },
    }, 'soft', 'soft'),
  },
  shoulder: {
    label: 'Over the shoulder',
    pose: withHands({
      c: { pelvis: [0, -8, 0], spine_01: [0, -6, 0], spine_02: [0, -8, 0], spine_03: [0, -8, 0], neck_01: [0, -15, 0], head: [-2, -25, -3] },
      both: { ...armsDown },
      r: { ...armsDown, thigh: [6, 0, 0], calf: [-10, 0, 0] },
    }),
  },
  tpose: {
    label: 'T-pose',
    pose: withHands({ both: { upperarm: [0, 0, 44], lowerarm: [0, 0, 0] } }, 'open'),
  },
  apose: { label: 'A-pose', pose: {} },
};

export const DEFAULT_POSE = 'stand';
export const DEFAULT_HANDS = 'relaxed';

/**
 * Compose a preset with per-joint user offsets (added on top) and a hand shape.
 * @param preset  key of POSES
 * @param adjust  { bone: [x, y, z] } anatomical offsets for l/r via `l`/`r`/`c` like buildPose
 * @param hands   optional key of HANDS to override the preset's hands (both sides)
 */
export function composePose(preset, adjust = {}, hands = null) {
  const p = POSES[preset]?.pose || {};
  const merged = { c: { ...(p.c || {}) }, both: { ...(p.both || {}) }, l: { ...(p.l || {}) }, r: { ...(p.r || {}) } };
  // expand `both` into l/r so offsets and hand overrides apply per side
  for (const [k, v] of Object.entries(merged.both)) { merged.l[k] ??= v; merged.r[k] ??= v; }
  merged.both = {};
  if (hands && HANDS[hands]) for (const side of ['l', 'r']) Object.assign(merged[side], HANDS[hands].pose);
  const sum = (a = [0, 0, 0], b = [0, 0, 0]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  // offsets on a hanging limb ride on top of the solved hang
  const add = (a, b) => (a && !Array.isArray(a) ? { ...a, extra: sum(a.extra, b) } : sum(a, b));
  for (const g of ['c', 'l', 'r']) for (const [k, v] of Object.entries(adjust[g] || {})) merged[g][k] = add(merged[g][k], v);
  return buildPose(merged);
}

export const isSideBone = (n) => SIDE_BONES.test(n);
