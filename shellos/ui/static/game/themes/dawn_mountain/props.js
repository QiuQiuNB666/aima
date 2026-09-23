// 路边的东西：石栏杆 + 铁链（挂红布条、同心锁）、迎风松、山石、紧十八两侧崖壁、摩崖石刻、碑。
// 全部 instanced / merged：每类 1 次绘制。
import * as THREE from 'three';
import { ROAD_W } from '../../path.js';

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const RAIL_LAT = ROAD_W / 2 + 0.35;         // 1.45：路面 ±1.4 以内不放东西

// 石栏杆：每步一根望柱（踏面中心），柱顶一条石扶手，柱间铁链下垂 + 红布条 / 同心锁
export function railings(ctx, ranges, mats) {
  const { route, util } = ctx, R = ctx.rand;
  const posts = [], rails = [], links = [], ribbons = [], locks = [];
  const v = new THREE.Vector3();
  const seg = (a, b, out, extra = {}) => {          // a→b 的细长件：单位几何沿 x
    v.subVectors(b, a); const len = v.length();
    out.push({ p: a.clone().lerp(b, 0.5), q: new THREE.Quaternion().setFromUnitVectors(X, v.normalize()), s: [len, 1, 1], ...extra });
  };
  for (const [s0, s1] of ranges) for (const side of [1, -1]) {
    let prev = null;
    for (let s = s0; s <= s1 + 1e-6; s += 2) {
      const a = route.at(s, side * RAIL_LAT), p = a.pos.clone();
      posts.push({ p, ry: -a.heading });
      if (prev) {
        seg(prev.clone().setY(prev.y + 0.74), p.clone().setY(p.y + 0.74), rails);
        const N = 8, c0 = prev.clone().setY(prev.y + 0.5), c1 = p.clone().setY(p.y + 0.5);   // 链：抛物线下垂
        const pt = k => c0.clone().lerp(c1, k / N).addScaledVector(Y, -0.2 * 4 * (k / N) * (1 - k / N));
        for (let k = 0; k < N; k++) seg(pt(k), pt(k + 1), links);
        for (const f of [0.3, 0.5, 0.7]) if (R() < 0.6) { const lo = pt(Math.round(f * N)); ribbons.push({ p: lo.clone(), ry: -a.heading + (R() - 0.5) * 0.6, s: [1, 0.8 + R() * 0.5, 1], color: R() < 0.8 ? '#d0302a' : '#e8b53a' }); }
        if (R() < 0.6) locks.push({ p: pt(2 + (R() * 5 | 0)).addScaledVector(Y, -0.05), ry: -a.heading, color: R() < 0.7 ? '#d8a62a' : '#b83a2a' });
      }
      prev = p;
    }
  }
  const postGeo = util.merged([
    { geo: new THREE.BoxGeometry(0.15, 1.7, 0.15), p: [0, -0.05, 0], color: '#d6cdbb' },
    { geo: new THREE.BoxGeometry(0.2, 0.07, 0.2), p: [0, 0.83, 0], color: '#e2dacb' },
    { geo: new THREE.ConeGeometry(0.13, 0.16, 4).rotateY(Math.PI / 4), p: [0, 0.94, 0], color: '#e2dacb' },
  ]);
  const out = [
    util.instanced(postGeo, mats.vc, posts),                                                             // 柱中心在踏面：地下 0.9、地上 0.9
    util.instanced(new THREE.BoxGeometry(1, 0.08, 0.11), mats.stoneRail, rails),
    util.instanced(new THREE.CylinderGeometry(0.02, 0.02, 1, 5).rotateZ(Math.PI / 2), mats.iron, links),
    util.instanced(new THREE.PlaneGeometry(0.09, 0.42).translate(0, -0.21, 0), mats.cloth, ribbons),
    util.instanced(new THREE.BoxGeometry(0.07, 0.09, 0.03), mats.lambert, locks),
  ];
  out.forEach(m => { m.name = 'rail'; });
  return out;
}

// 松树：S 形斜干 + 几层扁平松针团，全部朝 +x（风向）伸展 = 迎客松那种「迎风斜枝」。返回合成几何
function pineGeo(util, R, big) {
  const P = [], trunk = '#4b3a2b', leaf = ['#233d25', '#2c4a2b', '#375a31', '#41683a'];
  let x = 0, y = 0, lean = 0;
  const H = big ? 3.4 : 2.4, n = 4;
  const pts = [];
  for (let k = 0; k < n; k++) {
    lean += (k === 0 ? 0.25 : 0.12) + R() * 0.12;
    const len = H / n, r0 = 0.14 * (1 - k / n) + 0.04, r1 = 0.14 * (1 - (k + 1) / n) + 0.035;
    P.push({ geo: new THREE.CylinderGeometry(r1, r0, len, 6).translate(0, len / 2, 0), p: [x, y, 0], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean), color: trunk });
    x += Math.sin(lean) * len; y += Math.cos(lean) * len; pts.push([x, y]);
  }
  const layers = big ? 6 : 4;
  for (let j = 0; j < layers; j++) {
    const f = 0.35 + 0.65 * j / (layers - 1), k = Math.min(n - 1, Math.floor(f * n)), [tx, ty] = pts[k];
    const reach = (1 - f) * (big ? 1.5 : 1.0) + 0.35, bx = tx + reach * (0.6 + R() * 0.5), bz = (R() - 0.5) * 0.9 * (1 - f * 0.6);
    const sy = 0.22 + R() * 0.08, w = (big ? 1.35 : 1.0) * (1.15 - f * 0.45);
    // 枝：从干到针团
    const a = new THREE.Vector3(tx - 0.1, ty - 0.2, 0), b = new THREE.Vector3(bx, ty - 0.05, bz), d = b.clone().sub(a);
    P.push({ geo: new THREE.CylinderGeometry(0.03, 0.05, d.length(), 5).translate(0, d.length() / 2, 0), p: a.toArray(), q: new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), color: trunk });
    for (let q = 0; q < 4; q++) {                       // 一层 = 几团扁针叶（团簇，不是一整张饼）
      const a2 = q / 4 * Math.PI * 2 + R(), rr = w * 0.45 * (q ? 1 : 0), cw = w * (q ? 0.55 : 0.7) * (0.8 + R() * 0.4);
      P.push({ geo: new THREE.SphereGeometry(1, 9, 4), p: [bx + Math.cos(a2) * rr, ty + (R() - 0.3) * sy * 0.8, bz + Math.sin(a2) * rr * 0.7], s: [cw, sy * (0.8 + R() * 0.5), cw * 0.8], color: leaf[(j + q) % leaf.length] });
    }
  }
  return util.merged(P);
}

// 松树 + 山石撒在地上。hAt(x, z) = 地面高；keep(x, z, lat, s, isRock) → 是否允许放
export function forest(ctx, hAt, windRy, keep, mats, hero = []) {
  const { route, util } = ctx, R = ctx.rand;
  const geos = [pineGeo(util, R, true), pineGeo(util, R, false), pineGeo(util, R, false)];
  const sets = [[], [], []], rocks = [];
  const N = route.N, span = [-14, N + 18];
  for (let tries = 0; tries < 900 && sets[0].length + sets[1].length + sets[2].length < 170; tries++) {
    const s = span[0] + R() * (span[1] - span[0]), side = R() < 0.55 ? 1 : -1;
    const lat = side * ((side > 0 ? 7.5 : 2.8) + Math.pow(R(), 2.2) * 30);   // 左侧松往路这边伸枝，离远点
    const a = route.at(s, lat);
    if (!keep(a.pos.x, a.pos.z, lat, s)) continue;
    const y = hAt(a.pos.x, a.pos.z);
    const k = R() < 0.25 ? 0 : 1 + (R() * 2 | 0), sc = 0.8 + R() * 0.7 + (Math.abs(lat) > 12 ? 0.5 : 0);
    sets[k].push({ p: [a.pos.x, y - 0.1, a.pos.z], ry: windRy + (R() - 0.5) * 0.7, s: sc });
  }
  for (const h of hero) {                   // 指定位置的「名松」：关键镜头里一定看得到
    const a = route.at(h.s, h.lat), y = hAt(a.pos.x, a.pos.z);
    sets[0].push({ p: [a.pos.x, Math.max(y, route.heightAt(h.s) - 1.5) - 0.1, a.pos.z], ry: windRy + (h.ry || 0), s: h.sc || 1.3 });
  }
  for (let i = 0; i < 70; i++) {
    const s = span[0] + R() * (span[1] - span[0]), side = R() < 0.5 ? 1 : -1, lat = side * ((side > 0 ? 4.2 : 2.2) + R() * 16);
    const a = route.at(s, lat);
    if (!keep(a.pos.x, a.pos.z, lat, s, true)) continue;
    const y = hAt(a.pos.x, a.pos.z), sz = 0.2 + R() * R() * 0.9;
    rocks.push({ p: [a.pos.x, y + sz * 0.15, a.pos.z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), s: [sz * (1 + R()), sz * (0.6 + R() * 0.5), sz], color: new THREE.Color('#8c877c').multiplyScalar(0.8 + R() * 0.35) });
  }
  const out = geos.map((g, k) => util.instanced(g, mats.vc, sets[k]));
  out.push(util.instanced(new THREE.IcosahedronGeometry(1, 0), mats.rock, rocks));
  out.forEach(m => { m.name = 'forest'; });
  return { meshes: out, count: sets.reduce((a, b) => a + b.length, 0) };
}

// 崖壁：沿路一侧的一整面岩壁（行 × 列网格，向外起伏、上部后仰），在 s0..s1 两端收成 0 高。
// hOf(s) = 这里的崖高；cap(x, z, y) = 高度上限（登顶环绕镜头附近压低）
export function cliff(ctx, { side, s0, s1, lat, hOf, seed, cap }) {
  const { route, kit } = ctx, cols = Math.ceil((s1 - s0) * 4), rows = 16;
  const pos = [], col = [], idx = [], c = new THREE.Color(), base = new THREE.Color('#8f887b'), dark = new THREE.Color('#5d574e'), warm = new THREE.Color('#b3a48c');
  for (let i = 0; i <= cols; i++) {
    const s = s0 + (s1 - s0) * i / cols, a = route.at(s), y0 = route.heightAt(s);
    const e = Math.min(1, (s - s0) / 2.5, (s1 - s) / 2.5), H = hOf(s) * e * e * (3 - 2 * e);
    for (let r = 0; r <= rows; r++) {
      const v = r / rows, yy = y0 - 1.2 + v * (H + 1.2);
      const n = kit.fbm(s * 0.45 + seed, yy * 0.35 - seed, 4), n2 = kit.noise2(s * 1.7, yy * 1.3 + seed);
      const out = (typeof lat === 'function' ? lat(s) : lat) + v * v * 1.6 + n * 1.3 + (n2 - 0.5) * 0.25;         // 离路距离：只往外起伏，不往路上凸
      const px = a.pos.x + a.left.x * side * out, pz = a.pos.z + a.left.z * side * out;
      pos.push(px, cap ? Math.min(yy, cap(px, pz, yy)) : yy, pz);
      const band = 0.5 + 0.5 * Math.sin(yy * 2.3 + n * 5);                 // 层理
      c.copy(dark).lerp(base, 0.35 + 0.65 * n).lerp(warm, 0.25 * band * v);
      col.push(c.r, c.g, c.b);
      if (i < cols && r < rows) { const k = i * (rows + 1) + r, k2 = k + rows + 1; idx.push(k, k2, k + 1, k + 1, k2, k2 + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 刻字石面：一块浅色石板半嵌在崖里，面朝下山方向偏向路（从镜头看不是贴着墙的斜角），上面红字
// face = 石面朝向的水平向量
export function carving(ctx, text, at, face, { w = 1.3, h = 3.0, d = 0.9, charH, color = '#b8261c', slab = '#c2b49c' } = {}) {
  const ry = Math.atan2(face.x, face.z);
  const slabPart = { geo: new THREE.BoxGeometry(w, h, d), p: at.clone().addScaledVector(face, 0.03 - d / 2).toArray(), ry, color: slab };
  const txt = { text, p: at.clone().addScaledVector(face, 0.04), ry, h: charH || h * 0.86, color, vertical: [...text].length > 1 && h > w, weight: 900, pad: 0.12, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' };
  return { slabPart, txt };
}
