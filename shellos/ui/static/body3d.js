// 真人 3D：Three.js + CesiumMan（Khronos glTF 示例，带骨骼）。全部本地文件，离线可用。
// 用法：import {initBody, updateBody} from './body3d.js'; initBody(container); updateBody(frame)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';

let scene, camera, renderer, controls, bones = {}, root, ready = false, rest = {};
const d2r = Math.PI / 180;

// 髋角约定：负 = 屈曲（坐着读到 -70°）。屈曲让大腿绕人体左右轴向前抬。
// 骨骼名和旋转轴在加载后按名字猜（见 pickBones），猜错了改这里。
export const CONVENTION = { flexSign: -1, pitchSign: 1, rollSign: 1 };

export function initBody(container) {
  const W = container.clientWidth, H = container.clientHeight || 300;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 50);
  camera.position.set(2.2, 1.4, 2.6);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // 省 GPU：控制循环和游戏屏同机
  renderer.setSize(W, H);
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0);
  controls.enablePan = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(2, 4, 3); scene.add(sun);
  const grid = new THREE.GridHelper(3, 12, 0x2a323c, 0x1c2229); scene.add(grid);

  new GLTFLoader().load('/models/CesiumMan.glb', g => {
    root = g.scene; scene.add(root);
    root.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.frustumCulled = false; } });
    pickBones();
    window.__bones = Object.keys(bones);   // 调试：在控制台看骨骼名
    window.__body = { bones, rest, THREE };
    ready = true;
  }, undefined, e => console.error('glb load failed', e));

  const loop = () => { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  window.addEventListener('resize', () => { const w = container.clientWidth, h = container.clientHeight || 300; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); });
}

let hipL, hipR, kneeL, kneeR, pelvis;
function pickBones() {
  // 9/22 在浏览器里验过：leg_joint_*_1 = 髋（y≈0.62）、_2 = 膝（0.36）、_3 = 踝、_5 = 趾；
  // 髋绕局部 X 轴正转 = 大腿前抬（屈曲）；Skeleton_torso_joint_1 = 骨盆根，转它整个下半身跟着转
  hipL = bones['leg_joint_L_1'] || null;  hipR = bones['leg_joint_R_1'] || null;
  kneeL = bones['leg_joint_L_2'] || null; kneeR = bones['leg_joint_R_2'] || null;
  pelvis = bones['Skeleton_torso_joint_1'] || null;
  for (const b of [hipL, hipR, kneeL, kneeR, pelvis]) if (b) rest[b.uuid] = b.quaternion.clone();
  console.log('bones', Object.keys(bones), { hipL: hipL && hipL.name, pelvis: pelvis && pelvis.name });
}

const qTmp = new THREE.Quaternion(), axisX = new THREE.Vector3(1, 0, 0), axisZ = new THREE.Vector3(0, 0, 1);
function setJoint(bone, ax, angleDeg) {
  if (!bone) return;
  bone.quaternion.copy(rest[bone.uuid]).multiply(qTmp.setFromAxisAngle(ax, angleDeg * d2r));
}

export function updateBody(f) {
  if (!ready || !f || window.__pause) return;
  const fl = CONVENTION.flexSign * f.l, fr = CONVENTION.flexSign * f.r;
  setJoint(hipL, axisX, fl);  setJoint(hipR, axisX, fr);
  // 膝角没有传感器：屈髋时让膝跟着弯一点，看起来像走路而不是踢腿
  setJoint(kneeL, axisX, -Math.max(0, fl) * 0.6);  setJoint(kneeR, axisX, -Math.max(0, fr) * 0.6);
  if (pelvis) {
    pelvis.quaternion.copy(rest[pelvis.uuid])
      .multiply(qTmp.setFromAxisAngle(axisX, CONVENTION.pitchSign * f.pitch * d2r))
      .multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, CONVENTION.rollSign * f.roll * d2r));
  }
}
