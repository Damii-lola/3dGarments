/**
 * The site's theme and accent colour.
 *
 * A plain script in <head> rather than a module, because it has to run before the page
 * is painted: a module would run after, and a dark-theme visitor would see a flash of
 * cream on every page. It reads what was last stored on this device, applies it, and
 * leaves `window.FMSTheme` for the settings page (which changes it) and src/theme.js
 * (which refreshes it from the account).
 *
 *   theme   "light" | "dark" | "system"  -> <html data-theme="light|dark">
 *   accent  "#rrggbb"                    -> --orange and the colours derived from it
 *
 * The brand orange is the default and writes nothing: with no stored choice, or the
 * brand colour itself, the stylesheets are exactly as designed.
 */
(function () {
  // The popup on a store's own page is the store's to style (from the dashboard's customiser),
  // not the account holder's: it never reads the theme.
  if (/[?&]embed=1(&|$)/.test(location.search)) return;

  var KEY = '3dg.appearance.v1';
  var BRAND = '#f0521f';
  var LEGACY = '#ff6a4a'; // the settings page's old, never-applied default
  var INK = '#191411';
  var PAGE = { light: '#f5e9d6', dark: '#120e0b' };
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var current = { theme: 'light', accent: '' };

  function read() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (value && typeof value === 'object') return value;
    } catch (e) { /* storage blocked or damaged: fall back to the defaults */ }
    return {};
  }

  function write(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) { /* nothing to do */ }
  }

  /* ---- colour maths ---- */

  function toRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var la = luminance(toRgb(a)), lb = luminance(toRgb(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function toHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function fromHsl(hsl) {
    var h = hsl[0], s = hsl[1], l = hsl[2];
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function channel(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
  }

  /** Move a colour lighter or darker, a step at a time, until it reads against `against`. */
  function readable(hex, against, min, lighter) {
    var hsl = toHsl(toRgb(hex));
    for (var i = 0; i < 60 && contrast(toHex(fromHsl(hsl)), against) < min; i++) {
      hsl[2] = Math.max(0, Math.min(1, hsl[2] + (lighter ? 0.015 : -0.015)));
    }
    return toHex(fromHsl(hsl));
  }

  function shade(hex, amount) {
    var hsl = toHsl(toRgb(hex));
    hsl[2] = Math.max(0, Math.min(1, hsl[2] + amount));
    return toHex(fromHsl(hsl));
  }

  /* ---- applying ---- */

  var VARS = ['--orange', '--orange-rgb', '--orange-deep', '--orange-text'];

  function apply(value) {
    value = value || {};
    var pref = value.theme === 'dark' || value.theme === 'system' ? value.theme : 'light';
    var dark = pref === 'dark' || (pref === 'system' && !!query && query.matches);
    current = { theme: pref, accent: value.accent || '' };

    root.setAttribute('data-theme', dark ? 'dark' : 'light');

    var accent = typeof value.accent === 'string' && /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent.toLowerCase() : '';
    if (!accent || accent === BRAND || accent === LEGACY) {
      VARS.forEach(function (name) { root.style.removeProperty(name); });
      return;
    }
    // Text on the accent is the page's dark ink, so the accent has to be light enough to carry it.
    var base = readable(accent, INK, 4.5, true);
    var rgb = toRgb(base);
    root.style.setProperty('--orange', base);
    root.style.setProperty('--orange-rgb', rgb.join(' '));
    root.style.setProperty('--orange-deep', shade(base, -0.1));
    // The accent used as TEXT or a line on the page itself: pushed away from the page colour until it reads.
    root.style.setProperty('--orange-text', readable(base, dark ? PAGE.dark : PAGE.light, 4.5, dark));
  }

  /** Change what is stored (a partial update is fine) and apply it. */
  function set(patch) {
    var next = Object.assign({}, read(), patch, { at: Date.now() });
    write(next);
    apply(next);
    return next;
  }

  if (query && query.addEventListener) {
    query.addEventListener('change', function () { if (current.theme === 'system') apply(read()); });
  }

  window.FMSTheme = { read: read, apply: apply, set: set, BRAND: BRAND, readable: readable };
  apply(read());
})();
