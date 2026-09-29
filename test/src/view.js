// Raw viewer for body files (FBX / GLB): studio lighting, optional clay material, no rig logic.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createStage } from '@web/scene/stage.js';

const q = new URLSearchParams(location.search);
const stage = createStage(document.querySelector('#v'));
const file = q.get('file') || './body/male.glb';
const obj = file.endsWith('.fbx') ? await new FBXLoader().loadAsync(file) : (await new GLTFLoader().loadAsync(file)).scene;
// normalise: feet on the floor, height in metres
obj.updateMatrixWorld(true);
let box = new THREE.Box3().setFromObject(obj);
const h = box.max.y - box.min.y;
obj.scale.multiplyScalar((+q.get('h') || 1.8) / h);
obj.updateMatrixWorld(true);
box = new THREE.Box3().setFromObject(obj);
obj.position.y -= box.min.y;
obj.position.x -= (box.min.x + box.max.x) / 2;
obj.position.z -= (box.min.z + box.max.z) / 2;
const clay = new THREE.MeshPhysicalMaterial({ color: '#8e8f93', roughness: 0.55, sheen: 0.2 });
obj.traverse((o) => {
  if (!o.isMesh) return;
  if (q.get('clay')) o.material = clay;
  o.castShadow = o.receiveShadow = true;
  o.frustumCulled = false;
});
stage.root.add(obj);
stage.setSubjectHeight(+q.get('h') || 1.8);
stage.setView(q.get('view') || 'front', { instant: true });
window.__view = { stage, obj, THREE, ready: true };
