// P 线：峰哥的穿搭。outfit = { name, uniforms（颜色）, glsl（片元里的 fit()：按部位 / 位置 / 朝向给颜色）, inflate(reg, t)（衣服蓬度，米）}。
//   body.js 的顶点属性：reg 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子；t = 沿这一段 0..1（躯干从裆到脖子、四肢从近端到远端、鞋从脚跟到脚尖）；
//   h = 离髋关节多高（米，静止姿态）；ang = 朝向（x = 前，y = 往外 / 躯干是往左；鞋是 x = 朝上）；side +1 左 −1 右。
// 换装只看 theme.style（第 2 轮每个主题一套）；engine.js 不传主题，所以 outfitFor() 按引擎同样的规则自己找当前世界（预览看 ?preview=，实机读 /state）。
//   ?outfit=<style 或穿搭名> 临时换（截图用）。
import * as THREE from 'three';
import { PALETTE, UI } from '../style.js';

const col = c => ({ value: new THREE.Color(c) });

// 通用小工具（拼进每套穿搭的 GLSL 前面）
const LIB = `
float band(float x, float a, float b) { return step(a, x) * step(x, b); }
`;

// 第 1 轮基础款 = 球球挑的冲锋衣（橙红偏砖 + 炭灰拼色）+ 炭灰冲锋裤 + 登山鞋
const base = {
  name: 'base',
  uniforms: { uMain: col('#b0472c'), uTrim: col('#33363b'), uZip: col('#141517'), uPants: col('#2b2e33'), uKnee: col('#3a3e45'),
    uShoe: col('#4a4038'), uSole: col('#9b948a'), uNeck: col('#1e1f22'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.012, 0.009, 0.007, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 0.0) {                                    // 躯干：冲锋衣（下摆盖到髋关节下面一点，外骨骼腰带扣在外面）
    if (h < -0.03) return uPants;
    if (h < 0.01) c = uTrim;                           // 下摆收边
    if (h > uSpan - 0.015 && ang.x < 0.75) c = uTrim;  // 肩背补强
    float lat = 0.16 - 0.3 * clamp((h + 0.03) / (uSpan + 0.1), 0.0, 1.0);   // 前襟斜拉链：领口偏左 → 下摆偏右
    if (ang.x > 0.2 && abs(ang.y - lat) < 0.07 && h > -0.03) c = uTrim;     // 防风门襟
    if (ang.x > 0.2 && abs(ang.y - lat) < 0.022 && h > -0.03) c = uZip;
    if (ang.x > 0.3 && band(h, uSpan - 0.14, uSpan - 0.1) > 0.0 && band(ang.y, 0.3, 0.6) > 0.0 && abs(ang.y - 0.3 - (uSpan - 0.1 - h) * 7.0) < 0.05) c = uZip;   // 胸袋拉链
    return c;
  }
  if (reg == 6.0) return uNeck;
  if (reg == 1.0) { if (t < 0.2 && ang.x < 0.4) c = uTrim; if (t > 0.86 && ang.x < -0.1) c = uTrim; return c; }   // 上臂：肩头 / 肘后补强
  if (reg == 2.0) { if (t < 0.12 && ang.x < -0.1) c = uTrim; if (t > 0.82) c = uTrim; if (t > 0.84 && t < 0.95 && ang.y > 0.5) c = uTrim * 1.6; return c; }   // 前臂：肘后 / 袖口 + 魔术贴
  if (reg == 3.0) { c = uPants; if (t > 0.84 && ang.x > 0.3) c = uKnee; return c; }
  if (reg == 4.0) { c = uPants; if (t < 0.14 && ang.x > 0.3) c = uKnee; if (t > 0.9) c = uPants * 0.8; return c; }
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  return c;
}`,
};

// ———— 珠峰 snow_summit：红色连体羽绒服（每 7.5 cm 一道绗缝）、护目镜推在帽子上、氧气面罩挂胸前（软管绕到背后接外骨骼电池包）、冰爪、手套 ————
//   颜色都从 style.js：大身 = PALETTE.snow_summit.accent（觇标经幡红）、拼色 / 手套 / 靴 / 面罩 = PALETTE.cyber_night.sub（湿钢灰）、
//   镜片 = PALETTE.snow_summit.sub（高空蓝）、冰爪 = UI.dim
const STEEL = PALETTE.cyber_night.sub;
const snow = {
  name: 'snow_summit',
  hand: STEEL,                                             // 手套
  uniforms: { uMain: col(PALETTE.snow_summit.accent[0]), uTrim: col(STEEL), uZip: col('#141517'), uSole: col(UI.dim), uNeck: col('#1e1f22'),
    uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.03, 0.024, 0.02, 0.024, 0.02, 0.012, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uTrim; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; if (t > 0.2 && t < 0.3 && ang.x > 0.2) c = uMain; return c; }   // 高山靴：钢灰 + 一道红
  float bf = (reg == 1.0 || reg == 2.0) ? t * 3.6 : h / 0.075;                                     // 绗缝：四肢按段长、躯干和腿按高度
  float seam = min(fract(bf), 1.0 - fract(bf));
  c *= 0.8 + 0.2 * smoothstep(0.0, 0.16, seam);
  if (reg == 0.0) {
    if (ang.x > 0.25 && abs(ang.y) < 0.035) c = uZip;                                              // 前襟拉链
    if (h > uSpan - 0.02 && ang.x < 0.8) c = uTrim;                                                // 肩部耐磨片
  }
  if (reg == 2.0 && t > 0.84) c = uTrim;                                                           // 袖口
  if ((reg == 3.0 && t > 0.82 || reg == 4.0 && t < 0.16) && ang.x > 0.25) c = uTrim;               // 护膝
  if (reg == 4.0 && t > 0.8) c = uTrim;                                                            // 雪套
  return c;
}`,
  extras(x) {
    const { THREE: T, J, body, H, attach } = x, V = () => new T.Vector3(), steel = new T.Color(STEEL), lam = matOf(x);
    // ① 护目镜：推在毛线帽上。帽带一圈（帽檐线上 30–52 px）+ 前面一块大镜片（帽檐线上 14–110 px ≈ 4 cm 高、左右 ±63°，中间往外鼓）+ 一圈镜框
    const bulge = (u, v) => Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    headPiece(x, headSheet(x, 30, 52, -Math.PI, Math.PI, 40, 1, () => 1.16), lam(steel, 'goggleBand', 0.1), 'fenggeGoggles');
    headPiece(x, headSheet(x, 6, 118, -1.18, 1.18, 16, 4, (u, v) => 1.17 + 0.045 * bulge(u, v)), lam(steel, 'goggleFrame', 0.12), 'fenggeGoggles');
    headPiece(x, headSheet(x, 14, 110, -1.1, 1.1, 16, 4, (u, v) => 1.19 + 0.05 * bulge(u, v)), lam(new T.Color(PALETTE.snow_summit.sub), 'goggleLens', 0.5, 1.6), 'fenggeGoggles');
    // ② 氧气面罩：挂在胸前偏右，软管从面罩底下绕过右腰侧、到背后接外骨骼电池包
    const span = body.shY - body.hipY, chest = J.torso_joint_3, fx = chest.x + 0.094 + 0.03 + 0.03, my = body.hipY + span * 0.74;
    const mask = new T.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);   // 碗形，口朝后贴胸
    mask.rotateZ(-Math.PI / 2).scale(0.034, 0.052, 0.042).translate(fx, my, chest.z + 0.035);
    const valve = new T.CylinderGeometry(0.012, 0.014, 0.022, 6); valve.rotateZ(Math.PI / 2).translate(fx + 0.034, my - 0.012, chest.z + 0.035);
    const hose = new T.TubeGeometry(new T.CatmullRomCurve3([
      V().set(fx + 0.02, my - 0.045, chest.z + 0.035), V().set(fx - 0.005, my - 0.12, chest.z + 0.1), V().set(fx - 0.07, my - 0.14, chest.z + 0.175),
      V().set(chest.x - 0.08, my - 0.12, chest.z + 0.17), V().set(J.Skeleton_torso_joint_1.x - 0.16, body.hipY + 0.33, chest.z + 0.07)]), 26, 0.011, 5);
    const o2 = new T.Mesh(mergeAll(T, [mask, valve, hose]), lam(steel, 'o2mask', 0.18));
    o2.name = 'fenggeO2'; o2.frustumCulled = false; attach(o2, 'torso_joint_3');
    // ③ 冰爪：每只脚两条钢框 + 10 个爪齿朝下 + 2 个前齿朝前下，挂踝骨
    for (const sd of ['L', 'R']) {
      const ank = J[`leg_joint_${sd}_3`], toe = J[`leg_joint_${sd}_5`], heel = ank.x - 0.05, tip = Math.max(toe.x + 0.06, ank.x + 0.17), parts = [];
      for (const dz of [-0.028, 0.028]) {
        parts.push(new T.BoxGeometry(tip - heel - 0.02, 0.006, 0.006).translate((heel + tip) / 2, 0.004, ank.z + dz));
        for (let i = 0; i < 5; i++) parts.push(new T.ConeGeometry(0.007, 0.022, 4).rotateX(Math.PI).translate(heel + 0.02 + (tip - heel - 0.06) * i / 4, -0.008, ank.z + dz));
        parts.push(new T.ConeGeometry(0.006, 0.026, 4).rotateZ(Math.PI * 0.62).translate(tip + 0.006, 0.0, ank.z + dz * 0.6));   // 前齿
      }
      const cr = new T.Mesh(mergeAll(T, parts), lam(new T.Color(UI.dim), 'crampon', 0.25));
      cr.name = 'fenggeCrampon'; cr.frustumCulled = false; attach(cr, `leg_joint_${sd}_3`);
    }
  },
};

// ———— 配件小工具 ————
function mergeAll(T, geos) {                               // 几何合一个网格（只要 position，法线平面着色时现算）
  const pos = []; for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
const matOf = x => (c, key, glow = 0.15, rim) => x.tune(new x.THREE.MeshLambertMaterial({ color: c, flatShading: true }), key, rim, glow);
// 贴着帽子 / 头表面铺一片（头组坐标 = 照片像素，1 px ≈ 0.42 mm）：y 从帽檐线往上 y0..y1 px，绕头 ph0..ph1 弧度（0 = 正前），kf(u, v) = 往外放多少倍。
//   y 夹在 yMax 以内：护目镜这类「一片」夹 222 px（再往上头型收成一点，片的上沿会戳出尖）；帽身要收口成穹顶就给 232（= 头顶）
function headSheet(x, y0, y1, ph0, ph1, nu, nv, kf, edge = x.edge, yMax = 222) {
  const T = x.THREE, p = new T.Vector3(), pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, ph = ph0 + (ph1 - ph0) * u;
    x.headAt(Math.min(yMax, edge(ph) + y0 + (y1 - y0) * v), ph, p, kf(u, v), false);
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, c0 = a0 + nu + 1; idx.push(a0, a0 + 1, c0, a0 + 1, c0 + 1, c0); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function headPiece(x, g, mat, name) { mat.side = x.THREE.DoubleSide; const m = new x.THREE.Mesh(g, mat); m.name = name; m.frustumCulled = false; x.H.add(m); return m; }
const SKIN = '#c48c76';                                    // 露出来的胳膊 / 腿 / 脖子（照片里取的肤色，和手一样）

// ———— 华山 cliff_path：冲锋衣（球球挑的橙红砖）+ 立领 / 收在后领的帽兜 + 安全带（腰带 + 两个腿环 + 前面挂锁扣，配合 E 线的安全绳）————
//   安全带颜色跟 E 线 themes/cliff_path/props.js 的道具一致：扁带 #f07a1a、锁扣 #c9ccd2（扣上以后 E 线把崖上那副藏掉，就是「穿在身上了」）
const cliff = {
  ...base, name: 'cliff_path',
  extras(x) {
    const { THREE: T, J, body, attach, nk } = x, V = () => new T.Vector3(), lam = matOf(x), webC = new T.Color('#f07a1a'), steelC = new T.Color('#c9ccd2');
    const pel = J.Skeleton_torso_joint_1, hipY = body.hipY, parts = [];
    // 腰带：一圈扁带，套在冲锋衣下摆上（外骨骼腰带下面）
    const belt = [], n = 24, bw = 0.152, bd = 0.116, cx = pel.x + 0.004;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, pt = (a, y, k) => V().set(cx + Math.cos(a) * bd * k, y, pel.z + Math.sin(a) * bw * k);
      const q = [pt(a0, hipY - 0.04, 1), pt(a1, hipY - 0.04, 1), pt(a1, hipY - 0.01, 1), pt(a0, hipY - 0.01, 1)];
      belt.push(new T.BufferGeometry().setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]));
    }
    const beltM = new T.Mesh(mergeAll(T, belt), lam(webC, 'harness', 0.2)); beltM.material.side = T.DoubleSide; beltM.name = 'fenggeHarness';
    beltM.frustumCulled = false; attach(beltM, 'Skeleton_torso_joint_1');
    // 前面的保护环 + D 形锁扣（安全绳从这里出去）
    const lock = new T.TorusGeometry(0.026, 0.0055, 5, 12); lock.scale(0.8, 1.2, 1).rotateY(Math.PI / 2).translate(cx + bd + 0.012, hipY - 0.07, pel.z);
    const loop = new T.TorusGeometry(0.02, 0.006, 4, 10); loop.rotateY(Math.PI / 2).translate(cx + bd + 0.006, hipY - 0.042, pel.z);
    const lockM = new T.Mesh(mergeAll(T, [lock]), lam(steelC, 'carabiner', 0.25)); lockM.name = 'fenggeCarabiner'; lockM.frustumCulled = false; attach(lockM, 'Skeleton_torso_joint_1');
    const loopM = new T.Mesh(mergeAll(T, [loop]), lam(webC, 'harness', 0.2)); loopM.frustumCulled = false; attach(loopM, 'Skeleton_torso_joint_1');
    // 两个腿环：大腿根一圈，跟着大腿骨走
    for (const sd of ['L', 'R']) {
      const hip = J[`leg_joint_${sd}_1`], knee = J[`leg_joint_${sd}_2`], ax = knee.clone().sub(hip).normalize(), c = hip.clone().addScaledVector(ax, 0.07);
      const ring = new T.TorusGeometry(0.084, 0.011, 4, 16); ring.lookAt(ax); ring.translate(c.x, c.y, c.z);
      const m = new T.Mesh(mergeAll(T, [ring]), lam(webC, 'harness', 0.2)); m.name = 'fenggeHarness'; m.frustumCulled = false; attach(m, `leg_joint_${sd}_1`);
    }
    // 立领 + 收在后领的帽兜（挂胸骨，跟躯干走，不跟头转）；立领比围脖粗一圈，前面留拉链口
    const jc = new T.Color(base.uniforms.uMain.value), zc = new T.Color(base.uniforms.uZip.value), tc = new T.Color(base.uniforms.uTrim.value);
    const cP = [[-0.05, 0.088, -0.012], [-0.025, 0.084, -0.008], [0.0, 0.078, -0.004], [0.03, 0.075, 0.0]];   // [相对脖子骨的高度, 半径, 前后中心]
    const pos = [], cols = [], idx = [], NA = 28;
    for (let j = 0; j < cP.length; j++) for (let i = 0; i <= NA; i++) {
      const a = (i / NA - 0.5) * 2 * Math.PI * 0.93 + Math.PI, [h, r, dx] = cP[j], fr = Math.cos(a);   // a = π 是后面；前面留 ±12° 的口
      pos.push(nk.x + dx + fr * r, nk.y + h - (j >= 2 ? 0.022 * Math.max(0, fr) : 0), nk.z + Math.sin(a) * r);
      cols.push(...(i === 0 || i === NA ? zc : j === cP.length - 1 ? tc : jc).toArray());
    }
    for (let j = 0; j < cP.length - 1; j++) for (let i = 0; i < NA; i++) { const a0 = j * (NA + 1) + i, c0 = a0 + NA + 1; idx.push(a0, a0 + 1, c0, a0 + 1, c0 + 1, c0); }
    const cg = new T.BufferGeometry(); cg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); cg.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); cg.setIndex(idx);
    const ARC = Math.PI * 0.8, R = 0.07, hood = new T.TorusGeometry(R, 0.028, 8, 20, ARC), hp = hood.attributes.position, q = V(), o = V();
    for (let i = 0; i < hp.count; i++) {                    // 中间厚、两头收尖
      q.fromBufferAttribute(hp, i); const th = Math.atan2(q.y, q.x), tp = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, th / ARC)))));
      o.set(Math.cos(th) * R, Math.sin(th) * R, 0); q.sub(o).multiplyScalar(0.3 + 0.7 * tp).add(o); hp.setXYZ(i, q.x, q.y, q.z);
    }
    hood.rotateX(Math.PI / 2).rotateY(ARC / 2 - Math.PI).scale(1.12, 0.95, 1.08).translate(nk.x - 0.05, nk.y - 0.012, nk.z);   // 放平后弧的中点转到正后方（−X）
    const hc = []; for (let i = 0; i < hp.count; i++) hc.push(...jc.clone().multiplyScalar(0.9).toArray());
    hood.setAttribute('color', new T.Float32BufferAttribute(hc, 3));
    const cm = new T.Mesh(mergeColored(T, [cg, hood]), x.tune(new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide }), 'collar', undefined, 0.18));
    cm.name = 'fenggeCollar'; cm.frustumCulled = false; attach(cm, 'torso_joint_3');
  },
};
function mergeColored(T, geos) {                           // 带顶点色的合并
  const pos = [], col = [];
  for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); col.push(...g.attributes.color.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}

// ———— 东京 cyber_night：近黑雨衣（盖到大腿中段）+ 白色反光条（胸 / 背一圈、大臂、小臂、小腿；片元里 ×2.6 = 夜里被灯一照就亮）————
//   颜色：雨衣 = PALETTE.grid.main（深蓝灰近黑）、拼色 / 裤 = PALETTE.cyber_night.sub（湿钢灰）、反光条 = UI.fg
const tokyo = {
  name: 'cyber_night',
  uniforms: { uMain: col(PALETTE.grid.main), uTrim: col(PALETTE.cyber_night.sub), uRefl: col(UI.fg), uShoe: col('#1e1f22'), uSole: col(UI.dim), uNeck: col('#1e1f22'),
    uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.016, 0.011, 0.009, reg === 3 && t < 0.5 ? 0.02 : 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain, R = uRefl * 2.6;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 0.0) {
    if (ang.x > 0.25 && abs(ang.y) < 0.03) return uTrim;                                          // 门襟
    if (band(h, uSpan * 0.52, uSpan * 0.52 + 0.022) > 0.0) return R;                              // 胸 / 背一圈反光条
    if (band(h, uSpan * 0.52 + 0.034, uSpan * 0.52 + 0.046) > 0.0) return R;
    if (h > uSpan - 0.02 && ang.x < 0.8) c = uTrim;
    return c;
  }
  if (reg == 1.0) { if (band(t, 0.55, 0.62) > 0.0) return R; return c; }
  if (reg == 2.0) { if (band(t, 0.62, 0.69) > 0.0) return R; if (t > 0.86) return uTrim; return c; }
  if (reg == 3.0) { if (t < 0.45) { if (t > 0.41) return uTrim; return c; } return uTrim; }        // 雨衣下摆盖到大腿中段
  if (reg == 4.0) { c = uTrim; if (band(t, 0.45, 0.51) > 0.0) return R; return c; }
  return c;
}`,
};

// ———— 泰山 dawn_mountain：朱红短袖（胳膊 / 脖子露肤色）+ 登山长裤 + 小背包（在外骨骼电池包上面，不挡它）+ 遮阳渔夫帽（换掉毛线帽）————
//   颜色：短袖 = PALETTE.dawn_mountain.accent（朱红）、帽子 = PALETTE.dawn_mountain.sub（拂晓金）、背包 = PALETTE.dawn_mountain.main（花岗岩灰）、裤 / 背带 = PALETTE.cyber_night.sub
const taishan = {
  name: 'dawn_mountain', beanie: false, gaiter: false,
  uniforms: { uMain: col(PALETTE.dawn_mountain.accent[0]), uPants: col(PALETTE.cyber_night.sub), uStrap: col('#1e1f22'), uSkin: col(SKIN),
    uShoe: col('#4a4038'), uSole: col('#9b948a'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.008, reg === 1 && t < 0.45 ? 0.007 : 0, 0, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uSkin;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 0.0) {
    if (h < -0.03) return uPants;
    if (h > uSpan + 0.035 && ang.x > -0.2) return uSkin;                                          // 圆领口
    if (h > uSpan - 0.17 && abs(abs(ang.y) - 0.52) < 0.045 && ang.x > 0.0) return uStrap;        // 背包肩带（前面，细）
    if (abs(h - (uSpan - 0.1)) < 0.007 && ang.x > 0.55 && abs(ang.y) < 0.46) return uStrap;       // 胸带（短）
    return c;
  }
  if (reg == 1.0) return t < 0.45 ? (t > 0.4 ? c * 0.85 : c) : uSkin;                            // 短袖到大臂一半
  if (reg == 2.0) return uSkin;
  if (reg == 3.0 || reg == 4.0) return uPants;
  return c;
}`,
  extras(x) {
    const { THREE: T, J, body, attach } = x, lam = matOf(x);
    // 遮阳渔夫帽：帽身贴头（帽檐线在前额 110 px、两侧和后面往下压一点）+ 往外往下斜的一圈帽檐（宽约 5 cm）
    const hatEdge = ph => { const c = Math.cos(ph); return -20 + 125 * Math.pow(Math.max(0, c), 1.4) + 5 * Math.max(0, -c); };
    const hc = new T.Color(PALETTE.dawn_mountain.sub), crown = headSheet(x, 0, 150, -Math.PI, Math.PI, 28, 7, (u, v) => 1.07 + 0.02 * Math.sin(Math.PI * v), hatEdge, 232);
    headPiece(x, crown, lam(hc, 'hatCrown', 0.18), 'fenggeHat');
    const brim = headSheet(x, -4, -26, -Math.PI, Math.PI, 28, 1, (u, v) => 1.08 + 0.42 * v, hatEdge);
    headPiece(x, brim, lam(hc.clone().multiplyScalar(0.9), 'hatBrim', 0.18), 'fenggeHat');
    // 小背包：上背（肩胛到肩上），底边在外骨骼电池包上面，挂胸骨
    const span = body.shY - body.hipY, ch = J.torso_joint_3, y0 = body.hipY + 0.34, y1 = body.shY + 0.05;
    const pack = new T.BoxGeometry(0.11, y1 - y0, 0.22, 2, 3, 2), pp = pack.attributes.position, v = new T.Vector3();
    for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const r = 1 - 0.18 * (Math.abs(v.z) / 0.11) ** 2; pp.setXYZ(i, v.x * (v.x > 0 ? 0.6 : r), v.y, v.z * (v.y > 0 ? 0.9 : 1)); }   // 背面鼓、贴背那面平
    pack.translate(ch.x - 0.094 - 0.012 - 0.05, (y0 + y1) / 2, ch.z);
    const lid = new T.BoxGeometry(0.1, 0.035, 0.2).translate(ch.x - 0.094 - 0.012 - 0.06, y1 - 0.01, ch.z);
    const pk = new T.Mesh(mergeAll(T, [pack]), lam(new T.Color(PALETTE.dawn_mountain.main), 'pack', 0.16));
    const pl = new T.Mesh(mergeAll(T, [lid]), lam(new T.Color(PALETTE.cyber_night.sub), 'packLid', 0.14));
    for (const m of [pk, pl]) { m.name = 'fenggePack'; m.frustumCulled = false; attach(m, 'torso_joint_3'); }
  },
};

// ———— 梧桐山 subtropical：杜鹃粉 T 恤 + 卡其短裤（膝盖以下露腿）+ 背后腰上挂一个水壶 ————
//   颜色：T 恤 = PALETTE.subtropical.accent（毛棉杜鹃粉）、短裤 = PALETTE.dawn_mountain.main（花岗岩卡其）、水壶 = PALETTE.subtropical.main（林绿）
const wutong = {
  name: 'subtropical', gaiter: false,
  uniforms: { uMain: col(PALETTE.subtropical.accent[0]), uShorts: col(PALETTE.dawn_mountain.main), uSkin: col(SKIN), uShoe: col('#3a3a3a'), uSole: col('#9b948a'),
    uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.006, reg === 1 && t < 0.42 ? 0.006 : 0, 0, reg === 3 && t < 0.62 ? 0.01 : 0, 0, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uSkin;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; if (t < 0.35 && h > 0.06 - uHip) c = vec3(0.92); return c; }   // 运动鞋 + 白袜口
  if (reg == 0.0) {
    if (h < 0.0) return uShorts;
    if (h > uSpan + 0.035 && ang.x > -0.2) return uSkin;                                          // 圆领口
    if (h > uSpan + 0.02 && h < uSpan + 0.035) return c * 0.8;                                    // 领口罗纹
    return c;
  }
  if (reg == 1.0) return t < 0.42 ? (t > 0.37 ? c * 0.85 : c) : uSkin;
  if (reg == 2.0) return uSkin;
  if (reg == 3.0) return t < 0.62 ? (t > 0.57 ? uShorts * 0.85 : uShorts) : uSkin;               // 短裤到膝盖上面
  if (reg == 4.0) return uSkin;
  return c;
}`,
  extras(x) {
    const { THREE: T, J, body, attach } = x, lam = matOf(x), pel = J.Skeleton_torso_joint_1;
    const b = new T.CylinderGeometry(0.032, 0.032, 0.15, 8).translate(pel.x - 0.13, body.hipY - 0.07, pel.z - 0.075);
    const cap = new T.CylinderGeometry(0.02, 0.024, 0.03, 8).translate(pel.x - 0.13, body.hipY + 0.018, pel.z - 0.075);
    const bm = new T.Mesh(mergeAll(T, [b]), lam(new T.Color(PALETTE.subtropical.main), 'bottle', 0.2));
    const cm = new T.Mesh(mergeAll(T, [cap]), lam(new T.Color(PALETTE.cyber_night.sub), 'bottleCap', 0.15));
    for (const m of [bm, cm]) { m.name = 'fenggeBottle'; m.frustumCulled = false; attach(m, 'Skeleton_torso_joint_1'); }
  },
};

// ———— 富士 night_to_dawn：火山褐抓绒衣（片元里加一层绒面颗粒、半拉链、胸袋）+ 深色裤 + 头灯（帽子上一圈带子 + 前面灯座；
//   发光的灯泡是富士主题自己按 userData.fengge.lamp 挂的，灯座正好在它后面）————
//   颜色：抓绒 = PALETTE.night_to_dawn.main（火山褐）、拼色 / 裤 / 头灯 = PALETTE.cyber_night.sub
const fuji = {
  name: 'night_to_dawn',
  uniforms: { uMain: col(PALETTE.night_to_dawn.main), uTrim: col(PALETTE.cyber_night.sub), uZip: col('#141517'), uShoe: col('#4a4038'), uSole: col('#9b948a'),
    uNeck: col('#1e1f22'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.014, 0.01, 0.008, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 3.0 || reg == 4.0) return uTrim;
  c *= 0.9 + 0.2 * hash3(floor(vec3(h * 160.0, ang * 30.0)));                                   // 抓绒颗粒
  if (reg == 0.0) {
    if (h < -0.03) return uTrim;
    if (h < 0.0) return uTrim * 1.2;                                                               // 下摆收口
    if (ang.x > 0.25 && abs(ang.y) < 0.03 && h > uSpan - 0.2) return uZip;                        // 半拉链
    if (ang.x > 0.3 && band(h, uSpan - 0.16, uSpan - 0.06) > 0.0 && band(ang.y, 0.35, 0.62) > 0.0) c = uTrim;   // 胸袋
    if (h > uSpan - 0.015 && ang.x < 0.75) c = uTrim;                                            // 肩部拼色
    return c;
  }
  if (reg == 2.0 && t > 0.86) return uTrim;
  return c;
}`,
  extras(x) {
    const lam = matOf(x), T = x.THREE, dark = new T.Color(PALETTE.cyber_night.sub);
    headPiece(x, headSheet(x, 22, 44, -Math.PI, Math.PI, 40, 1, () => 1.16), lam(dark, 'lampBand', 0.1), 'fenggeHeadlamp');   // 头灯带
    headPiece(x, headSheet(x, 10, 58, -0.26, 0.26, 4, 3, (u, v) => 1.2 + 0.04 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)), lam(dark, 'lampBox', 0.12), 'fenggeHeadlamp');   // 灯座
  },
};

// ———— 训练场 grid：保留原来的白衬衫（CesiumMan 分区材质的缺省色：衣服 #eef2f6、裤 #39424f）————
const grid = {
  name: 'grid',
  uniforms: { uMain: col('#eef2f6'), uPants: col('#39424f'), uShoe: col('#2a2f36'), uSole: col('#9b948a'), uNeck: col('#1e1f22'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.008, 0.006, 0.005, 0.005, 0.004, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 0.0) { if (h < -0.03) return uPants; if (ang.x > 0.3 && abs(ang.y) < 0.02) c *= 0.85; return c; }   // 衬衫门襟
  if (reg == 2.0 && t > 0.88) return c * 0.9;                                                    // 袖口
  if (reg == 3.0 || reg == 4.0) return uPants;
  return c;
}`,
};

export const OUTFITS = { base, snow_summit: snow, cliff_path: cliff, cyber_night: tokyo, dawn_mountain: taishan, subtropical: wutong, night_to_dawn: fuji, grid };
// theme.style → 穿搭名（一个主题一套）
export const BY_STYLE = { snow_summit: 'snow_summit', cliff_path: 'cliff_path', cyber_night: 'cyber_night', dawn_mountain: 'dawn_mountain', subtropical: 'subtropical', night_to_dawn: 'night_to_dawn', grid: 'grid' };

let styleP = null;
function themeStyle() {                                   // 和 engine.js main() 选世界的规则一样
  return styleP || (styleP = (async () => {
    const q = new URLSearchParams(location.search);
    const worlds = await fetch('/worlds.json').then(r => r.json()).catch(() => []);
    let id = q.get('preview');
    if (!id) {
      const s = await fetch('/state').then(r => r.json()).catch(() => null);
      if (s && s.terrain && !s.terrain.preset && s.terrain.world) return (s.terrain.world.theme || {}).style || 'grid';
      id = s && s.terrain ? s.terrain.preset : 'everest_north';
    }
    const w = worlds.find(x => x.id === id) || worlds.find(x => x.id === 'everest_north') || worlds[0];
    return (w && w.theme && w.theme.style) || 'grid';
  })());
}

export async function outfitFor() {
  const o = new URLSearchParams(location.search).get('outfit');
  if (o && OUTFITS[o]) return OUTFITS[o];
  const style = o || await themeStyle();
  return OUTFITS[BY_STYLE[style]] || base;
}
