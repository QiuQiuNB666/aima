// CesiumMan 化身。骨骼映射沿用 body3d.js（9/22 浏览器里验过）：
//   leg_joint_*_1 = 髋，_2 = 膝；髋角约定 负 = 屈曲 → flex = -frame.l
// 轴（9/23 审查在浏览器里逐轴量过骨骼世界坐标）：髋绕局部 Y 负转 = 大腿前抬；膝绕局部 Y 正转 = 小腿后弯（负 = 反关节）。
//   以前绕 X 转，屈髋时腿往侧面劈开——别改回去。
// 影子登山者用同一个模型，换成半透明材质。
// 化身不用 CesiumMan 自带的条纹贴图（3 米外像缠了胶带）：按绑定姿态高度分 3 块纯色（腿 = 深色外骨骼、躯干 = 浅色衣服、头盔），
//   外加不吃场景光的轮廓光（fresnel）和一点自发光——夜景里不会被染成一团深蓝，浅色石阶上也有边。主题可用 theme.avatar 改色。
export const AVATAR_LOOK = { leg: '#39424f', body: '#eef2f6', head: '#cfd8e2', rim: '#8ff0ff', rimK: 0.9, self: 0.22, headScale: 0.86 };
const LEG_Z = 0.80, HEAD_Z = 1.30;         // 绑定姿态（z 向上，身高 1.51）里的分界高度：髋 / 脖子

function zonedMaterial(L) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const U = { uLeg: { value: new THREE.Color(L.leg) }, uBody: { value: new THREE.Color(L.body) }, uHead: { value: new THREE.Color(L.head) },
    uRim: { value: new THREE.Color(L.rim) }, uRimK: { value: L.rimK }, uSelf: { value: L.self } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZ = position.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vZ;\nuniform vec3 uLeg, uBody, uHead, uRim;\nuniform float uRimK, uSelf;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 zc = vZ < ${LEG_Z.toFixed(2)} ? uLeg : vZ < ${HEAD_Z.toFixed(2)} ? uBody : uHead;
        diffuseColor.rgb *= zc;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        totalEmissiveRadiance += zc * uSelf + uRim * pow(fr, 2.2) * uRimK;`);
  };
  m.userData.look = U;
  return m;
}
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

export async function loadAvatar({ ghost = false, color = '#9fe8ff', opacity = 0.42, look = null } = {}) {
  const model = await freshScene();
  const outer = new THREE.Group(); outer.name = ghost ? 'ghost' : 'avatar';
  model.rotation.y = MODEL_YAW; outer.add(model);
  const bones = {}, mats = [], L = { ...AVATAR_LOOK, ...(look || {}) };
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      if (ghost) { o.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }); o.renderOrder = 2; }
      else o.material = zonedMaterial(L);
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
  if (head) head.scale.setScalar(L.headScale);   // 头盔球原来约占身高 1/5.5，偏大
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
