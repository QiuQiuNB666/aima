// P 线：峰哥的穿搭（第 2 轮，9/24 凌晨）。outfit = { name, uniforms（颜色）, glsl（片元里的 fit()：按部位 / 位置 / 朝向给颜色）, inflate(reg, t)（衣服蓬度，米）,
//   beanie / gaiter（false = 不戴毛线帽 / 围脖）, hand（手套颜色）, lampK（富士主题头灯挂点往外放多少）, extras(x)（配件：静止姿态下按骨骼摆好挂上去）}。
//   body.js 的顶点属性：reg 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子；t = 沿这一段 0..1（躯干从裆到脖子、四肢从近端到远端、鞋从脚跟到脚尖）；
//   h = 离髋关节多高（米，静止姿态）；ang = 朝向（x = 前，y = 往外 / 躯干是往左；鞋是 x = 朝上）；side +1 左 −1 右。
// 换装只看 theme.style；engine.js 不传主题，所以 outfitFor() 按 engine.js main() 同样的规则自己找当前世界（预览看 ?preview=，实机读 /state）。
//   ?outfit=<style 或穿搭名> 临时换（截图用）。颜色从 style.js 拿；中性色（鞋底、拉链、肤色……）集中在 N。
import * as THREE from 'three';
import { PALETTE, UI } from '../style.js';
import { AVATAR_LOOK } from '../avatar.js';

const col = c => ({ value: new THREE.Color(c) });
// 中性色：不是新色相，是鞋 / 拉链 / 围脖 / 肤色这些「本来就是这个颜色」的东西（肤色 = 照片里取的，和手一样）
const N = { dark: '#1e1f22', zip: '#141517', shoe: '#4a4038', sole: '#9b948a', skin: '#c48c76', sock: '#ebebeb' };
const STEEL = PALETTE.cyber_night.sub;                     // 湿钢灰：拼色 / 手套 / 靴 / 背带
// 华山安全带：和 E 线 themes/cliff_path/props.js 的道具同色（扣上以后 E 线把崖上那副藏掉，就是「穿在身上了」）。
//   审查指出这个橙和琥珀外骨骼色相只差约 9°，已在指挥板上约 E 线一起换色；换的时候只改这两个常量
const WEB = '#f07a1a', LOCK = UI.dim;

// GLSL 小工具：band = 硬边条带；aband = 抗锯齿条带（fwidth 软化边缘，远处细条纹不爬、不闪）
const LIB = `
float band(float x, float a, float b) { return step(a, x) * step(x, b); }
float aband(float x, float a, float b) { float w = fwidth(x); return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`;
// 贴脖根的圆领（短袖用）：侧面和后面贴着脖根，前面往下凹约 3 cm，再加一圈罗纹
const CREW = `
  float nl = uSpan + 0.062 - 0.028 * smoothstep(0.35, 0.95, ang.x);
  if (h > nl) return uSkin;
  if (h > nl - 0.012) return c * 0.78;`;

// ———— 第 1 轮基础款 = 球球挑的冲锋衣（橙红偏砖 + 炭灰拼色）+ 炭灰冲锋裤 + 登山鞋（华山那套也穿它）————
const base = {
  name: 'base',
  uniforms: { uMain: col('#b0472c'), uTrim: col('#33363b'), uZip: col(N.zip), uPants: col('#2b2e33'), uKnee: col('#3a3e45'),
    uShoe: col(N.shoe), uSole: col(N.sole), uNeck: col(N.dark), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
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

// ———— 珠峰 snow_summit（主打）：红色连体羽绒服（每 7.5 cm 一道绗缝）、护目镜推在帽子翻边上、氧气面罩挂胸前（挂绳绕脖子、软管顺胸前下到外骨骼腰带）、
//   冰爪（钢框露在靴子外面、爪齿一半露出雪面、前齿伸出鞋尖、红色绑带）、手套 ————
//   颜色：大身 / 绑带 = PALETTE.snow_summit.accent（觇标经幡红）；拼色 / 手套 / 靴 / 冰爪 = STEEL；面罩橡胶 = UI.dim；
//   镜片 = PALETTE.night_to_dawn.sub（深靛近黑，高山镜）+ 一道 UI.fg 高光（第一版用的高空蓝太像捷风的钴蓝，又太亮，读成发带）
const snow = {
  name: 'snow_summit',
  hand: STEEL,
  uniforms: { uMain: col(PALETTE.snow_summit.accent[0]), uTrim: col(STEEL), uZip: col(N.zip), uSole: col(UI.dim), uNeck: col(N.dark),
    uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => reg === 0 ? 0.03 * (1 - smoothstep(0.85, 0.95, t)) : [0, 0.024, 0.02, 0.024, 0.02, 0.012, 0][reg] || 0,   // 躯干到领口收回来，不留一圈台阶
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
    const { THREE: T, J, body, attach } = x, V = () => new T.Vector3(), steel = new T.Color(STEEL), red = new T.Color(PALETTE.snow_summit.accent[0]), lam = matOf(x);
    // ① 护目镜：压在毛线帽翻边上（翻边 k ≤ 1.135，别往上爬到帽身：帽身往上抬、往外鼓，会和镜框穿插）
    const bulge = (u, v) => Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    headPiece(x, headSheet(x, { y0: 30, y1: 52, ph0: -Math.PI, ph1: Math.PI, nu: 40, nv: 1, k: () => 1.16 }), lam(steel, 'goggleBand', 0.1), 'fenggeGoggles');
    headPiece(x, headSheet(x, { y0: 4, y1: 76, ph0: -1.18, ph1: 1.18, nu: 16, nv: 4, k: (u, v) => 1.175 + 0.045 * bulge(u, v) + 0.03 * v }), lam(steel, 'goggleFrame', 0.12), 'fenggeGoggles');
    headPiece(x, headSheet(x, { y0: 10, y1: 70, ph0: -1.0, ph1: 1.0, nu: 16, nv: 4, k: (u, v) => 1.195 + 0.05 * bulge(u, v) + 0.03 * v }), lam(new T.Color(PALETTE.night_to_dawn.sub), 'goggleLens', 0.2), 'fenggeGoggles');
    headPiece(x, headSheet(x, { y0: 44, y1: 52, ph0: -0.8, ph1: 0.3, nu: 10, nv: 1, k: () => 1.262 }), lam(new T.Color(UI.fg), 'goggleGlint', 0.3), 'fenggeGoggles');   // 镜片上一道高光
    // ② 氧气面罩：胸口正中（锁骨下），浅灰橡胶碗 + 钢灰阀门；挂绳绕到脖子后面；软管顺着胸前往下，插进外骨骼腰带前面（别走身侧：胳膊一直在那摆）
    const span = body.shY - body.hipY, chest = J.torso_joint_3, pel = J.Skeleton_torso_joint_1, cz = chest.z;
    const fx = chest.x + 0.094 + 0.03 + 0.008, my = body.hipY + span * 0.8;
    const mask = new T.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);   // 碗形，口朝后贴胸
    mask.rotateZ(-Math.PI / 2).scale(0.045, 0.07, 0.058).translate(fx, my, cz);
    const valve = new T.CylinderGeometry(0.013, 0.015, 0.024, 6); valve.rotateZ(Math.PI / 2).translate(fx + 0.045, my - 0.018, cz);
    const hose = new T.TubeGeometry(new T.CatmullRomCurve3([V().set(fx + 0.03, my - 0.06, cz + 0.01), V().set(fx + 0.012, my - 0.13, cz + 0.05),
      V().set(pel.x + 0.15, body.hipY + 0.17, cz + 0.075), V().set(pel.x + 0.135, body.hipY + 0.1, cz + 0.075)]), 16, 0.011, 5);
    const lanyard = new T.TorusGeometry(0.088, 0.005, 4, 20); lanyard.rotateX(Math.PI / 2).rotateZ(-0.62).translate(x.nk.x + 0.012, body.shY + 0.005, x.nk.z);
    const put = (geos, c, key, glow) => { const m = new T.Mesh(mergeAll(T, geos), lam(c, key, glow)); m.name = 'fenggeO2'; m.frustumCulled = false; attach(m, 'torso_joint_3'); };
    put([mask], new T.Color(UI.dim), 'o2mask', 0.2); put([valve, hose, lanyard], steel, 'o2hose', 0.18);
    // ③ 冰爪：钢框沿鞋底外缘露在靴子外面、抬到雪面以上；爪齿一半露出雪面；前齿伸出鞋尖 2 cm；脚背一根红绑带 + 两侧立柱。挂踝骨
    for (const sd of ['L', 'R']) {
      const ank = J[`leg_joint_${sd}_3`], toe = J[`leg_joint_${sd}_5`], heel = ank.x - 0.05, tip = Math.max(toe.x + 0.06, ank.x + 0.17), metal = [], strap = [];
      for (const dz of [-0.058, 0.058]) {
        metal.push(new T.BoxGeometry(tip - heel - 0.01, 0.012, 0.008).translate((heel + tip) / 2, 0.012, ank.z + dz));
        for (let i = 0; i < 5; i++) metal.push(new T.ConeGeometry(0.01, 0.034, 4).rotateX(Math.PI).translate(heel + 0.015 + (tip - heel - 0.05) * i / 4, 0.004, ank.z + dz));
        metal.push(new T.ConeGeometry(0.009, 0.045, 4).rotateZ(-Math.PI / 2 * 0.85).translate(tip + 0.02, 0.01, ank.z + dz * 0.35));   // 前齿
        strap.push(new T.BoxGeometry(0.016, 0.09, 0.008).translate(ank.x + 0.07, 0.055, ank.z + dz));                                   // 绑带两侧立柱
      }
      strap.push(new T.BoxGeometry(0.018, 0.008, 0.124).translate(ank.x + 0.07, 0.098, ank.z));                                          // 脚背绑带
      for (const [g, c, key, glow] of [[metal, steel, 'crampon', 0.25], [strap, red, 'cramponStrap', 0.2]]) {
        const m = new T.Mesh(mergeAll(T, g), lam(c, key, glow)); m.name = 'fenggeCrampon'; m.frustumCulled = false; attach(m, `leg_joint_${sd}_3`);
      }
    }
  },
};

// ———— 配件小工具 ————
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function mergeAll(T, geos) {                               // 几何合一个网格（只要 position，法线平面着色时现算）
  const pos = []; for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
function mergeColored(T, geos) {                           // 带顶点色的合并
  const pos = [], col = [];
  for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); col.push(...g.attributes.color.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
const matOf = x => (c, key, glow = 0.15, rim) => x.tune(new x.THREE.MeshLambertMaterial({ color: c, flatShading: true }), key, rim, glow);
// 贴着帽子 / 头表面铺一片（头组坐标 = 照片像素，1 px ≈ 0.42 mm）：y 从帽檐线往上 y0..y1 px，绕头 ph0..ph1 弧度（0 = 正前），k(u, v) = 往外放多少倍，
//   lift(v) = 再往上抬多少 px（帽顶别和头顶重合）。y 夹在 yMax 以内：护目镜这类「一片」夹 222 px（再往上头型收成一点，片的上沿会戳出尖）；
//   帽身要收口成穹顶就给 232（= 头顶，超出的行都收到头顶那一点）
function headSheet(x, { y0, y1, ph0, ph1, nu, nv, k, edge = x.edge, yMax = 222, lift = () => 0 }) {
  const T = x.THREE, p = new T.Vector3(), pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, ph = ph0 + (ph1 - ph0) * u;
    x.headAt(Math.min(yMax, edge(ph) + y0 + (y1 - y0) * v), ph, p, k(u, v), false);
    pos.push(p.x, p.y + lift(v), p.z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, c0 = a0 + nu + 1; idx.push(a0, a0 + 1, c0, a0 + 1, c0 + 1, c0); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function headPiece(x, g, mat, name) { mat.side = x.THREE.DoubleSide; const m = new x.THREE.Mesh(g, mat); m.name = name; m.frustumCulled = false; x.H.add(m); return m; }
// 立领 + 收在后领的帽兜（华山冲锋衣、东京雨衣都用）：挂胸骨，跟躯干走、不跟头转；立领比围脖粗一圈，前面留拉链口；帽兜中间厚、两头收尖
function collarHood(x, main, zip, trim) {
  const { THREE: T, attach, nk } = x, jc = new T.Color(main), zc = new T.Color(zip), tc = new T.Color(trim), V = () => new T.Vector3();
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
  for (let i = 0; i < hp.count; i++) {
    q.fromBufferAttribute(hp, i); const th = Math.atan2(q.y, q.x), tp = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, th / ARC)))));
    o.set(Math.cos(th) * R, Math.sin(th) * R, 0); q.sub(o).multiplyScalar(0.3 + 0.7 * tp).add(o); hp.setXYZ(i, q.x, q.y, q.z);
  }
  hood.rotateX(Math.PI / 2).rotateY(ARC / 2 - Math.PI).scale(1.12, 0.95, 1.08).translate(nk.x - 0.05, nk.y - 0.012, nk.z);   // 放平后弧的中点转到正后方（−X）
  const hc = []; for (let i = 0; i < hp.count; i++) hc.push(...jc.clone().multiplyScalar(0.9).toArray());
  hood.setAttribute('color', new T.Float32BufferAttribute(hc, 3));
  const cm = new T.Mesh(mergeColored(T, [cg, hood]), x.tune(new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide }), 'collar', undefined, 0.18));
  cm.name = 'fenggeCollar'; cm.frustumCulled = false; attach(cm, 'torso_joint_3');
}

// ———— 华山 cliff_path：冲锋衣（球球挑的橙红砖，同基础款）+ 立领帽兜 + 安全带（腰带 + 两个腿环 + 前面保护环挂 D 形锁扣，E 线的安全绳从这里出去）————
const cliff = {
  ...base, name: 'cliff_path',
  extras(x) {
    const { THREE: T, J, body, attach } = x, V = () => new T.Vector3(), lam = matOf(x), webC = new T.Color(WEB), lockC = new T.Color(LOCK);
    const pel = J.Skeleton_torso_joint_1, hipY = body.hipY, belt = [], n = 24, bw = 0.152, bd = 0.116, cx = pel.x + 0.004;
    for (let i = 0; i < n; i++) {                            // 腰带：一圈扁带，套在冲锋衣下摆上（外骨骼腰带下面）
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, pt = (a, y) => V().set(cx + Math.cos(a) * bd, y, pel.z + Math.sin(a) * bw);
      const q = [pt(a0, hipY - 0.04), pt(a1, hipY - 0.04), pt(a1, hipY - 0.01), pt(a0, hipY - 0.01)];
      belt.push(new T.BufferGeometry().setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]));
    }
    const loop = new T.TorusGeometry(0.02, 0.006, 4, 10); loop.rotateY(Math.PI / 2).translate(cx + bd + 0.006, hipY - 0.042, pel.z);
    const hb = new T.Mesh(mergeAll(T, [...belt, loop]), lam(webC, 'harness', 0.2)); hb.material.side = T.DoubleSide; hb.name = 'fenggeHarness'; hb.frustumCulled = false;
    attach(hb, 'Skeleton_torso_joint_1');
    const lock = new T.TorusGeometry(0.026, 0.0055, 5, 12); lock.scale(0.8, 1.2, 1).rotateY(Math.PI / 2).translate(cx + bd + 0.012, hipY - 0.07, pel.z);
    const lm = new T.Mesh(mergeAll(T, [lock]), lam(lockC, 'carabiner', 0.25)); lm.name = 'fenggeCarabiner'; lm.frustumCulled = false; attach(lm, 'Skeleton_torso_joint_1');
    for (const sd of ['L', 'R']) {                           // 腿环：大腿上（躯干下摆以下），跟着大腿骨走；外沿离外骨骼大腿杆还有约 3 mm
      const hip = J[`leg_joint_${sd}_1`], knee = J[`leg_joint_${sd}_2`], ax = knee.clone().sub(hip).normalize(), c = hip.clone().addScaledVector(ax, 0.13);
      const ring = new T.TorusGeometry(0.07, 0.01, 4, 16); ring.lookAt(ax); ring.translate(c.x, c.y, c.z);
      const m = new T.Mesh(mergeAll(T, [ring]), lam(webC, 'harness', 0.2)); m.name = 'fenggeHarness'; m.frustumCulled = false; attach(m, `leg_joint_${sd}_1`);
    }
    collarHood(x, base.uniforms.uMain.value, N.zip, base.uniforms.uTrim.value);
  },
};

// ———— 东京 cyber_night：近黑雨衣（盖到大腿中段，下摆一圈反光滚边）+ 收在后领的帽兜 + 白色反光条（胸 / 背两道、大臂、小臂、小腿；×2.6 = 夜里被灯一照就亮）————
//   颜色：雨衣 = PALETTE.grid.main（深蓝灰近黑）、拼色 / 裤 = PALETTE.cyber_night.sub（湿钢灰）、反光条 = UI.fg
const tokyo = {
  name: 'cyber_night',
  uniforms: { uMain: col(PALETTE.grid.main), uTrim: col(PALETTE.cyber_night.sub), uRefl: col(UI.fg), uShoe: col(N.dark), uSole: col(UI.dim), uNeck: col(N.dark),
    uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.016, 0.011, 0.009, reg === 3 && t < 0.5 ? 0.02 : 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain, R = uRefl * 2.6;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 0.0) {
    if (ang.x > 0.25 && abs(ang.y) < 0.03) c = uTrim;                                             // 门襟
    if (h > uSpan - 0.02 && ang.x < 0.8) c = uTrim;
    c = mix(c, R, max(aband(h, uSpan * 0.52, uSpan * 0.52 + 0.024), aband(h, uSpan * 0.52 + 0.036, uSpan * 0.52 + 0.058)));   // 胸 / 背两道反光条
    return c;
  }
  if (reg == 1.0) return mix(c, R, aband(t, 0.55, 0.63));
  if (reg == 2.0) { if (t > 0.86) c = uTrim; return mix(c, R, aband(t, 0.62, 0.7)); }
  if (reg == 3.0) { if (t < 0.45) return mix(c, R, aband(t, 0.4, 0.45)); return uTrim; }          // 雨衣下摆盖到大腿中段，下摆一圈反光滚边
  if (reg == 4.0) return mix(uTrim, R, aband(t, 0.45, 0.52));
  return c;
}`,
  extras(x) { collarHood(x, PALETTE.grid.main, N.zip, PALETTE.cyber_night.sub); },
};

// ———— 泰山 dawn_mountain：朱红短袖（圆领，胳膊 / 脖子露肤色）+ 登山长裤 + 小背包（贴着上背，在外骨骼电池包上面，不挡它；背带翻过肩膀、往腋下斜，胸带中间一个插扣）
//   + 米白遮阳渔夫帽（换掉毛线帽，帽身盖住整个头顶和后脑，宽帽檐往下斜，一圈朱红帽带）————
//   颜色：短袖 / 帽带 = PALETTE.dawn_mountain.accent（朱红）、帽子 = PALETTE.snow_summit.main（米白：拂晓金和琥珀外骨骼同色相，不用）、
//   背包 / 背带 / 裤 = STEEL
const taishan = {
  name: 'dawn_mountain', beanie: false, gaiter: false,
  uniforms: { uMain: col(PALETTE.dawn_mountain.accent[0]), uPants: col(STEEL), uStrap: col(STEEL), uSkin: col(N.skin),
    uShoe: col(N.shoe), uSole: col(N.sole), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.008, reg === 1 && t < 0.45 ? 0.007 : 0, 0, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uSkin;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 0.0) {
    if (h < -0.03) return uPants;` + CREW + `
    float sy = 0.46 + 1.6 * max(0.0, uSpan - 0.05 - h);                                             // 背带：上面贴近领口，往下往腋下外张
    if (h > uSpan - 0.2 && abs(abs(ang.y) - sy) < 0.075 && (ang.x > -0.3 || h > uSpan - 0.02)) return h < uSpan - 0.16 ? uStrap * 1.8 : uStrap;   // 末端调节扣
    if (abs(h - (uSpan - 0.1)) < 0.011 && ang.x > 0.5 && abs(ang.y) < sy) return abs(ang.y) < 0.07 ? uStrap * 2.2 : uStrap;   // 胸带 + 中间插扣
    return c;
  }
  if (reg == 1.0) return t < 0.45 ? (t > 0.4 ? c * 0.85 : c) : uSkin;                            // 短袖到大臂一半
  if (reg == 2.0) return uSkin;
  if (reg == 3.0 || reg == 4.0) return uPants;
  return c;
}`,
  extras(x) {
    const { THREE: T, J, body, attach } = x, lam = matOf(x);
    const hatEdge = ph => { const c = Math.cos(ph); return -20 + 125 * Math.pow(Math.max(0, c), 1.4) + 5 * Math.max(0, -c); };   // 帽檐线：前额 105 px，两侧 / 后面压到耳朵上方
    const hc = new T.Color(PALETTE.snow_summit.main);
    // 帽身：一直铺到头顶（yMax 232，超出的行收成穹顶），下沿 k 1.13 盖住头发，往上 1.07–1.09，帽顶再抬 10 px
    headPiece(x, headSheet(x, { y0: 0, y1: 250, ph0: -Math.PI, ph1: Math.PI, nu: 28, nv: 10, edge: hatEdge, yMax: 232, lift: v => 10 * v * v,
      k: (u, v) => 1.07 + 0.02 * Math.sin(Math.PI * v) + 0.06 * Math.max(0, 1 - v / 0.3) }), lam(hc, 'hatCrown', 0.18), 'fenggeHat');
    headPiece(x, headSheet(x, { y0: 2, y1: 20, ph0: -Math.PI, ph1: Math.PI, nu: 28, nv: 1, edge: hatEdge, k: () => 1.14 }), lam(new T.Color(PALETTE.dawn_mountain.accent[0]), 'hatBand', 0.18), 'fenggeHat');
    headPiece(x, headSheet(x, { y0: -4, y1: -48, ph0: -Math.PI, ph1: Math.PI, nu: 28, nv: 2, edge: hatEdge, k: (u, v) => 1.13 + 0.57 * v }), lam(hc.clone().multiplyScalar(0.72), 'hatBrim', 0.18), 'fenggeHat');
    // 小背包：贴着上背（贴背那面落在背面上），底边在外骨骼电池包上面；挂胸骨
    const ch = J.torso_joint_3, y0 = body.hipY + 0.34, y1 = body.shY + 0.05;
    const pack = new T.BoxGeometry(0.11, y1 - y0, 0.22, 2, 3, 2), pp = pack.attributes.position, v = new T.Vector3();
    for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const r = 1 - 0.18 * (Math.abs(v.z) / 0.11) ** 2; pp.setXYZ(i, v.x * (v.x > 0 ? 0.6 : r), v.y, v.z * (v.y > 0 ? 0.9 : 1)); }   // 背面鼓、贴背那面平
    pack.translate(ch.x - 0.125, (y0 + y1) / 2, ch.z);
    const lid = new T.BoxGeometry(0.1, 0.035, 0.2).translate(ch.x - 0.135, y1 - 0.01, ch.z);
    for (const [g, c, key] of [[pack, STEEL, 'pack'], [lid, N.dark, 'packLid']]) {
      const m = new T.Mesh(mergeAll(T, [g]), lam(new T.Color(c), key, 0.16)); m.name = 'fenggePack'; m.frustumCulled = false; attach(m, 'torso_joint_3');
    }
  },
};

// ———— 梧桐山 subtropical：杜鹃粉 T 恤（圆领）+ 卡其短裤（膝盖以下露腿）+ 白袜运动鞋 + 斜挎水壶（右肩斜到左腰，壶在左前腰、外骨骼腰带上面，正面看得见）————
//   颜色：T 恤 = PALETTE.subtropical.accent（毛棉杜鹃粉）、短裤 = PALETTE.dawn_mountain.main（花岗岩卡其）、水壶 = PALETTE.subtropical.main（林绿）、挎带 / 壶盖 = STEEL
const wutong = {
  name: 'subtropical', gaiter: false,
  uniforms: { uMain: col(PALETTE.subtropical.accent[0]), uShorts: col(PALETTE.dawn_mountain.main), uSkin: col(N.skin), uStrapC: col(STEEL), uSock: col(N.sock),
    uShoe: col('#3a3a3a'), uSole: col(N.sole), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.006, reg === 1 && t < 0.42 ? 0.006 : 0, 0, reg === 3 && t < 0.62 ? 0.01 : 0, 0, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uSkin;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; if (t < 0.35 && h > 0.06 - uHip) c = uSock; return c; }   // 运动鞋 + 白袜口
  if (reg == 0.0) {
    if (h < 0.0) return uShorts;` + CREW + `
    float k = clamp((h - 0.16) / (uSpan - 0.16), 0.0, 1.0);                                        // 斜挎带：左腰 → 右肩，前后都画
    if (h > 0.14 && abs(ang.y * sign(ang.x + 1e-3) - mix(0.5, -0.55, k)) < 0.06) return uStrapC;
    return c;
  }
  if (reg == 1.0) return t < 0.42 ? (t > 0.37 ? c * 0.85 : c) : uSkin;
  if (reg == 2.0) return uSkin;
  if (reg == 3.0) return t < 0.62 ? (t > 0.57 ? uShorts * 0.85 : uShorts) : uSkin;               // 短裤到膝盖上面
  if (reg == 4.0) return uSkin;
  return c;
}`,
  extras(x) {
    const { THREE: T, J, body, attach } = x, lam = matOf(x), pel = J.Skeleton_torso_joint_1, bx = pel.x + 0.115, bz = pel.z - 0.085;   // 左 = −Z
    const b = new T.CylinderGeometry(0.032, 0.032, 0.13, 8).translate(bx, body.hipY + 0.17, bz);
    const cap = new T.CylinderGeometry(0.02, 0.024, 0.03, 8).translate(bx, body.hipY + 0.25, bz);
    const clip = new T.BoxGeometry(0.012, 0.03, 0.024).translate(bx + 0.034, body.hipY + 0.2, bz);
    for (const [g, c, key] of [[[b], PALETTE.subtropical.main, 'bottle'], [[cap, clip], STEEL, 'bottleCap']]) {
      const m = new T.Mesh(mergeAll(T, g), lam(new T.Color(c), key, 0.2)); m.name = 'fenggeBottle'; m.frustumCulled = false; attach(m, 'Skeleton_torso_joint_1');
    }
  },
};

// ———— 富士 night_to_dawn：火山褐抓绒衣（绒面颗粒、半拉链、胸袋）+ 深色裤 + 头灯（帽子上一圈浅灰带子 + 前面一个灯座 + 小镜片；
//   富士主题自己按 userData.fengge.lamp 挂的发光灯泡，挂点按 lampK 挪到灯座前面）————
//   颜色：抓绒 = PALETTE.night_to_dawn.main（火山褐）、拼色 / 裤 = STEEL、头灯带 / 灯座 = UI.dim、镜片 = UI.fg
const fuji = {
  name: 'night_to_dawn', lampK: 1.26,
  uniforms: { uMain: col(PALETTE.night_to_dawn.main), uTrim: col(STEEL), uZip: col(N.zip), uShoe: col(N.shoe), uSole: col(N.sole),
    uNeck: col(N.dark), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.014, 0.01, 0.008, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 6.0) return uNeck;
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  if (reg == 3.0 || reg == 4.0) return uTrim;
  c *= 0.92 + 0.16 * hash3(floor(vec3(h * 60.0, ang * 12.0)));                                   // 抓绒颗粒（格子放粗：远了不闪）
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
    const lam = matOf(x), T = x.THREE, grey = new T.Color(UI.dim);
    headPiece(x, headSheet(x, { y0: 22, y1: 44, ph0: -Math.PI, ph1: Math.PI, nu: 40, nv: 1, k: () => 1.16 }), lam(grey, 'lampBand', 0.14), 'fenggeHeadlamp');
    headPiece(x, headSheet(x, { y0: 4, y1: 84, ph0: -0.34, ph1: 0.34, nu: 6, nv: 4, k: (u, v) => 1.2 + 0.05 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) }), lam(grey, 'lampBox', 0.2), 'fenggeHeadlamp');
    headPiece(x, headSheet(x, { y0: 22, y1: 46, ph0: -0.14, ph1: 0.14, nu: 3, nv: 2, k: () => 1.25 }), lam(new T.Color(UI.fg), 'lampLens', 0.3), 'fenggeHeadlamp');
  },
};

// ———— 训练场 grid：保留原来的白衬衫（直接用 avatar.js 分区材质的缺省色：衣服 AVATAR_LOOK.body、裤 AVATAR_LOOK.leg）————
const grid = {
  name: 'grid',
  uniforms: { uMain: col(AVATAR_LOOK.body), uPants: col(AVATAR_LOOK.leg), uShoe: col(N.dark), uSole: col(N.sole), uNeck: col(N.dark), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
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
function themeStyle() {                                   // 照 engine.js main() 选世界的顺序（包括「preset 不在 worlds.json 里就用 /state 自带的 world」）
  return styleP || (styleP = (async () => {
    const q = new URLSearchParams(location.search), id = q.get('preview');
    const worlds = await fetch('/worlds.json').then(r => r.json()).catch(() => []);
    let w;
    if (id) w = worlds.find(x => x.id === id) || worlds[0];
    else {
      const s = await fetch('/state').then(r => r.json()).catch(() => null);
      w = s && s.terrain ? worlds.find(x => x.id === s.terrain.preset) : (worlds.find(x => x.id === 'everest_north') || worlds[0]);
      if (!w && s && s.terrain) return ((s.terrain.world || {}).theme || {}).style || 'grid';
    }
    return (w && w.theme && w.theme.style) || 'grid';
  })());
}

export async function outfitFor() {
  const o = new URLSearchParams(location.search).get('outfit');
  if (o && OUTFITS[o]) return OUTFITS[o];
  const style = o || await themeStyle();
  return OUTFITS[BY_STYLE[style]] || base;
}
