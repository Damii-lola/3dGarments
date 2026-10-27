/**
 * The model editor's settings, synced to Supabase per device: the row in public.body_profiles of
 * the anonymous user this browser signs in as (the same session that owns the photo groups).
 * localStorage stays the fast path; the cloud copy wins when it is newer (e.g. after local
 * storage was cleared, the anonymous session in it being kept by supabase-js' own storage).
 */
import { supabaseClient, ensureSession } from './auth.js';
import { storageMode } from '../uploads/store.js';

let timer = 0;

/** @returns the saved settings object, or null (no cloud / nothing saved / error) */
export async function loadProfile() {
  try {
    if ((await storageMode()) !== 'cloud') return null;
    const sb = await supabaseClient(), { user } = await ensureSession();
    const { data, error } = await sb.from('body_profiles').select('settings').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data?.settings?.models ? data.settings : null;
  } catch (err) {
    console.warn('profile: cloud load skipped', err);
    return null;
  }
}

/** debounced upsert (the editor calls this on every change) */
export function saveProfile(settings, wait = 1500) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      if ((await storageMode()) !== 'cloud') return;
      const sb = await supabaseClient(), { user } = await ensureSession();
      const { error } = await sb.from('body_profiles').upsert({ user_id: user.id, settings });
      if (error) throw error;
    } catch (err) {
      console.warn('profile: cloud save skipped', err);
    }
  }, wait);
}
