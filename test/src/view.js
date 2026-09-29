// Raw viewer for the generated body GLB (tools/body): studio lighting, clay material, no rig logic.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage } from '@web/scene/stage.js';

const stage = createStage(document.querySelector('#v'));
const gltf = await new GLTFLoader().loadAsync(`./body/male.glb?${Date.now()}`);
const mat = new THREE.MeshPhysicalMaterial({ color: '#8e8f93', roughness: 0.55, sheen: 0.2 });
gltf.scene.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = o.receiveShadow = true; } });
stage.root.add(gltf.scene);
stage.setSubjectHeight(1.85);
const v = new URLSearchParams(location.search).get('view') || 'front';
stage.setView(v, { instant: true });
window.__view = { stage, ready: true };
