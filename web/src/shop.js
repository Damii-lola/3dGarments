/**
 * The blank shop page behind the popup customiser's "Phase 0" preview: nothing but
 * the floating FindMySize button, loaded the way a store would load it.
 *
 * This is a module rather than an inline script because the site's content-security
 * policy (script-src 'self') blocks inline scripts, and it builds the address from
 * the site's base path because the site is served from /3dGarments/ on GitHub Pages,
 * where a bare "/embed.js" would point at the wrong place.
 */
const params = new URLSearchParams(location.search);
const code = params.get('g') || '';

const script = document.createElement('script');
script.src = `${import.meta.env.BASE_URL}embed.js`;
if (code) script.setAttribute('data-chart', code);
script.setAttribute('data-label', 'Find My Size');
document.body.appendChild(script);
