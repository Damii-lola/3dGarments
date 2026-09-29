/**
 * 3dGarments — wardrobe logic shared by the API (with AI) and the browser (local mode, no AI).
 * Pure ESM, zero dependencies.
 *
 *   photos of a group ──► per photo: cut-out + silhouette (silhouette.js) + colour signature
 *                         (+ AI description on the server)
 *                    ──► groupImages(): which photos show the same garment
 *                    ──► buildItems(): one item per garment, its body zone, category, and which
 *                        photo is its front / back / side view
 *
 * Nothing here invents garment content: the 3D garment is textured with the photos themselves,
 * and an item only gets the views that were actually photographed.
 */
import { rgbaToLab, kmeansLab } from './silhouette.js';

/** where an item is worn */
export const ZONES = ['head', 'upper', 'full', 'lower', 'feet'];

/** fine type → { category (how the 3D builder wraps it), zone } */
export const TYPES = {
  tshirt: ['top', 'upper'], shirt: ['top', 'upper'], blouse: ['top', 'upper'], polo: ['top', 'upper'],
  sweater: ['top', 'upper'], hoodie: ['top', 'upper'], sweatshirt: ['top', 'upper'], tank: ['top', 'upper'],
  crop_top: ['top', 'upper'], jersey: ['top', 'upper'], bra_top: ['top', 'upper'],
  jacket: ['outerwear', 'upper'], coat: ['outerwear', 'upper'], blazer: ['outerwear', 'upper'],
  cardigan: ['outerwear', 'upper'], vest: ['outerwear', 'upper'],
  dress: ['dress', 'full'], gown: ['dress', 'full'], kaftan: ['dress', 'full'], agbada: ['dress', 'full'],
  jumpsuit: ['jumpsuit', 'full'], romper: ['jumpsuit', 'full'],
  skirt: ['skirt', 'lower'], wrapper: ['skirt', 'lower'],
  trousers: ['pants', 'lower'], jeans: ['pants', 'lower'], leggings: ['pants', 'lower'], joggers: ['pants', 'lower'],
  chinos: ['pants', 'lower'], shorts: ['shorts', 'lower'],
  cap: ['hat', 'head'], hat: ['hat', 'head'], beanie: ['hat', 'head'], headwrap: ['hat', 'head'], gele: ['hat', 'head'],
  sneakers: ['shoes', 'feet'], shoes: ['shoes', 'feet'], boots: ['shoes', 'feet'], sandals: ['shoes', 'feet'],
  heels: ['shoes', 'feet'], slippers: ['shoes', 'feet'], loafers: ['shoes', 'feet'],
};
export const CATEGORY_ZONE = {
  top: 'upper', outerwear: 'upper', dress: 'full', jumpsuit: 'full', skirt: 'lower', pants: 'lower', shorts: 'lower', hat: 'head', shoes: 'feet',
};
/** zones an item occupies on the body (wearing a new item replaces what overlaps) */
export const OCCUPIES = { head: ['head'], upper: ['upper'], lower: ['lower'], full: ['upper', 'lower'], feet: ['feet'] };

export const VIEWS = ['front', 'back', 'side', 'detail'];
/** patterns that look the same front and back: the back may reuse the front's fabric (mirrored) */
const REPEATABLE = /^(solid|plain|striped|stripes|checked|check|plaid|gingham|ribbed|knit|denim|textured|herringbone|houndstooth)$/;

const norm = (s) => (typeof s === 'string' ? s.toLowerCase().trim().replace(/[\s-]+/g, '_') : '');

/* ------------------------------------------------------------------ */
/* Colour signature                                                    */
/* ------------------------------------------------------------------ */

/**
 * The garment's main colours (from the cut-out's opaque pixels): up to 3 clusters in Lab, each
 * with its share and an sRGB hex. Same garment in two photos → small distance.
 */
export function colorSignature(rgba, width, height) {
  const n = width * height, idx = [];
  const stride = Math.max(1, Math.floor(n / 24000));
  for (let i = 0; i < n; i += stride) if (rgba[i * 4 + 3] > 200) idx.push(i);
  if (!idx.length) return { colors: [] };
  const lab = rgbaToLab(rgba, n);
  const cl = kmeansLab(lab, idx, Math.min(3, idx.length)).filter((c) => c.count > 0);
  // mean RGB per cluster, for the hex
  const rgb = cl.map(() => [0, 0, 0, 0]);
  for (const i of idx) {
    const q = i * 3;
    let best = 0, bd = Infinity;
    cl.forEach((c, j) => { const d = (lab[q] - c.center[0]) ** 2 + (lab[q + 1] - c.center[1]) ** 2 + (lab[q + 2] - c.center[2]) ** 2; if (d < bd) { bd = d; best = j; } });
    const p = i * 4, a = rgb[best];
    a[0] += rgba[p]; a[1] += rgba[p + 1]; a[2] += rgba[p + 2]; a[3]++;
  }
  const hex = (a) => `#${[0, 1, 2].map((k) => Math.round(a[k] / Math.max(1, a[3])).toString(16).padStart(2, '0')).join('')}`;
  const total = cl.reduce((s, c) => s + c.count, 0) || 1;
  return {
    colors: cl.map((c, j) => ({ lab: c.center.map((v) => Math.round(v * 10) / 10), share: Math.round((c.count / total) * 1000) / 1000, hex: hex(rgb[j]) }))
      .sort((a, b) => b.share - a.share),
  };
}

/** 0 = same colours; ~10 = hard to tell apart; > 25 clearly different (share-weighted nearest-cluster ΔE, symmetric) */
export function colorDistance(a, b) {
  if (!a?.colors?.length || !b?.colors?.length) return 99;
  const one = (x, y) => x.colors.reduce((s, c) => s + c.share * Math.min(...y.colors.map((d) => Math.hypot(c.lab[0] - d.lab[0], c.lab[1] - d.lab[1], c.lab[2] - d.lab[2]))), 0);
  return Math.round(((one(a, b) + one(b, a)) / 2) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Per-photo features                                                  */
/* ------------------------------------------------------------------ */

/** depth of the front neckline below the collar top (garment units): fronts dip deeper than backs */
export function necklineDepth(geometry) {
  if (!geometry?.rows?.length) return 0;
  const cx = geometry.centerX;
  const covered = (r) => r.runs.some(([l, rr]) => l <= cx && rr >= cx);
  const first = geometry.rows.find((r) => r.y >= geometry.top && covered(r));
  return first ? Math.max(0, first.y - geometry.top) : 0;
}

/**
 * One photo's features.
 * @param photo { id, geometry, signature, ai? } — ai: normalized AI description (type, zone, view, …)
 */
export function photoFeatures(photo) {
  const ai = photo.ai || {};
  const type = norm(ai.type);
  const known = TYPES[type];
  const category = known?.[0] || (CATEGORY_ZONE[photo.geometry?.guess] ? photo.geometry.guess : 'top');
  const zone = ZONES.includes(norm(ai.zone)) ? norm(ai.zone) : known?.[1] || CATEGORY_ZONE[category];
  return {
    id: photo.id, type: known ? type : null, category, zone,
    view: VIEWS.includes(norm(ai.view)) ? norm(ai.view) : null,
    aspect: photo.geometry?.aspect || 1,
    neck: necklineDepth(photo.geometry),
    signature: photo.signature, ai,
  };
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

const COLOR_SAME = 14;  // ΔE-ish: photos this close (and compatible) are the same garment

/** could these two photos show the same garment? */
function compatible(a, b) {
  if (a.zone !== b.zone) return false;
  if (a.type && b.type && TYPES[a.type][0] !== TYPES[b.type][0]) return false;
  return colorDistance(a.signature, b.signature) <= COLOR_SAME;
}

/**
 * Which photos show the same garment.
 * @param feats photoFeatures[] (index = position in the group)
 * @param aiGroups optional [[i, j], [k], …] from the AI — used when it is a valid partition
 *   whose groups don't mix body zones; otherwise the deterministic grouping decides
 * @returns number[][] (indices into feats)
 */
export function groupImages(feats, aiGroups = null) {
  const n = feats.length;
  if (Array.isArray(aiGroups)) {
    const seen = new Set();
    let ok = aiGroups.every((g) => Array.isArray(g) && g.length && g.every((i) => Number.isInteger(i) && i >= 0 && i < n && !seen.has(i) && seen.add(i)));
    ok &&= seen.size === n && aiGroups.every((g) => new Set(g.map((i) => feats[i].zone)).size === 1);
    if (ok) return aiGroups.map((g) => [...g].sort((a, b) => a - b));
  }
  const parent = feats.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (compatible(feats[i], feats[j])) parent[find(j)] = find(i);
  }
  const groups = new Map();
  feats.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}

/**
 * Pick the front / back / side photos of one garment. AI view labels first; otherwise a much
 * narrower silhouette is a side view, and of two full views the deeper neckline is the front.
 */
export function assignViews(feats) {
  const views = {}, extras = [];
  const maxAspect = Math.max(...feats.map((f) => f.aspect));
  const guess = (f) => f.view || (feats.length > 1 && f.aspect < maxAspect * 0.62 && f.zone !== 'feet' ? 'side' : null);
  const labelled = feats.map((f) => ({ f, v: guess(f) }));
  for (const want of ['front', 'back', 'side']) {
    const c = labelled.filter((x) => x.v === want && !Object.values(views).includes(x.f.id));
    if (c.length) views[want] = c[0].f.id;
  }
  // unlabelled full views: deeper neckline = front
  const rest = labelled.filter((x) => !x.v && !Object.values(views).includes(x.f.id)).map((x) => x.f).sort((a, b) => b.neck - a.neck);
  for (const f of rest) {
    if (!views.front) views.front = f.id;
    else if (!views.back && f.zone !== 'feet' && f.zone !== 'head') views.back = f.id;
    else if (!views.side) views.side = f.id;
    else extras.push(f.id);
  }
  for (const f of feats) if (!Object.values(views).includes(f.id) && !extras.includes(f.id)) extras.push(f.id);
  // a garment needs a front: promote whatever there is
  if (!views.front) {
    const k = views.side ? 'side' : views.back ? 'back' : null;
    if (k) { views.front = views[k]; delete views[k]; } else if (extras.length) views.front = extras.shift();
  }
  return { views, extras };
}

/**
 * The garments of a group.
 * @param photos [{ id, geometry, signature, ai? }]
 * @param aiGroups optional AI grouping (see groupImages)
 * @param aiNames optional per-group names from the AI (same order as aiGroups)
 */
export function buildItems(photos, aiGroups = null, aiNames = null) {
  const feats = photos.map(photoFeatures);
  const groups = groupImages(feats, aiGroups);
  const usedAi = aiGroups && groups.length === aiGroups.length && groups.every((g, i) => g.join() === [...aiGroups[i]].sort((a, b) => a - b).join());
  return groups.map((g, gi) => {
    const fs = g.map((i) => feats[i]);
    // the item's type / category: the most common AI type, else the front photo's silhouette guess
    const votes = new Map();
    for (const f of fs) if (f.type) votes.set(f.type, (votes.get(f.type) || 0) + 1);
    const type = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const { views, extras } = assignViews(fs);
    const front = fs.find((f) => f.id === views.front) || fs[0];
    const category = type ? TYPES[type][0] : front.category;
    const zone = type ? TYPES[type][1] : front.zone;
    const ai = front.ai || {};
    const pattern = norm(ai.pattern) || null;
    return {
      id: `item-${gi}-${fs.map((f) => f.id).join('-')}`.slice(0, 120),
      name: (usedAi && aiNames?.[gi]) || ai.name || defaultName(category, front.signature),
      type, category, zone,
      fit: norm(ai.fit) || 'regular',
      material: norm(ai.material) || null,
      pattern,
      color: front.signature?.colors?.[0]?.hex || null,
      images: fs.map((f) => f.id),
      views, extras,
      // the back, when it wasn't photographed: the front's fabric for patterns that repeat,
      // otherwise its base colour (never a copy of a print or graphic)
      backFill: views.back ? null : (pattern && REPEATABLE.test(pattern) ? 'mirror' : 'color'),
    };
  });
}

const NAMES = { top: 'Top', outerwear: 'Jacket', dress: 'Dress', jumpsuit: 'Jumpsuit', skirt: 'Skirt', pants: 'Trousers', shorts: 'Shorts', hat: 'Hat', shoes: 'Shoes' };
function defaultName(category, sig) {
  const hex = sig?.colors?.[0]?.hex;
  return hex ? `${colorName(hex)} ${NAMES[category] || 'Garment'}` : NAMES[category] || 'Garment';
}

/** a rough colour word for a hex (only for fallback names) */
export function colorName(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.08) return l < 0.18 ? 'Black' : l > 0.85 ? 'White' : 'Grey';
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (l < 0.3 && h > 15 && h < 50) return 'Brown';
  if (h < 15 || h >= 340) return 'Red';
  if (h < 40) return l > 0.6 ? 'Peach' : 'Orange';
  if (h < 65) return 'Yellow';
  if (h < 160) return 'Green';
  if (h < 200) return 'Teal';
  if (h < 255) return l < 0.3 ? 'Navy' : 'Blue';
  if (h < 290) return 'Purple';
  return 'Pink';
}
