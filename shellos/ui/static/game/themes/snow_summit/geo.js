// 珠峰道具共用的几何小工具（直升机 / 牦牛 / 登山者）：放样曲面、按颜色涂顶点、两点之间一根管、平移后上色
import * as THREE from 'three';

const Yv = new THREE.Vector3(0, 1, 0);

// 放样：st = [[x, 半宽, 半高, 中心 y], …]（机头 → 机尾），超椭圆截面（p 越大越方），colorOf(i, j) 给每一块面的颜色（按格子分色，边界是直的）
export function loft(st, M, p, colorOf, cap = true) {
  const pos = [], col = [], c = new THREE.Color();
  const pt = (i, j) => { const [x, hw, hh, cy] = st[i], th = j / M * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
    return [x, cy + hh * Math.sign(sn) * Math.abs(sn) ** (2 / p), hw * Math.sign(cs) * Math.abs(cs) ** (2 / p)]; };
  const tri = (a, b, d, color) => { pos.push(...a, ...b, ...d); c.set(color); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); };
  for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = pt(i, j), b = pt(i, j + 1), d = pt(i + 1, j), e = pt(i + 1, j + 1), k = colorOf(i, j);
    tri(a, b, d, k); tri(b, e, d, k);
  }
  if (cap) { const [x, , , cy] = st[0], tip = [x + 0.06, cy, 0]; for (let j = 0; j < M; j++) tri(tip, pt(0, j + 1), pt(0, j), colorOf(0, j)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.computeVertexNormals();
  return g;
}
export const colored = (geo, color) => { geo = geo.index ? geo.toNonIndexed() : geo; const n = geo.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
export function tube(a, b, r, color, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Yv, d.clone().normalize())).translate(...a.clone().lerp(b, 0.5).toArray());
  return colored(g, color);
}
export const at = (g, x, y, z, color) => colored(g.translate(x, y, z), color);

