/** Minimal glTF binary reader: the first mesh primitive's rest positions, normals, UVs and triangle indices. */
export function readGlbMesh(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a .glb file');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + start, len).toString('utf8'));
    else if (type === 0x004e4942) bin = new Uint8Array(buf.buffer, buf.byteOffset + start, len);
    off = start + len;
  }
  if (!json || !bin) throw new Error('glb has no JSON or BIN chunk');
  const prim = json.meshes?.[0]?.primitives?.[0];
  if (!prim) throw new Error('glb has no mesh');
  const read = (idx, comps, Type) => {
    const a = json.accessors[idx], bv = json.bufferViews[a.bufferView], o = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || comps * Type.BYTES_PER_ELEMENT, out = new Type(a.count * comps), v = new DataView(bin.buffer, bin.byteOffset);
    const get = { Float32Array: 'getFloat32', Uint32Array: 'getUint32', Uint16Array: 'getUint16', Uint8Array: 'getUint8' }[Type.name];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = v[get](o + i * stride + c * Type.BYTES_PER_ELEMENT, true);
    return out;
  };
  const pos = read(prim.attributes.POSITION, 3, Float32Array);
  const uv = prim.attributes.TEXCOORD_0 != null ? read(prim.attributes.TEXCOORD_0, 2, Float32Array) : null;
  const ia = json.accessors[prim.indices];
  const raw = read(prim.indices, 1, ia.componentType === 5125 ? Uint32Array : ia.componentType === 5123 ? Uint16Array : Uint8Array);
  const index = Uint32Array.from(raw);
  let nrm = prim.attributes.NORMAL != null ? read(prim.attributes.NORMAL, 3, Float32Array) : null;
  if (!nrm) {                                              // area-weighted smooth normals
    nrm = new Float32Array(pos.length);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
    }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  }
  if (!uv) throw new Error('the template has no UVs: nothing to paint a texture onto');
  return { pos, nrm, uv, index };
}
