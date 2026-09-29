/**
 * One synthetic flat-lay "photo" (SVG, 1000 × 1000, on a textured backdrop with a drop shadow) for
 * EVERY garment type in shared/wardrobe.js TYPES — used to test the whole pipeline on each kind of
 * clothing: cut-out, measurements, grouping, and the 3D fit (render harness).
 *
 *   CATALOG[type] = { name, svg, fit, material, pattern }
 */

const backdrop = (id, a = '#ece7df', b = '#d5cdc0') => `
  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <pattern id="grain${id}" width="120" height="1000" patternUnits="userSpaceOnUse">
      <line x1="119" y1="0" x2="119" y2="1000" stroke="#000" stroke-opacity="0.05" stroke-width="2"/>
      <line x1="50" y1="0" x2="54" y2="1000" stroke="#fff" stroke-opacity="0.05" stroke-width="6"/>
    </pattern>
    <filter id="sh${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="noise${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.10 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <linearGradient id="fold${id}" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg${id})"/>
  <rect width="1000" height="1000" fill="url(#grain${id})"/>`;

/** fabric fills */
const FILL = {
  solid: (id, c) => `<rect width="1000" height="1000" fill="${c}"/>`,
  stripes: (id, c, c2) => `<defs><pattern id="st${id}" width="1000" height="36" patternUnits="userSpaceOnUse"><rect width="1000" height="36" fill="${c}"/><rect width="1000" height="12" fill="${c2}"/></pattern></defs><rect width="1000" height="1000" fill="url(#st${id})"/>`,
  vstripes: (id, c, c2) => `<defs><pattern id="vs${id}" width="30" height="1000" patternUnits="userSpaceOnUse"><rect width="30" height="1000" fill="${c}"/><rect width="4" height="1000" fill="${c2}"/></pattern></defs><rect width="1000" height="1000" fill="url(#vs${id})"/>`,
  check: (id, c, c2) => `<defs><pattern id="ck${id}" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="${c}"/><rect width="60" height="20" fill="${c2}" opacity="0.55"/><rect width="20" height="60" fill="${c2}" opacity="0.55"/></pattern></defs><rect width="1000" height="1000" fill="url(#ck${id})"/>`,
  dots: (id, c, c2) => `<defs><pattern id="dt${id}" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="${c}"/><circle cx="11" cy="11" r="5" fill="${c2}"/><circle cx="33" cy="33" r="5" fill="${c2}"/></pattern></defs><rect width="1000" height="1000" fill="url(#dt${id})"/>`,
  ankara: (id, c, c2, c3) => `<defs><pattern id="ak${id}" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="${c}"/><circle cx="60" cy="60" r="38" fill="${c2}"/><circle cx="60" cy="60" r="22" fill="${c3}"/><circle cx="60" cy="60" r="9" fill="${c}"/><circle cx="0" cy="0" r="18" fill="${c3}"/><circle cx="120" cy="0" r="18" fill="${c3}"/><circle cx="0" cy="120" r="18" fill="${c3}"/><circle cx="120" cy="120" r="18" fill="${c3}"/></pattern></defs><rect width="1000" height="1000" fill="url(#ak${id})"/>`,
  denim: (id, c) => `<defs><pattern id="dn${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" fill="${c}"/><rect width="8" height="3" fill="#fff" fill-opacity="0.07"/></pattern></defs><rect width="1000" height="1000" fill="url(#dn${id})"/>`,
  knit: (id, c) => `<defs><pattern id="kn${id}" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="14" height="10" fill="${c}"/><path d="M0 0 L7 10 L14 0" stroke="#000" stroke-opacity="0.12" fill="none" stroke-width="2"/></pattern></defs><rect width="1000" height="1000" fill="url(#kn${id})"/>`,
};

/** a flat-laid garment: outline path, fabric, extra details drawn on top (clipped) and over */
function garment(id, d, fill, inner = '', over = '', bg = null) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  ${bg ? backdrop(id, ...bg) : backdrop(id)}
  <defs><clipPath id="c${id}"><path d="${d}"/></clipPath></defs>
  <path d="${d}" transform="translate(12 18)" fill="#000" opacity="0.3" filter="url(#sh${id})"/>
  <g clip-path="url(#c${id})">
    ${fill}
    <rect width="1000" height="1000" fill="url(#fold${id})"/>
    <rect width="1000" height="1000" fill="#fff" filter="url(#noise${id})"/>
    ${inner}
  </g>
  ${over}
</svg>`;
}

const stitch = (d, c = '#000', o = 0.35) => `<path d="${d}" stroke="${c}" stroke-opacity="${o}" stroke-width="3" fill="none" stroke-dasharray="8 6"/>`;
const line = (d, c = '#000', w = 3, o = 0.4) => `<path d="${d}" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}" fill="none"/>`;
const buttons = (x, y0, y1, n, c = '#eee') => Array.from({ length: n }, (_, i) => `<circle cx="${x}" cy="${y0 + ((y1 - y0) * i) / Math.max(1, n - 1)}" r="8" fill="${c}" stroke="#000" stroke-opacity="0.3"/>`).join('');

/**
 * Upper-body outline, symmetric about x = 500.
 * sleeve: 'short' | 'long' | 'three' (3/4) | 'wide' | 'none' | 'cap'
 */
function top({ half = 200, top: T = 150, nw = 90, nd = 70, ya = 360, hem = 740, flare = 0, sleeve = 'short', drop = 26, strap = 0, sl = 1 }) {
  const L = [], R = [];
  const sx = 500 - half - 10, sy = T + drop;                            // shoulder tip
  if (sleeve === 'none') {
    const so = 500 - nw - (strap || 70);                                 // strap outer edge
    L.push(`${so} ${T + 4}`, `${500 - half + 8} ${ya - 40}`, `${500 - half} ${ya}`);
  } else if (sleeve === 'cap') {
    L.push(`${sx} ${sy}`, `${sx - 40} ${sy + 60}`, `${500 - half} ${ya}`);
  } else {
    const len = { short: 250, three: 420, long: 560, wide: 470 }[sleeve] * sl;
    const ang = sleeve === 'wide' ? 0.95 : sleeve === 'short' ? 0.8 : 1.12;    // radians from horizontal-out
    const dx = -Math.cos(ang), dy = Math.sin(ang);
    const cw = { short: 150, three: 110, long: 95, wide: 330 }[sleeve];  // cuff width
    const ex = sx + dx * len, ey = sy + dy * len;
    const nx = dy, ny = -dx;                                             // toward the underarm
    L.push(`${sx} ${sy}`, `${Math.round(ex)} ${Math.round(ey)}`, `${Math.round(ex + nx * cw)} ${Math.round(ey + ny * cw)}`, `${500 - half} ${ya}`);
  }
  L.push(`${500 - half - flare} ${hem}`);
  for (const p of [...L].reverse()) { const [x, y] = p.split(' ').map(Number); R.push(`${1000 - x} ${y}`); }
  const neckL = `${500 - nw} ${T}`, neckR = `${500 + nw} ${T}`;
  return `M${neckL} L${L.join(' L')} L${R.join(' L')} L${neckR} Q500 ${T + nd * 2} ${neckL} Z`;
}

/** trousers / shorts: waist, hips, crotch, legs */
function pants({ top: T = 96, w = 182, hip = 20, crotch = 392, hem = 944, legTop = 200, legBot = 170, inset = 3 }) {
  const lo = 500 - w - hip, ro = 500 + w + hip;
  return `M${500 - w} ${T} L${500 + w} ${T} L${ro} ${T + 200} L${500 + legBot + (legTop - legBot) * 0 + 18 + (ro - 500 - 18 - legTop) } ${hem} L${500 + inset + 45} ${hem} L${500 + inset} ${crotch} L${500 - inset} ${crotch} L${500 - inset - 45} ${hem} L${lo - (lo - (500 - 18 - legTop)) } ${hem} L${lo} ${T + 200} Z`
    .replace(/L(\d+(\.\d+)?) (\d+) L(\d+(\.\d+)?) (\d+) L/, (m) => m);
}
/** a cleaner trouser outline: leg outer edge from the hip to the hem, leg width at the hem */
function trouser({ top: T = 96, w = 182, hipOut = 18, crotch = 392, hem = 944, hemW = 170, gap = 6 }) {
  const oL = 500 - w - hipOut, oR = 500 + w + hipOut;
  const hemOutL = 500 - gap - hemW - 20, hemInL = 500 - gap - 20;
  return `M${500 - w} ${T} L${500 + w} ${T} L${oR} ${T + 200} L${1000 - hemOutL} ${hem} L${1000 - hemInL} ${hem} L${500 + gap} ${crotch} L${500 - gap} ${crotch} L${hemInL} ${hem} L${hemOutL} ${hem} L${oL} ${T + 200} Z`;
}

/** hats (front view) and shoes (side view, toe to the right) */
const SHAPES = {
  cap: 'M300 520 Q300 300 500 290 Q700 300 700 520 L860 540 Q870 580 820 585 L300 585 Z',
  hat: 'M170 600 Q170 560 330 552 L350 360 Q500 320 650 360 L670 552 Q830 560 830 600 Q830 640 500 640 Q170 640 170 600 Z',
  beanie: 'M300 640 L300 420 Q300 260 500 250 Q700 260 700 420 L700 640 Z',
  headwrap: 'M280 640 Q250 420 360 320 Q420 260 520 270 Q650 280 710 380 Q760 470 720 640 Q600 610 500 615 Q380 615 280 640 Z',
  gele: 'M200 620 Q230 470 300 420 Q260 330 360 300 Q420 200 520 240 Q640 190 690 290 Q800 320 760 420 Q830 500 800 620 Q640 590 500 598 Q340 590 200 620 Z',
  sneakers: 'M130 640 L130 560 Q140 470 250 450 L400 430 Q470 420 520 450 L640 520 Q760 540 840 580 Q880 600 870 640 L870 680 L130 680 Z',
  shoes: 'M140 650 L150 570 Q170 520 260 515 L420 505 Q500 505 560 540 L700 570 Q820 590 860 630 L860 665 L140 665 Z',
  boots: 'M200 670 L210 360 Q210 300 300 300 L420 300 Q450 330 440 420 L450 520 Q520 560 700 580 Q820 600 850 640 L850 690 L200 690 Z',
  sandals: 'M140 660 L140 630 L860 620 L860 660 Z M260 630 Q300 560 380 555 L420 630 Z M500 628 Q560 540 660 560 L680 624 Z',
  heels: 'M170 700 L190 600 Q200 480 280 470 L360 480 Q400 520 460 560 L650 620 Q800 640 840 680 L840 700 L630 700 L300 610 L260 700 Z',
  slippers: 'M140 650 Q140 610 200 600 L420 590 Q520 540 640 560 Q780 580 850 630 L860 660 L140 660 Z',
  loafers: 'M140 655 L145 585 Q160 540 250 535 L440 525 Q520 520 580 550 L720 580 Q830 600 860 635 L860 668 L140 668 Z',
};

const G = (id, d, fill, inner, over, bg) => garment(id, d, fill, inner, over, bg);
/** light garments are shot on a darker surface (grey linen), as a seller would */
const DARK = ['#8d8a86', '#6f6c68'];
const ID = (() => { let i = 0; return () => `g${++i}`; })();

function make() {
  const C = {};
  const add = (type, name, extra, svgFn) => { const id = ID(); C[type] = { name, ...extra, svg: svgFn(id) }; };

  /* ---------------- tops ---------------- */
  add('tshirt', 'White graphic tee', { fit: 'regular', material: 'cotton jersey', pattern: 'graphic' }, (id) => {
    const d = top({ nw: 74, nd: 52 });
    return G(id, d, FILL.solid(id, '#f2f0ea'), `<circle cx="500" cy="420" r="80" fill="none" stroke="#1d3c78" stroke-width="14"/><text x="500" y="445" font-family="Arial Black,Arial" font-weight="900" font-size="70" fill="#c8102e" text-anchor="middle">NYC</text>`,
      stitch('M300 725 L700 725') + line(`M410 150 Q500 ${150 + 140} 590 150`, '#bbb', 14, 1), DARK);
  });
  add('shirt', 'Blue striped shirt', { fit: 'regular', material: 'cotton poplin', pattern: 'striped' }, (id) => {
    const d = top({ sleeve: 'long', nw: 60, nd: 28, hem: 780, drop: 30 });
    return G(id, d, FILL.vstripes(id, '#dfe8f5', '#4f79b8'), `<rect x="488" y="160" width="24" height="620" fill="#fff" opacity="0.5"/>${buttons(500, 200, 740, 7)}`,
      `<path d="M440 150 L500 205 L470 240 L420 170 Z M560 150 L500 205 L530 240 L580 170 Z" fill="#e9eef7" stroke="#8aa" stroke-width="2"/>`);
  });
  add('blouse', 'Silk blouse', { fit: 'loose', material: 'silk', pattern: 'solid' }, (id) => {
    const d = top({ sleeve: 'three', nw: 80, nd: 110, hem: 720, flare: 20 });
    return G(id, d, FILL.solid(id, '#e8b4b8'), line('M500 370 L500 720', '#000', 2, 0.15), '');
  });
  add('polo', 'Green polo', { fit: 'regular', material: 'cotton pique', pattern: 'solid' }, (id) => {
    const d = top({ nw: 62, nd: 25 });
    return G(id, d, FILL.knit(id, '#1f6b4a'), `<rect x="485" y="170" width="30" height="130" fill="#fff" opacity="0.12"/>${buttons(500, 200, 280, 3, '#ddd')}`,
      `<path d="M438 150 L500 190 L480 220 L425 165 Z M562 150 L500 190 L520 220 L575 165 Z" fill="#1a5a3e" stroke="#0e3" stroke-opacity="0.2"/>`);
  });
  add('sweater', 'Grey knit sweater', { fit: 'regular', material: 'wool knit', pattern: 'knit' }, (id) => {
    const d = top({ sleeve: 'long', nw: 75, nd: 30, hem: 760, half: 215 });
    return G(id, d, FILL.knit(id, '#8c8f94'), `<rect x="0" y="720" width="1000" height="40" fill="#000" opacity="0.1"/>`, line('M425 150 Q500 210 575 150', '#555', 12, 0.5));
  });
  add('hoodie', 'Black hoodie', { fit: 'loose', material: 'cotton fleece', pattern: 'solid' }, (id) => {
    const d = top({ sleeve: 'long', nw: 70, nd: 30, hem: 770, half: 225 });
    return G(id, d, FILL.solid(id, '#26272b'), `<path d="M390 560 L610 560 L640 700 L360 700 Z" fill="#000" opacity="0.25"/><rect y="730" width="1000" height="40" fill="#000" opacity="0.2"/>`,
      line('M470 190 L465 330 M530 190 L535 330', '#ddd', 4, 0.8));
  });
  add('sweatshirt', 'Cream sweatshirt', { fit: 'relaxed', material: 'cotton fleece', pattern: 'graphic' }, (id) => {
    const d = top({ sleeve: 'long', nw: 72, nd: 32, hem: 750, half: 220 });
    return G(id, d, FILL.solid(id, '#eadfc8'), `<text x="500" y="420" font-family="Georgia,serif" font-size="64" fill="#7a2e2e" text-anchor="middle">VARSITY</text><rect y="715" width="1000" height="35" fill="#000" opacity="0.08"/>`, line('M428 150 Q500 214 572 150', '#b9ad95', 12, 1), DARK);
  });
  add('tank', 'Ribbed tank top', { fit: 'fitted', material: 'cotton rib knit', pattern: 'ribbed' }, (id) => {
    const d = top({ sleeve: 'none', nw: 95, nd: 90, half: 185, strap: 55, ya: 330, hem: 720 });
    return G(id, d, FILL.vstripes(id, '#f4f4f4', '#d9d9d9'), '', '', DARK);
  });
  add('crop_top', 'Lilac crop top', { fit: 'fitted', material: 'cotton jersey', pattern: 'solid' }, (id) => {
    const d = top({ nw: 95, nd: 55, hem: 520, half: 190 });
    return G(id, d, FILL.solid(id, '#b9a3d6'), '', stitch('M310 505 L690 505'));
  });
  add('jersey', 'Football jersey', { fit: 'regular', material: 'polyester', pattern: 'graphic' }, (id) => {
    const d = top({ nw: 70, nd: 90, sl: 1.05 });
    return G(id, d, FILL.solid(id, '#0a7a3a'), `<rect x="0" y="330" width="1000" height="40" fill="#fff"/><text x="500" y="560" font-family="Arial Black,Arial" font-weight="900" font-size="160" fill="#fff" text-anchor="middle">10</text>`, '');
  });
  add('bra_top', 'Sports bra', { fit: 'tight', material: 'spandex', pattern: 'solid' }, (id) => {
    const d = 'M360 300 L420 300 Q500 400 580 300 L640 300 L700 430 Q700 520 690 560 L310 560 Q300 520 300 430 Z';
    return G(id, d, FILL.solid(id, '#d34a6b'), `<rect y="520" width="1000" height="40" fill="#000" opacity="0.25"/>`, '');
  });

  /* ---------------- outerwear ---------------- */
  add('jacket', 'Denim jacket', { fit: 'regular', material: 'denim', pattern: 'denim' }, (id) => {
    const d = top({ sleeve: 'long', nw: 65, nd: 30, hem: 700, half: 220 });
    return G(id, d, FILL.denim(id, '#4a6c9b'), `${line('M500 160 L500 700', '#223', 4, 0.5)}${buttons(515, 220, 660, 6, '#b8893a')}${stitch('M330 300 L470 300 M530 300 L670 300', '#d99a3a', 0.9)}<rect y="650" width="1000" height="50" fill="#000" opacity="0.12"/>`, '');
  });
  add('coat', 'Camel wool coat', { fit: 'relaxed', material: 'wool', pattern: 'solid' }, (id) => {
    const d = top({ sleeve: 'long', nw: 70, nd: 110, hem: 960, half: 215, flare: 30, top: 60, ya: 290, sl: 1.1 });
    return G(id, d, FILL.solid(id, '#b88a58'), `${line('M500 280 L500 960', '#000', 3, 0.35)}${buttons(530, 330, 640, 4, '#3a2a1a')}`, '');
  });
  add('blazer', 'Navy blazer', { fit: 'fitted', material: 'wool', pattern: 'solid' }, (id) => {
    const d = top({ sleeve: 'long', nw: 60, nd: 140, hem: 780, half: 205 });
    return G(id, d, FILL.solid(id, '#1f2a44'), `<path d="M440 150 L500 440 L520 440 L470 260 Z M560 150 L500 440 L480 440 L530 260 Z" fill="#fff" opacity="0.08"/>${buttons(512, 470, 560, 2, '#111')}<rect x="340" y="560" width="110" height="10" fill="#000" opacity="0.3"/><rect x="550" y="560" width="110" height="10" fill="#000" opacity="0.3"/>`, '');
  });
  add('cardigan', 'Cream cardigan', { fit: 'relaxed', material: 'wool knit', pattern: 'knit' }, (id) => {
    const d = top({ sleeve: 'long', nw: 60, nd: 170, hem: 760, half: 210 });
    return G(id, d, FILL.knit(id, '#e6dcc6'), `${line('M500 350 L500 760', '#000', 3, 0.3)}${buttons(515, 390, 700, 5, '#6b5a40')}`, '', DARK);
  });
  add('vest', 'Quilted vest', { fit: 'regular', material: 'polyester', pattern: 'quilted' }, (id) => {
    const d = top({ sleeve: 'none', nw: 70, nd: 40, half: 205, strap: 95, ya: 340, hem: 740 });
    return G(id, d, FILL.solid(id, '#3d4b2f'), `${Array.from({ length: 10 }, (_, i) => line(`M0 ${250 + i * 50} L1000 ${250 + i * 50}`, '#000', 3, 0.3)).join('')}${line('M500 170 L500 740', '#999', 5, 0.8)}`, '');
  });

  /* ---------------- dresses / full ---------------- */
  add('dress', 'Floral sundress', { fit: 'fitted', material: 'cotton', pattern: 'floral' }, (id) => {
    const d = 'M392 70 L440 70 Q500 190 560 70 L608 70 Q622 210 668 262 Q640 360 622 430 L748 800 L252 800 L378 430 Q360 360 332 262 Q378 210 392 70 Z';
    return G(id, d, FILL.dots(id, '#f3e6c9', '#e0554d'), `<rect x="0" y="420" width="1000" height="22" fill="#e0554d"/>`, '');
  });
  add('gown', 'Emerald evening gown', { fit: 'fitted', material: 'satin', pattern: 'solid' }, (id) => {
    const d = 'M400 60 L430 60 Q500 150 570 60 L600 60 Q620 180 650 240 Q640 330 620 420 Q650 700 790 960 L210 960 Q350 700 380 420 Q360 330 350 240 Q380 180 400 60 Z';
    return G(id, d, FILL.solid(id, '#0f5c4a'), `<ellipse cx="560" cy="650" rx="60" ry="300" fill="#fff" opacity="0.08"/>`, '');
  });
  add('kaftan', 'Printed kaftan', { fit: 'loose', material: 'cotton', pattern: 'print' }, (id) => {
    const d = top({ sleeve: 'wide', nw: 60, nd: 90, hem: 960, half: 190, top: 70, ya: 330, flare: 40, sl: 0.8 });
    return G(id, d, FILL.ankara(id, '#f2c14e', '#d1495b', '#1b4965'), `<path d="M500 110 L500 330" stroke="#1b4965" stroke-width="10"/>`, '');
  });
  add('agbada', 'Agbada', { fit: 'oversized', material: 'cotton damask', pattern: 'embroidered' }, (id) => {
    const d = 'M430 90 Q500 170 570 90 L900 180 L930 760 L620 790 L610 960 L390 960 L380 790 L70 760 L100 180 Z';
    return G(id, d, FILL.solid(id, '#e9e2d0'), `<path d="M430 100 Q500 260 570 100 L560 360 Q500 420 440 360 Z" fill="#b08d57" opacity="0.55"/><path d="M450 400 Q500 460 550 400" stroke="#b08d57" stroke-width="8" fill="none"/>`, '', DARK);
  });
  add('jumpsuit', 'Olive jumpsuit', { fit: 'regular', material: 'cotton twill', pattern: 'solid' }, (id) => {
    const d = 'M430 60 Q500 140 570 60 L680 90 L820 330 L740 380 L660 250 L680 460 L700 540 L718 960 L548 960 L503 560 L497 560 L452 960 L282 960 L300 540 L320 460 L340 250 L260 380 L180 330 L320 90 Z';
    return G(id, d, FILL.solid(id, '#5b6b3a'), `${line('M500 110 L500 520', '#000', 3, 0.3)}<rect x="330" y="430" width="340" height="18" fill="#000" opacity="0.2"/>`, '');
  });
  add('romper', 'Floral romper', { fit: 'loose', material: 'rayon', pattern: 'floral' }, (id) => {
    const d = 'M425 120 Q500 220 575 120 L660 140 L780 300 L700 350 L640 270 L660 480 L690 560 L700 760 L540 760 L503 610 L497 610 L460 760 L300 760 L310 560 L340 480 L360 270 L300 350 L220 300 L340 140 Z';
    return G(id, d, FILL.dots(id, '#2c3e70', '#f4d35e'), `<rect x="330" y="470" width="340" height="16" fill="#000" opacity="0.2"/>`, '');
  });

  /* ---------------- lower ---------------- */
  add('skirt', 'Plaid A-line skirt', { fit: 'regular', material: 'wool', pattern: 'plaid' }, (id) => {
    const d = 'M340 250 L660 250 L760 760 L240 760 Z';
    return G(id, d, FILL.check(id, '#8b1e2d', '#1d2b4f'), `<rect x="0" y="250" width="1000" height="40" fill="#000" opacity="0.25"/>`, '');
  });
  add('wrapper', 'Ankara wrapper skirt', { fit: 'regular', material: 'cotton wax print', pattern: 'print' }, (id) => {
    const d = 'M330 120 L670 120 L700 900 L300 900 Z';
    return G(id, d, FILL.ankara(id, '#1b998b', '#ed217c', '#fffd82'), line('M620 120 L660 900', '#000', 4, 0.35), '');
  });
  add('trousers', 'Black tailored trousers', { fit: 'regular', material: 'wool', pattern: 'solid' }, (id) => {
    const d = trouser({ hemW: 160 });
    return G(id, d, FILL.solid(id, '#222326'), `${line('M405 140 L400 944 M595 140 L600 944', '#fff', 2, 0.12)}<rect x="314" y="96" width="372" height="40" fill="#000" opacity="0.3"/>`, '');
  });
  add('jeans', 'Blue jeans', { fit: 'regular', material: 'denim', pattern: 'denim' }, (id) => {
    const d = trouser({ hemW: 165 });
    return G(id, d, FILL.denim(id, '#3b5f93'), `<rect x="300" y="96" width="400" height="44" fill="#1f3558"/>${stitch('M500 140 L500 360 M340 150 Q380 250 470 260 M660 150 Q620 250 530 260', '#d99a3a', 0.9)}<circle cx="500" cy="118" r="10" fill="#c9a24a"/>`, '');
  });
  add('leggings', 'Black leggings', { fit: 'tight', material: 'spandex', pattern: 'solid' }, (id) => {
    const d = trouser({ w: 150, hipOut: 10, hemW: 95, crotch: 360, gap: 4 });
    return G(id, d, FILL.solid(id, '#151517'), `<rect y="96" width="1000" height="50" fill="#fff" opacity="0.05"/>`, '');
  });
  add('joggers', 'Grey joggers', { fit: 'relaxed', material: 'cotton fleece', pattern: 'solid' }, (id) => {
    const d = trouser({ w: 190, hipOut: 22, hemW: 110, crotch: 420 });
    return G(id, d, FILL.solid(id, '#9a9ca1'), `<rect y="96" width="1000" height="60" fill="#000" opacity="0.1"/><rect y="890" width="1000" height="60" fill="#000" opacity="0.12"/>`, line('M470 110 L460 190 M530 110 L540 190', '#eee', 4, 0.9));
  });
  add('chinos', 'Khaki chinos', { fit: 'slim', material: 'cotton twill', pattern: 'solid' }, (id) => {
    const d = trouser({ w: 176, hipOut: 14, hemW: 140 });
    return G(id, d, FILL.solid(id, '#c3ab7f'), `<rect x="300" y="96" width="400" height="40" fill="#000" opacity="0.12"/>${stitch('M500 136 L500 340')}`, '');
  });
  add('shorts', 'Denim shorts', { fit: 'regular', material: 'denim', pattern: 'denim' }, (id) => {
    const d = trouser({ hem: 560, hemW: 205, crotch: 420 });
    return G(id, d, FILL.denim(id, '#6f8fbf'), `<rect x="300" y="96" width="400" height="44" fill="#3d5a86"/>${stitch('M500 140 L500 360', '#d99a3a', 0.9)}`, '');
  });

  /* ---------------- head ---------------- */
  add('cap', 'Red baseball cap', { material: 'cotton twill', pattern: 'solid' }, (id) => G(id, SHAPES.cap, FILL.solid(id, '#b3202a'), line('M500 290 L500 520', '#000', 3, 0.3) + `<circle cx="500" cy="300" r="10" fill="#000" opacity="0.3"/>`, ''));
  add('hat', 'Straw fedora', { material: 'straw', pattern: 'woven' }, (id) => G(id, SHAPES.hat, FILL.check(id, '#d8b877', '#b99650'), `<rect x="340" y="500" width="330" height="40" fill="#2a2a2a"/>`, ''));
  add('beanie', 'Mustard beanie', { material: 'wool knit', pattern: 'knit' }, (id) => G(id, SHAPES.beanie, FILL.knit(id, '#d4a017'), `<rect x="300" y="540" width="400" height="100" fill="#000" opacity="0.12"/>`, ''));
  add('headwrap', 'Silk headwrap', { material: 'silk', pattern: 'print' }, (id) => G(id, SHAPES.headwrap, FILL.stripes(id, '#6a0572', '#e9c46a'), '', ''));
  add('gele', 'Gold gele', { material: 'aso oke', pattern: 'woven' }, (id) => G(id, SHAPES.gele, FILL.vstripes(id, '#d4af37', '#8a6d1d'), `${Array.from({ length: 6 }, (_, i) => line(`M${250 + i * 90} 620 Q${300 + i * 80} 400 ${330 + i * 70} 260`, '#6b5314', 5, 0.5)).join('')}`, ''));

  /* ---------------- feet (side views, toe to the right) ---------------- */
  add('sneakers', 'White sneakers', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.sneakers, FILL.solid(id, '#f5f5f2'), `<rect y="640" width="1000" height="40" fill="#ddd"/>${line('M420 470 L560 520', '#bbb', 6, 1)}`, '', DARK));
  add('shoes', 'Brown oxford shoes', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.shoes, FILL.solid(id, '#5a3a22'), `<rect y="645" width="1000" height="20" fill="#2a1a10"/>`, ''));
  add('boots', 'Black ankle boots', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.boots, FILL.solid(id, '#1c1c1c'), `<rect y="665" width="1000" height="25" fill="#000"/>`, ''));
  add('sandals', 'Tan sandals', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.sandals, FILL.solid(id, '#b07d4f'), '', ''));
  add('heels', 'Red heels', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.heels, FILL.solid(id, '#a3151f'), '', ''));
  add('slippers', 'Grey slippers', { material: 'wool felt', pattern: 'solid' }, (id) => G(id, SHAPES.slippers, FILL.solid(id, '#8e8e93'), '', ''));
  add('loafers', 'Burgundy loafers', { material: 'leather', pattern: 'solid' }, (id) => G(id, SHAPES.loafers, FILL.solid(id, '#5c1a23'), `<rect x="430" y="535" width="120" height="14" fill="#000" opacity="0.3"/>`, ''));
  return C;
}

void pants;
export const CATALOG = make();
