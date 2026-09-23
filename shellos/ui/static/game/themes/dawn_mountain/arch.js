// 山门：中天门（红柱黄瓦牌坊，跨路）、南天门（红墙拱门 + 摩空阁，跨在紧十八顶端，路从拱洞里穿过去）。
// 局部坐标：x = 路左、y = 上、z = 前进方向；原点 = 路中心。每座门合成 1 个网格（顶点色），匾额文字交给入口统一合进 textSigns。
import * as THREE from 'three';

const RED = '#b23a2a', RED_D = '#7e231b', GOLD = '#f3cf6b', TILE = '#e3ab3a', TILE_D = '#b67c22', STONE = '#8f8a80', TEAL = '#2c5a5e', GREEN = '#3f6b5a';

// 庑殿顶：下层翘檐（扁平台）+ 上层坡面 + 正脊。w 宽（沿 x）、d 进深（沿 z）、h 高，底面在 y
export function hipRoof(parts, w, d, h, y, z = 0, [dk, lt] = [TILE_D, TILE], x = 0) {
  const fr = (rt, hh, yy, ww, dd, color) => parts.push({ geo: new THREE.CylinderGeometry(rt, 1, 1, 4, 1).rotateY(Math.PI / 4), p: [x, yy + hh / 2, z], s: [ww / Math.SQRT2, hh, dd / Math.SQRT2], color });
  fr(0.8, h * 0.2, y, w, d, dk);
  fr(0.2, h * 0.8, y + h * 0.2, w * 0.82, d * 0.82, lt);
  parts.push({ geo: new THREE.BoxGeometry(1, 1, 1), p: [x, y + h + 0.04, z], s: [w * 0.42, 0.14, 0.14], color: dk });
  for (const sx of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(1, 1, 1), p: [x + sx * w * 0.21, y + h + 0.16, z], s: [0.14, 0.3, 0.2], color: dk });   // 鸱吻
}
const box = (parts, p, s, color) => parts.push({ geo: new THREE.BoxGeometry(1, 1, 1), p, s, color });

// 路线 s 处的门框：base（路中心）、left、dir、ry（让局部 z 对准前进方向）
export function frameAt(route, s) {
  const a = route.at(s);
  return { base: a.pos.clone(), left: a.left.clone(), dir: a.dir.clone(), ry: Math.PI / 2 - a.heading };
}
// 局部点 → 世界坐标
export const toWorld = (F, x, y, z) => F.base.clone().addScaledVector(F.left, x).addScaledVector(F.dir, z).setY(F.base.y + y);

function place(util, parts, F, mat) {
  const m = new THREE.Mesh(util.merged(parts), mat);
  m.position.copy(F.base); m.rotation.y = F.ry; return m;
}
// 匾额：正反两面。y、z 为局部；h 文字板高
function plaque(F, text, y, zFront, zBack, h, o = {}) {
  const st = { color: GOLD, bg: '#1d3b4f', border: GOLD, weight: 900, pad: 0.28, ...o };
  return [
    { text, p: toWorld(F, 0, y, zFront), ry: F.ry + Math.PI, h, ...st },
    { text, p: toWorld(F, 0, y, zBack), ry: F.ry, h, ...st },
  ];
}

// 中天门：两根红柱（路两侧 ±2.3，镜头在化身左后 1.2–1.4 从柱间穿过）；额枋底 3.9（入口把慢十八下段的镜头压到踏面上 ≤ 3.4）
export function zhongTianMen(ctx, s, mat) {
  const F = frameAt(ctx.route, s), P = [];
  for (const x of [-2.3, 2.3]) {
    P.push({ geo: new THREE.CylinderGeometry(0.19, 0.22, 4.3, 12), p: [x, 2.0, 0], color: RED });
    box(P, [x, 0.3, 0], [0.7, 0.6, 0.7], STONE);
    box(P, [x, 0.12, 0], [0.95, 0.24, 0.95], STONE);
    box(P, [x, 3.55, 0.28], [0.1, 0.5, 0.5], RED_D);     // 雀替
  }
  box(P, [0, 4.05, 0], [5.4, 0.3, 0.42], RED_D);        // 额枋
  box(P, [0, 4.6, 0], [4.7, 0.8, 0.28], TEAL);          // 花板（匾额底）
  box(P, [0, 5.08, 0], [5.4, 0.18, 0.44], RED_D);
  box(P, [0, 5.26, 0], [5.8, 0.2, 0.74], GREEN);        // 斗拱带
  hipRoof(P, 7.0, 2.0, 0.95, 5.36);
  return { mesh: place(ctx.util, P, F, mat), texts: plaque(F, '中天门', 4.6, -0.16, 0.16, 0.66) };
}

// 南天门：红墙 + 圆拱门洞（宽 2.8、拱顶 3.1），墙厚 1.0；城楼摩空阁。半宽 3.1。
// 路从拱洞正中穿过；过门段镜头停在南侧洞口外 0.6–0.9、对准洞轴，洞口大于视野 → 画面里只有洞里的天街，不见红墙
export function nanTianMen(ctx, s, mat, hd = null) {
  const F = frameAt(ctx.route, s);
  if (hd !== null) { F.dir.set(Math.cos(hd), 0, Math.sin(hd)); F.left.set(Math.sin(hd), 0, -Math.cos(hd)); F.ry = Math.PI / 2 - hd; }   // 路在门前后有弯：门轴取弦向
  const P = [], D = 1.0, HW = 3.1, AR = 1.4, SPRING = 1.7, TOP = 4.3;   // 拱顶 3.1：镜头不再穿洞（停在洞口外看进去），拱压低 → 匾额在紧十八镜头里落到 HUD 下面
  const sh = new THREE.Shape();
  sh.moveTo(-HW, -2.5); sh.lineTo(HW, -2.5); sh.lineTo(HW, TOP); sh.lineTo(-HW, TOP); sh.lineTo(-HW, -2.5);
  const hole = new THREE.Path();
  hole.moveTo(-AR, -2.4); hole.lineTo(AR, -2.4); hole.lineTo(AR, SPRING); hole.absarc(0, SPRING, AR, 0, Math.PI, false); hole.lineTo(-AR, -2.4);
  sh.holes.push(hole);
  const wall = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -D / 2);
  P.push({ geo: wall, color: RED });
  for (const sx of [-1, 1]) box(P, [sx * (AR + (HW - AR) / 2 + 0.03), 0.05, 0], [HW - AR + 0.1, 1.1, D + 0.12], STONE);   // 石基
  const NV = 15, R1 = AR + 0.24, G = 0.01 / AR;         // 拱券：15 块首尾相接的楔形石，缝 0.02（缝里露出墙色）
  for (let k = 0; k < NV; k++) {
    const a0 = Math.PI * k / NV + G, a1 = Math.PI * (k + 1) / NV - G, w = new THREE.Shape();
    w.moveTo(Math.cos(a0) * AR, Math.sin(a0) * AR); w.lineTo(Math.cos(a0) * R1, Math.sin(a0) * R1);
    w.absarc(0, 0, R1, a0, a1, false); w.lineTo(Math.cos(a1) * AR, Math.sin(a1) * AR); w.absarc(0, 0, AR, a1, a0, true);
    P.push({ geo: new THREE.ExtrudeGeometry(w, { depth: D + 0.06, bevelEnabled: false, curveSegments: 2 }).translate(0, SPRING, -(D + 0.06) / 2), color: k % 2 ? '#948d82' : '#8a8378' });
  }
  for (const sx of [-1, 1]) box(P, [sx * (AR + 0.12), SPRING / 2 - 0.25, 0], [0.24, SPRING + 0.5, D + 0.06], '#8a8378');   // 门洞两侧石框
  hipRoof(P, HW * 2 + 0.8, D + 0.9, 0.5, TOP);          // 墙顶檐
  box(P, [0, TOP + 0.62, 0], [4.6, 0.25, 1.3], STONE);  // 城楼台基
  box(P, [0, TOP + 1.35, 0], [4.0, 1.25, 0.95], RED);   // 摩空阁
  for (let k = -3; k <= 3; k++) box(P, [k * 0.62, TOP + 1.35, -0.5], [0.13, 1.25, 0.08], RED_D);   // 檐柱
  box(P, [0, TOP + 2.05, 0], [4.2, 0.22, 1.1], GREEN);  // 斗拱带
  hipRoof(P, 5.6, 2.2, 1.2, TOP + 2.16);
  const texts = [
    ...plaque(F, '南天门', SPRING + AR + 0.52, -D / 2 - 0.02, D / 2 + 0.02, 0.56),
    ...plaque(F, '摩空阁', TOP + 1.45, -0.52, 0.52, 0.4),
  ];
  const cp = { color: GOLD, bg: '#5e1c16', border: '#c9a24a', vertical: true, weight: 800, pad: 0.2, h: 2.4 };   // 楹联：上联在观者右手（-x）
  texts.push({ text: '门辟九霄仰步三天胜迹', p: toWorld(F, -2.25, 1.35, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  texts.push({ text: '阶崇万级俯临千嶂奇观', p: toWorld(F, 2.25, 1.35, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  return { mesh: place(ctx.util, P, F, mat), texts, F, D, HW };
}

// 天街：路左侧一排低矮店铺（灰瓦檐 + 暖白墙 + 木门 + 竖幌子），红灯笼另给（lanterns）。s0 起每间占 4 步（2 单位）
export function tianJie(ctx, s0, count, mat) {
  const { route, util } = ctx, P = [], texts = [], lanterns = [];
  const names = ['天街茶舍', '仙居客栈', '岱顶小吃', '泰山石记'], flags = ['茶', '客栈', '食', '石'];
  for (let k = 0; k < count; k++) {
    const F = frameAt(route, s0 + k * 4.5 + 2), at = (x, y, z) => toWorld(F, x, y, z).toArray();
    const X = 3.55, W = 2.0, Hh = 2.1, add = (geo, p, s, color) => P.push({ geo, p: at(...p), ry: F.ry, s, color });
    add(new THREE.BoxGeometry(1, 1, 1), [X, -0.2, 0], [2.3, 0.5, W + 0.1], '#9a9184');                // 石台基
    add(new THREE.BoxGeometry(1, 1, 1), [X, Hh / 2, 0], [2.2, Hh, W], '#e8dcc6');                      // 暖白墙
    add(new THREE.BoxGeometry(1, 1, 1), [X - 1.08, 0.75, 0], [0.06, 1.5, 0.85], '#5a3f2a');            // 木门
    for (const z of [-0.72, 0.72]) add(new THREE.BoxGeometry(1, 1, 1), [X - 1.08, 1.25, z], [0.05, 0.5, 0.36], '#7a5634');   // 窗
    add(new THREE.BoxGeometry(1, 1, 1), [X - 1.08, Hh - 0.12, 0], [0.08, 0.16, W + 0.05], '#6e4a2c');  // 檐下木枋
    const rp = [], cols = ['#50535a', '#6d7076'];
    hipRoof(rp, 3.0, W + 0.7, 0.75, Hh);
    for (const r of rp) P.push({ geo: r.geo, p: at(r.p[0] + X, r.p[1], r.p[2]), ry: F.ry, s: r.s, color: r.color === TILE ? cols[1] : cols[0] });
    add(new THREE.BoxGeometry(1, 1, 1), [2.2, 1.95, W / 2 - 0.2], [0.04, 0.9, 0.05], '#3a2a1c');      // 幌子杆（店铺远端，不挡灯笼）
    texts.push({ text: flags[k % 4], p: toWorld(F, 2.05, 1.55, W / 2 - 0.2), ry: F.ry + Math.PI, h: 0.75, color: '#fff3dc', bg: '#9b2a1e', border: '#e0b44a', vertical: true, weight: 900, pad: 0.2 });
    texts.push({ text: names[k % 4], p: toWorld(F, X - 1.13, 1.72, -0.1), ry: F.ry - Math.PI / 2, h: 0.24, color: '#2a1a10', bg: '#d9b877', weight: 800, pad: 0.15 });
    for (const z of (k % 2 ? [-0.7] : [-0.7, 0.3])) lanterns.push({ p: toWorld(F, X - 1.3, 1.62, z), ry: F.ry });
  }
  return { mesh: new THREE.Mesh(util.merged(P), mat), texts, lanterns };
}

// 红灯笼：一个合成几何（红肚 + 上下金边 + 穗），配 vertexColors 材质做 InstancedMesh
export function lanternGeo(util) {
  return util.merged([
    { geo: new THREE.SphereGeometry(0.17, 12, 8), p: [0, 0, 0], s: [1, 1.15, 1], color: '#d8321f' },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), p: [0, 0.2, 0], color: '#c9982f' },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), p: [0, -0.2, 0], color: '#c9982f' },
    { geo: new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4), p: [0, 0.37, 0], color: '#2a2020' },
    { geo: new THREE.CylinderGeometry(0.02, 0.05, 0.16, 6), p: [0, -0.3, 0], color: '#e0b030' },
  ]);
}

// 玉皇庙剪影：山脊上的小殿（石台基 + 红墙 + 黄瓦庑殿顶 + 两侧矮围墙），比南天门小；下面一块花岗岩把它托高
export function yuHuangMiao(ctx, s, lat, lift, mat) {
  const F = frameAt(ctx.route, s), P = [];
  F.base.addScaledVector(F.left, lat); F.base.y += lift;
  P.push({ geo: new THREE.CylinderGeometry(2.7, 3.4, lift + 1.2, 7), p: [0, -lift / 2 - 0.6, 0], color: '#7f786c' });   // 托起的岩台
  box(P, [0, 0.2, 0], [4.4, 0.4, 3.2], STONE);
  box(P, [0, 1.15, 0], [3.4, 1.5, 2.2], RED);
  box(P, [0, 0.72, -1.12], [0.9, 0.95, 0.06], RED_D);
  box(P, [0, 1.98, 0], [3.6, 0.18, 2.4], GREEN);
  hipRoof(P, 4.4, 3.1, 1.0, 2.07);
  for (const sx of [-1, 1]) {
    box(P, [sx * 2.8, 0.75, 0.4], [1.4, 1.1, 0.35], RED);
    box(P, [sx * 2.8, 1.38, 0.4], [1.6, 0.16, 0.6], TILE);
  }
  return { mesh: place(ctx.util, P, F, mat), texts: [{ text: '玉皇顶', p: toWorld(F, 0, 1.62, -1.16), ry: F.ry + Math.PI, h: 0.4, color: GOLD, bg: '#1d3b4f', border: GOLD, weight: 900, pad: 0.25 }] };
}
