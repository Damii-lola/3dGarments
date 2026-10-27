/**
 * How a store's popup looks — defined once, used twice.
 *
 * A store customises its popup in the dashboard. What it picks is saved on the chart
 * (`size_charts.popup`), and this module is what turns that saved object into pixels,
 * in both places that draw the popup:
 *
 *   - the popup on the store's own page (size.js / main.js, `?embed=1`), and
 *   - the dashboard's preview, which is that same popup in a frame.
 *
 * Because both call applyPopupConfig(), the preview cannot drift from what a shopper
 * sees. (Before this, the preview was styled by one set of rules and the popup by none:
 * the saved settings were never read by the popup at all.)
 *
 * The saved object is data a store controls, so everything that comes out of it is
 * checked: colours must be hex, numbers are clamped, text is plain text and is set
 * with textContent, and the font is a choice from a list rather than a CSS string.
 * Nothing from the saved object is ever put into the page as markup.
 */

export const POPUP_VERSION = 2;

/** The typefaces on offer. A list, not a text box: a font a store typed would need to be loaded. */
export const FONTS = {
  default: {
    label: 'FindMySize',
    display: '"Fraunces Variable", "Fraunces", Georgia, "Times New Roman", serif',
    body: '"Instrument Sans Variable", "Instrument Sans", ui-sans-serif, system-ui, sans-serif',
  },
  serif: { label: 'Classic serif', display: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif' },
  system: {
    label: 'System',
    display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  clean: {
    label: 'Clean sans',
    display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
};

/**
 * What the popup is when a store has chosen nothing: the same card the standalone
 * /size page shows. Every value here is also the value the stylesheet falls back to,
 * so a default config changes nothing on the page.
 */
export const DEFAULTS = Object.freeze({
  v: POPUP_VERSION,
  theme: Object.freeze({
    background: '#221a15',
    text: '#f5e9d6',
    accent: '#f0521f',
    font: 'default',
    radius: 28,
    scale: 1,
  }),
  // The floating button on the store's page. Its default look is the one it has always had.
  button: Object.freeze({
    label: 'Find My Size',
    bg: '#ff6a4a',
    textColor: '#ffffff',
    radius: 13,
    side: 'right',
    float: true,
  }),
  record: Object.freeze({
    headline: 'Record one slow turn',
    instruction:
      'Turn all the way around, slowly. Stand still, whole body in frame, arms a hand\u2019s width from your sides \u2014 that gap is how we tell your arms from your torso. Max 30 seconds.',
    recordLabel: 'Click to Record',
    recordHint: '360\u00b0 \u00b7 hold still \u00b7 max 30 seconds',
    promises: true,
  }),
  results: Object.freeze({
    kicker: 'Your measurements',
    title: 'Read from your video',
    sizeLabel: 'Your size',
  }),
});

const LIMITS = {
  radius: [0, 40],
  scale: [0.85, 1.25],
  buttonRadius: [0, 32],
};

/* ---------- colour ---------- */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" / "#AABBCC" -> "#aabbcc"; anything else (rgba(), names, junk) -> null. */
export function hex6(value) {
  if (typeof value !== 'string') return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** `a` moved toward `b` by `t` (0 = a, 1 = b). */
export function mix(a, b, t) {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex) {
  const c = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Dark ink or white, whichever reads better on `bg`. */
export function readableOn(bg) {
  return contrast('#191411', bg) >= contrast('#ffffff', bg) ? '#191411' : '#ffffff';
}

/* ---------- validation ---------- */

const num = (value, [lo, hi], fallback) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

const colour = (value, fallback) => hex6(value) || fallback;

/** Plain text, trimmed and capped. Empty means "use the default", not "show nothing". */
function text(value, max, fallback) {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || fallback;
}

/**
 * Whatever is stored -> a complete, safe config.
 *
 * Version 1 (the old customiser's) was never read by any popup, so apart from the
 * button's own settings, which did reach stores through the snippet, nothing of it
 * carries over: its values described a different design.
 */
export function normalizePopup(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const current = src.v === POPUP_VERSION;
  const t = (current && src.theme) || {};
  const b = (current ? src.button : legacyButton(src.fabButton)) || {};
  const r = (current && src.record) || {};
  const s = (current && src.results) || {};
  const D = DEFAULTS;

  return {
    v: POPUP_VERSION,
    theme: {
      background: colour(t.background, D.theme.background),
      text: colour(t.text, D.theme.text),
      accent: colour(t.accent, D.theme.accent),
      font: Object.prototype.hasOwnProperty.call(FONTS, t.font) ? t.font : D.theme.font,
      radius: num(t.radius, LIMITS.radius, D.theme.radius),
      scale: num(t.scale, LIMITS.scale, D.theme.scale),
    },
    button: {
      label: text(b.label, 28, D.button.label),
      bg: colour(b.bg, D.button.bg),
      textColor: colour(b.textColor, D.button.textColor),
      radius: num(b.radius, LIMITS.buttonRadius, D.button.radius),
      side: b.side === 'left' ? 'left' : 'right',
      float: b.float !== false,
    },
    record: {
      headline: text(r.headline, 60, D.record.headline),
      instruction: text(r.instruction, 260, D.record.instruction),
      recordLabel: text(r.recordLabel, 30, D.record.recordLabel),
      recordHint: text(r.recordHint, 60, D.record.recordHint),
      promises: r.promises !== false,
    },
    results: {
      kicker: text(s.kicker, 40, D.results.kicker),
      title: text(s.title, 60, D.results.title),
      sizeLabel: text(s.sizeLabel, 30, D.results.sizeLabel),
    },
  };
}

/** The old button settings were in rem; the new ones are px. */
function legacyButton(old) {
  if (!old || typeof old !== 'object') return {};
  return {
    label: old.label,
    bg: old.bg,
    textColor: old.textColor,
    radius: typeof old.radius === 'number' ? old.radius * 16 : undefined,
    float: old.float,
  };
}

/** True when nothing differs from the defaults. */
export function isDefault(cfg) {
  return JSON.stringify(normalizePopup(cfg)) === JSON.stringify(normalizePopup({}));
}

/* ---------- from settings to CSS ---------- */

/**
 * The colours the popup is really drawn with. Text is checked against the background
 * (a store that picks a pale background and leaves the text pale would otherwise ship
 * a popup nobody can read), and the card's inner colours are worked out from the two.
 */
export function effectiveColours(cfg) {
  const { background, accent } = cfg.theme;
  let ink = cfg.theme.text;
  const corrected = contrast(ink, background) < 4.5;
  if (corrected) ink = readableOn(background);
  return { background, text: ink, accent, corrected };
}

/** Only what differs from the defaults is written: a default popup gets no overrides at all. */
export function popupCss(rawCfg) {
  const cfg = normalizePopup(rawCfg);
  const D = DEFAULTS.theme;
  const t = cfg.theme;
  const { background, text: ink, accent } = effectiveColours(cfg);
  const body = [];
  const root = [];

  if (background !== D.background || ink !== D.text) {
    const rgb = toRgb(ink).join(' ');
    body.push(
      `--pu-bg:${background}`, `--bg:${background}`,
      `--panel:${mix(background, ink, 0.08)}`,
      `--pu-text:${ink}`, `--text:${ink}`,
      `--pu-muted:${mix(ink, background, 0.32)}`, `--muted:${mix(ink, background, 0.38)}`,
      `--faint:${mix(ink, background, 0.6)}`,
      `--line:rgb(${rgb} / 0.12)`, `--line-2:rgb(${rgb} / 0.2)`,
      `--glass:${rgb}`,
      `color-scheme:${luminance(background) > 0.4 ? 'light' : 'dark'}`,
    );
  }
  if (accent !== D.accent) {
    const lighter = mix(accent, '#ffffff', 0.28);
    body.push(`--pu-accent:${accent}`, `--accent:${accent}`, `--pu-accent-2:${lighter}`, `--accent-2:${lighter}`, `--on-accent:${readableOn(accent)}`);
  }
  if (t.radius !== D.radius) body.push(`--pu-radius:${t.radius}px`, `--radius:${Math.round(t.radius * 0.64)}px`);
  if (t.font !== D.font) body.push(`--pu-display:${FONTS[t.font].display}`, `--pu-body:${FONTS[t.font].body}`);
  if (t.scale !== D.scale) root.push(`--pu-scale:${t.scale}`);

  let css = '';
  if (t.font !== D.font) {
    // The scanner's own headings set their own faces, so they are named here as well.
    const f = FONTS[t.font];
    css += `html.embed body.app, html.embed body.app button, html.embed body.app input{font-family:${f.body}}\n`;
    css += `html.embed body.app .result-title, html.embed body.app .verdict-size, html.embed body.app .measure-value, html.embed body.app .intro h1, html.embed body.app .cam-cta{font-family:${f.display}}\n`;
  }
  if (root.length) css += `html.embed{${root.join(';')}}\n`;
  if (body.length) css += `html.embed body.app{${body.join(';')}}\n`;
  return css;
}

/* ---------- applying ---------- */

const STYLE_ID = 'popup-theme';

function setText(doc, selector, value) {
  const el = doc.querySelector(selector);
  if (el && el.textContent !== value) el.textContent = value;
}

/** The size label main.js writes into the verdict card; read from here so it can follow the config. */
export function popupText(win = window) {
  return (win.__puText && typeof win.__puText === 'object') ? win.__puText : {};
}

/**
 * Draw the popup the way `rawCfg` says. Safe to call again with a new object: that is
 * how the dashboard's preview updates as a store drags a slider.
 */
export function applyPopupConfig(rawCfg, doc = document) {
  const cfg = normalizePopup(rawCfg);
  const win = doc.defaultView || window;

  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  style.textContent = popupCss(cfg);

  setText(doc, '.intro h1', cfg.record.headline);
  setText(doc, '.intro .lead', cfg.record.instruction);
  setText(doc, '.cam-cta', cfg.record.recordLabel);
  setText(doc, '.cam-hint', cfg.record.recordHint);
  const promises = doc.querySelector('.card-foot');
  if (promises) promises.setAttribute('data-off', String(!cfg.record.promises));
  setText(doc, '.result-kicker', cfg.results.kicker);
  setText(doc, '#result-title', cfg.results.title);

  // "Your size" is written by the scanner each time a result arrives, so it reads the
  // label from here; and if a result is already on screen it is updated now.
  win.__puText = { sizeLabel: cfg.results.sizeLabel };
  const eyebrow = doc.getElementById('verdict-eyebrow');
  if (eyebrow && !doc.getElementById('verdict')?.classList.contains('verdict-none') && eyebrow.textContent) {
    eyebrow.textContent = cfg.results.sizeLabel;
  }

  // The frame the store's page draws around us follows the card's corners and colour.
  const { background } = effectiveColours(cfg);
  try {
    win.parent?.postMessage({ source: '3dg', type: 'frame', background, radius: cfg.theme.radius }, '*');
  } catch { /* not in a frame */ }

  return cfg;
}

/**
 * The button's settings as attributes on the store's script tag, and only the ones that
 * differ from the defaults: a store that changes nothing pastes the shortest tag there is.
 * Values are plain text from the store, so they are escaped before they go into a tag.
 */
export function buttonAttributes(raw) {
  const b = normalizePopup(raw).button;
  const d = DEFAULTS.button;
  const out = {};
  if (b.label !== d.label) out['data-label'] = b.label;
  if (b.bg !== d.bg) out['data-color'] = b.bg;
  if (b.textColor !== d.textColor) out['data-text-color'] = b.textColor;
  if (b.radius !== d.radius) out['data-radius'] = String(b.radius);
  if (b.side !== d.side) out['data-side'] = b.side;
  if (!b.float) out['data-float'] = '0';
  return out;
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `data-label="Fit me" data-color="#2563eb"` (with a leading space, or nothing). */
export function buttonAttributeString(raw) {
  return Object.entries(buttonAttributes(raw)).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
}

/* ---------- the AI's answer -> this popup's settings ---------- */

/** Pick the typeface on offer that the site's own most resembles. */
export function fontFromGuess(guess) {
  const g = String(guess || '').toLowerCase();
  if (/serif|georgia|times|garamond|playfair|merri|lora|didot|bodoni/.test(g) && !/sans/.test(g)) return 'serif';
  if (/helvetica|arial|inter\b|roboto|open sans|lato|montserrat/.test(g)) return 'clean';
  if (/system|segoe|sf pro|apple/.test(g)) return 'system';
  return 'default';
}

/** What the website analysis found, as settings. Anything not usable is left as it was. */
export function fromAnalysis(c, found) {
  const accent = hex6(found.primaryColor) || hex6(found.accentColor);
  const background = hex6(found.backgroundColor);
  const text = hex6(found.textColor);
  if (background) c.theme.background = background;
  if (text) c.theme.text = text;
  if (accent) {
    c.theme.accent = accent;
    c.button.bg = accent;
    c.button.textColor = readableOn(accent);
  }
  const rem = Number(found.borderRadius);
  if (Number.isFinite(rem)) {
    c.theme.radius = Math.min(40, Math.max(0, Math.round(rem * 16)));
    c.button.radius = Math.min(32, Math.max(0, Math.round((Number(found.buttonRadius) || rem * 0.8) * 16)));
  }
  if (found.fontFamily) c.theme.font = fontFromGuess(found.fontFamily);
  return c;
}
