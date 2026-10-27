/**
 * What the settings page is allowed to write to `user_settings`.
 *
 * Only the fields that were sent are written, and each one is checked: an unchecked
 * "theme || 'dark'" used to turn any missing field into a stored default, which then
 * looked like a choice the person had made.
 */
import { HttpError } from '../lib/errors.js';

export const THEMES = ['light', 'dark', 'system'];
export const UNITS = ['cm', 'in'];
const HEX = /^#[0-9a-f]{6}$/i;

/** @returns {{theme?: string, accent_colour?: string, default_unit?: string}} */
export function parseAppearance(body) {
  const { theme, accent_colour: accent, unit } = body || {};
  const row = {};

  if (theme !== undefined) {
    if (!THEMES.includes(theme)) throw new HttpError(400, 'Theme must be light, dark or system.');
    row.theme = theme;
  }
  if (accent !== undefined) {
    if (typeof accent !== 'string' || !HEX.test(accent)) throw new HttpError(400, 'Accent colour must look like #f0521f.');
    row.accent_colour = accent.toLowerCase();
  }
  if (unit !== undefined) {
    if (!UNITS.includes(unit)) throw new HttpError(400, 'Unit must be cm or in.');
    row.default_unit = unit;
  }
  if (!Object.keys(row).length) throw new HttpError(400, 'Nothing to save.');
  return row;
}

/** The row, shaped for the page; null when nothing has been saved yet. */
export function shapeSettings(row) {
  if (!row) return null;
  return {
    notify_results: row.notify_results,
    notify_digest: row.notify_digest,
    notify_marketing: row.notify_marketing,
    notify_security: row.notify_security,
    billing_email: row.billing_email || '',
    tax_id: row.tax_id || '',
    theme: row.theme,
    accent_colour: row.accent_colour,
    default_unit: row.default_unit,
  };
}
