import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError, ah } from '../lib/errors.js';
import { requireUser } from '../middleware/auth.js';
import { runModel } from '../lib/cloudflare.js';

/**
 * Website appearance analysis endpoint.
 *
 * Body: { url: string }
 * Returns a suggested colour palette + design tokens for the popup + FAB button,
 * derived from the website's homepage. Uses Cloudflare vision (via Workers AI)
 * when available, otherwise falls back to a simple heuristic read of the HTML/CSS.
 *
 * Signed in only, rate limited because it spends Workers AI tokens.
 */
const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many website analyses — try again in a little while.' },
});

export const websiteAnalysis = Router();
websiteAnalysis.use(requireUser);
websiteAnalysis.post('/analyze', limiter, ah(async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new HttpError(400, 'Send a valid http/https url.');
  }

  let suggestion;
  try {
    // Fetch the homepage HTML
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const html = await resp.text();

    // Quick heuristic extraction: look for common brand colour hints in inline styles
    const colorMatches = [...html.matchAll(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g)];
    const hexColors = colorMatches.map((m) => m[0]).slice(0, 6);

    // Try to read meta theme-color or primary brand colour
    const themeMatch = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i);
    const brandColor = themeMatch ? themeMatch[1] : (hexColors[0] || '#ff6a4a');

    // Derive a complementary palette
    const palette = derivePalette(brandColor);

    suggestion = {
      source: 'heuristic',
      url,
      primaryColor: brandColor,
      secondaryColor: palette.secondary,
      accentColor: palette.accent,
      backgroundColor: palette.bg,
      textColor: palette.text,
      borderRadius: 1.0,
      fontFamily: 'system-ui',
      buttonRadius: 0.8,
      mode: 'dark',
    };

    // Try Cloudflare vision for a better read if configured
    try {
      const visionResult = await runModel(config.cloudflare.visionModel || '@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          { role: 'system', content: 'You analyze website homepages. Reply with ONLY compact JSON describing the visual identity: primary brand colour (hex), secondary colour (hex), accent colour (hex), suggested background colour (hex), text colour (hex), mode ("dark" or "light"), font family guess, and border radius preference (0.5 to 2.0). Keys: primaryColor, secondaryColor, accentColor, backgroundColor, textColor, mode, fontFamily, borderRadius. No prose.' },
          { role: 'user', content: `Homepage HTML of ${url}:\n\n${html.slice(0, 12000)}` },
        ],
        max_tokens: 300,
        temperature: 0.1,
      }, { timeoutMs: 45_000 });

      const raw = extractJson(visionResult?.response ?? visionResult);
      if (raw && typeof raw === 'object') {
        suggestion = {
          ...suggestion,
          source: 'ai',
          primaryColor: raw.primaryColor || suggestion.primaryColor,
          secondaryColor: raw.secondaryColor || suggestion.secondaryColor,
          accentColor: raw.accentColor || suggestion.accentColor,
          backgroundColor: raw.backgroundColor || suggestion.backgroundColor,
          textColor: raw.textColor || suggestion.textColor,
          mode: raw.mode || suggestion.mode,
          fontFamily: raw.fontFamily || suggestion.fontFamily,
          borderRadius: Number(raw.borderRadius) || suggestion.borderRadius,
        };
      }
    } catch {
      // AI unavailable — keep heuristic result
    }
  } catch (err) {
    throw new HttpError(422, `Could not read that website: ${err.message}`);
  }

  res.json(suggestion);
}));

function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return {}; }
}

function derivePalette(baseHex) {
  // Simple heuristic: derive a usable palette from one brand colour
  const h = baseHex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isDark = lum < 0.5;

  return {
    secondary: adjustHex(baseHex, -20),
    accent: adjustHex(baseHex, +30),
    bg: isDark ? '#0e1015' : '#f5f5f5',
    text: isDark ? '#eef0f4' : '#1a1d24',
  };
}

function adjustHex(hex, delta) {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.max(0, parseInt(h.slice(0, 2), 16) + delta));
  const g = Math.min(255, Math.max(0, parseInt(h.slice(2, 4), 16) + delta));
  const b = Math.min(255, Math.max(0, parseInt(h.slice(4, 6), 16) + delta));
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
