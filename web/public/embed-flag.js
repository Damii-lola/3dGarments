/* Marks the page as the store popup before anything is painted, so the standalone
   page's own chrome (footer, ticker, section) never flashes inside a store's popup.
   size.js does the rest of the embed set-up once it runs. */
if (new URLSearchParams(location.search).get('embed') === '1') {
  var root = document.documentElement;
  root.classList.add('embed');
  // A store's own look arrives a moment after the page does. Hold the card back until it
  // has (or a couple of seconds have passed), so a popup never shows the default look and
  // then jumps. The dashboard's preview (?preview=) draws its own settings and never waits.
  if (/[?&]g=/.test(location.search) && !/[?&]preview=/.test(location.search)) {
    root.classList.add('pu-pending');
    setTimeout(function () { root.classList.remove('pu-pending'); }, 2500);
  }
}
