// 山门：中天门（红柱黄瓦牌坊，跨路）、南天门（红墙拱门 + 摩空阁，放在十八盘顶的山顶平台上）。
// 局部坐标：x = 路左、y = 上、z = 前进方向；原点 = 路中心。每座门合成 1 个网格（顶点色），匾额文字交给入口统一合进 textSigns。
import * as THREE from 'three';

const RED = '#b8402f', RED_D = '#86261e', GOLD = '#f3cf6b', TILE = '#e0a93c', TILE_D = '#c68a26', STONE = '#9a948a', TEAL = '#2c5a5e', GREEN = '#3f6b5a';

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

// 中天门：两根红柱（在路两侧 ±2.4，镜头从柱间穿过）、额枋底 4.2（镜头在台阶上最高约 3.7，留余量）
export function zhongTianMen(ctx, s, mat) {
  const F = frameAt(ctx.route, s), P = [];
  for (const x of [-2.4, 2.4]) {
    P.push({ geo: new THREE.CylinderGeometry(0.17, 0.2, 5.8, 10), p: [x, 1.8, 0], color: RED });
    box(P, [x, 0.28, 0], [0.66, 0.56, 0.66], STONE);
    box(P, [x, 0.12, 0], [0.9, 0.24, 0.9], STONE);
  }
  box(P, [0, 4.36, 0], [5.6, 0.32, 0.4], RED_D);     // 额枋
  box(P, [0, 4.92, 0], [4.9, 0.8, 0.26], TEAL);      // 花板（匾额底）
  box(P, [0, 5.43, 0], [5.6, 0.22, 0.42], RED_D);
  box(P, [0, 5.64, 0], [5.9, 0.2, 0.72], GREEN);     // 斗拱带
  hipRoof(P, 7.0, 2.0, 0.95, 5.74);
  return { mesh: place(ctx.util, P, F, mat), texts: plaque(F, '中天门', 4.92, -0.15, 0.15, 0.62) };
}

// 南天门：红墙 + 圆拱门洞（宽 2.9、拱顶 2.95）+ 城楼摩空阁。半宽 3.4：登顶环绕镜头（半径 5.2）从墙外绕过
export function nanTianMen(ctx, s, mat, shift = 0) {
  const F = frameAt(ctx.route, s); F.base.addScaledVector(F.left, shift);
  const P = [], D = 1.6, HW = 3.4, AR = 1.45;
  const sh = new THREE.Shape();
  sh.moveTo(-HW, -2.5); sh.lineTo(HW, -2.5); sh.lineTo(HW, 4.0); sh.lineTo(-HW, 4.0); sh.lineTo(-HW, -2.5);
  const hole = new THREE.Path();
  hole.moveTo(-AR, -2.4); hole.lineTo(AR, -2.4); hole.lineTo(AR, 1.5); hole.absarc(0, 1.5, AR, 0, Math.PI, false); hole.lineTo(-AR, -2.4);
  sh.holes.push(hole);
  const wall = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -D / 2);
  P.push({ geo: wall, color: RED });
  for (const sx of [-1, 1]) box(P, [sx * (AR + (HW - AR) / 2 + 0.03), -0.05, 0], [HW - AR + 0.1, 1.0, D + 0.1], STONE);   // 石基
  // 拱券石边（门洞口一圈浅色石）
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * k / 10, r = AR + 0.09;
    box(P, [Math.cos(a) * r, 1.5 + Math.sin(a) * r, 0], [0.2, 0.2, D + 0.04], '#c9bfae');
  }
  hipRoof(P, 7.6, 2.4, 0.5, 4.0);                     // 墙顶檐
  box(P, [0, 4.62, 0], [5.0, 0.25, 1.8], STONE);      // 城楼台基
  box(P, [0, 5.35, 0], [4.4, 1.25, 1.3], RED);        // 摩空阁
  for (let k = -3; k <= 3; k++) box(P, [k * 0.68, 5.35, -0.67], [0.14, 1.25, 0.08], RED_D);   // 檐柱
  box(P, [0, 6.05, 0], [4.6, 0.22, 1.45], GREEN);     // 斗拱带
  hipRoof(P, 6.2, 2.8, 1.25, 6.16);
  const texts = [
    ...plaque(F, '南天门', 3.42, -D / 2 - 0.02, D / 2 + 0.02, 0.62),
    ...plaque(F, '摩空阁', 5.45, -0.72, 0.72, 0.42, { bg: '#1d3b4f' }),
  ];
  const cp = { color: GOLD, bg: '#5e1c16', border: '#c9a24a', vertical: true, weight: 800, pad: 0.2, h: 2.5 };   // 南天门楹联：上联在观者右手（-x）
  texts.push({ text: '门辟九霄仰步三天胜迹', p: toWorld(F, -2.35, 1.55, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  texts.push({ text: '阶崇万级俯临千嶂奇观', p: toWorld(F, 2.35, 1.55, -D / 2 - 0.02), ry: F.ry + Math.PI, ...cp });
  return { mesh: place(ctx.util, P, F, mat), texts, F };
}
