// 华山花岗岩：绝壁（沿路一侧的一整面岩，竖向节理 = 一条条竖棱 + 水痕黑条）、巨石、摩崖刻字。
import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const GRANITE = { base: '#c2b9ac', light: '#ddd6cb', dark: '#8b847a', stain: '#5e5a54', lichen: '#6f7560' };
const CB = new THREE.Color(GRANITE.base), CL = new THREE.Color(GRANITE.light), CD = new THREE.Color(GRANITE.dark), CS = new THREE.Color(GRANITE.stain), CG = new THREE.Color(GRANITE.lichen);

// 花岗岩配色：lit 受光 0..1、stain 水痕（竖条）、x/y/z 世界坐标取噪声
export function graniteColor(kit, out, x, y, z, lit = 0.5) {
  const n = kit.fbm(x * 0.4 + z * 0.4, y * 0.25, 3), streak = kit.noise2((x + z) * 2.2, y * 0.08);   // 水痕：横向细、竖向拉长
  out.copy(CB).lerp(CD, smooth(0.55, 0.8, n) * 0.6).lerp(CL, Math.max(0, Math.min(1, lit)) * 0.6);
  out.lerp(CS, smooth(0.62, 0.8, streak) * 0.55).lerp(CG, smooth(0.7, 0.85, kit.noise2(x * 0.9, y * 0.9 + z)) * 0.35);
  return out.multiplyScalar(0.9 + 0.18 * kit.noise2(x * 3.1 + z * 2.7, y * 3.3));
}

// 绝壁：side 1 = 路左 / -1 = 路右；lat(s) 崖脚离路中心；top(s) 崖顶相对路面；base 崖底相对路面（负 = 往下扎进深谷）；
//   lean(s) 顶部向路前倾；ribs = 竖向节理宽度。s0..s1 两端 1.5 步内收成 0 高（不露切口）。返回 BufferGeometry（顶点色）
export function cliffWall(ctx, { side, s0, s1, lat, top, base = -1.5, lean = 0, seed = 1, rows = 30, ribs = 1.1, taper = 1.5 }) {
  const { route, kit } = ctx, fn = v => typeof v === 'function' ? v : () => v, L = fn(lat), T = fn(top), B = fn(base), LN = fn(lean);
  const cols = Math.max(2, Math.ceil((s1 - s0) * 4)), pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= cols; i++) {
    const s = s0 + (s1 - s0) * i / cols, a = route.at(s), y0 = route.heightAt(s), e = Math.min(1, (s - s0) / taper, (s1 - s) / taper);
    const ee = e * e * (3 - 2 * e), yt = B(s) + (T(s) - B(s)) * ee, yb = B(s), wx = s * 0.5;
    const rf = wx / ribs + 0.4 * kit.noise2(wx * 0.3, seed), rib = Math.floor(rf), rh = kit.hash2(rib + seed * 13, seed * 7);   // 竖向节理：一条条竖棱各自进退
    const groove = 1 - Math.min(1, Math.abs(rf - rib - 0.5) * 2.4);            // 棱与棱之间的竖缝（暗）
    for (let r = 0; r <= rows; r++) {
      const v = r / rows, yy = y0 + yb + v * (yt - yb), n = kit.fbm(wx * 0.45 + seed, yy * 0.3 - seed, 4);
      const out = L(s) + 0.5 * rh + 0.45 * (n - 0.5) + 0.15 * kit.noise2(wx * 2.4, yy * 0.6) - LN(s) * smooth(0.4, 1, v) + 0.12 * (1 - ee) + 0.12 * (1 - groove);
      const px = a.pos.x + a.left.x * side * out, pz = a.pos.z + a.left.z * side * out;
      pos.push(px, yy, pz);
      graniteColor(kit, c, px, yy, pz, 0.35 + 0.5 * rh + 0.3 * (n - 0.5)).multiplyScalar(0.72 + 0.28 * Math.pow(groove, 0.3));
      col.push(c.r, c.g, c.b);
      if (i < cols && r < rows) { const k = i * (rows + 1) + r, k2 = k + rows + 1; idx.push(k, k2, k + 1, k + 1, k2, k2 + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 巨石：抖过的多面体，花岗岩色（顶点色，平直着色）
export function boulderGeo(kit, seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed(), p = g.attributes.position, col = [], c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.85 + 0.3 * kit.fbm(x * 1.3 + seed, y * 1.3 + z * 0.7, 3);
    p.setXYZ(i, x * k, Math.max(-0.6, y * k * 0.85), z * k);
  }
  g.computeVertexNormals();
  for (let i = 0; i < p.count; i += 3) {
    graniteColor(kit, c, p.getX(i) * 3, p.getY(i) * 3, p.getZ(i) * 3, 0.4 + 0.4 * g.attributes.normal.getY(i));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// 摩崖刻字（红字）：给 kit.signs2 的一项。at = 字中心，face = 字面朝向（水平向量）
export function carving(text, at, face, { h = 1.2, vertical = true, color = '#b7261d', bg = null } = {}) {
  return { text, p: at.clone().addScaledVector(face, 0.05), ry: Math.atan2(face.x, face.z), h, color, bg, vertical, weight: 900, pad: 0.1, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' };
}
