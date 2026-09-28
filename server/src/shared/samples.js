/**
 * Synthetic flat-lay "photos" (SVG) used for the in-app demo and the test-suite.
 * They deliberately include a textured backdrop + drop shadow so they exercise
 * the real segmentation path, not a pre-cut PNG.
 */

const backdrop = (id, a, b) => `
  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <pattern id="grain${id}" width="140" height="1000" patternUnits="userSpaceOnUse">
      <rect width="140" height="1000" fill="none"/>
      <line x1="139" y1="0" x2="139" y2="1000" stroke="#000" stroke-opacity="0.05" stroke-width="2"/>
      <line x1="60" y1="0" x2="64" y2="1000" stroke="#fff" stroke-opacity="0.05" stroke-width="6"/>
    </pattern>
    <filter id="shadow${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>
  <rect width="1000" height="1000" fill="url(#bg${id})"/>
  <rect width="1000" height="1000" fill="url(#grain${id})"/>`;

const TEE = 'M398 150 Q500 232 602 150 L712 178 L884 318 L808 428 L700 362 L700 742 L300 742 L300 362 L192 428 L116 318 L288 178 Z';
const JEANS = 'M318 96 L682 96 L700 300 L718 944 L548 944 L503 392 L497 392 L452 944 L282 944 L300 300 Z';
const DRESS = 'M392 70 L440 70 Q500 190 560 70 L608 70 Q622 210 668 262 Q640 360 622 430 L748 800 L252 800 L378 430 Q360 360 332 262 Q378 210 392 70 Z';

export const SAMPLE_SVGS = {
  tee: {
    name: 'Graphic Tee',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  ${backdrop('t', '#d9cbb3', '#c3b193')}
  <defs>
    <linearGradient id="teeFold" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </linearGradient>
    <clipPath id="teeClip"><path d="${TEE}"/></clipPath>
  </defs>
  <path d="${TEE}" transform="translate(14 20)" fill="#000" opacity="0.35" filter="url(#shadowt)"/>
  <g clip-path="url(#teeClip)">
    <rect width="1000" height="1000" fill="#c8102e"/>
    <path d="M300 520 Q500 480 700 540" stroke="#000" stroke-opacity="0.08" stroke-width="30" fill="none"/>
    <path d="M320 720 Q520 690 690 760" stroke="#fff" stroke-opacity="0.06" stroke-width="24" fill="none"/>
    <rect width="1000" height="1000" fill="url(#teeFold)"/>
    <circle cx="500" cy="440" r="96" fill="none" stroke="#fff" stroke-width="16"/>
    <text x="500" y="468" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="84" fill="#fff" text-anchor="middle">3D</text>
    <text x="500" y="600" font-family="Arial, sans-serif" font-weight="700" font-size="40" letter-spacing="10" fill="#fff" text-anchor="middle">GARMENTS</text>
  </g>
  <path d="M398 150 Q500 232 602 150" stroke="#8e0b20" stroke-width="18" fill="none"/>
  <path d="M300 730 L700 730 M200 414 L116 318" stroke="#8e0b20" stroke-width="5" fill="none" stroke-dasharray="10 8"/>
</svg>`,
  },
  jeans: {
    name: 'Blue Jeans',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  ${backdrop('j', '#ece9e4', '#d7d2ca')}
  <defs>
    <linearGradient id="denim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#27426b"/><stop offset="0.5" stop-color="#3b5f93"/><stop offset="1" stop-color="#2a4775"/>
    </linearGradient>
    <pattern id="twill" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <rect width="8" height="4" fill="#fff" fill-opacity="0.05"/>
    </pattern>
    <clipPath id="jClip"><path d="${JEANS}"/></clipPath>
  </defs>
  <path d="${JEANS}" transform="translate(12 18)" fill="#000" opacity="0.3" filter="url(#shadowj)"/>
  <g clip-path="url(#jClip)">
    <rect width="1000" height="1000" fill="url(#denim)"/>
    <rect width="1000" height="1000" fill="url(#twill)"/>
    <ellipse cx="370" cy="560" rx="40" ry="170" fill="#fff" fill-opacity="0.09"/>
    <ellipse cx="630" cy="560" rx="40" ry="170" fill="#fff" fill-opacity="0.09"/>
    <rect x="300" y="96" width="400" height="44" fill="#1f3558"/>
  </g>
  <path d="M500 140 L500 360 M340 150 Q380 250 470 260 M660 150 Q620 250 530 260" stroke="#d99a3a" stroke-width="4" fill="none" stroke-dasharray="9 6"/>
  <circle cx="500" cy="118" r="10" fill="#c9a24a"/>
</svg>`,
  },
  dress: {
    name: 'Floral Sundress',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  ${backdrop('d', '#5d6b73', '#46525a')}
  <defs>
    <pattern id="floral" width="120" height="120" patternUnits="userSpaceOnUse">
      <rect width="120" height="120" fill="#f4e3c1"/>
      <g fill="#e2725b"><circle cx="30" cy="30" r="13"/><circle cx="48" cy="30" r="9"/><circle cx="30" cy="48" r="9"/><circle cx="14" cy="28" r="8"/><circle cx="30" cy="13" r="8"/></g>
      <circle cx="30" cy="30" r="6" fill="#f2b632"/>
      <g fill="#3c7a5a"><ellipse cx="88" cy="84" rx="16" ry="7" transform="rotate(-30 88 84)"/><ellipse cx="72" cy="98" rx="14" ry="6" transform="rotate(40 72 98)"/></g>
      <circle cx="96" cy="30" r="5" fill="#2f5d8a"/>
    </pattern>
    <clipPath id="dClip"><path d="${DRESS}"/></clipPath>
  </defs>
  <path d="${DRESS}" transform="translate(12 20)" fill="#000" opacity="0.4" filter="url(#shadowd)"/>
  <g clip-path="url(#dClip)">
    <rect width="1000" height="1000" fill="url(#floral)"/>
    <path d="M430 480 L340 800 M570 480 L660 800 M500 480 L500 800" stroke="#000" stroke-opacity="0.07" stroke-width="40"/>
    <rect x="330" y="410" width="340" height="30" fill="#e2725b"/>
  </g>
</svg>`,
  },
};
