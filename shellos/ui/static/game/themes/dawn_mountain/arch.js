// 山门：中天门（红柱黄瓦牌坊，跨路）、南天门（红墙拱门 + 摩空阁，跨在紧十八顶端，路从拱洞里穿过去）。
// 局部坐标：x = 路左、y = 上、z = 前进方向；原点 = 路中心。每座门合成 1 个网格（顶点色），匾额文字交给入口统一合进 textSigns。
import * as THREE from 'three';

const RED = '#b23a2a', RED_D = '#7e231b', GOLD = '#f3cf6b', TILE = '#e3ab3a', TILE_D = '#b67c22', STONE = '#8f8a80', TEAL = '#2c5a5e', GREEN = '#3f6b5a';

// 庑殿顶：下层翘檐（扁平台）+ 上层坡面 + 正脊。w 宽（沿 x）、d 进深（沿 z）、h 高，底面在 y
export function hipRoof(parts, w, d, h, y, z = 0) {
  const fr = (rt, hh, yy, ww, dd, color) => parts.push({ geo: new THREE.CylinderGeometry(rt, 1, 1, 4, 1).rotateY(Math.PI / 4), p: [0, yy + hh / 2, z], s: [ww / Math.SQRT2, hh, dd / Math.SQRT2], color });
  fr(0.8, h * 0.2, y, w, d, TILE_D);
  fr(0.2, h * 0.8, y + h * 0.2, w * 0.82, d * 0.82, TILE);
  parts.push({ geo: new THREE.BoxGeometry(1, 1, 1), p: [0, y + h + 0.04, z], s: [w * 0.42, 0.14, 0.14], color: TILE_D });
  for (const sx of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(1, 1, 1), p: [sx * w * 0.21, y + h + 0.16, z], s: [0.14, 0.3, 0.2], color: TILE_D });   // 鸱吻
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

// 南天门：红墙 + 圆拱门洞（宽 2.8、拱顶 3.4），墙厚 1.0；城楼摩空阁。半宽 3.1。
// 路从拱洞正中穿过；登顶时镜头从洞里穿到化身背后（入口把镜头压在路中线附近、高度 ≤ 2.9）
export function nanTianMen(ctx, s, mat) {
  const F = frameAt(ctx.route, s);
  const P = [], D = 1.0, HW = 3.1, AR = 1.4, SPRING = 2.0, TOP = 4.5;
  const sh = new THREE.Shape();
  sh.moveTo(-HW, -2.5); sh.lineTo(HW, -2.5); sh.lineTo(HW, TOP); sh.lineTo(-HW, TOP); sh.lineTo(-HW, -2.5);
  const hole = new THREE.Path();
  hole.moveTo(-AR, -2.4); hole.lineTo(AR, -2.4); hole.lineTo(AR, SPRING); hole.absarc(0, SPRING, AR, 0, Math.PI, false); hole.lineTo(-AR, -2.4);
  sh.holes.push(hole);
  const wall = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -D / 2);
  P.push({ geo: wall, color: RED });
  for (const sx of [-1, 1]) box(P, [sx * (AR + (HW - AR) / 2 + 0.03), 0.05, 0], [HW - AR + 0.1, 1.1, D + 0.12], STONE);   // 石基
  for (let k = 0; k <= 12; k++) {                      // 拱券石边（门洞口一圈浅色石）
    const a = Math.PI * k / 12, r = AR + 0.1;
    box(P, [Math.cos(a) * r, SPRING + Math.sin(a) * r, 0], [0.22, 0.22, D + 0.06], '#c9bfae');
  }
  hipRoof(P, HW * 2 + 0.8, D + 0.9, 0.5, TOP);          // 墙顶檐
  box(P, [0, TOP + 0.62, 0], [4.6, 0.25, 1.3], STONE);  // 城楼台基
  box(P, [0, TOP + 1.35, 0], [4.0, 1.25, 0.95], RED);   // 摩空阁
  for (let k = -3; k <= 3; k++) box(P, [k * 0.62, TOP + 1.35, -0.5], [0.13, 1.25, 0.08], RED_D);   // 檐柱
  box(P, [0, TOP + 2.05, 0], [4.2, 0.22, 1.1], GREEN);  // 斗拱带
  hipRoof(P, 5.6, 2.2, 1.2, TOP + 2.16);
  const texts = [
    ...plaque(F, '南天门', SPRING + AR + 0.6, -D / 2 - 0.02, D / 2 + 0.02, 0.6),
    ...plaque(F, '摩空阁', TOP + 1.45, -0.52, 0.52, 0.4),
  ];
  const cp = { color: GOLD, bg: '#5e1c16', border: '#c9a24a', vertical: true, weight: 800, pad: 0.2, h: 2.4 };   // 楹联：上联在观者右手（-x）
  texts.push({ text: '门辟九霄仰步三天胜迹', p: toWorld(F, -2.25, 1.35, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  texts.push({ text: '阶崇万级俯临千嶂奇观', p: toWorld(F, 2.25, 1.35, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  return { mesh: place(ctx.util, P, F, mat), texts, F, D, HW };
}
