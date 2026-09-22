// CesiumMan 化身。骨骼映射沿用 body3d.js（9/22 浏览器里验过）：
//   leg_joint_*_1 = 髋，_2 = 膝；髋角约定 负 = 屈曲 → flex = -frame.l
// 轴（9/23 审查在浏览器里逐轴量过骨骼世界坐标）：髋绕局部 Y 负转 = 大腿前抬；膝绕局部 Y 正转 = 小腿后弯（负 = 反关节）。
//   以前绕 X 转，屈髋时腿往侧面劈开——别改回去。
// 影子登山者用同一个模型，换成半透明材质。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

export const MODEL_YAW = Math.PI / 2;      // 让模型正面朝局部 +X（路线前进方向），截图验过；错了改这里
const d2r = Math.PI / 180, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), qT = new THREE.Quaternion(), qA = new THREE.Quaternion();
// 手臂 = rest·Rx(放下)·Rz(摆)（9/23 修复 G 在浏览器里量的）：局部 X 放下（左 +60、右 −60；70° 会插进躯干）；
//   放下之后再绕局部 Z 才是前后摆，两臂同号即一前一后（Rz 放在 Rx 前面几乎不摆）。右臂静止偏后，加 −15° 补成左右对称。
const ARM_DOWN = 60, ARM_SWING = 0.6, ARM_R_OFF = -15;
let bufP = null;
async function freshScene() {           // 每个化身各解析一次 glb（带骨骼的网格直接 clone 会共用骨架）
  const buf = await (bufP || (bufP = fetch('/models/CesiumMan.glb').then(r => r.arrayBuffer())));
  return new Promise((res, rej) => new GLTFLoader().parse(buf.slice(0), '/models/', g => res(g.scene), rej));
}

export async function loadAvatar({ ghost = false, color = '#9fe8ff', opacity = 0.42 } = {}) {
  const model = await freshScene();
  const outer = new THREE.Group(); outer.name = ghost ? 'ghost' : 'avatar';
  model.rotation.y = MODEL_YAW; outer.add(model);
  const bones = {}, mats = [];
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      if (ghost) { o.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }); o.renderOrder = 2; }
      mats.push(o.material);
    }
  });
  const J = n => bones[n] || null;
  const hipL = J('leg_joint_L_1'), hipR = J('leg_joint_R_1'), kneeL = J('leg_joint_L_2'), kneeR = J('leg_joint_R_2');
  const rest = new Map();
  const armL = J('Skeleton_arm_joint_L__4_'), armR = J('Skeleton_arm_joint_R');
  for (const b of [hipL, hipR, kneeL, kneeR, armL, armR]) if (b) rest.set(b, b.quaternion.clone());
  const arm = (b, swing, down) => { if (b) b.quaternion.copy(rest.get(b)).multiply(qA.setFromAxisAngle(X, down * d2r)).multiply(qT.setFromAxisAngle(Z, swing * d2r)); };
  const set = (b, deg) => { if (b) b.quaternion.copy(rest.get(b)).multiply(qT.setFromAxisAngle(Y, deg * d2r)); };
  const head = J('Skeleton_neck_joint_2');
  const tmp = new THREE.Vector3();
  return {
    group: outer, bones, mats,
    // flex 度，正 = 前抬。膝没有传感器：屈髋时跟着弯，看起来像走路而不是踢腿
    pose(flexL, flexR) {
      const fl = Math.max(-35, Math.min(70, flexL)), fr = Math.max(-35, Math.min(70, flexR));
      set(hipL, -fl); set(hipR, -fr);
      set(kneeL, Math.max(0, fl) * 0.9 + 4); set(kneeR, Math.max(0, fr) * 0.9 + 4);
      const sw = (fr - fl) / 2 * ARM_SWING;       // 手臂和同侧腿反向摆
      arm(armL, sw, ARM_DOWN); arm(armR, sw + ARM_R_OFF, -ARM_DOWN);
    },
    headWorld(out = tmp) { if (head) head.getWorldPosition(out); else outer.getWorldPosition(out).setY(outer.position.y + 1.4); return out; },
  };
}

// 真实髋角 → 屈曲角（body3d CONVENTION.flexSign = -1）
export const flexFromFrame = f => f ? [-f.l, -f.r] : [0, 0];
