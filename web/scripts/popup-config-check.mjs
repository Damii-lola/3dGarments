/**
 * The popup's settings: what is accepted, what is refused, and what a default popup
 * costs (nothing). Run with `npm run check`.
 */
import assert from 'node:assert/strict';
import { applyPopupConfig, buttonAttributes, buttonAttributeString, contrast, DEFAULTS, effectiveColours, fontFromGuess, fromAnalysis, hex6, isDefault, normalizePopup, popupCss, readableOn } from '../src/popup-config.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('ok -', name); };

test('nothing chosen is the default popup, and costs no CSS at all', () => {
  assert.deepEqual(normalizePopup(undefined), normalizePopup({}));
  assert.deepEqual(normalizePopup(null), normalizePopup('junk'));
  assert.equal(popupCss({}), '');
  assert.equal(isDefault({}), true);
  assert.equal(isDefault({ v: 2, theme: { accent: '#2563eb' } }), false);
});

test('colours must be hex; anything else falls back instead of reaching the page', () => {
  assert.equal(hex6('#ABC'), '#aabbcc');
  assert.equal(hex6(' #F0521F '), '#f0521f');
  for (const bad of ['red', 'rgb(1,2,3)', 'url(x)', '#12', '#gggggg', '#ff0000;}body{display:none', 42, null, undefined]) assert.equal(hex6(bad), null, String(bad));
  const cfg = normalizePopup({ v: 2, theme: { accent: 'url(javascript:alert(1))', background: '#00000;}', text: 'red' } });
  assert.equal(cfg.theme.accent, DEFAULTS.theme.accent);
  assert.equal(cfg.theme.background, DEFAULTS.theme.background);
  assert.equal(cfg.theme.text, DEFAULTS.theme.text);
});

test('the CSS that comes out can never contain what a store typed', () => {
  const css = popupCss({ v: 2, theme: { accent: '#2563eb', font: 'comic sans; } body { display:none', radius: 99999, scale: -5 }, record: { headline: '</style><script>x</script>' } });
  assert.ok(!/script|<|display:none|comic/i.test(css), css);
  assert.match(css, /--pu-accent:#2563eb/);
  assert.match(css, /--pu-radius:40px/);               // clamped
  assert.match(css, /--pu-scale:0\.85/);               // clamped
});

test('numbers are clamped, text is capped, an empty text means the default', () => {
  const cfg = normalizePopup({ v: 2, theme: { radius: -3, scale: 9 }, button: { radius: 500 }, record: { headline: 'x'.repeat(500), instruction: '   ', recordLabel: 42 } });
  assert.equal(cfg.theme.radius, 0);
  assert.equal(cfg.theme.scale, 1.25);
  assert.equal(cfg.button.radius, 32);
  assert.equal(cfg.record.headline.length, 60);
  assert.equal(cfg.record.instruction, DEFAULTS.record.instruction);
  assert.equal(cfg.record.recordLabel, DEFAULTS.record.recordLabel);
});

test('text that cannot be read on the background is corrected, and the CSS uses the corrected text', () => {
  const cfg = normalizePopup({ v: 2, theme: { background: '#f6efe3', text: '#f5e9d6' } });
  const eff = effectiveColours(cfg);
  assert.equal(eff.corrected, true);
  assert.ok(contrast(eff.text, eff.background) >= 4.5);
  assert.match(popupCss(cfg), new RegExp(`--pu-text:${eff.text}`));
  assert.equal(effectiveColours(normalizePopup({})).corrected, false);
});

test('a light background turns the inner glass dark and tells the browser', () => {
  const css = popupCss({ v: 2, theme: { background: '#ffffff', text: '#191411' } });
  assert.match(css, /color-scheme:light/);
  assert.match(css, /--glass:25 20 17/);
  assert.match(popupCss({ v: 2, theme: { background: '#101010' } }), /color-scheme:dark/);
});

test('readableOn picks the ink that contrasts', () => {
  assert.equal(readableOn('#ffffff'), '#191411');
  assert.equal(readableOn('#101010'), '#ffffff');
  assert.equal(readableOn('#f0521f'), '#191411');
});

test('the old (v1) settings never reached a popup, so only the button carries over', () => {
  const old = { global: { primaryColor: '#123456', backgroundColor: '#000000' }, phase1: { headline: { text: 'Find your size' } }, fabButton: { label: 'Fit me', bg: '#2563eb', radius: 1, float: false } };
  const cfg = normalizePopup(old);
  assert.equal(cfg.theme.accent, DEFAULTS.theme.accent);
  assert.equal(cfg.record.headline, DEFAULTS.record.headline);
  assert.equal(cfg.button.label, 'Fit me');
  assert.equal(cfg.button.bg, '#2563eb');
  assert.equal(cfg.button.radius, 16);                  // 1rem -> 16px
  assert.equal(cfg.button.float, false);
});

test('applying writes the style and the words, as text, and tells the frame', () => {
  const calls = [];
  const els = {
    '.intro h1': { textContent: '' }, '.intro .lead': { textContent: '' }, '.cam-cta': { textContent: '' }, '.cam-hint': { textContent: '' },
    '.card-foot': { setAttribute: (k, v) => calls.push([k, v]) }, '.result-kicker': { textContent: '' }, '#result-title': { textContent: '' },
  };
  const style = { id: '', textContent: '' };
  const doc = {
    defaultView: { parent: { postMessage: (m) => calls.push(['frame', m]) } },
    head: { appendChild: () => {} },
    getElementById: (id) => (id === 'popup-theme' ? style : null),
    createElement: () => style,
    querySelector: (sel) => els[sel] || null,
  };
  applyPopupConfig({ v: 2, theme: { accent: '#2563eb', radius: 12 }, record: { headline: '<b>Hi</b>', promises: false } }, doc);
  assert.match(style.textContent, /--pu-accent:#2563eb/);
  assert.equal(els['.intro h1'].textContent, '<b>Hi</b>');           // text, never markup
  assert.deepEqual(calls.find((c) => c[0] === 'data-off'), ['data-off', 'true']);
  const frame = calls.find((c) => c[0] === 'frame')[1];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.radius, 12);
  assert.equal(doc.defaultView.__puText.sizeLabel, 'Your size');
});

test('the snippet carries only what differs, and escapes what a store typed', () => {
  assert.equal(buttonAttributeString({}), '');
  assert.deepEqual(buttonAttributes({ v: 2, button: { label: 'Fit me', bg: '#2563eb', side: 'left', float: false, radius: 20 } }),
    { 'data-label': 'Fit me', 'data-color': '#2563eb', 'data-radius': '20', 'data-side': 'left', 'data-float': '0' });
  const tag = buttonAttributeString({ v: 2, button: { label: 'Say "hi" <b>&' } });
  assert.equal(tag, ' data-label="Say &quot;hi&quot; &lt;b&gt;&amp;"');
  assert.ok(!/"\s*<|<b>/.test(tag));
});

test('the AI answer becomes settings, and unusable parts are left alone', () => {
  const c = normalizePopup({});
  fromAnalysis(c, { primaryColor: '#2563eb', backgroundColor: '#ffffff', textColor: '#111111', borderRadius: 0.5, fontFamily: 'Georgia, serif' });
  assert.equal(c.theme.accent, '#2563eb');
  assert.equal(c.theme.background, '#ffffff');
  assert.equal(c.theme.radius, 8);
  assert.equal(c.theme.font, 'serif');
  assert.equal(c.button.bg, '#2563eb');
  assert.equal(c.button.textColor, readableOn('#2563eb'));
  const d = normalizePopup({});
  fromAnalysis(d, { primaryColor: 'blue', backgroundColor: 'url(x)', borderRadius: 'big' });
  assert.deepEqual(d, normalizePopup({}));
  assert.equal(fontFromGuess('Inter, sans-serif'), 'clean');
  assert.equal(fontFromGuess('Playfair Display'), 'serif');
  assert.equal(fontFromGuess('Comic Neue'), 'default');
});

console.log(`\n${passed} passed`);
