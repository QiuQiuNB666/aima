// CesiumMan 化身。骨骼映射沿用 body3d.js（9/22 浏览器里验过）：
//   leg_joint_*_1 = 髋，_2 = 膝；髋角约定 负 = 屈曲 → flex = -frame.l
// 轴（9/23 审查在浏览器里逐轴量过骨骼世界坐标）：髋绕局部 Y 负转 = 大腿前抬；膝绕局部 Y 正转 = 小腿后弯（负 = 反关节）。
//   以前绕 X 转，屈髋时腿往侧面劈开——别改回去。
// 影子登山者用同一个模型，换成半透明材质（带菲涅尔描边，theme.ghostRim）。
// 化身不用 CesiumMan 自带的条纹贴图（3 米外像缠了胶带）：按绑定姿态高度分 3 块纯色（腿 = 深色外骨骼、躯干 = 浅色衣服、头盔），
//   外加不吃场景光的轮廓光（fresnel）和一点自发光——夜景里不会被染成一团深蓝，浅色石阶上也有边。主题可用 theme.avatar 改色。
// 外骨骼件（第 2 轮）：髋部电机圆盘 + 发光环、大腿/小腿外侧亮色连杆、膝关节圆盘、腰带 + 背后电池包（背后两条亮条，跟拍镜头正好看见）、
//   头盔深色面罩 + 一道亮缝、手（小球）。全部挂在骨骼上跟着动；影子也有，用影子材质。
export const AVATAR_LOOK = { leg: '#39424f', body: '#eef2f6', head: '#cfd8e2', rim: '#ffe2b8', rimK: 0.9, self: 0.22, headScale: 0.86,
  exo: '#ffb03a', exoDark: '#1c232c', visor: '#0a0e14', pointK: 0.35 };
export const AVATAR_H = 1.46;              // 头顶离脚底（世界单位），化身和影子一样
const LEG_Z = 0.80, HEAD_Z = 1.30;         // 绑定姿态（z 向上，身高 1.51）里的分界高度：髋 / 脖子

// pointK：主题点光（PointLight）打在化身身上的比例。缺省 0.35——跟随灯照路面，别把衣服染成粉的；1 = 和场景一样吃光
function zonedMaterial(L) {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const U = { uLeg: { value: new THREE.Color(L.leg) }, uBody: { value: new THREE.Color(L.body) }, uHead: { value: new THREE.Color(L.head) },
    uRim: { value: new THREE.Color(L.rim) }, uRimK: { value: L.rimK }, uSelf: { value: L.self }, uPointK: { value: L.pointK } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZ = position.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vZ;\nuniform vec3 uLeg, uBody, uHead, uRim;\nuniform float uRimK, uSelf, uPointK;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 zc = vZ < ${LEG_Z.toFixed(2)} ? uLeg : vZ < ${HEAD_Z.toFixed(2)} ? uBody : uHead;
        diffuseColor.rgb *= zc;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        totalEmissiveRadiance += zc * uSelf + uRim * pow(max(fr, 0.0), 2.2) * uRimK;`)   // max：Metal 上 fr 浮点误差略小于 0 时 pow(负数)=NaN（L 线 9/23 查到的坏点来源）
      .replace('#include <lights_fragment_begin>', pointScaled);
  };
  m.userData.look = U;
  return m;
}
let pointScaled = '';                       // lights_fragment_begin，点光颜色 × uPointK（外骨骼深色件也用）
function pointK(m, U) {
  m.onBeforeCompile = sh => { sh.uniforms.uPointK = U; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPointK;').replace('#include <lights_fragment_begin>', pointScaled); };
  m.customProgramCacheKey = () => 'exo-pointk';
  return m;
}
// 影子材质：半透明、不写深度；rim = 菲涅尔描边色（边缘更亮更实，3 米外靠轮廓认出人形），null = 不描边
function ghostMaterial(color, opacity, rim) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  if (!rim) return m;
  const U = { value: new THREE.Color(rim) };
  m.userData.rim = true;                    // 旧主题（subtropical）自己补描边前先看这个标记，有了就不再补
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = U;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN, vGV;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_SKINNING\nvGN = normalize(transformedNormal);\n#else\nvGN = normalize(normalMatrix * normal);\n#endif\nvGV = -mvPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN, vGV;\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `float fr = pow(1.0 - abs(dot(normalize(vGN), normalize(vGV))), 1.8);
        outgoingLight = mix(outgoingLight, uRim, fr);
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.9 * fr));
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'ghost-rim';
  m.userData.rimColor = U;
  return m;
}
function haloSprite(color) {                // 影子身后一团柔光（theme.ghostHalo）
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  s.scale.set(1.5, 2.3, 1); s.position.y = 0.85; s.renderOrder = 1; s.name = 'ghostHalo';
  return s;
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { makeHipTrack, makeBody } from './anim.js';
pointScaled = THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', '$&\n\t\tdirectLight.color *= uPointK;');

export const MODEL_YAW = Math.PI / 2;      // 让模型正面朝局部 +X（路线前进方向），截图验过；错了改这里
const d2r = Math.PI / 180, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), qT = new THREE.Quaternion(), qA = new THREE.Quaternion();
const qP = new THREE.Quaternion(), qR = new THREE.Quaternion(), qI = new THREE.Quaternion(), eu = new THREE.Euler();
// 手臂 = rest·Rx(放下)·Rz(摆)（9/23 修复 G 在浏览器里量的）：局部 X 放下（左 +60、右 −60；70° 会插进躯干）；
//   放下之后再绕局部 Z 才是前后摆，两臂同号即一前一后（Rz 放在 Rx 前面几乎不摆）。右臂静止偏后，加 −15° 补成左右对称。
const ARM_DOWN = 60, ARM_SWING = 0.6, ARM_R_OFF = -15, ARM_R_UP = 28;
const KNEE0 = 9;                           // 膝盖常弯 9°：直腿像木桩（grid 审查）；抬脚高度只差 3 mm，不影响踩台阶
let bufP = null;
export const preloadAvatar = () => bufP || (bufP = fetch('/models/CesiumMan.glb').then(r => r.arrayBuffer()));   // 引擎开场就发请求，和主题 build 并行
async function freshScene() {           // 每个化身各解析一次 glb（带骨骼的网格直接 clone 会共用骨架）
  const buf = await preloadAvatar();
  return new Promise((res, rej) => new GLTFLoader().parse(buf.slice(0), '/models/', g => res(g.scene), rej));
}

// 外骨骼件：在绑定姿态下按骨骼世界坐标摆好（几何直接烘到世界坐标），同一骨骼 × 同一材质合成 1 个网格，再 bone.attach（保持世界变换）
//   → 之后跟着骨骼动；每个化身约 14 次绘制。左手 = 局部 −Z（模型朝 +X）。
// 返回 { bars }：腿侧连杆 + 腰带（主题自己做了同类件时引擎把这些藏掉）
function dressExo(outer, model, J, L, gm) {
  outer.updateMatrixWorld(true);
  const W = b => b.getWorldPosition(new THREE.Vector3());
  const glow = gm || new THREE.MeshBasicMaterial({ color: L.exo });
  const pk = { value: L.pointK };
  const dark = gm || pointK(new THREE.MeshLambertMaterial({ color: L.exoDark, emissive: L.exoDark, emissiveIntensity: 0.6 }), pk);
  const visor = gm || new THREE.MeshBasicMaterial({ color: L.visor });
  const qq = new THREE.Quaternion(), mx = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), bk = new Map();
  let tag = '';                                       // 'bar' = 可藏的连杆/腰带，单独成组
  const put = (geo, mat, bone, p, q, sc) => {
    geo.applyMatrix4(mx.compose(p, q || qq.identity(), sc || one));
    const k = `${bone.uuid}|${mat.uuid}|${tag}`;
    if (!bk.has(k)) bk.set(k, { bone, mat, bar: !!tag, geos: [] });
    bk.get(k).geos.push(geo);
  };
  const toZ = new THREE.Quaternion().setFromUnitVectors(Y, Z);
  const disc = (r, h) => new THREE.CylinderGeometry(r, r, h, 20);
  const bar = (bone, a, b, w, d, mat) => {          // a→b 的方条：长轴 = 骨段方向，d = 侧向厚度
    const dir = b.clone().sub(a), len = dir.length();
    tag = 'bar'; put(new THREE.BoxGeometry(w, len, d), mat, bone, a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize())); tag = '';
  };
  const pel = J('Skeleton_torso_joint_1');
  const hips = [];
  for (const sd of ['L', 'R']) {
    const hip = J(`leg_joint_${sd}_1`), knee = J(`leg_joint_${sd}_2`), ank = J(`leg_joint_${sd}_3`);
    if (!hip || !knee || !ank || !pel) continue;
    const h = W(hip), k = W(knee), a = W(ank), o = new THREE.Vector3(0, 0, Math.sign(h.z) || (sd === 'L' ? -1 : 1));
    hips.push(h);
    put(disc(0.085, 0.055), dark, pel, h.clone().addScaledVector(o, 0.105), toZ);                       // 髋部电机
    put(new THREE.TorusGeometry(0.085, 0.015, 8, 28), glow, pel, h.clone().addScaledVector(o, 0.135));   // 发光环
    put(new THREE.CircleGeometry(0.03, 16), glow, pel, h.clone().addScaledVector(o, 0.134), o.z > 0 ? null : new THREE.Quaternion().setFromAxisAngle(Y, Math.PI));
    bar(hip, h.clone().addScaledVector(o, 0.105).setY(h.y - 0.06), k.clone().addScaledVector(o, 0.09), 0.05, 0.035, glow);    // 大腿连杆
    put(disc(0.06, 0.045), dark, knee, k.clone().addScaledVector(o, 0.09), toZ);                          // 膝关节
    put(new THREE.TorusGeometry(0.06, 0.012, 8, 24), glow, knee, k.clone().addScaledVector(o, 0.113));
    bar(knee, k.clone().addScaledVector(o, 0.085), a.clone().addScaledVector(o, 0.07), 0.045, 0.03, glow);    // 小腿连杆
    put(new THREE.BoxGeometry(0.12, 0.05, 0.04), dark, ank, a.clone().addScaledVector(o, 0.07).setY(a.y + 0.02));        // 脚踝卡扣
  }
  if (pel && hips.length === 2) {
    const c = hips[0].clone().add(hips[1]).multiplyScalar(0.5), wz = Math.abs(hips[0].z - hips[1].z) + 0.2;
    tag = 'bar'; put(new THREE.BoxGeometry(0.25, 0.075, wz), dark, pel, c.clone().setY(c.y + 0.07)); tag = '';               // 腰带
    put(new THREE.BoxGeometry(0.09, 0.24, 0.2), dark, pel, new THREE.Vector3(c.x - 0.17, c.y + 0.2, c.z));                // 背后电池包
    for (const z of [-0.055, 0.055]) put(new THREE.BoxGeometry(0.012, 0.17, 0.03), glow, pel, new THREE.Vector3(c.x - 0.218, c.y + 0.2, c.z + z));   // 电池包亮条（镜头在身后，最先看到这个）
  }
  const head = J('Skeleton_neck_joint_2');
  let mesh = null; model.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (head && mesh) {                                 // 头盔球的实际大小：绑定 z > 脖子 的顶点（蒙皮后世界坐标）的包围盒
    const P = mesh.geometry.attributes.position, v = new THREE.Vector3(), bb = new THREE.Box3();
    for (let i = 0; i < P.count; i++) if (P.getZ(i) > HEAD_Z) { mesh.getVertexPosition(i, v); bb.expandByPoint(mesh.localToWorld(v)); }
    if (!bb.isEmpty()) {
      const rx = (bb.max.x - bb.min.x) / 2, rz = (bb.max.z - bb.min.z) / 2, c = new THREE.Vector3((bb.max.x + bb.min.x) / 2, bb.max.y - rx, (bb.max.z + bb.min.z) / 2);
      // 球面片：phi≈π 是 +X（正面），theta 从顶上量；面罩 = 眼睛一圈，亮缝 = 面罩中线
      const cap = (th0, th1, k, mat) => put(new THREE.SphereGeometry(1, 28, 6, Math.PI - 1.05, 2.1, th0, th1 - th0), mat, head, c, null, new THREE.Vector3(rx * k, rx * k, rz * k));
      cap(1.2, 1.95, 1.08, visor);
      cap(1.5, 1.6, 1.1, glow);
    }
  }
  for (const [n, e] of [['Skeleton_arm_joint_L__2_', 'Skeleton_arm_joint_L__3_'], ['Skeleton_arm_joint_R__3_', 'Skeleton_arm_joint_R__2_']]) {   // 手：腕 + 前臂方向 6 cm
    const w = J(n), el = J(e); if (!w || !el) continue;
    const p = W(w), d = p.clone().sub(W(el)).normalize();
    put(new THREE.SphereGeometry(0.048, 12, 8), dark, w, p.addScaledVector(d, 0.06));
  }
  const bars = [];
  for (const { bone, mat, bar: isBar, geos } of bk.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos.map(g => g.toNonIndexed())), mat);
    m.name = 'exo'; m.frustumCulled = false; if (gm) m.renderOrder = 2;
    bone.attach(m); if (isBar) bars.push(m);
  }
  return { bars };
}

export async function loadAvatar({ ghost = false, color = '#9fe8ff', opacity = 0.42, look = null, rim, halo = false } = {}) {
  const model = await freshScene();
  const outer = new THREE.Group(); outer.name = ghost ? 'ghost' : 'avatar';
  model.rotation.y = MODEL_YAW; outer.add(model);
  const bones = {}, mats = [], L = { ...AVATAR_LOOK, ...(look || {}) };
  const gm = ghost ? ghostMaterial(color, opacity, rim === undefined ? new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.55) : rim) : null;
  if (gm) mats.push(gm);
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      if (ghost) { o.material = gm; o.renderOrder = 2; }
      else { o.material = zonedMaterial(L); mats.push(o.material); }
    }
  });
  const J = n => bones[n] || null;
  const hipL = J('leg_joint_L_1'), hipR = J('leg_joint_R_1'), kneeL = J('leg_joint_L_2'), kneeR = J('leg_joint_R_2');
  const armL = J('Skeleton_arm_joint_L__4_'), armR = J('Skeleton_arm_joint_R');
  // A2 动作用到的其余骨骼：骨盆 → 腰 → 胸 → (颈) → 头；踝；肘（左 L__3_、右 R__2_，9/23 A2 按骨骼世界坐标认的）
  const pel = J('Skeleton_torso_joint_1'), spine = J('Skeleton_torso_joint_2'), chest = J('torso_joint_3'), head = J('Skeleton_neck_joint_2');
  const ankL = J('leg_joint_L_3'), ankR = J('leg_joint_R_3'), elbL = J('Skeleton_arm_joint_L__3_'), elbR = J('Skeleton_arm_joint_R__2_');
  const rest = new Map();
  for (const b of [hipL, hipR, kneeL, kneeR, armL, armR, pel, spine, chest, head, ankL, ankR, elbL, elbR]) if (b) rest.set(b, b.quaternion.clone());
  const arm = (b, swing, down) => { if (b) b.quaternion.copy(rest.get(b)).multiply(qA.setFromAxisAngle(X, down * d2r)).multiply(qT.setFromAxisAngle(Z, swing * d2r)); };
  const set = (b, deg) => { if (b) b.quaternion.copy(rest.get(b)).multiply(qT.setFromAxisAngle(Y, deg * d2r)); };
  // 绕化身自己的轴转（° ，右手系，化身局部：x = 前后轴（+ = 左侧抬起）、y = 竖直（+ = 左转）、z = 左右轴（+ = 前面往上 = 后仰 / 勾脚 / 屈肘））。
  //   用父骨骼当前的朝向换算，所以不管父骨骼怎么摆，转的都是身体的轴。fromRest=false = 叠加在当前姿态上。父骨骼要先摆好（从上往下调）
  const turn = (b, x, y, z, fromRest = true) => {
    if (!b) return;
    if (fromRest) b.quaternion.copy(rest.get(b));
    qP.identity(); for (let p = b.parent; p && p !== outer; p = p.parent) qP.premultiply(p.quaternion);
    qR.setFromEuler(eu.set(x * d2r, y * d2r, z * d2r, 'YZX'));
    b.quaternion.premultiply(qI.copy(qP).invert().multiply(qR).multiply(qP));
  };
  if (head) head.scale.setScalar(L.headScale);   // 头盔球原来约占身高 1/5.5，偏大
  outer.updateMatrixWorld(true);
  const W = b => b.getWorldPosition(new THREE.Vector3());
  const body = makeBody({ L1: hipL && kneeL ? W(hipL).distanceTo(W(kneeL)) : 0.26, L2: kneeL && ankL ? W(kneeL).distanceTo(W(ankL)) : 0.27, calib: !ghost });
  const track = makeHipTrack(), base = model.position.clone();
  let lastS = null;
  const exo = L.exo === false ? { bars: [] } : dressExo(outer, model, J, L, gm);
  if (ghost && halo) { const h = haloSprite(color); outer.add(h); mats.push(h.material); }
  const tmp = new THREE.Vector3();
  return {
    group: outer, bones, mats, exo, body,
    // 旧接口（fengge.html 预览还在用）：flex 度，正 = 前抬；膝跟着屈髋弯
    pose(flexL, flexR) {
      const fl = Math.max(-35, Math.min(70, flexL)), fr = Math.max(-35, Math.min(70, flexR));
      set(hipL, -fl); set(hipR, -fr);
      set(kneeL, Math.max(0, fl) * 0.9 + KNEE0); set(kneeR, Math.max(0, fr) * 0.9 + KNEE0);
      const sw = (fr - fl) / 2 * ARM_SWING;       // 手臂和同侧腿反向摆
      arm(armL, sw, ARM_DOWN); arm(armR, sw + ARM_R_OFF, -ARM_DOWN);
    },
    // A2：每帧调一次（算法见 anim.js）。d = { state: /state（实机：自己跟踪 frame，10 Hz → 60 fps；safety.sent 用来让撑地膝跟着外骨骼的力弯）, 或 fl, fr[, wl, wr]（直接给：影子 / 预览）,
    //   kind: 当前路段, summit: 登顶中 }
    animate(dt, t, d) {
      let h = d, tq = null;
      if (d.state) {
        const S = d.state, f = S.frame;
        if (S !== lastS && f) track.push(t, S.t, -f.l, -f.r, f.ldps != null ? -f.ldps : null, f.rdps != null ? -f.rdps : null);
        lastS = S; h = track.sample(t, dt); tq = S.safety && S.safety.sent;   // 外骨骼实际给的力（物理方向，+ = 伸展）
      }
      const P = body.update(dt, t, { fl: h.fl, fr: h.fr, wl: h.wl, wr: h.wr, kind: d.kind, summit: d.summit, tq });
      const cl = v => Math.max(-40, Math.min(95, v));
      model.position.set(base.x, base.y + P.bob, base.z + P.sway);
      turn(pel, P.pelvis[0], P.pelvis[1], -P.pelvis[2]);
      turn(spine, P.spine[0], P.spine[1], -P.spine[2]);
      turn(chest, P.chest[0], P.chest[1], -P.chest[2]);
      turn(head, P.head[0], P.head[1], -P.head[2]);
      set(hipL, -cl(P.hipL)); turn(hipL, -P.pelvis[0], -P.pelvis[1], 0, false);   // 腿抵掉骨盆的转动：脚还在身体正下方、膝朝前
      set(hipR, -cl(P.hipR)); turn(hipR, -P.pelvis[0], -P.pelvis[1], 0, false);
      set(kneeL, P.kneeL); set(kneeR, P.kneeR);
      turn(ankL, 0, 0, P.ankL); turn(ankR, 0, 0, P.ankR);
      const c = P.cheer;                          // 登顶举手：右臂绑定姿态偏前，举起来要反过来补 +28°（A2 量的：两臂才对称成 V 字）；肘往头这边弯（绕前后轴），平时往前弯（绕左右轴）
      arm(armL, P.armL[0], P.armL[1]); arm(armR, P.armR[0] + ARM_R_OFF + (ARM_R_UP - ARM_R_OFF) * c, -P.armR[1]);
      turn(elbL, P.armL[2] * c, 0, P.armL[2] * (1 - c)); turn(elbR, -P.armR[2] * c, 0, P.armR[2] * (1 - c));
    },
    headWorld(out = tmp) { if (head) head.getWorldPosition(out); else outer.getWorldPosition(out).setY(outer.position.y + 1.4); return out; },
  };
}

// 真实髋角 → 屈曲角（body3d CONVENTION.flexSign = -1）
export const flexFromFrame = f => f ? [-f.l, -f.r] : [0, 0];
