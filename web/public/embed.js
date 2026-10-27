/**
 * 3dGarments — the size finder a store drops onto its own product page.
 *
 * A shopper should never be sent to another site to find out what size to buy,
 * so this opens the scanner in a popup OVER the page the shopper is already on:
 * one button, one click, the scanner in a frame, and an ✕ straight back to the
 * product. The alternative — a link to our page — is a new tab that loses the
 * basket, which is the exact thing a store cannot afford.
 *
 * It is plain JavaScript with no build step and no dependencies, served from the
 * site root, so a store adds one <script> tag and nothing else. It runs on their
 * storefront, so it stays small, it puts its styles in one namespaced block, and
 * it touches nothing on their page except the node it was asked to.
 *
 * Usage:
 *   <script src="https://…/3dGarments/embed.js"
 *           data-chart="a1b2c3d4e5f6" data-label="Find my size"></script>
 *
 * Or, with a button of your own:
 *   <button onclick="ThreeDG.open({ code: 'a1b2c3d4e5f6', name: 'Oxford Shirt' })">
 *     Find my size
 *   </button>
 *
 * data-chart  the code from the dashboard. Required. `data-code` works too.
 * data-label  the button text. Default "Find my size".
 * data-name   the garment's name, for the button's title. Optional.
 * data-base   the site root, if this script is served from somewhere else.
 * data-float  "1" pins the button to the bottom-right corner instead of
 *             placing it in the page where the tag is.
 *
 * The tag can go anywhere — head, body, a template partial. A tag in the
 * <head> has nowhere to put a button (a <button> in a head is never rendered),
 * so it floats instead of disappearing. That was the one way this could be
 * pasted correctly and still show nothing.
 */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[src*="embed.js"]');

  /** The site this file came from: the scanner lives beside it, so nothing here
   *  hard-codes a domain and a copy of the site on another host just works. */
  function siteRoot() {
    try { return new URL('./', script.src).href; } catch (e) { return '/'; }
  }
  function siteOrigin() {
    try { return new URL('./', script.src).origin; } catch (e) { return location.origin; }
  }

  /** Turn a colour into a matching soft shadow. Hex colours get a real rgba
   *  shadow; anything else falls back to a neutral one. */
  function shadowFor(color) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return 'rgba(0,0,0,.25)';
    var hex = m[1];
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',.28)';
  }

  var STYLE_ID = 'threeDG-embed-style';
  var CSS = [
    '.threeDG-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(6,7,10,.74);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:threeDG-fade .2s ease-out}',
    '.threeDG-panel{position:relative;width:min(27.5rem,100%);height:min(48rem,94vh);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:var(--threeDG-panel-radius,1.75rem);background:var(--threeDG-panel-bg,#221a15);box-shadow:0 2.5rem 6rem rgba(0,0,0,.65);animation:threeDG-rise .3s cubic-bezier(.22,1,.36,1)}',
    '.threeDG-panel:focus{outline:none}',
    '.threeDG-frame{flex:1;min-height:0;width:100%;display:block;border:0;background:var(--threeDG-panel-bg,#221a15)}',
    '.threeDG-close{position:absolute;top:.55rem;right:.55rem;z-index:2;width:2.15rem;height:2.15rem;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:.7rem;background:rgba(12,13,17,.86);color:#eef0f4;font:400 1.2rem/1 system-ui,sans-serif;cursor:pointer}',
    '.threeDG-close:hover{background:rgba(255,255,255,.14);color:#fff}',
    '.threeDG-button{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.1rem;border:0;border-radius:var(--threeDG-radius,.8rem);background:var(--threeDG-accent,linear-gradient(180deg,#ff6a4a,#f04a29));color:var(--threeDG-text,#fff);font:650 .95rem/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em;cursor:pointer;box-shadow:0 .5rem 1.4rem var(--threeDG-shadow,rgba(240,74,41,.28))}',
    '.threeDG-button:hover{filter:brightness(1.06)}',
    '.threeDG-button svg{width:1.05rem;height:1.05rem;flex:0 0 auto}',
    '@keyframes threeDG-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes threeDG-rise{from{opacity:0;transform:translateY(.8rem) scale(.985)}to{opacity:1;transform:none}}',
    '@media (max-width:520px){.threeDG-overlay{padding:0}.threeDG-panel{width:100%;height:100%;border:0;border-radius:0}}',
    '@media (prefers-reduced-motion:reduce){.threeDG-overlay,.threeDG-panel{animation:none}}',
    '.threeDG-float{position:fixed;right:1.1rem;bottom:1.1rem;z-index:2147482000}',
    '.threeDG-float.threeDG-left{left:1.1rem;right:auto}',
    '.threeDG-float .threeDG-button{box-shadow:0 .7rem 2rem rgba(0,0,0,.35),0 .5rem 1.4rem var(--threeDG-shadow,rgba(240,74,41,.3))}',
  ].join('');

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  var overlay = null;
  var panelEl = null;
  var opener = null;
  var bodyOverflow = null;
  var scrollY = 0;

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  /**
   * The popup itself. Only one is ever open: opening a second one closes the
   * first, so a double tap cannot leave two scanners stacked on the page.
   */
  function open(opts) {
    var code = (opts && opts.code) || '';
    if (!code) return;
    close();
    ensureStyles();

    var base = (opts && opts.base) || siteRoot();
    opener = document.activeElement;

    overlay = document.createElement('div');
    overlay.className = 'threeDG-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', (opts && opts.name ? opts.name + ': ' : '') + 'Find your size');

    var panel = document.createElement('div');
    panel.className = 'threeDG-panel';
    panel.tabIndex = -1;
    panelEl = panel;

    var frame = document.createElement('iframe');
    frame.className = 'threeDG-frame';
    frame.title = 'Find your size';
    // The clip is recorded in the phone's own camera app (an <input capture>),
    // not with getUserMedia, so the frame asks for no microphone. `camera` stays
    // for browsers that gate the capture input on it, and fullscreen is used by
    // the review step.
    frame.setAttribute('allow', 'camera; fullscreen');
    frame.setAttribute('allowfullscreen', '');
    frame.src = base + 'size/?g=' + encodeURIComponent(code) + '&embed=1';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'threeDG-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', close);

    panel.appendChild(frame);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);

    // The page underneath belongs to the store: it is frozen while the popup is
    // up, so a scroll gesture inside the scanner cannot drag the product page
    // around behind it. Both values are put back exactly as they were found.
    scrollY = window.scrollY || 0;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('pointerdown', function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    panel.focus();
  }

  function close() {
    if (!overlay) return;
    document.removeEventListener('keydown', onKey, true);
    document.body.style.overflow = bodyOverflow == null ? '' : bodyOverflow;
    bodyOverflow = null;
    overlay.remove();
    overlay = null;
    panelEl = null;
    try { window.scrollTo(0, scrollY); } catch (e) { /* ignore */ }
    if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* ignore */ } }
    opener = null;
  }

  // The scanner can close the popup itself (after a result, say an explicit
  // "done"), and it is only ever listened to from our own origin.
  window.addEventListener('message', function (event) {
    if (!overlay || event.origin !== siteOrigin()) return;
    var data = event.data;
    if (data && data.source === '3dg' && data.type === 'close') close();
    // The card inside the popup says what colour and corners it has been given (the store's
    // own choice), and the frame around it follows, so no stray corner of the old colour shows.
    if (data && data.source === '3dg' && data.type === 'frame' && panelEl) {
      if (/^#[0-9a-f]{6}$/i.test(data.background || '')) panelEl.style.setProperty('--threeDG-panel-bg', data.background);
      var radius = Number(data.radius);
      if (isFinite(radius)) panelEl.style.setProperty('--threeDG-panel-radius', Math.max(0, Math.min(40, radius)) + 'px');
    }
  });

  var CAMERA = 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A2 2 0 0 1 10.4 3.5h3.2a2 2 0 0 1 1.7 1L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5zM12 8.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z';

  /** A button of the store's own, wired to the popup. */
  function mount(target, opts) {
    ensureStyles();
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'threeDG-button';
    if (opts && opts.name) button.title = opts.name;
    // A store can recolour the button with data-color="#1a2b3c" (or any CSS
    // colour). The default is the brand orange; everything else stays the same.
    if (opts && opts.color) {
      button.style.setProperty('--threeDG-accent', opts.color);
      button.style.setProperty('--threeDG-shadow', shadowFor(opts.color));
    }
    // data-text-color: the label's colour. data-radius: the corners, in px (0 = square, 32 = pill).
    if (opts && opts.textColor) button.style.setProperty('--threeDG-text', opts.textColor);
    var radius = opts && opts.radius !== '' && opts.radius != null ? Number(opts.radius) : NaN;
    if (isFinite(radius)) button.style.setProperty('--threeDG-radius', Math.max(0, Math.min(32, radius)) + 'px');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', CAMERA);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    var label = document.createElement('span');
    label.textContent = (opts && opts.label) || 'Find My Size';
    button.appendChild(svg);
    button.appendChild(label);
    button.addEventListener('click', function () { open(opts); });

    if (target) {
      target.replaceChildren(button);
      return button;
    }

    // Where the tag sits decides where the button goes. A tag in the <head> —
    // which is where a script tag normally goes — has no rendered place to put
    // one, so it becomes a floating button instead of an invisible element.
    var parent = script && script.parentNode;
    var inHead = !parent || parent === document.head || parent.nodeName === 'HEAD';
    if ((opts && opts.float) || inHead) {
      var wrap = document.createElement('div');
      wrap.className = 'threeDG-float' + (opts && opts.side === 'left' ? ' threeDG-left' : '');
      wrap.appendChild(button);
      (document.body || document.documentElement).appendChild(wrap);
    } else {
      parent.insertBefore(button, script.nextSibling);
    }
    return button;
  }

  window.ThreeDG = { open: open, close: close, mount: mount };

  // A tag with a code asks for a button; a tag without one is just here to
  // publish ThreeDG, which is what the dashboard uses to preview a chart.
  // The tag may sit in the <head>, where document.body does not exist yet, so
  // the mount waits for the body rather than attaching to <html> and vanishing
  // into a place no stylesheet reaches.
  function autoMount() {
    if (!script) return;
    var spec = script.dataset || {};
    var code = spec.chart || spec.code || '';
    if (!code) return;
    mount(null, {
      code: code,
      name: spec.name || '',
      label: spec.label || 'Find My Size',
      base: spec.base || '',
      color: spec.color || spec.accent || '',
      textColor: spec.textColor || '',
      radius: spec.radius || '',
      side: spec.side === 'left' ? 'left' : 'right',
      // Floating is the default: a tag at the top of <body> becomes a FAB.
      // Only data-float="0" pins it inline instead.
      float: spec.float !== '0' && spec.float !== 'false',
    });
  }
  if (document.body) autoMount();
  else document.addEventListener('DOMContentLoaded', autoMount, { once: true });
})();
