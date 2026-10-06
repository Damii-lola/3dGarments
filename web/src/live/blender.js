/**
 * The live link to Blender (tools/blender/live.py): ?blender=1 (or ?blender=ws://host:port).
 *
 * - Sends the body EXACTLY as it stands on screen: sex + every vertex's world position (pose, height, width, every
 *   shape slider). Blender puts it on its own copy of the same model (same vertices, same order), so whatever is
 *   modelled there is modelled on this body. Re-sent whenever the body changes.
 * - Draws what Blender streams back (the meshes in its "Garments" collection, live: cloth frames as they simulate)
 *   in world space, on the body.
 * A small badge shows the link's state. Reconnects every 2 s while Blender isn't there.
 */
import * as THREE from 'three';

const b64 = (buf) => {
  const u = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s, T) => {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
};

/** world positions of the body as drawn (CPU morphs + skinning + the model's transform) */
function bodyPositions(human) {
  const B = human.active, mesh = B.mesh, g = mesh.geometry;
  mesh.userData.cpuMorphUpdate?.();
  human.object.updateMatrixWorld(true);
  mesh.skeleton.update();
  const P = g.attributes.position.array, MP = g.attributes.morphPos?.array, n = P.length / 3;
  const out = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3] + (MP ? MP[i * 3] : 0), P[i * 3 + 1] + (MP ? MP[i * 3 + 1] : 0), P[i * 3 + 2] + (MP ? MP[i * 3 + 2] : 0));
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}

/** a cheap fingerprint of everything that moves the body */
function bodyKey(human) {
  const B = human.active, mesh = B.mesh;
  mesh.updateMatrixWorld(true);
  const bones = B.bones.map((b) => b.quaternion.toArray().map((x) => x.toFixed(4)).join(',')).join(';');
  return `${human.sex}|${(mesh.morphTargetInfluences || []).map((x) => x.toFixed(4)).join(',')}|${mesh.matrixWorld.elements.map((x) => x.toFixed(4)).join(',')}|${bones}`;
}

export function connectBlender({ human, stage, url = 'ws://127.0.0.1:8790' }) {
  const group = new THREE.Group();
  group.name = 'blender-live';
  stage.scene ? stage.scene.add(group) : stage.root.parent.add(group);
  const meshes = new Map();
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:50;padding:6px 10px;border-radius:8px;font:12px/1.2 system-ui,sans-serif;background:rgba(20,20,20,.75);color:#fff;pointer-events:none';
  document.body.append(badge);
  const say = (s, ok) => { badge.textContent = `Blender: ${s}`; badge.style.background = ok ? 'rgba(22,110,60,.85)' : 'rgba(20,20,20,.75)'; };

  let ws = null, lastKey = '', timer = 0;
  const sendBody = (force = false) => {
    if (!ws || ws.readyState !== 1 || !human) return;
    const k = bodyKey(human);
    if (!force && k === lastKey) return;
    lastKey = k;
    ws.send(JSON.stringify({ t: 'body', sex: human.sex, pos: b64(bodyPositions(human)) }));
  };

  const onMesh = (m) => {
    let o = meshes.get(m.id);
    if (!o || m.idx) {
      if (o) { group.remove(o); o.geometry.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(unb64(m.pos, Float32Array), 3));
      geo.setIndex(new THREE.BufferAttribute(unb64(m.idx, Uint32Array), 1));
      geo.computeVertexNormals();
      const c = m.color || [0.92, 0.92, 0.9];
      const mat = m.style === 'wire'
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), wireframe: true, transparent: true, opacity: 0.35 })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      o = new THREE.Mesh(geo, mat);
      o.name = `blender:${m.id}`;
      o.castShadow = o.receiveShadow = m.style !== 'wire';
      o.frustumCulled = false;
      meshes.set(m.id, o);
      group.add(o);
    } else {
      const a = o.geometry.attributes.position;
      a.array.set(unb64(m.pos, Float32Array));
      a.needsUpdate = true;
      o.geometry.computeVertexNormals();
    }
    stage.invalidate(2);
  };

  const open = () => {
    say('connecting…');
    try { ws = new WebSocket(url); } catch { return setTimeout(open, 2000); }
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello' })); lastKey = ''; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { say(`live (Blender ${m.blender})`, true); sendBody(true); }
      else if (m.t === 'mesh') onMesh(m);
      else if (m.t === 'remove') { const o = meshes.get(m.id); if (o) { group.remove(o); o.geometry.dispose(); meshes.delete(m.id); stage.invalidate(2); } }
      else if (m.t === 'error') console.warn('[blender]', m.msg);
    };
    ws.onclose = () => { say('not connected (start tools/blender/live.py)'); ws = null; setTimeout(open, 2000); };
  };
  open();
  // the body changes on sliders, poses, sex: send it when it settles (checked 4× a second, cheap fingerprint)
  timer = setInterval(() => sendBody(false), 250);
  return { group, meshes, get socket() { return ws; }, sendBody, close() { clearInterval(timer); ws?.close(); badge.remove(); group.removeFromParent(); } };
}
