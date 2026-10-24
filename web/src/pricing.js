/**
 * The pricing page. nav.js does the header (current page, the account panel, the
 * menu, the scroll reveals); this adds the two things the page itself does.
 */
import './nav.js';

/* ---------- the menu on a phone ----------
   nav.js opens and closes the list of pages. This adds: the page behind it stops
   scrolling while it is open, and the button says what it will do. */
const menuButton = document.getElementById('nav-menu');
if (menuButton) {
  const syncMenu = () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('is-locked', open);
  };
  new MutationObserver(syncMenu).observe(menuButton, { attributes: true, attributeFilter: ['aria-expanded'] });
  document.querySelector('.nav-demo')?.addEventListener('click', () => {
    if (menuButton.getAttribute('aria-expanded') === 'true') menuButton.click();
  });
  window.matchMedia('(min-width: 961px)').addEventListener('change', (event) => {
    if (event.matches && menuButton.getAttribute('aria-expanded') === 'true') menuButton.click();
  });
}

/* ---------- the price counts up once ----------
   The markup already says "$150", so with scripts off, or for anyone who asks for
   less motion, that is what they read. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion) {
  for (const el of document.querySelectorAll('[data-count]')) {
    const target = Number.parseInt(el.getAttribute('data-count'), 10) || 0;
    const duration = 950;
    let start = null;
    const frame = (now) => {
      if (start === null) start = now;
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      el.textContent = progress < 1 ? `$${Math.round(target * eased)}` : `$${target}`;
      if (progress < 1) window.requestAnimationFrame(frame);
    };
    el.textContent = '$0';
    window.requestAnimationFrame(frame);
  }
}
