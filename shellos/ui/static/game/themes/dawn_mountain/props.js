// 路边的东西：石栏杆 + 铁链（挂红布条、同心锁）、迎风松、灌丛 / 草簇 / 碎石、花岗岩崖壁、摩崖石刻、碑。
// 全部 instanced / merged：每类 1 次绘制。
import * as THREE from 'three';
import { ROAD_W } from '../../path.js';

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
export const RAIL_LAT = ROAD_W / 2 + 0.35;  // 1.45：路面 ±1.4 以内不放东西
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 石栏杆：每 2 步一根望柱，柱顶一条石扶手，柱间铁链下垂 + 红布条 / 同心锁。
// 右侧（影子那边）布条少、链子压低：影子半透明，身后别挂一串红条
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
    const cy = side > 0 ? 0.5 : 0.42, pRib = side > 0 ? 0.6 : 0.2;
    for (let s = s0; s <= s1 + 1e-6; s += 2) {
      const a = route.at(s, side * RAIL_LAT), p = a.pos.clone();
      posts.push({ p, ry: -a.heading });
      if (prev) {
        seg(prev.clone().setY(prev.y + 0.74), p.clone().setY(p.y + 0.74), rails);
        const N = 8, c0 = prev.clone().setY(prev.y + cy), c1 = p.clone().setY(p.y + cy);   // 链：抛物线下垂
        const pt = k => c0.clone().lerp(c1, k / N).addScaledVector(Y, -0.18 * 4 * (k / N) * (1 - k / N));
        for (let k = 0; k < N; k++) seg(pt(k), pt(k + 1), links);
        for (const f of [0.3, 0.5, 0.7]) if (R() < pRib) { const lo = pt(Math.round(f * N)); ribbons.push({ p: lo.clone(), ry: -a.heading + (R() - 0.5) * 0.6, s: [1, 0.7 + R() * 0.4, 1], color: R() < 0.8 ? '#b8281f' : '#d9a531' }); }
        if (R() < 0.6) locks.push({ p: pt(2 + (R() * 5 | 0)).addScaledVector(Y, -0.05), ry: -a.heading, color: R() < 0.7 ? '#c39322' : '#a8342a' });
      }
      prev = p;
    }
  }
  const postGeo = util.merged([
    { geo: new THREE.BoxGeometry(0.15, 1.7, 0.15), p: [0, -0.05, 0], color: '#bdb4a3' },
    { geo: new THREE.BoxGeometry(0.2, 0.07, 0.2), p: [0, 0.83, 0], color: '#cbc2b1' },
    { geo: new THREE.ConeGeometry(0.13, 0.16, 4).rotateY(Math.PI / 4), p: [0, 0.94, 0], color: '#cbc2b1' },
  ]);
  const out = [
    util.instanced(postGeo, mats.vc, posts),                                                             // 柱中心在踏面：地下 0.9、地上 0.9
    util.instanced(new THREE.BoxGeometry(1, 0.08, 0.11), mats.stoneRail, rails),
    util.instanced(new THREE.CylinderGeometry(0.02, 0.02, 1, 5).rotateZ(Math.PI / 2), mats.iron, links),
    util.instanced(new THREE.PlaneGeometry(0.09, 0.36).translate(0, -0.18, 0), mats.cloth, ribbons),
    util.instanced(new THREE.BoxGeometry(0.07, 0.09, 0.03), mats.lambert, locks),
  ];
  out.forEach(m => { m.name = 'rail'; });
  return out;
}

// 针叶团：粗糙的扁球（二十面体细分 1 + 顶点抖动），顶点色 = 底暗、顶面暖色受光（#4f6a3a → #8a8a4a）
function needleGeo(R) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, col = [], c = new THREE.Color();
  const lo = new THREE.Color('#26361f'), mid = new THREE.Color('#4f6a3a'), hi = new THREE.Color('#8a8a4a');
  const seed = R() * 100, hsh = (x, y, z) => { const s = Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + seed) * 43758.5; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {        // 非索引几何：按位置哈希抖动，重合顶点抖得一样，不裂缝
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.88 + 0.24 * hsh(x, y, z);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  const ng = g; ng.computeVertexNormals();
  const n = ng.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const ny = Math.max(-1, Math.min(1, n.getY(i) * 0.6 + p.getY(i) * 0.4));          // 平直着色 + 高度：团顶亮、团底暗
    if (ny < 0) c.copy(lo).lerp(mid, 1 + ny); else c.copy(mid).lerp(hi, Math.pow(ny, 1.5));
    col.push(c.r, c.g, c.b);
  }
  ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return ng;
}

// 松树：S 形斜干 + 几层针叶团，全部朝 +x（风向）伸展 = 迎客松那种「迎风斜枝」。返回合成几何
function pineGeo(util, R, big) {
  const P = [], trunk = '#4b3a2b', S = 1.3;
  let x = 0, y = 0, lean = 0;
  const H = (big ? 3.4 : 2.4) * S, n = 4;
  const pts = [];
  for (let k = 0; k < n; k++) {
    lean += (k === 0 ? 0.25 : 0.12) + R() * 0.12;
    const len = H / n, r0 = (0.14 * (1 - k / n) + 0.04) * S, r1 = (0.14 * (1 - (k + 1) / n) + 0.035) * S;
    P.push({ geo: new THREE.CylinderGeometry(r1, r0, len, 6).translate(0, len / 2, 0), p: [x, y, 0], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean), color: trunk });
    x += Math.sin(lean) * len; y += Math.cos(lean) * len; pts.push([x, y]);
  }
  const layers = big ? 5 : 4;
  for (let j = 0; j < layers; j++) {
    const f = 0.3 + 0.7 * j / (layers - 1), k = Math.min(n - 1, Math.floor(f * n)), [tx, ty] = pts[k];
    const reach = ((1 - f) * (big ? 1.5 : 1.0) + 0.35) * S, bx = tx + reach * (0.5 + R() * 0.5), bz = (R() - 0.5) * 1.1 * (1 - f * 0.6) * S;
    const w = (big ? 1.35 : 1.0) * (1.15 - f * 0.45) * S;
    const a = new THREE.Vector3(tx - 0.1, ty - 0.2, 0), b = new THREE.Vector3(bx, ty - 0.05, bz), d = b.clone().sub(a);
    P.push({ geo: new THREE.CylinderGeometry(0.035, 0.06, d.length(), 5).translate(0, d.length() / 2, 0), p: a.toArray(), q: new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), color: trunk });
    for (let q = 0; q < 3; q++) {                       // 一层 = 三团错落的针叶（不是一整张饼）
      const a2 = q / 3 * Math.PI * 2 + R() * 1.5, rr = w * 0.42 * (q ? 1 : 0.25), cw = w * (q ? 0.55 : 0.68) * (0.8 + R() * 0.35);
      P.push({ geo: needleGeo(R), p: [bx + Math.cos(a2) * rr, ty + (R() - 0.3) * 0.3, bz + Math.sin(a2) * rr * 0.8], s: [cw, cw * (0.28 + R() * 0.12), cw * 0.8] });
    }
  }
  return util.merged(P);
}

// 松树撒在地上。hAt(x, z) = 地面高；keep(x, z, lat, s) → 是否允许放；hero = 指定位置的名松
export function forest(ctx, hAt, windRy, keep, mats, hero = [], count = 95) {
  const { route, util } = ctx, R = ctx.rand;
  const geos = [pineGeo(util, R, true), pineGeo(util, R, false), pineGeo(util, R, false)];
  const sets = [[], [], []];
  const N = route.N, span = [-14, N + 18];
  for (let tries = 0; tries < 900 && sets[0].length + sets[1].length + sets[2].length < count; tries++) {
    const s = span[0] + R() * (span[1] - span[0]), side = R() < 0.5 ? 1 : -1;
    const lat = side * ((side > 0 ? 7.5 : 4) + Math.pow(R(), 1.8) * 30);
    const a = route.at(s, lat);
    if (!keep(a.pos.x, a.pos.z, lat, s)) continue;
    const y = hAt(a.pos.x, a.pos.z);
    const k = R() < 0.3 ? 0 : 1 + (R() * 2 | 0), sc = 0.8 + R() * 0.5 + (Math.abs(lat) > 12 ? 0.4 : 0);
    sets[k].push({ p: [a.pos.x, y - 0.1, a.pos.z], ry: windRy + (R() - 0.5) * 0.7, s: sc });
  }
  for (const h of hero) {
    const a = route.at(h.s, h.lat), y = h.y ?? hAt(a.pos.x, a.pos.z);
    sets[0].push({ p: [a.pos.x, y - 0.1, a.pos.z], ry: windRy + (h.ry || 0), s: h.sc || 1 });
  }
  const out = geos.map((g, k) => util.instanced(g, mats.vc, sets[k]));
  out.forEach(m => { m.name = 'forest'; });
  return { meshes: out, count: sets.reduce((a, b) => a + b.length, 0) };
}

// 地面零碎：灌丛、草簇、碎石，沿栏杆外 1–4 单位撒。spots = [{ x, z, y, lat, s }]，调用方已过滤
export function scatter(ctx, spots, mats) {
  const { util } = ctx, R = ctx.rand;
  const shrubs = [], tufts = [], rocks = [];
  const sh = ['#3e4d2a', '#4f5d30', '#5b6636', '#6b6a38'], gr = ['#75753f', '#8a7c52', '#6d7a3c', '#9a8a5a'];
  for (const p of spots) {
    const r = R(), ry = R() * 6.28;
    if (r < 0.3) { const sz = 0.14 + R() * 0.2; shrubs.push({ p: [p.x, p.y + sz * 0.3, p.z], ry, s: [sz * (1 + R() * 0.6), sz * (0.6 + R() * 0.3), sz], color: sh[R() * 4 | 0] }); }
    else if (r < 0.72) { const sz = 0.16 + R() * 0.18; tufts.push({ p: [p.x, p.y, p.z], ry, s: [sz, sz * (1 + R()), sz], color: gr[R() * 4 | 0] }); }
    else { const sz = 0.08 + R() * R() * 0.32; rocks.push({ p: [p.x, p.y + sz * 0.2, p.z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), s: [sz * (1 + R() * 0.8), sz * (0.5 + R() * 0.4), sz], color: new THREE.Color('#8a857a').multiplyScalar(0.8 + R() * 0.35) }); }
  }
  // 草簇：三片交叉的细叶（锥）
  const tuft = util.merged([0, 1, 2].map(k => ({ geo: new THREE.ConeGeometry(0.12, 1, 3).translate(0, 0.5, 0), p: [Math.cos(k * 2.1) * 0.08, 0, Math.sin(k * 2.1) * 0.08], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(k * 2.1) * 0.35, 0, Math.cos(k * 2.1) * 0.35)) })));
  const out = [
    util.instanced(new THREE.IcosahedronGeometry(1, 0), mats.lambert, shrubs),
    util.instanced(tuft, mats.lambert, tufts),
    util.instanced(new THREE.IcosahedronGeometry(1, 0), mats.rock, rocks),
  ];
  out.forEach(m => { m.name = 'scatter'; });
  return out;
}

// 花岗岩配色（崖壁、陡坡共用）：基色 / 层理暗带 / 受光面，外加竖向裂隙
export const GRANITE = { base: '#7f7a70', dark: '#5c574f', lit: '#a8a092', crack: '#3f3b35' };
export function graniteColor(kit, out, x, y, z, lit, crack = 0, bandK = 0.7) {
  const n = kit.fbm(x * 0.35 + z * 0.35, y * 0.6, 3), band = smooth(0.55, 0.85, 0.5 + 0.5 * Math.sin(y * 1.9 + n * 4));
  out.set(GRANITE.base).lerp(C_DARK, band * bandK).lerp(C_LIT, Math.max(0, Math.min(1, lit)) * (0.55 + 0.45 * n));
  if (crack > 0) out.lerp(C_CRACK, crack);
  out.multiplyScalar(0.92 + 0.16 * kit.noise2(x * 1.7 + z * 1.3, y * 1.9));
  return out;
}
const C_DARK = new THREE.Color(GRANITE.dark), C_LIT = new THREE.Color(GRANITE.lit), C_CRACK = new THREE.Color(GRANITE.crack);

// 崖壁：沿路一侧的一整面岩壁（行 × 列网格），在 s0..s1 两端收成 0 高。参数都可以是数或 s 的函数：
// lat = 崖脚离路中心；hOf = 崖高；lean = 顶部向路前倾多少；rough = 起伏幅度（只往外推，不往路上凸）；cracks = 竖向裂隙所在的 s
export function cliff(ctx, { side, s0, s1, lat, hOf, seed, lean = 0, rough = 1.3, cracks = [], rows = 36 }) {
  const { route, kit } = ctx, cols = Math.ceil((s1 - s0) * 4), fn = v => typeof v === 'function' ? v : () => v;
  const L = fn(lat), Hf = fn(hOf), LN = fn(lean), RG = fn(rough);
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= cols; i++) {
    const s = s0 + (s1 - s0) * i / cols, a = route.at(s), y0 = route.heightAt(s);
    const e = Math.min(1, (s - s0) / 2, (s1 - s) / 2), H = Hf(s) * e * e * (3 - 2 * e), amp = RG(s), ln = LN(s);
    let ck = 0;
    for (const cs of cracks) ck = Math.max(ck, 1 - smooth(0.06, 0.2, Math.abs(s - cs + 0.15 * Math.sin(s * 3 + seed))));
    for (let r = 0; r <= rows; r++) {
      const v = r / rows, yy = y0 - 1.5 + v * (H + 1.5);
      const wx = s * 0.5, n = kit.fbm(wx * 0.32 + seed, yy * 0.26 - seed, 4), n2 = kit.noise2(wx * 1.1, yy * 1.1 + seed);
      const ckv = ck * smooth(0.02, 0.15, v) * (1 - smooth(0.85, 1, v));
      // 花岗岩块体：按 ~1.3 高 × ~1.7 宽错缝分块，每块整体进退一点 → 竖向节理 + 水平台坎，不是一匹布
      const by = Math.floor(yy / 1.3 + 0.35 * n), bx = Math.floor(wx / 1.7 + 0.5 * by + 0.3 * n), bh = kit.hash2(bx + seed * 17, by * 3.1);
      const ledge = smooth(0.7, 0.95, (yy / 1.3 + 0.35 * n) - by);
      const out = L(s) + n * amp * 0.6 + bh * 0.55 * Math.min(1, amp + 0.4) + n2 * 0.12 + 0.12 - ln * smooth(0.3, 1, v) + 0.3 * ckv;
      const px = a.pos.x + a.left.x * side * out, pz = a.pos.z + a.left.z * side * out;
      pos.push(px, yy, pz);
      graniteColor(kit, c, px, yy, pz, 0.15 + 0.8 * (n - 0.45) + 0.25 * v + 0.5 * (bh - 0.5), Math.max(ckv * 0.85, 0.5 * ledge));
      c.multiplyScalar(0.82 + 0.36 * bh);
      col.push(c.r, c.g, c.b);
      if (i < cols && r < rows) { const k = i * (rows + 1) + r, k2 = k + rows + 1; idx.push(k, k2, k + 1, k + 1, k2, k2 + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 刻字：slab = 石板颜色（碑）；不给 slab 就只刻在崖面上（文字板贴着崖面）
// face = 字面朝向的水平向量
export function carving(ctx, text, at, face, { w = 1.3, h = 3.0, d = 0.9, charH, color = '#b8261c', slab = null, vertical } = {}) {
  const ry = Math.atan2(face.x, face.z);
  const slabPart = slab ? { geo: new THREE.BoxGeometry(w, h, d), p: at.clone().addScaledVector(face, 0.03 - d / 2).toArray(), ry, color: slab } : null;
  const txt = { text, p: at.clone().addScaledVector(face, 0.04), ry, h: charH || h * 0.86, color, vertical: vertical ?? ([...text].length > 1 && h > w), weight: 900, pad: 0.12, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' };
  return { slabPart, txt };
}
