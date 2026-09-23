// J 线 · 峰哥的助理（9/23 夜起，替换追兵「捷风」；旧版用 ?npc=jifeng，在 npc_jifeng.js，没删）。
// 造型：CesiumMan 骨架（和峰哥同一套）→ P 线的放样身体 + 这里的曲线（assistant/body.js）+ 穿搭（assistant/outfits.js）；
//   A2 的动作（anim.js）照用，所以是真的在跑。风格对齐峰哥：平面着色、哑光低多边形。CesiumMan 原网格藏掉，外骨骼不给她穿。
// 接口和 npc_jifeng.js 的 makeJifeng 一样（npc.js 两个都认）。
import * as THREE from 'three';
import { loadAvatar } from './avatar.js';
import { buildAssistantBody } from './assistant/body.js';
import { outfitFor } from './assistant/outfits.js';
import { buildHead } from './assistant/head.js';
import { makeChain, applyChain } from './assistant/verlet.js';

const Q = new URLSearchParams(location.search);
// ↓↓ 名字占位，球球 / anni 定了改这里；也可以临时 ?npcname=xxx
export const 名字 = Q.get('npcname') || '助理';
export const SCALE = 0.96;                 // 比峰哥矮一点

// 身体材质：平面着色的 Lambert（body.js 给的）+ 自发光打底 + 白色轮廓光，夜景里看得清
function tune(m, more) {
  m.onBeforeCompile = sh => {
    more(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float frA = clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      totalEmissiveRadiance += diffuseColor.rgb * 0.22 + vec3(0.95, 0.96, 1.0) * pow(frA, 2.4) * 0.4;`);
  };
}

export async function makeAssistant(scene) {
  const av = await loadAvatar({ look: { exo: false, headScale: 1 } });
  av.group.name = 'npc_assistant';
  let cm = null; av.group.traverse(o => { if (o.isSkinnedMesh && !cm) cm = o; });
  const outfit = await outfitFor();
  const body = buildAssistantBody(av, outfit, tune);   // 按当前世界的 theme.style 选一套
  if (cm) cm.visible = false;                                  // CesiumMan 原网格（方块小人 + 头盔）藏掉
  const head = buildHead(av);                                  // 手绘低多边形脸 + 深棕头发 + 高马尾（head.ponytail 第 4 轮甩动）
  const hem = outfit.uniforms.uOne.value > 0.5 ? null : buildHem(av, body, outfit.uniforms.uMain.value);   // 连体羽绒服没有衣角
  const sway = hipSway(av);
  av.group.scale.setScalar(SCALE);
  scene.add(av.group);
  const tmp = new THREE.Vector3(), swing = makeSwing(av, head, hem);
  return {
    av, group: av.group, name: 名字, body, head, pose: av.pose, statue: false, model: false,
    animate(dt, t, d) { av.animate(dt, t, d); sway(d); },
    headWorld: (out = tmp) => av.headWorld(out),
    stance: () => false, update(dt) { swing(dt); }, burst() {}, resetTrail() {},
    set visible(v) { av.group.visible = v; }, get visible() { return av.group.visible; },
  };
}

// ---- 第 4 轮：女性步态——在 A2 的姿态上再叠骨盆侧倾 + 扭转（跟两腿髋角差走），胸口反向扭一点；髋摆更明显，肩基本不动 ----
function hipSway(av) {
  const pel = av.bones['Skeleton_torso_joint_1'], chest = av.bones['torso_joint_3'];
  av.group.updateMatrixWorld(true);
  const local = (b, v) => v.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert());   // 绑定姿态下外层 = 世界
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const pRoll = pel && local(pel, X), pYaw = pel && local(pel, Y), cRoll = chest && local(chest, X), cYaw = chest && local(chest, Y);
  const q = new THREE.Quaternion(), D = Math.PI / 180;
  return d => {                                               // d.fl / d.fr = 两腿屈髋角（°）
    if (!pel) return;
    const s = Math.max(-40, Math.min(40, (d.fl || 0) - (d.fr || 0)));
    pel.quaternion.multiply(q.setFromAxisAngle(pRoll, s * 0.16 * D)).multiply(q.setFromAxisAngle(pYaw, -s * 0.12 * D));
    if (chest) chest.quaternion.multiply(q.setFromAxisAngle(cRoll, -s * 0.1 * D)).multiply(q.setFromAxisAngle(cYaw, s * 0.1 * D));
  };
}

// 衣角：外套后下摆一片（3 节扁板，挂在骨盆骨上），跑起来往后飘
function buildHem(av, body, color) {
  const pel = av.bones['Skeleton_torso_joint_1']; if (!pel) return null;
  av.group.updateMatrixWorld(true);
  const root = new THREE.Object3D(); root.name = 'hem';
  root.position.set(pel.getWorldPosition(new THREE.Vector3()).x - 0.1, body.hipY + 0.02, 0);
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: 0.22, side: THREE.DoubleSide });
  const lens = [0.05, 0.05, 0.04], pivots = [];
  let parent = root;
  for (let k = 0; k < lens.length; k++) {
    const pv = new THREE.Object3D(); if (k) pv.position.set(0, -lens[k - 1], 0);
    pv.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, lens[k], 0.2 - k * 0.03).translate(0, -lens[k] / 2, 0), m));
    parent.add(pv); pivots.push(pv); parent = pv;
  }
  root.traverse(o => { o.frustumCulled = false; });
  pel.attach(root);
  return { root, pivots, lens };
}

// 每帧（A2 姿态之后）：马尾、衣角的 Verlet；碰撞球 = 头、后背
function makeSwing(av, head, hem) {
  const chains = [];
  const add = (o, opt) => { if (o) chains.push({ o, c: makeChain(o.pivots.length + 1, o.lens.map(l => l * SCALE), opt) }); };
  add(head && head.ponytail, { damp: 0.92 });
  add(hem, { damp: 0.88, gravity: 7 });
  const hb = av.bones['Skeleton_neck_joint_2'], cb = av.bones['torso_joint_3'], hm = av.group.getObjectByName('assistantHead');
  const hc = new THREE.Vector3(); if (hm) { hm.geometry.computeBoundingBox(); hm.geometry.boundingBox.getCenter(hc); }
  const a = new THREE.Vector3(), sph = [{ c: new THREE.Vector3(), r: 0.12 * SCALE }, { c: new THREE.Vector3(), r: 0.15 * SCALE }];
  const rest = o => (i, out) => i < o.pivots.length ? o.pivots[i].getWorldPosition(out) : o.pivots[i - 1].localToWorld(out.set(0, -o.lens[i - 1], 0));
  return dt => {
    if (!chains.length || !av.group.visible) return;
    av.group.updateMatrixWorld(true);
    if (hm) hm.localToWorld(sph[0].c.copy(hc)); else if (hb) hb.getWorldPosition(sph[0].c);
    if (cb) cb.getWorldPosition(sph[1].c).addScaledVector(new THREE.Vector3(-1, 0, 0).applyQuaternion(av.group.quaternion), 0.04);
    for (const { o, c } of chains) {
      o.root.getWorldPosition(a);
      c.step(dt, a, rest(o), o === hem ? [] : sph);
      applyChain(o.pivots, c.points);
    }
  };
}
