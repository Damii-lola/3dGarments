/**
 * Viewer stage: renderer, camera, studio lights, camera views and post (ambient occlusion).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';

export const LIGHTING = {
  soft: { label: 'Soft box', key: 3.0, fill: 0.45, rim: 1.4, env: 0.38, keyAz: 34, keyEl: 52 },
};

const deg = THREE.MathUtils.degToRad;

/**
 * Phones and small tablets get a lighter live view (lower pixel density, half-res AO, smaller
 * shadow map, less MSAA).
 */
export const LOW_POWER = typeof window !== 'undefined' && (
  window.matchMedia?.('(pointer: coarse)').matches
  || Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 820
  || (navigator.hardwareConcurrency || 8) <= 4);

export function createStage(container) {
  // no preserveDrawingBuffer: it costs a full-frame copy per frame on phones
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const REST_RATIO = Math.min(window.devicePixelRatio || 1, LOW_POWER ? 1.5 : 2);
  renderer.setPixelRatio(REST_RATIO);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  let pmrem = new THREE.PMREMGenerator(renderer);
  let roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
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
  key.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.4, bottom: -0.6, near: 0.5, far: 20 });
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 5;
  key.shadow.blurSamples = LOW_POWER ? 8 : 16;
  const fill = new THREE.DirectionalLight(0xe8f0ff, 0.9);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  // the studio rig (backdrop + lights) turns with the camera
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
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  const ao = new N8AOPass(scene, camera, 1, 1);
  // N8AO draws the scene itself into this target; multisample it or every edge stair-steps
  ao.beautyRenderTarget.samples = 4;
  Object.assign(ao.configuration, {
    aoRadius: 0.26, distanceFalloff: 1.3, intensity: 3.2, color: new THREE.Color('#1a0d08'),
    gammaCorrection: false, screenSpaceRadius: false, halfRes: LOW_POWER, depthAwareUpsampling: true,
    aoSamples: LOW_POWER ? 8 : 16, denoiseSamples: LOW_POWER ? 4 : 8, denoiseRadius: 8, transparencyAware: false,
  });
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  let aoEnabled = true;
  let dragging = false;
  let cheap = false; // phones: while anything is moving the AO pass sits out and the resolution adapts
  const draw = (full = false) => (aoEnabled && (full || !cheap) ? composer.render() : renderer.render(scene, camera));

  const state = {
    env: { color: '#e9e6e1' },
    light: { preset: 'soft', rotation: 0, intensity: 1 },
  };

  /** Studio backdrop colour (the only environment the fitting room needs). */
  function setEnvironment(patch = {}) {
    if (patch.color) state.env.color = patch.color;
    scene.environment = roomEnv;
    cyc.visible = true;
    cyc.material.color.set(state.env.color);
    catcher.visible = false;
    applyLighting();
    invalidate(6);
  }

  function setLighting(patch) {
    Object.assign(state.light, patch);
    applyLighting();
    invalidate();
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
    scene.environmentIntensity = L.env * k;
  }

  /* ---------------- camera views ---------------- */
  let tween = null, currentView = null, userMoved = false;
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
    currentView = name; userMoved = false;
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
  controls.addEventListener('start', () => { tween = null; userMoved = true; });

  /* ---------------- loop ---------------- */
  let autoRotate = false;
  const clock = new THREE.Clock();
  // Render on demand: only while something moves (drag, damping, view tween, turntable, a slider
  // being dragged = invalidate(n, true)) or for a few frames after invalidate(); plus a slow safety
  // redraw. While live on a phone, frames skip AO and render at an adaptive pixel ratio; when it
  // settles, one full-quality frame (AO, full resolution) is drawn.
  const SAFETY_MS = LOW_POWER ? 2000 : 1000;
  const lastCam = new THREE.Vector3();
  let frames = 3, lastDraw = 0, controlsMoved = false, liveUntil = 0, wasLive = false, lost = false;
  let liveRatio = LOW_POWER ? Math.min(REST_RATIO, 1) : REST_RATIO, ema = 16, liveFrames = 0, lastT = 0, downgraded = false;
  const invalidate = (n = 3, live = false) => {
    frames = Math.max(frames, n);
    if (live) liveUntil = performance.now() + 250;
  };
  const setRatio = (r) => { if (renderer.getPixelRatio() !== r) renderer.setPixelRatio(r); };
  controls.addEventListener('change', () => { controlsMoved = true; });
  controls.addEventListener('start', () => { dragging = true; invalidate(); });
  controls.addEventListener('end', () => { dragging = false; invalidate(4); });
  renderer.setAnimationLoop((t) => {
    if (lost) return;
    const dt = Math.min(0.05, clock.getDelta());
    stepTween();
    if (autoRotate) root.rotation.y += dt * 0.45;
    controlsMoved = false;
    controls.update();
    // the damping tail keeps firing 'change' for seconds after it stops being visible (< 0.3 mm)
    if (controlsMoved && camera.position.distanceToSquared(lastCam) < 1e-7 && !dragging) controlsMoved = false;
    lastCam.copy(camera.position);
    const live = !!(controlsMoved || tween || autoRotate || dragging || performance.now() < liveUntil);
    if (wasLive && !live) frames = Math.max(frames, 2); // settle: one full-quality frame
    wasLive = live;
    if (!live && frames <= 0 && t - lastDraw < SAFETY_MS) { lastT = 0; return; }
    frames = Math.max(0, frames - 1);
    if (live && LOW_POWER) {
      // adaptive resolution: drop when frames run long, probe upward only until the first drop
      if (lastT) {
        ema += (Math.min(t - lastT, 100) - ema) * 0.15;
        if (++liveFrames % 20 === 0) {
          if (ema > 24 && liveRatio > 0.6) { liveRatio = Math.max(0.6, liveRatio - 0.15); downgraded = true; }
          else if (!downgraded && ema < 18 && liveRatio < REST_RATIO) liveRatio = Math.min(REST_RATIO, liveRatio + 0.125);
        }
      }
      lastT = t;
    } else lastT = 0;
    cheap = LOW_POWER && live;
    setRatio(cheap ? liveRatio : REST_RATIO);
    rig.rotation.y = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    draw();
    lastDraw = t;
  });

  const resizeSubs = new Set();
  let resizeTimer = 0, sizedAspect = 0;
  // reallocating the drawing buffer + post targets is what the GPU hates mid-rotation, so it waits
  // until the size settles; meanwhile the camera already has the new aspect (the canvas stretches)
  const allocate = () => {
    clearTimeout(resizeTimer);
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(REST_RATIO);
    composer.setSize(w, h);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    const aspect = w / h;
    // a new orientation re-frames the current view unless the user has moved the camera since
    if (sizedAspect && Math.abs(aspect - sizedAspect) / sizedAspect > 0.08 && currentView && !userMoved) setView(currentView, { instant: true });
    sizedAspect = aspect;
    invalidate(4);
  };
  const resize = (immediate = false) => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resizeSubs.forEach((fn) => fn());
    invalidate(4);
    if (immediate) allocate();
    else { clearTimeout(resizeTimer); resizeTimer = setTimeout(allocate, 180); }
  };
  new ResizeObserver(() => resize()).observe(container);
  resize(true);
  // iOS: sizes can land late after a rotation, and a backgrounded page's canvas may be discarded
  const settle = () => { resize(); setTimeout(() => resize(), 400); };
  window.addEventListener('orientationchange', settle);
  window.visualViewport?.addEventListener('resize', () => resize());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(4); });
  window.addEventListener('pageshow', () => invalidate(4));

  // the GPU can drop the context (memory pressure on a rotation, a backgrounded tab): rebuild what
  // lived only on the GPU (the prefiltered environments) and carry on
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    lost = false;
    pmrem = new THREE.PMREMGenerator(renderer);
    roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    resize(true);
    setEnvironment({});
  });

  setEnvironment({});

  return {
    renderer, scene, camera, controls, root, key,
    setView, setEnvironment, setLighting, onResize(fn) { resizeSubs.add(fn); },
    get environment() { return { ...state.env }; },
    get lighting() { return { ...state.light }; },
    setSubjectHeight(h) { subjectHeight = h; },
    setExposure(v) { renderer.toneMappingExposure = v; invalidate(); },
    setAO(v) { aoEnabled = !!v; invalidate(); },
    /** ask for a redraw after changing anything in the scene (pose, shape, skin …) */
    invalidate,
    ao,
    setAutoRotate(v) { autoRotate = v; if (!v) root.rotation.y = 0; invalidate(); },
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
