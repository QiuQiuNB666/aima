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
    const { THREE: T, J, body, H, headAt, edge, tune, attach } = x, V = () => new T.Vector3(), steel = new T.Color(STEEL);
    const lam = (c, key, glow = 0.15, rim) => tune(new T.MeshLambertMaterial({ color: c, flatShading: true }), key, rim, glow);
    // ① 护目镜：推在毛线帽上（头组坐标 = 照片像素，1 px ≈ 0.42 mm；headAt 给帽子 / 头的表面，k = 往外放多少倍）。
    //   帽带一圈（帽檐线上 30–52 px）+ 前面一块大镜片（帽檐线上 12–112 px ≈ 4 cm 高、左右 ±63°，中间往外鼓）+ 一圈镜框
    const p = V(), sheet = (y0, y1, ph0, ph1, nu, nv, kf) => {
      const pos = [], idx = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, ph = ph0 + (ph1 - ph0) * u; headAt(Math.min(222, edge(ph) + y0 + (y1 - y0) * v), ph, p, kf(u, v), false);   // 222 px：别超过头顶（再往上头型收成一点，会戳出尖） pos.push(p.x, p.y, p.z);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, c0 = a0 + nu + 1; idx.push(a0, a0 + 1, c0, a0 + 1, c0 + 1, c0); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    const bulge = (u, v) => Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const band = sheet(30, 52, -Math.PI, Math.PI, 40, 1, () => 1.16);
    const frame = sheet(6, 118, -1.18, 1.18, 16, 4, (u, v) => 1.17 + 0.045 * bulge(u, v));
    const lensG = sheet(14, 110, -1.1, 1.1, 16, 4, (u, v) => 1.19 + 0.05 * bulge(u, v));
    const gm = (g, c, key, glow, rim) => { const m = new T.Mesh(g, lam(c, key, glow, rim)); m.material.side = T.DoubleSide; m.name = 'fenggeGoggles'; m.frustumCulled = false; H.add(m); };
    gm(band, steel, 'goggleBand', 0.1); gm(frame, steel, 'goggleFrame', 0.12); gm(lensG, new T.Color(PALETTE.snow_summit.sub), 'goggleLens', 0.5, 1.6);
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
function mergeAll(T, geos) {                               // 几何合一个网格（只要 position，法线平面着色时现算）
  const pos = []; for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

export const OUTFITS = { base, snow_summit: snow };
// theme.style → 穿搭名（第 2 轮一个主题一套；还没做的先穿基础款）
export const BY_STYLE = { snow_summit: 'snow_summit' };

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
