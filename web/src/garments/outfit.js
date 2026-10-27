/**
 * The outfit on the model: which garments are worn, built on the body that is showing.
 *
 *   const outfit = new Outfit(human, stage);
 *   await outfit.wear(item, { front: { src, geometry }, back?: … });   // src: canvas / Blob / URL
 *   outfit.remove(item.id);
 *
 * Wearing an item replaces whatever it overlaps (OCCUPIES: a dress replaces a top and trousers).
 * Garments are layered: trousers and skirts first, then tops and dresses draped over them, then
 * outerwear. Every garment is draped on the body as it is shown (shape + pose): while a slider moves
 * it follows through its own morph targets, and once things settle it is draped again, exactly.
 */
import { OCCUPIES } from '@shared/wardrobe.js';
import { buildGarment, Photo } from './fit.js';
import { loadImage } from './local.js';

const LAYER = { pants: 0, shorts: 0, skirt: 0, shoes: 0, hat: 0, top: 1, dress: 1, jumpsuit: 1, outerwear: 2 };
const SETTLE_MS = 350;

export class Outfit {
  constructor(human, stage) {
    this.human = human;
    this.stage = stage;
    this.worn = new Map();          // item id → { item, photos, built: garment | null, body }
    this.listeners = new Set();
    this.timer = 0;
    this.onHuman = () => {
      if (this.building || !this.worn.size) return;
      const body = this.human.active, infl = body.mesh.morphTargetInfluences || [];
      for (const w of this.worn.values()) if (w.built && w.body === body) w.built.follow(infl);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.rebuild(true), SETTLE_MS);
    };
    human.listeners.add(this.onHuman);
  }

  get items() { return [...this.worn.values()].map((w) => w.item); }
  has(id) { return this.worn.has(id); }
  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }

  /** @param views { front: { src, geometry }, back?: …, side?: … } */
  async wear(item, views) {
    const photos = {};
    for (const [k, v] of Object.entries(views)) if (v) photos[k] = new Photo(await loadImage(v.src), v.geometry);
    if (!photos.front) throw new Error('This garment has no front photo');
    const zones = OCCUPIES[item.zone] || [item.zone];
    for (const [id, w] of this.worn) if ((OCCUPIES[w.item.zone] || [w.item.zone]).some((z) => zones.includes(z))) this.#drop(id);
    this.worn.set(item.id, { item, photos, built: null, body: null });
    this.rebuild();
  }

  remove(id) {
    if (!this.worn.has(id)) return;
    this.#drop(id);
    this.rebuild();
  }

  clear() { for (const id of [...this.worn.keys()]) this.#drop(id); this.rebuild(); }

  #drop(id) {
    this.worn.get(id).built?.dispose();
    this.worn.delete(id);
  }

  /**
   * Drape everything worn on the body as shown (inner layers first), hide the skin under it.
   * @param warm settle each garment from where it was (after a slider / pose change) instead of sewing it anew
   */
  rebuild(warm = false) {
    clearTimeout(this.timer);
    const body = this.human.active;
    const hidden = new Set();
    const under = [];
    this.building = true;
    try {
      const list = [...this.worn.values()].sort((a, b) => (LAYER[a.item.category] ?? 1) - (LAYER[b.item.category] ?? 1));
      for (const w of list) {
        const g = buildGarment(body, this.human, w.item, w.photos, { under: [...under], warm: warm && w.body === body ? w.built?.state : null });
        w.built?.dispose();
        w.built = g; w.body = body;
        if (w.item.zone !== 'feet' && w.item.zone !== 'head') under.push(g.posed);
        for (const i of g.hide) hidden.add(i);
      }
      for (const b of Object.values(this.human.bodies)) if (b !== body) b.setHidden(new Set());
      body.setHidden(hidden);
    } finally {
      this.building = false;
    }
    this.stage?.invalidate?.(2);
    for (const f of this.listeners) f(this.items);
  }

  dispose() {
    this.human.listeners.delete(this.onHuman);
    for (const id of [...this.worn.keys()]) this.#drop(id);
  }
}
