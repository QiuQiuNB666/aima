// J 线 · 峰哥的助理（9/23 夜起，替换追兵「捷风」；旧版用 ?npc=jifeng，在 npc_jifeng.js，没删）。
// 缺省（9/24 球球定方向）：二次元开源 VRM 角色——Q 线的装载器 assistant_q/npc_q.js（makeQ：VRM + Mixamo 动作重定向，MToon 材质 / 描边原样），
//   ?npcvrm=<模型 id 或文件名>（旧参数 ?asst= 同义）换人（models/assistant_q/ 里 8 个，缺省 AvatarSample_B），头发 / 裙摆用 VRM 自带的 spring bone。
// ?npc=custom：自建版（CesiumMan 骨架 → P 线的放样身体 + assistant/body.js 的曲线 + outfits.js 穿搭 + head.js 手绘脸 + Verlet 马尾），不作缺省。
// 指路 / 互动 / 待机的姿势两版共用（pointer / actor / idler，按人物自己的坐标轴叠在动画上）。接口和 npc_jifeng.js 的 makeJifeng 一样。
import * as THREE from 'three';
import { loadAvatar } from './avatar.js';
import { buildAssistantBody } from './assistant/body.js';
import { outfitFor } from './assistant/outfits.js';
import { buildHead } from './assistant/head.js';
import { makeChain, applyChain } from './assistant/verlet.js';
import { makeQ } from './assistant_q/npc_q.js';
import { AVATAR_H } from './avatar.js';

const Q = new URLSearchParams(location.search);
// ↓↓ 名字占位「小 B」（模型 AvatarSample_B），球球 / anni 定了改这里；也可以临时 ?npcname=xxx
export const 名字 = Q.get('npcname') || '小 B';
export const SCALE = 0.96;                 // 比峰哥矮一点
export const FAR = 12;                     // 米：再远就不算马尾 / 衣角甩动、不做待机小动作

// 身体材质：平面着色的 Lambert（body.js 给的）+ 自发光打底 + 白色轮廓光，夜景里看得清
function tune(m, more) {
  m.onBeforeCompile = sh => {
    more(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float frA = clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      totalEmissiveRadiance += diffuseColor.rgb * 0.22 + vec3(0.95, 0.96, 1.0) * pow(frA, 2.4) * 0.4;`);
  };
}

export const VRM_ID = (Q.get('npcvrm') || Q.get('asst') || 'AvatarSample_B').replace(/\.vrm$/, '');   // 9/24 定 1 号 AvatarSample_B（VRoid 官方样例，紫双马尾街头风）

export async function makeAssistant(scene, camera) {
  if (Q.get('npc') !== 'custom') try { return await makeVRM(scene, camera); } catch (e) { console.warn('助理 VRM 加载失败，用自建版', e); }
  return makeCustom(scene, camera);
}

// ---- 缺省：VRM（Q 线的 makeQ）----
async function makeVRM(scene, camera) {
  const q = await makeQ(VRM_ID);
  const outer = new THREE.Group(); outer.name = 'npc_assistant';
  const g = q.group;
  g.rotation.y += Math.PI / 2;                                 // VRM 朝 +Z（VRM0 已被 rotateVRM0 转过 180°，这里是加不是赋值）→ 我们的约定朝 +X
  outer.add(g); outer.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g, true), k = AVATAR_H * SCALE / Math.max(0.5, bb.max.y - bb.min.y);
  g.scale.setScalar(k); g.position.y = -bb.min.y * k;           // 身高 = 峰哥 × 0.96、脚底落地
  const H = q.vrm.humanoid, N = n => H.getNormalizedBoneNode(n), R = n => H.getRawBoneNode(n);
  const B = { armL: N('leftUpperArm'), armR: N('rightUpperArm'), head: N('head'), chest: N('upperChest') || N('chest'), wristL: R('leftHand'), elbowL: R('leftLowerArm'),
    flipXZ: q.vrm.meta?.metaVersion === '0' };   // VRM 0.x 的 normalized 骨旋转 x / z 分量是反的（Q 线重定向同样翻了）：绕前后 / 左右轴的角度要反号（9/24 实测递氧气的手跑到身后）
  scene.add(outer);
  const tmp = new THREE.Vector3(), headRaw = R('head');
  return {
    group: outer, name: 名字, vrm: q.vrm, statue: false, model: true, tris: q.tris,
    // 顺序（npc.js）：animate（Mixamo 动作写 normalized 骨）→ point / act / idle 叠在 normalized 骨上 → update（vrm.update：拷到 raw 骨 + spring bone）
    animate(dt, t, d) { q.play(d.speed < 0.05 ? 'idle' : d.speed < 1.6 ? 'walk' : 'run'); q.mixer.update(dt); },
    point: pointer(outer, B, 80),
    act: actor(outer, B),
    idle: idler(outer, B),
    headWorld: (out = tmp) => headRaw.getWorldPosition(out).setY(out.y + 0.08),
    stance: () => false, burst() {}, resetTrail() {},
    get far() { return !!camera && camera.position.distanceTo(outer.position) > FAR; },
    update(dt) { q.vrm.update(Math.min(dt, 0.05)); },
    set visible(v) { outer.visible = v; }, get visible() { return outer.visible; },
  };
}

// ---- ?npc=custom：自建版 ----
async function makeCustom(scene, camera) {
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
    point: pointer(av.group, cesiumBones(av), POINT_DEG),
    act: actor(av.group, cesiumBones(av)),
    idle: idler(av.group, cesiumBones(av)),
    headWorld: (out = tmp) => av.headWorld(out),
    stance: () => false, burst() {}, resetTrail() {},
    // 第 9 轮：离镜头 12 m 外不算甩动、不做待机小动作（头的三级 LOD 由 THREE.LOD 自己切）
    get far() { return !!camera && camera.position.distanceTo(av.group.position) > FAR; },
    update(dt) { if (!this.far) swing(dt); },
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

// ---- 第 5 轮：指路——A2 摆完之后，右上臂绕人物的左右轴往前上抬（权重 w 0..1，渐入渐出）；轴每帧按骨骼当前朝向换算 ----
function pointer(group, B, deg) {
  const arm = B.armR; if (!arm) return () => {};
  const ax = new THREE.Vector3(), qb = new THREE.Quaternion(), q = new THREE.Quaternion(), D = Math.PI / 180;
  return w => {
    if (!(w > 0.01)) return;
    arm.parent.updateWorldMatrix(true, false); arm.updateWorldMatrix(false, false);
    ax.set(0, 0, B.flipXZ ? -1 : 1).applyQuaternion(group.getWorldQuaternion(qb));   // 人物的左右轴（世界）
    ax.applyQuaternion(arm.getWorldQuaternion(qb).invert()).normalize();       // → 上臂自己的坐标
    arm.quaternion.multiply(q.setFromAxisAngle(ax, deg * D * w));
  };
}
// 自建版（CesiumMan 骨架）的骨骼表
function cesiumBones(av) {
  const b = n => av.bones[n] || null;
  return { armL: b('Skeleton_arm_joint_L__4_'), armR: b('Skeleton_arm_joint_R'), head: b('Skeleton_neck_joint_2'), chest: b('torso_joint_3'),
    wristL: b('Skeleton_arm_joint_L__2_'), elbowL: b('Skeleton_arm_joint_L__3_') };
}
export const POINT_DEG = 80;               // 往前上抬多少度（正负按截图对过）

// ---- 第 6 轮：互动姿势（A2 之后叠）：oxygen 左臂往前递 + 左手里的氧气瓶；guard 两臂往外张；five 左臂举过头击掌 ----
//   轴都用人物自己的坐标（x 前、y 上、z 左右，绑定姿态下 = 外层坐标），每帧换算到骨骼。
function actor(group, B) {
  const L = B.armL, R = B.armR;
  const bottle = makeBottle(group, B.wristL, B.elbowL);
  const ax = new THREE.Vector3(), qb = new THREE.Quaternion(), q = new THREE.Quaternion(), D = Math.PI / 180;
  const rot = (b, x, y, z, deg) => {
    if (!b || !deg) return;
    b.parent.updateWorldMatrix(true, false); b.updateWorldMatrix(false, false);
    const f = B.flipXZ ? -1 : 1;                                               // VRM0：绕前后 / 左右轴反号，绕竖轴不变
    ax.set(x * f, y, z * f).applyQuaternion(group.getWorldQuaternion(qb)).applyQuaternion(b.getWorldQuaternion(qb).invert()).normalize();
    b.quaternion.multiply(q.setFromAxisAngle(ax, deg * D));
  };
  return a => {
    rot(L, 0, 0, 1, 62 * a.oxygen + 150 * a.five);         // 左臂：往前递 / 举过头
    rot(L, 1, 0, 0, 22 * a.guard + 12 * a.five);          // 左臂往外张（挡）/ 击掌时略往里
    rot(R, 1, 0, 0, -22 * a.guard);                        // 右臂往外张
    if (bottle) bottle.visible = a.oxygen > 0.3;
  };
}

// 氧气瓶：橙红色小钢瓶 + 白瓶口，挂在左手腕骨上（绑定姿态下沿前臂方向摆好），只在递氧气时露出来
function makeBottle(group, w, e) {
  if (!w || !e) return null;
  group.updateMatrixWorld(true);
  const pw = w.getWorldPosition(new THREE.Vector3()), dir = pw.clone().sub(e.getWorldPosition(new THREE.Vector3())).normalize();
  const g = new THREE.Group(); g.name = 'oxygenBottle';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.17, 8), new THREE.MeshLambertMaterial({ color: '#d9542c', emissive: '#d9542c', emissiveIntensity: 0.25, flatShading: true }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.04, 8).translate(0, 0.105, 0), new THREE.MeshLambertMaterial({ color: '#eef3f8', emissive: '#eef3f8', emissiveIntensity: 0.25 }));
  g.add(body, cap);
  g.position.copy(pw).addScaledVector(dir, 0.07); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0).lerp(dir, 0.4).normalize());
  g.traverse(o => { o.frustumCulled = false; });
  w.attach(g); g.visible = false;
  return g;
}

// ---- 第 8 轮：待机小动作——站着（不在走、不在指路 / 互动）超过 1.2 s，每 4–7 s 随机来一个，各约 2.2 s、渐入渐出：
//   hair 右手往后脑理头发、watch 抬左手看表（低头）、look 回头看峰哥（他在她左后方：头和胸口往左转） ----
export const IDLE = ['hair', 'watch', 'look'];
function idler(group, B) {
  const L = B.armL, R = B.armR, H = B.head, C = B.chest;
  const ax = new THREE.Vector3(), qb = new THREE.Quaternion(), q = new THREE.Quaternion(), D = Math.PI / 180;
  const rot = (b, x, y, z, deg) => {
    if (!b || !deg) return;
    b.parent.updateWorldMatrix(true, false); b.updateWorldMatrix(false, false);
    const f = B.flipXZ ? -1 : 1;                                               // VRM0：绕前后 / 左右轴反号，绕竖轴不变
    ax.set(x * f, y, z * f).applyQuaternion(group.getWorldQuaternion(qb)).applyQuaternion(b.getWorldQuaternion(qb).invert()).normalize();
    b.quaternion.multiply(q.setFromAxisAngle(ax, deg * D));
  };
  const force = new URLSearchParams(location.search).get('npcidle');   // 预览 &npcidle=hair|watch|look：一直摆这个（截图用）
  let still = 0, cur = null, t0 = 0, next = 2 + Math.random() * 2, k = 0;
  return (t, dt, standing) => {
    still = standing ? still + dt : 0;
    if (force) { cur = force; t0 = t - 1; }
    else if (!standing) { cur = null; next = 1.2; }
    else if (!cur && still > next) { cur = IDLE[k++ % IDLE.length]; t0 = t; }
    if (!cur) return;
    const el = t - t0, w = force ? 1 : Math.min(1, el / 0.35) * Math.min(1, Math.max(0, (2.2 - el) / 0.35));
    if (!force && el > 2.2) { cur = null; still = 0; next = 4 + Math.random() * 3; return; }
    if (cur === 'hair') { rot(R, 0, 0, 1, 150 * w); rot(R, 1, 0, 0, -35 * w); rot(H, 0, 0, 1, -6 * w); }
    else if (cur === 'watch') { rot(L, 0, 0, 1, 55 * w); rot(L, 1, 0, 0, -28 * w); rot(H, 0, 0, 1, -18 * w); }
    else if (cur === 'look') { rot(C, 0, 1, 0, 22 * w); rot(H, 0, 1, 0, 48 * w); }
  };
}
