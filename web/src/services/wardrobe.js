/**
 * Wardrobe store — one interface over two backends:
 *   cloud: API + Supabase (persistent, AI-described)
 *   local: in-browser processing, kept in memory for this tab
 */
import { api } from './api.js';
import { processLocally } from './local.js';

export function createWardrobe() {
  let mode = 'local';
  let items = [];
  const subs = new Set();
  let poll = null;

  const emit = () => subs.forEach((fn) => fn(items));
  const put = (g) => {
    const i = items.findIndex((x) => x.id === g.id);
    if (i >= 0) items[i] = { ...items[i], ...g }; else items = [g, ...items];
    emit();
    return items.find((x) => x.id === g.id);
  };

  function schedulePoll() {
    clearTimeout(poll);
    if (mode !== 'cloud' || !items.some((g) => g.status === 'processing')) return;
    poll = setTimeout(async () => {
      try {
        for (const g of items.filter((x) => x.status === 'processing')) {
          const { garment } = await api(`/api/garments/${g.id}`);
          const before = g.status;
          put(garment);
          if (before !== garment.status) subs.forEach((fn) => fn(items, garment));
        }
      } catch { /* keep polling */ }
      schedulePoll();
    }, 2200);
  }

  return {
    get mode() { return mode; },
    get items() { return items; },
    get: (id) => items.find((x) => x.id === id),
    subscribe(fn) { subs.add(fn); fn(items); return () => subs.delete(fn); },

    async setMode(m) {
      mode = m;
      items = [];
      emit();
      if (m === 'cloud') {
        const { garments } = await api('/api/garments');
        items = garments;
        emit();
        schedulePoll();
      }
    },

    /** Add a photo. Resolves with the (possibly still processing) garment. */
    async add(file, { name } = {}) {
      if (mode === 'cloud') {
        const form = new FormData();
        form.append('image', file, file.name || 'garment.jpg');
        if (name) form.append('name', name);
        const { garment } = await api('/api/garments', { method: 'POST', form });
        put(garment);
        schedulePoll();
        return garment;
      }
      const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      put({ id, name: name || file.name?.replace(/\.[^.]+$/, '').slice(0, 40) || 'Garment', status: 'processing', category: null, fit: {} });
      try {
        const r = await processLocally(file);
        return put({ id, status: 'ready', ...r, analysis: {}, updated_at: Date.now() });
      } catch (err) {
        put({ id, status: 'failed', error: err.message });
        throw err;
      }
    },

    async update(id, patch) {
      if (mode === 'cloud') {
        const { garment } = await api(`/api/garments/${id}`, { method: 'PATCH', body: patch });
        return put(garment);
      }
      const cur = items.find((x) => x.id === id);
      return put({ ...cur, ...patch, fit: { ...(cur?.fit || {}), ...(patch.fit || {}) } });
    },

    async retry(id) {
      if (mode !== 'cloud') return;
      const { garment } = await api(`/api/garments/${id}/reprocess`, { method: 'POST' });
      put(garment);
      schedulePoll();
    },

    async remove(id) {
      if (mode === 'cloud') await api(`/api/garments/${id}`, { method: 'DELETE' });
      items = items.filter((x) => x.id !== id);
      emit();
    },
  };
}
