// 路边的东西：木护栏（柱 + 两道横杆）、观景台（木平台 + 栏杆 + 投币望远镜 + 长凳）、刻字石（红字）、木指示牌。
// 护栏 2 次绘制；观景台 + 石头 + 牌子合成 1 个几何 1 次绘制；所有字 1 张图集 1 次绘制。
import * as THREE from 'three';
import { ROAD_W } from '../../path.js';

const X = new THREE.Vector3(1, 0, 0);
// 刻字石：二十面体细分 1 次 + 按位置哈希起伏，保持分面（花岗岩块）
function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5, k = 0.85 + 0.25 * (h - Math.floor(h));
    p.setXYZ(i, x * k, Math.max(y * k, -0.6), z * k);
  }
  g.deleteAttribute('uv'); g.computeVertexNormals();
  return g;
}
const RAIL_LAT = ROAD_W / 2 + 0.3;           // 1.4：护栏在路沿外

export function buildProps(scene, ctx, B) {
  const { route, util } = ctx, { hAt } = B;
  const vc = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#1d1a14' });   // 太阳在前方，朝镜头的面背光：提一点
  const parts = [], texts = [];

  // —— 木护栏：ranges = [s0, s1, side]；每半步一根柱（台阶每级一根，柱立在踏面中心），柱顶两道横杆
  const posts = [], rails = [], v = new THREE.Vector3();
  const seg = (a, b, out, th) => { v.subVectors(b, a); const len = v.length(); out.push({ p: a.clone().lerp(b, 0.5), q: new THREE.Quaternion().setFromUnitVectors(X, v.normalize()), s: [len + 0.04, th, th] }); };
  for (const [s0, s1, side] of B.rails) {
    let prev = null;
    for (let s = s0; s <= s1 + 1e-6; s += 1) {
      const a = route.at(s + 0.5, side * RAIL_LAT), p = a.pos.clone();
      posts.push({ p: [p.x, p.y + 0.42, p.z], ry: -a.heading, color: '#6b4a2e' });
      if (prev) { seg(prev.clone().setY(prev.y + 0.95), p.clone().setY(p.y + 0.95), rails, 1); seg(prev.clone().setY(prev.y + 0.55), p.clone().setY(p.y + 0.55), rails, 0.75); }
      prev = p;
    }
  }
  const wood = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const pm = util.instanced(new THREE.BoxGeometry(0.11, 1.05, 0.11), wood, posts); pm.name = 'railPosts';
  const rm = util.instanced(new THREE.BoxGeometry(1, 0.07, 0.07), new THREE.MeshLambertMaterial({ color: '#8a6440' }), rails); rm.name = 'rails';
  scene.add(pm, rm);

  // —— 观景台：在「观景台」平地段右侧，木板平台伸出山坡（立柱下到地面），外三边栏杆，一台投币望远镜朝城市
  const D = B.deck, a0 = route.at(D.s), yTop = a0.pos.y - 0.03;
  const L = D.len, W = D.w, hd = -a0.heading;
  const frame = new THREE.Matrix4().compose(a0.pos.clone().setY(yTop), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd), new THREE.Vector3(1, 1, 1));
  const local = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frame);     // x 前、z 右、y 上（平台面 = 0）
  const dp = (geo, x, y, z, color, ry = 0) => { const p = local(x, y, z); parts.push({ geo, p: p.toArray(), ry: hd + ry, color }); };
  const z0 = ROAD_W / 2 + 0.05, z1 = z0 + W;
  for (let k = 0, n = Math.round(W / 0.26); k < n; k++) {         // 木板（横着铺，一条一条）
    const z = z0 + (k + 0.5) * W / n;
    dp(new THREE.BoxGeometry(L, 0.08, W / n - 0.03), 0, -0.04, z, k % 3 === 0 ? '#9c7048' : k % 3 === 1 ? '#a87a50' : '#936943');
  }
  dp(new THREE.BoxGeometry(L + 0.1, 0.18, 0.12), 0, -0.12, z1, '#6b4a2e');                         // 外沿梁
  for (const x of [-L / 2 + 0.1, 0, L / 2 - 0.1]) for (const z of [z0 + 0.4, z1 - 0.05]) {          // 立柱到地
    const p = local(x, 0, z), g = hAt(p.x, p.z), h = Math.max(0.3, yTop - g + 0.3);
    dp(new THREE.BoxGeometry(0.16, h, 0.16), x, -h / 2, z, '#5c4028');
  }
  // 栏杆：外边 + 前后两边（靠路那边敞开）
  const railRun = (xa, za, xb, zb) => {
    const len = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(len / 0.7)), ry = -Math.atan2(zb - za, xb - xa);
    for (let k = 0; k <= n; k++) dp(new THREE.BoxGeometry(0.1, 1.05, 0.1), xa + (xb - xa) * k / n, 0.52, za + (zb - za) * k / n, '#6b4a2e');
    for (const [y, t] of [[1.02, 0.09], [0.6, 0.06]]) dp(new THREE.BoxGeometry(len + 0.08, t, t), (xa + xb) / 2, y, (za + zb) / 2, '#8a6440', ry);
  };
  railRun(-L / 2, z1, L / 2, z1);
  railRun(-L / 2, z0 + 0.5, -L / 2, z1);
  railRun(L / 2, z0 + 0.5, L / 2, z1);
  // 投币望远镜：立柱 + 头（双筒），朝前右（城市方向）
  const tx = D.tele[0], tz = z0 + D.tele[1], tr = D.tele[2];
  dp(new THREE.CylinderGeometry(0.07, 0.11, 1.05, 8), tx, 0.52, tz, '#3d4a52');
  dp(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), tx, 0.03, tz, '#3d4a52');
  const head = (geo, lx, ly, lz, color) => {                          // 头的局部坐标：+x = 镜筒朝向
    const c = Math.cos(tr), s = Math.sin(tr);
    dp(geo, tx + lx * c - lz * s, 1.1 + ly, tz + lx * s + lz * c, color, -tr);
  };
  head(new THREE.BoxGeometry(0.34, 0.26, 0.36), 0, 0, 0, '#2f7d6a');
  for (const lz of [-0.09, 0.09]) head(new THREE.CylinderGeometry(0.07, 0.08, 0.34, 10).rotateZ(Math.PI / 2), 0.28, 0.05, lz, '#1f2a30');
  head(new THREE.BoxGeometry(0.06, 0.1, 0.3), -0.2, 0.06, 0, '#1f2a30');
  // 长凳（平台后侧，背朝路）
  dp(new THREE.BoxGeometry(1.1, 0.06, 0.38), -L / 2 + 0.9, 0.45, z0 + 1.3, '#a87a50');
  for (const x of [-0.45, 0.45]) dp(new THREE.BoxGeometry(0.07, 0.45, 0.34), -L / 2 + 0.9 + x, 0.22, z0 + 1.3, '#5c4028');

  // —— 刻字石（红字）/ 木牌：石头 = 压扁的多面体，字贴在朝镜头那面
  const face = (s, k) => { const a = route.at(s); return a.left.clone().multiplyScalar(-k).addScaledVector(a.dir, -(1 - k)).normalize(); };   // 朝下山方向、偏向路
  for (const S of B.stones) {
    const a = route.at(S.s, S.lat), g = S.deck ? route.heightAt(S.s) - 0.03 : Math.min(hAt(a.pos.x, a.pos.z), route.heightAt(S.s)), f = face(S.s, S.k);
    const ry = Math.atan2(f.x, f.z);
    const base = a.pos.clone().setY(g);
    if (S.board) {                                                    // 木牌：两根柱 + 板
      for (const sx of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(0.1, S.h + 0.6, 0.1), p: base.clone().add(new THREE.Vector3(Math.cos(ry) * sx * S.w * 0.42, (S.h + 0.6) / 2, -Math.sin(ry) * sx * S.w * 0.42)).toArray(), ry, color: '#5c4028' });
      parts.push({ geo: new THREE.BoxGeometry(S.w, S.h, 0.08), p: base.clone().setY(g + 0.6 + S.h / 2).toArray(), ry, color: '#6e4b2c' });
      texts.push({ text: S.text, p: base.clone().setY(g + 0.6 + S.h / 2).addScaledVector(f, 0.05).toArray(), ry, h: S.charH, color: '#fff3d6', weight: 800, vertical: S.vertical });
    } else {                                                          // 石：12 面体压扁，前面切平
      parts.push({ geo: rockGeo(), p: base.clone().setY(g + S.h * 0.4).toArray(), ry, s: [S.w * 0.56, S.h * 0.62, S.d * 0.55], color: S.col || '#b9b2a4' });
      parts.push({ geo: new THREE.BoxGeometry(S.w * 0.84, S.h * 0.72, 0.05), p: base.clone().setY(g + S.h * 0.5).addScaledVector(f, S.d * 0.6).toArray(), ry, color: S.col || '#c7c0b0' });   // 磨平的正面
      texts.push({ text: S.text, p: base.clone().setY(g + S.h * 0.5).addScaledVector(f, S.d * 0.6 + 0.04).toArray(), ry, h: S.charH, color: '#c8261e', weight: 900, vertical: S.vertical });
    }
  }
  const pmesh = new THREE.Mesh(util.merged(parts), vc); pmesh.name = 'deckAndStones'; scene.add(pmesh);
  const signs = util.textSigns(texts, { size: 128 }); signs.renderOrder = 1; scene.add(signs);
}
