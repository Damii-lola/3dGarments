/* Marks the page as the store popup before anything is painted, so the standalone
   page's own chrome (footer, ticker, section) never flashes inside a store's popup.
   size.js does the rest of the embed set-up once it runs. */
if (new URLSearchParams(location.search).get('embed') === '1') {
  document.documentElement.classList.add('embed');
}
