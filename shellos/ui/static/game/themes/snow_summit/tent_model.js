// 登山帐篷（instanced，instanceColor 给篷布颜色）：两根交叉帐杆撑起来的圆顶，杆与杆之间的篷布往里绷（张力褶皱，杆套一道深色）、
//   前厅 + 半掀开卷到一边的门帘（门洞里黑）、四根风绳 + 地钉。门洞 / 篷布带 aGlow：天一暗（风雪）里面亮起暖黄灯，整顶帐篷透出光。
//   约 420 三角形 / 顶（?fx=low：圆顶更粗、不要风绳）。glowMaterial 也给大本营那块静态几何用（大穹顶、餐厅帐的门窗）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

const Yv = new THREE.Vector3(0, 1, 0);
function prep(g, glow, color) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (color) { const c = new THREE.Color(color), a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}
const stick = (a, b, r, color, glow = 0) => { const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 4); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Yv, d.clone().normalize())).translate(...a.clone().lerp(b, 0.5).toArray()); return prep(g, glow, color); };

export function tentGeo(LOW = false) {
  const G = [];
  // 圆顶：杆在 ±45° / ±135° 两条对角线上；杆之间（0° / 90° / 180° / 270°）的篷布往里绷，半高处最深；杆套深一道
  {
    const g = new THREE.SphereGeometry(1, LOW ? 12 : 20, LOW ? 5 : 7, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(), p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), az = Math.atan2(z, x), el = Math.asin(Math.min(1, y));
      const between = Math.abs(Math.cos(2 * az)), sag = 0.085 * Math.pow(between, 1.5) * Math.sin(2 * el), k = 1 - sag;
      p.setXYZ(i, x * k, y * (1 - sag * 0.4), z * k);
      const sleeve = Math.abs(Math.sin(2 * az)) > 0.985 && y < 0.97 ? 0.72 : 1;       // 杆套
      const v = (0.94 + 0.08 * (1 - between)) * sleeve * (0.88 + 0.12 * y);              // 绷紧的地方亮、兜着的地方暗、底下暗一点
      col.push(v, v, v);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    G.push(prep(g.scale(0.95, 0.62, 0.72), 0.22));
  }
  // 前厅（半个小圆顶）+ 门洞（黑、亮灯时最亮）+ 半掀开的门帘（往一边翻开、卷起来一截）
  G.push(prep(new THREE.SphereGeometry(1, 8, 4, -Math.PI / 2, Math.PI, 0, Math.PI / 2).scale(0.45, 0.42, 0.52).translate(0.72, 0, 0), 0.22, '#d9d9d9'));
  G.push(prep(new THREE.CircleGeometry(0.2, 3).rotateY(Math.PI / 2).translate(1.13, 0.16, 0), 1, '#2a2622'));
  {
    const f = new THREE.BufferGeometry(); f.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.34, 0, 0, 0, 0, 0, 0, 0.26], 3));
    G.push(prep(f.rotateY(-1.15).translate(1.15, 0.02, 0.14), 0.22, '#e6e6e6'));
    G.push(stick(new THREE.Vector3(1.12, 0.3, 0.16), new THREE.Vector3(1.06, 0.04, 0.34), 0.03, '#cfcfcf'));   // 卷起来的那一截
  }
  // 风绳 + 地钉：从杆套半高处拉到四角地上
  if (!LOW) for (const az of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) {
    const a = new THREE.Vector3(Math.cos(az) * 0.66, 0.42, Math.sin(az) * 0.5), b = new THREE.Vector3(Math.cos(az) * 1.55, 0.02, Math.sin(az) * 1.25);
    G.push(stick(a, b, 0.008, '#f4f4f4'));
    G.push(stick(b.clone().setY(-0.02), b.clone().setY(0.1), 0.018, '#3a3a3a'));
  }
  return mergeGeometries(G);
}

// 带「里面亮灯」的材质：在 revealable（走过就溶）的基础上，aGlow × uGlow 往自发光里加暖黄（不受篷布颜色影响）
export function glowMaterial(revealable, rev, uGlow) {
  const m = revealable(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), rev), base = m.onBeforeCompile;
  m.onBeforeCompile = sh => {
    base(sh);
    sh.uniforms.uGlow = uGlow;
    sh.vertexShader = 'attribute float aGlow; varying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;');
    sh.fragmentShader = 'uniform float uGlow; varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vGlow * uGlow * vec3(1.0, 0.62, 0.3);');
  };
  m.customProgramCacheKey = () => 'snowRevGlow';
  return m;
}
// 静态几何（util.merged 出来的）补 aGlow：颜色正好是门洞色的顶点 = 1，其余 = base
export function addGlow(geo, doorHex, base = 0) {
  const c = new THREE.Color(doorHex), col = geo.attributes.color, n = col.count, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.abs(col.getX(i) - c.r) + Math.abs(col.getY(i) - c.g) + Math.abs(col.getZ(i) - c.b) < 0.01 ? 1 : base;
  geo.setAttribute('aGlow', new THREE.BufferAttribute(a, 1));
  return geo;
}
