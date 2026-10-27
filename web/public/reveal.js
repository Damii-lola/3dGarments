/*
 * Runs before the first paint, so the reveal styles never flash. It used to be
 * an inline <script> in three pages; it moved here so those pages can ship a
 * Content-Security-Policy that forbids inline code (script-src 'self').
 *
 * If the bundle in main.js never arrives, the fail-safe lifts the flag again:
 * a chunk that fails to load must not leave the page invisible.
 */
document.documentElement.classList.add('js');
window.__revealFailSafe = setTimeout(function () {
  document.documentElement.classList.remove('js');
}, 3000);
