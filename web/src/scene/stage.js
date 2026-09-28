import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const VIEWS = {
  front: { az: 0, el: 0.06, dist: 4.6 },
  side: { az: Math.PI / 2, el: 0.06, dist: 4.6 },
  back: { az: Math.PI, el: 0.06, dist: 4.6 },
  close: { az: 0.35, el: 0.05, dist: 2.1, ty: 1.28 },
};

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.0;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.6;
  controls.target.set(0, 0.92, 0);
  camera.position.set(0, 1.2, 4.6);

  // lights
  scene.add(new THREE.HemisphereLight(0xfff6ec, 0x2a2f38, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(2.2, 4.2, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1.4; key.shadow.camera.right = 1.4;
  key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -0.4;
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4);
  rim.position.set(-3, 2.6, -3.2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffe2c4, 0.5);
  fill.position.set(-3, 1.4, 2.5);
  scene.add(fill);

  // floor: soft contact shadow + radial glow
  const shadowFloor = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = grad; gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.001;
  scene.add(glow);

  const root = new THREE.Group();
  scene.add(root);

  // camera tweening — orbit around the target (never cuts through the figure), time-based
  let tween = null;
  const sph = new THREE.Spherical();
  function setView(name) {
    const v = VIEWS[name] || VIEWS.front;
    const target = new THREE.Vector3(0, v.ty ?? 0.92, 0);
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    let az = v.az;
    while (az - sph.theta > Math.PI) az -= Math.PI * 2;
    while (az - sph.theta < -Math.PI) az += Math.PI * 2;
    tween = {
      start: performance.now(), dur: 850,
      from: { r: sph.radius, th: sph.theta, ph: sph.phi, t: controls.target.clone() },
      to: { r: v.dist, th: az, ph: Math.PI / 2 - v.el, t: target },
    };
  }
  function stepTween() {
    if (!tween) return;
    const k = Math.min(1, (performance.now() - tween.start) / tween.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const { from: a, to: b } = tween;
    controls.target.lerpVectors(a.t, b.t, e);
    sph.set(a.r + (b.r - a.r) * e, a.ph + (b.ph - a.ph) * e, a.th + (b.th - a.th) * e);
    camera.position.setFromSpherical(sph).add(controls.target);
    if (k >= 1) tween = null;
  }

  let autoRotate = false;
  controls.addEventListener('start', () => { tween = null; });
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    stepTween();
    if (autoRotate) root.rotation.y += dt * 0.5;
    insetTick();
    controls.update();
    renderer.render(scene, camera);
  });

  // bottomInset: px of the canvas covered by UI (mobile sheet) — shift the render up so the figure stays visible
  let bottomInset = 0, insetNow = 0;
  const applyView = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.zoom = Math.max(0.5, Math.min(1, (h - insetNow) / h + 0.06));
    // render the full canvas, but centre the figure in the part not covered by UI
    if (insetNow > 0.5) camera.setViewOffset(w, h, 0, Math.min(insetNow, h * 0.6) / 2, w, h);
    else camera.clearViewOffset();
    camera.fov = w / h < 0.8 ? 38 : 28;
    camera.updateProjectionMatrix();
  };
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    applyView();
  };
  const insetTick = () => {
    if (Math.abs(insetNow - bottomInset) > 0.5) {
      insetNow += (bottomInset - insetNow) * 0.18;
      applyView();
    }
  };
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    renderer, scene, camera, controls, root,
    setView,
    setBottomInset(px) { bottomInset = Math.max(0, px); },
    setAutoRotate(v) { autoRotate = v; if (!v) root.rotation.y = 0; },
    get autoRotate() { return autoRotate; },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  };
}
