/**
 * Keeps the 3D figure in sync with what the user is wearing.
 */
import * as THREE from 'three';
import { createBody, DEFAULT_BODY } from './body.js';
import { buildMannequin, buildBase, BASE_HEIGHT } from './mannequin.js';
import { buildGarmentMesh, layerOf } from './wrap.js';
import { loadGarmentTextures } from './textures.js';

function disposeMesh(m) {
  m.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x.dispose());
    if (o.customDepthMaterial) o.customDepthMaterial.dispose();
  });
}

export function createDresser(stage) {
  const figure = new THREE.Group();
  figure.position.y = BASE_HEIGHT;
  stage.root.add(figure);
  stage.root.add(buildBase());

  let body = createBody(DEFAULT_BODY);
  let mannequin = buildMannequin(body);
  figure.add(mannequin);

  const textures = new Map(); // garmentId -> Promise<{texture, alphaAt}>
  const worn = new Map(); // garmentId -> { garment, mesh }
  let order = []; // wear order

  const texFor = (garment) => {
    const key = `${garment.id}:${garment.texture_path || ''}:${garment.updated_at || ''}:${garment.category}`;
    if (!textures.has(key)) textures.set(key, loadGarmentTextures(garment, stage.maxAnisotropy));
    return textures.get(key);
  };

  function layerIndex(id) {
    // stack by category layer, then by wear order
    const list = order.filter((x) => worn.has(x)).map((x) => worn.get(x).garment);
    list.sort((a, b) => layerOf(a.category) - layerOf(b.category) || order.indexOf(a.id) - order.indexOf(b.id));
    return list.findIndex((x) => x.id === id);
  }

  async function build(id) {
    const entry = worn.get(id);
    if (!entry) return;
    const tex = await texFor(entry.garment);
    if (!worn.has(id)) return;
    const mesh = buildGarmentMesh({ garment: entry.garment, texture: tex, alphaAt: tex.alphaAt, body, layer: layerIndex(id) });
    if (entry.mesh) { figure.remove(entry.mesh); disposeMesh(entry.mesh); }
    entry.mesh = mesh;
    figure.add(mesh);
  }

  const rebuildAll = () => Promise.all([...worn.keys()].map(build));

  return {
    get body() { return body; },
    isWorn: (id) => worn.has(id),
    wornIds: () => order.filter((x) => worn.has(x)),

    async wear(garment) {
      // one garment per slot: a new bottom replaces the old bottom, etc.
      const slot = (c) => (c === 'dress' ? 'full' : ['pants', 'shorts', 'skirt'].includes(c) ? 'bottom' : c === 'outerwear' ? 'outer' : 'top');
      for (const [id, e] of worn) {
        const a = slot(e.garment.category), b = slot(garment.category);
        if (id !== garment.id && (a === b || (b === 'full' && a !== 'outer') || (a === 'full' && b !== 'outer'))) this.takeOff(id);
      }
      worn.set(garment.id, { garment, mesh: worn.get(garment.id)?.mesh || null });
      order = [...order.filter((x) => x !== garment.id), garment.id];
      await rebuildAll();
    },

    takeOff(id) {
      const e = worn.get(id);
      if (!e) return;
      if (e.mesh) { figure.remove(e.mesh); disposeMesh(e.mesh); }
      worn.delete(id);
      order = order.filter((x) => x !== id);
    },

    async update(garment) {
      if (!worn.has(garment.id)) return;
      worn.get(garment.id).garment = garment;
      await rebuildAll();
    },

    async setBody(params) {
      body = createBody(params);
      figure.remove(mannequin);
      disposeMesh(mannequin);
      mannequin = buildMannequin(body);
      figure.add(mannequin);
      await rebuildAll();
    },

    forget(id) {
      this.takeOff(id);
      for (const [k, p] of textures) if (k.startsWith(`${id}:`)) { p.then((t) => t.dispose()).catch(() => {}); textures.delete(k); }
    },
  };
}
