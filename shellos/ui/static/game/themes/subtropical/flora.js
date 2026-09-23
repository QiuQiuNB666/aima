// 亚热带山林：阔叶树（圆团树冠，4 种）、榕树（粗干 + 板根 + 平展大冠 + 一排排垂下的气根）、蕨（羽状叶，alphaTest）、灌丛、山脊芒草。
// 每种一个 InstancedMesh（几何 = util.merged 合成的模板，顶点色 × 实例色）。
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// 凹凸的叶团：二十面体细分 1 次，顶点按位置哈希起伏，平滑法线
function blob(seed) {
  let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.84 + 0.3 * hash3(x + seed, y, z); p.setXYZ(i, x * k, y * k, z * k); }
  g.computeVertexNormals();
  return g;
}
// a→b 的圆柱段（r0 在 a 端）
function limb(a, b, r0, r1, color, rs = 6) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  return { geo: new THREE.CylinderGeometry(r1, r0, len, rs, 1, true).translate(0, len / 2, 0), p: a.toArray(), q: new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), color };
}
// 合成后按高度压暗下部（假 AO）+ 一点点噪声
function finish(util, parts, lo, hi) {
  const g = util.merged(parts), p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = (0.62 + 0.45 * smooth(lo, hi, p.getY(i))) * (0.92 + 0.16 * hash3(p.getX(i), p.getY(i), p.getZ(i)));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

const LEAF = ['#2e5e2a', '#3a7030', '#4a8236', '#2a5230', '#56913c'];
function broadleaf(util, R, blobs, o) {
  const P = [], trunk = '#5a4a3a', h = o.h, lean = new THREE.Vector3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize();
  const top = lean.clone().multiplyScalar(h * 0.55);
  P.push(limb(new THREE.Vector3(0, -0.3, 0), top, o.r, o.r * 0.6, trunk));
  const cc = top.clone().setY(h * 0.68), rc = o.crown;
  for (let k = 0; k < 3; k++) { const a = k / 3 * 6.28 + R(); P.push(limb(top, cc.clone().add(new THREE.Vector3(Math.cos(a) * rc * 0.55, rc * 0.25, Math.sin(a) * rc * 0.55)), o.r * 0.55, o.r * 0.25, trunk, 5)); }
  for (let k = 0; k < o.n; k++) {
    const a = R() * 6.28, rr = Math.sqrt(R()) * rc * 0.72, y = (R() * 0.9 - 0.25) * rc * 0.7;
    const s = rc * (0.42 + R() * 0.3) * (1 - 0.25 * Math.abs(y) / rc);
    P.push({ geo: blobs[k % blobs.length], p: [cc.x + Math.cos(a) * rr, cc.y + y + (k === 0 ? rc * 0.35 : 0), cc.z + Math.sin(a) * rr], s: [s, s * 0.8, s], color: LEAF[(o.tone + k) % LEAF.length] });
  }
  return finish(util, P, cc.y - rc * 0.9, cc.y + rc * 0.8);
}

// 榕树：模板高约 7.5，冠幅半径约 5
function banyan(util, R, blobs) {
  const P = [], bark = '#6e6353', root = '#8b7f6b', v = (x, y, z) => new THREE.Vector3(x, y, z);
  const fork = v(0, 2.6, 0);
  for (let k = 0; k < 6; k++) {                                     // 主干 = 6 股绞在一起
    const a = k / 6 * 6.28, b = v(Math.cos(a) * 0.42, -0.2, Math.sin(a) * 0.42);
    P.push(limb(b, fork.clone().add(v(Math.cos(a + 0.8) * 0.18, 0, Math.sin(a + 0.8) * 0.18)), 0.34, 0.24, bark, 7));
  }
  for (let k = 0; k < 7; k++) {                                     // 板根
    const a = k / 7 * 6.28 + R() * 0.4;
    P.push(limb(v(Math.cos(a) * 0.3, 0.9, Math.sin(a) * 0.3), v(Math.cos(a) * (1.3 + R() * 0.5), -0.25, Math.sin(a) * (1.3 + R() * 0.5)), 0.2, 0.05, bark, 5));
  }
  const tips = [];
  for (let k = 0; k < 7; k++) {                                     // 平伸的大枝
    const a = k / 7 * 6.28 + R() * 0.5, L = 2.8 + R() * 1.5, e = v(Math.cos(a) * L, 3.6 + R() * 1.0, Math.sin(a) * L);
    const m = fork.clone().lerp(e, 0.5).add(v(0, 0.35, 0));
    P.push(limb(fork.clone().add(v(0, R() * 0.6, 0)), m, 0.24, 0.16, bark, 6), limb(m, e, 0.16, 0.07, bark, 5));
    tips.push(m, e);
  }
  for (let k = 0; k < 24; k++) {                                    // 平展树冠
    const a = R() * 6.28, rr = Math.sqrt(R()) * 4.3, y = 5.0 + (R() - 0.3) * 1.3 - rr * 0.12;
    const s = 1.25 + R() * 0.7;
    P.push({ geo: blobs[k % blobs.length], p: [Math.cos(a) * rr, y, Math.sin(a) * rr], s: [s, s * 0.62, s], color: ['#28502a', '#2f5e2c', '#3a6c32', '#24462a'][k % 4] });
  }
  for (let k = 0; k < 64; k++) {                                    // 气根：从枝和冠底垂下，一簇 2–3 根；少数落地变成支柱根
    const src = k % 3 === 0 ? tips[(R() * tips.length) | 0].clone() : (() => { const a = R() * 6.28, rr = 0.9 + R() * 3.5; return v(Math.cos(a) * rr, 3.9 + R() * 0.5 - rr * 0.1, Math.sin(a) * rr); })();
    const ground = R() < 0.18, len = ground ? src.y + 0.2 : 1.0 + R() * 2.4;
    const n = 1 + ((R() * 3) | 0);
    for (let j = 0; j < n; j++) {
      const a = src.clone().add(v((R() - 0.5) * 0.25, 0, (R() - 0.5) * 0.25)), b = a.clone().add(v((R() - 0.5) * 0.15, -len * (0.8 + 0.2 * R()), (R() - 0.5) * 0.15));
      P.push(limb(a, b, ground ? 0.07 : 0.03, ground ? 0.06 : 0.012, root, 4));
    }
  }
  return finish(util, P, 0, 5.5);
}

// 蕨：7 片拱形羽叶，贴图 alphaTest
function fernGeo() {
  const parts = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.PlaneGeometry(0.34, 1, 1, 6), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5, x = p.getX(i) * (1 - 0.55 * t);
      p.setXYZ(i, x, Math.sin(t * 2.3) * 0.5, t * 0.95);            // 叶轴拱起再下垂
    }
    g.rotateY(k / 7 * 6.28 + (k % 2) * 0.3); parts.push(g);
  }
  return parts;
}

export function buildFlora(scene, ctx, B) {
  const { route, util, kit } = ctx, R = ctx.rand, N = route.N, { hAt } = B;
  const blobs = [blob(1), blob(7), blob(13)];
  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const out = [];

  // 阔叶树：近处 4 种（叶团细分 1 次），远处 3 种（叶团 20 面，三角形 1/4）
  const lo = [0, 1, 2].map(k => { const g = new THREE.IcosahedronGeometry(1, 0); g.deleteAttribute('uv'); return g; });
  const T = [
    broadleaf(util, R, blobs, { h: 7.5, r: 0.2, crown: 2.6, n: 12, tone: 0 }),
    broadleaf(util, R, blobs, { h: 9, r: 0.24, crown: 2.9, n: 13, tone: 2 }),
    broadleaf(util, R, blobs, { h: 6, r: 0.17, crown: 2.2, n: 10, tone: 1 }),
    broadleaf(util, R, blobs, { h: 10.5, r: 0.26, crown: 2.4, n: 11, tone: 3 }),
    broadleaf(util, R, lo, { h: 8, r: 0.22, crown: 2.8, n: 11, tone: 1 }),
    broadleaf(util, R, lo, { h: 9.5, r: 0.24, crown: 3.1, n: 11, tone: 3 }),
    broadleaf(util, R, lo, { h: 6.5, r: 0.2, crown: 2.5, n: 9, tone: 0 }),
  ];
  const trees = T.map(() => []), tint = new THREE.Color(), ok = B.keep;
  // 抖动网格铺满山体：每 3.4 一格，噪声留林窗；贴路左那一排（lat < 7）只用小树，树冠外沿离路 ≥ 3.2，镜头不会扎进树冠
  for (let gx = -62; gx <= 62; gx += 3.4) for (let gz = -62; gz <= 62; gz += 3.4) {
    const x = B.c.x + gx + (R() - 0.5) * 2.6, z = B.c.z + gz + (R() - 0.5) * 2.6, nr = util.nearestRoute(route, x, z), lat = nr.side * nr.d;
    if (kit.noise2(x * 0.07 + 11, z * 0.07) < 0.28 || !ok(x, z, lat, nr.s, 'tree')) continue;
    const y = hAt(x, z); if (y < B.landY + 3) continue;
    const small = lat > 0 && lat < 7, near = nr.d < 24;
    const kind = small ? 2 : near ? (R() * 4) | 0 : 4 + ((R() * 3) | 0);
    tint.setHSL(0.27 + (R() - 0.5) * 0.06, 0.25 + R() * 0.2, 0.5 + R() * 0.12).multiplyScalar(1.6);
    trees[kind].push({ p: [x, y, z], ry: R() * 6.28, s: small ? 0.55 + R() * 0.15 : 0.8 + R() * 0.45, color: tint.clone() });
  }
  T.forEach((g, i) => { if (!trees[i].length) return; const m = util.instanced(g, vc, trees[i]); m.name = 'trees'; out.push(m); });

  // 榕树：指定位置（一眼认出）
  const bGeo = banyan(util, R, blobs), bItems = [];
  for (const [s, lat, sc, ry] of B.banyans) { const a = route.at(s, lat); bItems.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z), a.pos.z], ry, s: sc }); }
  const bm = util.instanced(bGeo, vc, bItems); bm.name = 'banyan'; out.push(bm);

  // 蕨 + 灌丛：路两边（路沿外 0.4 起）+ 林下
  const frond = util.canvasTexture(64, 256, (g, w, h) => {
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    g.fillStyle = '#ffffff';
    for (let y = 8; y < h - 4; y += 9) {
      const L = (w / 2 - 3) * Math.min(1, (h - y) / h * 1.6) * (0.55 + 0.45 * Math.sin(y / h * Math.PI));
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + sx * L * 0.5, y + 3, L * 0.5, 3.2, sx * 0.35, 0, 7); g.fill(); }
    }
  });
  const fernParts = fernGeo(), fg = util.merged(fernParts.map(geo => ({ geo, color: '#ffffff' })));
  const fernMat = new THREE.MeshLambertMaterial({ map: frond, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
  const ferns = [], shrubs = [], grass = [];
  const put = (arr, s, lat, sc, color) => { const a = route.at(s, lat); arr.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) - 0.05, a.pos.z], ry: R() * 6.28, s: sc, color }); };
  for (let s = -15; s < N + 15; s += 0.55) for (const side of [1, -1]) {
    if (R() < 0.25) continue;
    const lat = side * ((side > 0 ? 2.1 : 1.65) + R() * 2.2), a = route.at(s, lat), near = side > 0 ? 0.6 : 0.85;   // 左侧（镜头那边）矮一点
    if (!ok(a.pos.x, a.pos.z, lat, s, 'low')) continue;
    const ridge = smooth(N - 4, N - 1, s);
    if (R() < ridge) put(grass, s, lat, 0.7 + R() * 0.6, new THREE.Color().setHSL(0.2 + R() * 0.05, 0.35, 0.55 + R() * 0.1));
    else if (R() < 0.75) put(ferns, s, lat, near * (0.7 + R() * 0.6), new THREE.Color().setHSL(0.28 + R() * 0.04, 0.5, 0.36 + R() * 0.12));
    else put(shrubs, s, lat, near * (0.4 + R() * 0.35), new THREE.Color().setHSL(0.29 + R() * 0.05, 0.45, 0.13 + R() * 0.06));
  }
  for (let k = 0; k < 420; k++) {                                   // 林下（左侧山坡多放：从镜头看那是一整面坡）
    const s = -16 + R() * (N + 32), side = R() < 0.7 ? 1 : -1, lat = side * (3 + Math.pow(R(), 1.6) * 20), a = route.at(s, lat);
    if (!ok(a.pos.x, a.pos.z, lat, s, 'low')) continue;
    const k = Math.abs(lat) < 7 ? 0.65 : 1;                        // 贴路的小一点（镜头近）
    if (R() < 0.6) put(ferns, s, lat, k * (0.9 + R() * 0.9), new THREE.Color().setHSL(0.28, 0.45, 0.3 + R() * 0.1));
    else put(shrubs, s, lat, k * (0.5 + R() * 0.5), new THREE.Color().setHSL(0.3, 0.45, 0.13 + R() * 0.06));
  }
  const fm = util.instanced(fg, fernMat, ferns); fm.name = 'ferns'; out.push(fm);
  const shrubGeo = finish(util, [
    { geo: blobs[0], p: [0, 0.35, 0], s: [0.6, 0.45, 0.6], color: '#ffffff' },
    { geo: blobs[1], p: [0.4, 0.25, 0.15], s: [0.45, 0.35, 0.45], color: '#e8f0e0' },
    { geo: blobs[2], p: [-0.3, 0.22, -0.25], s: [0.42, 0.32, 0.42], color: '#f4fff0' },
  ], 0, 0.8);
  const sm = util.instanced(shrubGeo, vc, shrubs); sm.name = 'shrubs'; out.push(sm);
  // 芒草：一丛细长锥（山脊上）
  const gp = [];
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28, tilt = 0.25 + (k % 3) * 0.12; gp.push({ geo: new THREE.ConeGeometry(0.03, 1.1, 3).translate(0, 0.55, 0), p: [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)), color: k % 3 ? '#ffffff' : '#fff0d0' }); }
  const grm = util.instanced(util.merged(gp), vc, grass); grm.name = 'grass'; out.push(grm);

  for (const m of out) scene.add(m);
  return out;
}
