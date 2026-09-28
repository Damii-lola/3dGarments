/**
 * Photo studio: renderer, camera, lights, environments/backdrops and hi-res capture.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';

/** CC0 Poly Haven HDRIs, bundled by @pmndrs/assets (loaded on demand). */
export const HDRIS = {
  studio: { label: 'Photo studio', load: () => import('@pmndrs/assets/hdri/studio.exr.js') },
  apartment: { label: 'Apartment', load: () => import('@pmndrs/assets/hdri/apartment.exr.js') },
  lobby: { label: 'Hotel lobby', load: () => import('@pmndrs/assets/hdri/lobby.exr.js') },
  hall: { label: 'Hall', load: () => import('@pmndrs/assets/hdri/hall.exr.js') },
  warehouse: { label: 'Warehouse', load: () => import('@pmndrs/assets/hdri/warehouse.exr.js') },
  workshop: { label: 'Workshop', load: () => import('@pmndrs/assets/hdri/workshop.exr.js') },
  city: { label: 'City street', load: () => import('@pmndrs/assets/hdri/city.exr.js') },
  venice: { label: 'Venice', load: () => import('@pmndrs/assets/hdri/venice.exr.js') },
  esplanade: { label: 'Esplanade', load: () => import('@pmndrs/assets/hdri/esplanade.exr.js') },
  bridge: { label: 'Bridge', load: () => import('@pmndrs/assets/hdri/bridge.exr.js') },
  park: { label: 'Park', load: () => import('@pmndrs/assets/hdri/park.exr.js') },
  forest: { label: 'Forest', load: () => import('@pmndrs/assets/hdri/forest.exr.js') },
  sky: { label: 'Open sky', load: () => import('@pmndrs/assets/hdri/sky.exr.js') },
  dawn: { label: 'Dawn', load: () => import('@pmndrs/assets/hdri/dawn.exr.js') },
  sunrise: { label: 'Sunrise', load: () => import('@pmndrs/assets/hdri/sunrise.exr.js') },
  sunset: { label: 'Sunset', load: () => import('@pmndrs/assets/hdri/sunset.exr.js') },
  night: { label: 'Night', load: () => import('@pmndrs/assets/hdri/night.exr.js') },
};

export const LIGHTING = {
  soft: { label: 'Soft box', key: 3.0, fill: 0.45, rim: 1.4, env: 0.38, keyAz: 34, keyEl: 52 },
  bright: { label: 'High key', key: 1.8, fill: 1.5, rim: 0.8, env: 0.95, keyAz: 20, keyEl: 30 },
  dramatic: { label: 'Dramatic', key: 3.4, fill: 0.15, rim: 2.2, env: 0.18, keyAz: 60, keyEl: 30 },
  rim: { label: 'Rim light', key: 1.2, fill: 0.4, rim: 3.6, env: 0.35, keyAz: -25, keyEl: 25 },
  natural: { label: 'Environment only', key: 0, fill: 0, rim: 0, env: 1, keyAz: 35, keyEl: 45 },
};

const deg = THREE.MathUtils.degToRad;

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environment = roomEnv;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 1.1, 5.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.58;
  controls.target.set(0, 0.9, 0);
  controls.screenSpacePanning = true;

  /* ---------------- lights ---------------- */
  const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.4, bottom: -0.6, near: 0.5, far: 20 });
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.9);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  // the studio rig (backdrop + lights) turns with the camera, like a photographer's set
  const rig = new THREE.Group();
  rig.add(key, key.target, fill, rim);
  scene.add(rig);

  /* ---------------- backdrops ---------------- */
  const cyc = buildCyclorama();
  rig.add(cyc);
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  catcher.renderOrder = -1;
  scene.add(catcher);

  const root = new THREE.Group();
  scene.add(root);

  /* ---------------- post: ambient occlusion → tone mapping / sRGB ---------------- */
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const ao = new N8AOPass(scene, camera, 1, 1);
  Object.assign(ao.configuration, {
    aoRadius: 0.26, distanceFalloff: 1.3, intensity: 3.2, color: new THREE.Color('#1a0d08'),
    gammaCorrection: false, screenSpaceRadius: false, halfRes: false, depthAwareUpsampling: true,
    aoSamples: 16, denoiseSamples: 8, denoiseRadius: 8, transparencyAware: false,
  });
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  let aoEnabled = true;
  const draw = () => (aoEnabled ? composer.render() : renderer.render(scene, camera));

  const state = {
    env: { kind: 'studio', color: '#e9e6e1', hdri: 'studio', blur: 0.35, rotation: 0, intensity: 1, image: null },
    light: { preset: 'soft', rotation: 0, intensity: 1 },
  };
  const hdrCache = new Map();
  let imageTex = null;

  async function hdrTexture(name) {
    if (!hdrCache.has(name)) {
      hdrCache.set(name, (async () => {
        const url = (await HDRIS[name].load()).default;
        const tex = await new EXRLoader().loadAsync(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return { bg: tex, env: pmrem.fromEquirectangular(tex).texture };
      })());
    }
    return hdrCache.get(name);
  }

  let envToken = 0;
  async function setEnvironment(patch) {
    Object.assign(state.env, patch);
    const e = state.env;
    const token = ++envToken;
    let env = roomEnv, bg = null;
    if (e.kind === 'hdri') {
      const t = await hdrTexture(e.hdri);
      if (token !== envToken) return;
      env = t.env; bg = t.bg;
    }
    if (e.kind === 'image' && e.image) {
      if (!imageTex || imageTex.userData.src !== e.image) {
        imageTex?.dispose();
        imageTex = await new THREE.TextureLoader().loadAsync(e.image);
        imageTex.colorSpace = THREE.SRGBColorSpace;
        imageTex.userData.src = e.image;
        if (token !== envToken) return;
      }
      bg = imageTex;
    }
    scene.environment = env;
    scene.environmentRotation.y = deg(e.rotation);
    scene.backgroundRotation.y = deg(e.rotation);
    scene.backgroundBlurriness = e.kind === 'hdri' ? e.blur : 0;
    scene.backgroundIntensity = e.kind === 'hdri' ? e.intensity : 1;
    scene.background = e.kind === 'color' ? new THREE.Color(e.color) : bg;
    cyc.visible = e.kind === 'studio';
    cyc.material.color.set(e.color);
    catcher.visible = e.kind !== 'studio';
    applyLighting();
    fitImageBackground();
  }

  function setLighting(patch) {
    Object.assign(state.light, patch);
    applyLighting();
  }

  function applyLighting() {
    const L = LIGHTING[state.light.preset] || LIGHTING.soft;
    const k = state.light.intensity;
    const rot = deg(state.light.rotation);
    const place = (light, az, el, dist = 6) => {
      light.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist + 1, Math.cos(az) * Math.cos(el) * dist);
    };
    place(key, deg(L.keyAz) + rot, deg(L.keyEl));
    place(fill, deg(-L.keyAz * 1.3) + rot, deg(12));
    place(rim, deg(180 - L.keyAz * 0.6) + rot, deg(28));
    key.target.position.set(0, 0.9, 0);
    key.intensity = L.key * k;
    fill.intensity = L.fill * k;
    rim.intensity = L.rim * k;
    const hdri = state.env.kind === 'hdri';
    scene.environmentIntensity = (hdri ? Math.max(L.env, 0.6) : L.env) * (hdri ? state.env.intensity : 1) * k;
    catcher.material.opacity = hdri ? 0.42 : 0.3;
  }

  // image backgrounds: emulate background-size: cover
  function fitImageBackground(canvasAspect = camera.aspect) {
    const t = scene.background;
    if (!t || !t.isTexture || t.mapping === THREE.EquirectangularReflectionMapping || !t.image) return;
    const imgAspect = t.image.width / t.image.height;
    t.matrixAutoUpdate = false;
    const [sx, sy] = canvasAspect > imgAspect ? [1, imgAspect / canvasAspect] : [canvasAspect / imgAspect, 1];
    t.matrix.setUvTransform((1 - sx) / 2, (1 - sy) / 2, sx, sy, 0, 0, 0);
  }

  /* ---------------- camera views ---------------- */
  let tween = null;
  const sph = new THREE.Spherical();
  const VIEWS = {
    front: { az: 0, el: 4, frame: [-0.07, 1] },
    three: { az: 32, el: 6, frame: [-0.07, 1] },
    side: { az: 90, el: 4, frame: [-0.07, 1] },
    back: { az: 180, el: 4, frame: [-0.07, 1] },
    upper: { az: 12, el: 3, frame: [0.48, 1] },
    portrait: { az: 14, el: 2, frame: [0.76, 1.0] },
    feet: { az: 25, el: 14, frame: [0, 0.32] },
  };
  let subjectHeight = 1.72;
  function viewTarget(name, aspect = camera.aspect) {
    const v = VIEWS[name] || VIEWS.front;
    const H = subjectHeight;
    const y0 = v.frame[0] * H, y1 = v.frame[1] * H + 0.06;
    const span = (y1 - y0) * 1.14;
    const fov = deg(camera.fov);
    const distV = span / 2 / Math.tan(fov / 2);
    const distH = (span * 0.55) / 2 / Math.tan(fov / 2) / Math.min(1, aspect);
    return { az: deg(v.az), el: deg(v.el), dist: Math.max(distV, distH), ty: (y0 + y1) / 2 };
  }
  function setView(name, { instant = false } = {}) {
    const t = viewTarget(name);
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    let az = t.az;
    while (az - sph.theta > Math.PI) az -= Math.PI * 2;
    while (az - sph.theta < -Math.PI) az += Math.PI * 2;
    tween = {
      start: performance.now(), dur: instant ? 0 : 900,
      from: { r: sph.radius, th: sph.theta, ph: sph.phi, t: controls.target.clone() },
      to: { r: t.dist, th: az, ph: Math.PI / 2 - t.el, t: new THREE.Vector3(0, t.ty, 0) },
    };
    stepTween();
  }
  function stepTween() {
    if (!tween) return;
    const k = tween.dur ? Math.min(1, (performance.now() - tween.start) / tween.dur) : 1;
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const { from: a, to: b } = tween;
    controls.target.lerpVectors(a.t, b.t, e);
    sph.set(a.r + (b.r - a.r) * e, a.ph + (b.ph - a.ph) * e, a.th + (b.th - a.th) * e);
    camera.position.setFromSpherical(sph).add(controls.target);
    camera.lookAt(controls.target);
    if (k >= 1) tween = null;
  }
  controls.addEventListener('start', () => { tween = null; });

  /* ---------------- loop ---------------- */
  let autoRotate = false;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    stepTween();
    if (autoRotate) root.rotation.y += dt * 0.45;
    controls.update();
    rig.rotation.y = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    draw();
  });

  const resizeSubs = new Set();
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitImageBackground();
    resizeSubs.forEach((fn) => fn());
  };
  new ResizeObserver(resize).observe(container);
  resize();

  /* ---------------- capture ---------------- */
  /** The largest rect of `aspect` (w/h) centred in the viewport, in CSS px — what a shot will contain. */
  function cropRect(aspect) {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const pad = 0.94;
    let w = cw * pad, h = w / aspect;
    if (h > ch * pad) { h = ch * pad; w = h * aspect; }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, cw, ch };
  }

  /**
   * Render a still of exactly the crop frame, at any resolution.
   * @returns Promise<Blob>
   */
  async function capture({ aspect = 4 / 5, longEdge = 2048, transparent = false, shadow = true, type = 'image/png', quality = 0.94 } = {}) {
    const r = cropRect(aspect);
    const maxSize = Math.min(renderer.capabilities.maxTextureSize, 8192);
    const L = Math.min(longEdge, maxSize);
    const width = Math.round(aspect >= 1 ? L : L * aspect);
    const height = Math.round(aspect >= 1 ? L / aspect : L);
    const prev = {
      size: renderer.getSize(new THREE.Vector2()), ratio: renderer.getPixelRatio(),
      bg: scene.background, cyc: cyc.visible, catcher: catcher.visible, alpha: renderer.getClearAlpha(),
      shadowSize: key.shadow.mapSize.x,
    };
    if (transparent) { scene.background = null; cyc.visible = false; catcher.visible = shadow; renderer.setClearAlpha(0); }
    const setShadow = (n) => { key.shadow.mapSize.set(n, n); key.shadow.map?.dispose(); key.shadow.map = null; };
    setShadow(4096);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    camera.aspect = r.cw / r.ch;
    camera.setViewOffset(r.cw, r.ch, r.x, r.y, r.w, r.h);
    camera.updateProjectionMatrix();
    fitImageBackground(width / height);
    draw();
    const blob = await new Promise((res) => renderer.domElement.toBlob(res, transparent ? 'image/png' : type, quality));
    // restore
    camera.clearViewOffset();
    scene.background = prev.bg; cyc.visible = prev.cyc; catcher.visible = prev.catcher;
    renderer.setClearAlpha(prev.alpha);
    setShadow(prev.shadowSize);
    renderer.setPixelRatio(prev.ratio);
    renderer.setSize(prev.size.x, prev.size.y, false);
    resize();
    return { blob, width, height };
  }

  setEnvironment({});

  return {
    renderer, scene, camera, controls, root, key,
    setView, setEnvironment, setLighting, capture, cropRect, onResize(fn) { resizeSubs.add(fn); },
    get environment() { return { ...state.env }; },
    get lighting() { return { ...state.light }; },
    setSubjectHeight(h) { subjectHeight = h; },
    setExposure(v) { renderer.toneMappingExposure = v; },
    setAO(v) { aoEnabled = !!v; },
    ao,
    setAutoRotate(v) { autoRotate = v; if (!v) root.rotation.y = 0; },
    get autoRotate() { return autoRotate; },
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  };
}

/** Seamless photo backdrop: floor → cove → wall, one smooth surface. */
function buildCyclorama() {
  const pts = [];
  const zFront = 8, zWall = -3.2, r = 2.2, top = 9;
  pts.push(new THREE.Vector2(zFront, 0));
  pts.push(new THREE.Vector2(zWall + r, 0));
  for (let i = 1; i < 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    pts.push(new THREE.Vector2(zWall + r - Math.sin(a) * r, r - Math.cos(a) * r));
  }
  pts.push(new THREE.Vector2(zWall, r));
  pts.push(new THREE.Vector2(zWall, top));
  const W = 22, cols = 2;
  const pos = [], idx = [];
  pts.forEach((p) => { for (let c = 0; c <= cols; c++) pos.push(-W / 2 + (W * c) / cols, p.y, p.x); });
  for (let i = 0; i < pts.length - 1; i++) for (let c = 0; c < cols; c++) {
    const a = i * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#e9e6e1', roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  m.name = 'cyclorama';
  return m;
}
