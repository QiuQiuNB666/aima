// 富士山·吉田线夜登：天随爬升（pos/total）从星空深蓝 → 蓝调 → 日出橙，登顶御来光。
//   一眼认出：繁星 + 银河 → 两侧山坡上的 Z 字折返小路和一串串慢慢往上爬的头灯（上方山坡 = 前面的人，下方跌进云海 = 后面的人）
//            → 火山岩红褐碎石路 + 沿路石垒 → 六/七/八合目山小屋（暖灯窗 + 站名牌）→ 九合目以上朱红鸟居 + 石灯笼 → 山顶鸟居框住日出。
//   氛围：脚下云海（夜里月光蓝灰，天亮染粉橙），远山露出云海；化身头灯照亮脚下一圈路面；登顶低角度暖光 = 边缘光。
// 子模块：night_to_dawn/sky.js（天、星、银河、太阳、云海、远山）、lamps.js（折返小路 + 头灯光点）、props.js（石垒、小屋、鸟居、灯笼、路牌、岩石）。
import * as THREE from 'three';
import { STEP } from '../path.js';
import { buildSky } from './night_to_dawn/sky.js';
import { headlamps, glows, trailRibbon, zigzag } from './night_to_dawn/lamps.js';
import { place, stoneTexture, stoneWalls, hut, torii, lantern, signpost, rockGeo } from './night_to_dawn/props.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 调色关键帧（p = 爬升进度；1.12 = 登顶画面）
const KEYS = [
  { p: 0.0, zenith: '#02030d', mid: '#060a22', hzCool: '#111736', hzWarm: '#1b1838', below: '#080a1a', sunGlow: '#ff9a50', warm: 0.0, halo: 0.0, stars: 1.0, milky: 1.0,
    fog: '#0a0d22', ridge1: '#05070f', ridge2: '#0b0f22', cloudLit: '#3d4876', cloudShade: '#141a34', cloudHaze: '#121836',
    hemiSky: '#6272d6', hemiGnd: '#1a1020', hemiI: 0.62, sunCol: '#93a4ff', sunI: 0.45, lamp: 1.0, glow: 1.0, fogN: 2, fogF: 15 },
  { p: 0.25, fogN: 3, fogF: 19 },
  { p: 0.42, zenith: '#03061c', mid: '#0b1032', hzCool: '#1d2250', hzWarm: '#4a2a4c', warm: 0.55, halo: 0.0, stars: 0.95, milky: 0.8,
    fog: '#12132e', ridge1: '#07081a', ridge2: '#171834', cloudLit: '#474d80', cloudShade: '#1b1d3e', cloudHaze: '#22244c',
    hemiSky: '#6a70c8', hemiGnd: '#1e1224', hemiI: 0.7, sunCol: '#a090d8', sunI: 0.5, lamp: 1.0, glow: 1.0, fogN: 5, fogF: 27 },
  { p: 0.75, zenith: '#0f1a46', mid: '#2a2c66', hzCool: '#634676', hzWarm: '#de6238', warm: 1.0, halo: 0.3, stars: 0.5, milky: 0.3,
    fog: '#352a48', ridge1: '#181226', ridge2: '#46304e', cloudLit: '#d48878', cloudShade: '#46385c', cloudHaze: '#86586a',
    hemiSky: '#c49ac2', hemiGnd: '#2e1a24', hemiI: 0.9, sunCol: '#ff9a6a', sunI: 0.9, lamp: 0.85, glow: 0.8, fogN: 12, fogF: 60 },
  { p: 1.0, zenith: '#22407c', mid: '#57589a', hzCool: '#bb7878', hzWarm: '#ff8a3d', warm: 1.0, halo: 0.7, stars: 0.14, milky: 0.06,
    fog: '#664250', ridge1: '#2a1b30', ridge2: '#784856', cloudLit: '#ffcfa4', cloudShade: '#8a5e70', cloudHaze: '#dc9c86',
    hemiSky: '#ffd0ae', hemiGnd: '#3a2226', hemiI: 1.1, sunCol: '#ffb070', sunI: 1.5, lamp: 0.55, glow: 0.55, fogN: 28, fogF: 170 },
  { p: 1.12, zenith: '#3a62a6', mid: '#8a86b8', hzCool: '#e0a08a', hzWarm: '#ffa24a', warm: 1.0, halo: 1.25, stars: 0.0, milky: 0.0,
    fog: '#8a5a5a', ridge1: '#3a2634', ridge2: '#9a6064', cloudLit: '#fff0d8', cloudShade: '#b07c80', cloudHaze: '#f0b494',
    hemiSky: '#ffe0c0', hemiGnd: '#4a2c2a', hemiI: 1.25, sunCol: '#ffb468', sunI: 2.0, lamp: 0.3, glow: 0.35, fogN: 40, fogF: 220 },
].reduce((A, k) => (A.push({ ...A[A.length - 1], ...k }), A), [])          // 没写的字段沿用上一帧
  .map(k => Object.fromEntries(Object.entries(k).map(([n, v]) => [n, typeof v === 'string' ? new THREE.Color(v) : v])));
const K = Object.fromEntries(Object.entries(KEYS[0]).map(([n, v]) => [n, v.isColor ? v.clone() : v]));
function palette(p) {
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], f = Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p)));
  for (const n in K) if (n !== 'p') { if (K[n].isColor) K[n].copy(a[n]).lerp(b[n], f); else K[n] = a[n] + (b[n] - a[n]) * f; }
  return K;
}

// 贴图：碎石（路面）、火山砂（地面）、岩阶（台阶，四周描深边）
function grain(util, kit, { edge = false, speck = 0.35 } = {}) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = kit.hash2(x, y), big = kit.noise2(x * 0.18, y * 0.18);
      let n = 0.8 + 0.18 * big + speck * (r - 0.5);
      if (r > 0.94) n += 0.25; if (r < 0.05) n -= 0.3;
      if (edge && (x < 5 || y < 5 || x > w - 6 || y > h - 6)) n *= 0.55;
      const v = Math.max(0, Math.min(255, n * 235)), i = (y * w + x) * 4;
      im.data[i] = v; im.data[i + 1] = v * 0.95; im.data[i + 2] = v * 0.92; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: !edge });
}

export function pathMaterials({ THREE, util, kit }) {
  return {
    road: new THREE.MeshLambertMaterial({ color: '#b27c62', map: grain(util, kit), emissive: '#2a170f' }),
    stairs: new THREE.MeshLambertMaterial({ color: '#ffffff', map: grain(util, kit, { edge: true, speck: 0.25 }), emissive: '#1e130e' }),
  };
}

let sky = null, lamps = null, glowSet = null, lightsR = null, scn = null, torch = null, SCp = null, sunXZ = null, CEN = null;

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, R = ctx.rand;
  scn = scene; lightsR = lights;
  const c = kit.routeCenter(route); CEN = c;
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize();
  const Lg = new THREE.Vector3(D.z, 0, -D.x);                           // 全局左（山坡往上那一侧）
  sunXZ = D.clone().multiplyScalar(Math.cos(0.1)).addScaledVector(Lg, -Math.sin(0.1)).normalize();   // 登顶画面的右半边（左半边是火口缘往剑峰那段）
  SCp = route.at(N + 1.2).pos.clone();                                 // 登顶环绕中心（半径 5.2、离地 2.3）

  sky = buildSky(scene, ctx, D, sunXZ);
  kit.fog(scene, '#0a0d22', 2, 15);

  // 路面贴图坐标（引擎的路面没有 uv）+ 台阶颜色：踏面比路亮、隔级略暗
  {
    const g = M.road.geometry, p = g.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.7; uv[i * 2 + 1] = p.getZ(i) * 0.7; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (M.stairs && M.stairIndex.length) {
    const sc = new THREE.Color('#d0ae96'), t2 = new THREE.Color();
    for (let n = 0; n < M.stairIndex.length; n++) M.stairs.setColorAt(n, t2.copy(sc).multiplyScalar(n % 2 ? 1 : 0.88));
    M.stairs.instanceColor.needsUpdate = true;
  }

  // 山体：左侧（上坡）抬成 ~28° 的火山坡、接近山顶放缓；右侧跌进云海；山顶平台之后整体往下 = 这里就是顶
  const E = route.at(N + 16).pos.clone(), dN = route.at(N + 16).dir.clone();
  const ground = kit.terrain(ctx, { size: 220, seg: 160, amp: 0.4, drop: 0.3, rough: 0.5, reach: 10, seed: 11, map: grain(util, kit, { speck: 0.5 }), uvScale: 3 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cc = new THREE.Color(), up = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z), nz = kit.fbm(x * 0.05 + 3, z * 0.05, 3);
      let y = p.getY(i);
      const ramp = Math.max(0, nr.d - 4);
      // 左坡下缓上陡（凸）：从路上往上看整面坡都露着；右坡是比视线缓的长坡（≈10°）：往下看得到坡上的光带一直伸进云海
      if (nr.side > 0) y += Math.min(34, 0.2 * ramp ** 1.4) * (0.8 + 0.45 * nz) * (1 - 0.6 * smooth(N - 8, N + 10, nr.s));   // 山顶旁边矮一些，登顶才像顶
      else y -= Math.min(16, 0.17 * ramp * smooth(0, 3, ramp)) * (0.85 + 0.3 * nz);
      const along = (x - E.x) * dN.x + (z - E.z) * dN.z, past = smooth(-3, 2, along) * (nr.side < 0 ? 1 : 1 - smooth(8, 18, nr.d));   // 山顶平台往前：往下（左前方的火口缘除外）
      if (past > 0) y = y * (1 - past) + Math.min(y, E.y - 0.5 * Math.max(0, along + 1)) * past;
      const dS = Math.hypot(x - SCp.x, z - SCp.z);
      if (dS < 12) y = Math.min(y, SCp.y - 0.05 + Math.max(0, dS - 6.2) * 3);
      p.setY(i, y); up[i] = y - nr.y;
    }
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const scree = new THREE.Color('#7c432d'), cinder = new THREE.Color('#3c2723'), black = new THREE.Color('#211819'), rust = new THREE.Color('#9a5634');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), n = kit.fbm(x * 0.09, z * 0.09, 3);
      cc.copy(scree).lerp(cinder, smooth(0.35, 0.7, n)).lerp(black, smooth(3, 22, Math.abs(up[i])) * 0.55).lerp(rust, smooth(0.6, 0.8, kit.noise2(x * 0.3, z * 0.3)) * 0.5);
      cc.multiplyScalar(0.9 + 0.3 * (kit.hash2(x, z) - 0.5));
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true;
  }
  const gp = ground.geometry.parameters, gs = gp.width, gn = gp.widthSegments, cell = gs / gn, gpos = ground.geometry.attributes.position;
  const hAt = (x, z) => {                              // 高度场双线性插值（比射线快）
    const fx = Math.max(0, Math.min(gn - 1e-6, (x - c.x + gs / 2) / cell)), fz = Math.max(0, Math.min(gn - 1e-6, (z - c.z + gs / 2) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, Y = (a, b) => gpos.getY(b * (gn + 1) + a);
    return (Y(ix, iz) * (1 - u) + Y(ix + 1, iz) * u) * (1 - v) + (Y(ix, iz + 1) * (1 - u) + Y(ix + 1, iz + 1) * u) * v;
  };
  const side = (s, lat) => { const a = route.at(s, lat); return { p: a.pos, ry: -a.heading, a }; };
  const onGround = (s, lat) => { const o = side(s, lat); o.p.y = Math.max(route.heightAt(s), hAt(o.p.x, o.p.z)); return o; };

  // ---- 头灯光带：两侧山坡上的 Z 字小路（u = 沿路前进距离，v = 全局左偏；上方 = 左坡往上爬，下方 = 右坡从云海里爬上来）
  const toWorld = ([u, v]) => { const a = route.at(u / STEP).pos; const x = a.x + Lg.x * v, z = a.z + Lg.z * v; return new THREE.Vector3(x, hAt(x, z), z); };
  const slopes = [
    zigzag(6, 30, 5.5, 17, 6, -0.12), zigzag(26, 48, 6, 20, 6, -0.12),           // 上方：左坡（往上爬的人）
    zigzag(0, 14, -30, -9, 7, 0.55), zigzag(17, 32, -40, -9, 8, 0.55), zigzag(35, 50, -46, -11, 8, 0.55),                      // 下方（从云海里上来）
  ].map(t => t.map(toWorld));
  // 本路上前后的登山者：只看得见头灯（离地 1.6），走近化身就淡掉
  const onRoute = []; for (let s = -14; s <= N + 15; s += 0.25) onRoute.push(route.at(s, 0.55).pos.clone());
  lamps = headlamps(ctx, [...slopes.map(pts => ({ pts, gap: 0.6 })), { pts: onRoute, lift: 1.6, fade: 1, gap: 1.6 }]);
  const trails = slopes; lamps.mesh.renderOrder = -2; scene.add(lamps.mesh);   // 先于云海画：云里的光点被云遮淡
  const trailMat = new THREE.MeshLambertMaterial({ color: '#7a5646', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  scene.add(trailRibbon(trails, 0.7, trailMat));

  // ---- 石垒：沿路两侧（右 = 下坡侧、左 = 挡土墙），台阶段和小屋门前留空
  const stone = new THREE.MeshLambertMaterial({ vertexColors: true, map: stoneTexture(util, R), side: THREE.DoubleSide });
  scene.add(stoneWalls(ctx, [
    { side: -1, s0: 2.5, s1: 18.7, lat: 1.5, h: 0.42 }, { side: -1, s0: 35.8, s1: 36.7, lat: 1.5, h: 0.42 },
    { side: 1, s0: 10.5, s1: 18.7, lat: 1.5, h: 0.5 }, { side: 1, s0: 22.4, s1: 36.7, lat: 1.5, h: 0.5 },
  ], stone));

  // ---- 山小屋、鸟居、石灯笼、路牌
  const body = [], glass = [], glowItems = [], texts = [], red = [];
  const addHut = (s, lat, o) => {
    const { p, ry, a } = onGround(s, lat), h = hut(o), r = ry + (lat > 0 ? Math.PI : 0);
    for (const t of h.text) t.ry = lat > 0 ? 0.75 * Math.PI : -0.75 * Math.PI;   // 站名牌斜 45° 朝来路，镜头从后面走上来读得到
    place(h.body, p, r, body); place(h.glass, p, r, glass); place(h.text, p, r, texts);
    for (const gI of place(h.glow, p, r)) glowItems.push({ p: gI.p, c: gI.c, sz: gI.sz });
    return a;
  };
  addHut(22.4, -4.0, { name: '七合目', w: 3.0, lit: 2, roof: '#3e4a4a' });
  addHut(31, -4.0, { name: '八合目', w: 4.6, lit: 4 });
  addHut(31.5, 7.6, { w: 3.2, lit: 2, roof: '#5a3024' });          // 八合目上面一层的小屋（左坡上）
  const addLantern = (s, lat) => { const o = onGround(s, lat), L = lantern(); place(L.parts, o.p, o.ry, body); glowItems.push({ p: o.p.clone().add(new THREE.Vector3(...L.light)), c: '#ffc76a', sz: 2.0 }); };
  const addSign = (s, lat, t, sub) => { const o = onGround(s, lat), S = signpost(t, sub); place(S.parts, o.p, o.ry, body); place(S.text, o.p, o.ry, texts); };
  addSign(0.8, -1.95, '吉田口', '五合目'); addLantern(2.2, 2.5); addLantern(2.2, -2.5);
  addSign(3.4, -1.95, '六合目');  addSign(35.8, -1.95, '九合目');
  // 鸟居：九合目以上一座立在路右边（小神社的门，不跨路：跟拍镜头在化身后 7–9 步，跨路的门迟早横在镜头和人中间）；
  //   山顶平台尽头一座跨路、框住日出（在登顶环绕圈外：离环绕中心 6.9 > 5.2，化身走不到那儿）
  for (const [s, lat, hw, H] of [[36, -4.4, 1.25, 2.6], [N + 15, 0, 2.3, 3.2]]) {
    const a = route.at(s, lat); place(torii({ hw, H }), a.pos.setY(Math.max(route.heightAt(s), hAt(a.pos.x, a.pos.z))), -a.heading, red);
  }
  { const o = onGround(37.6, -4.4); place([                                       // 鸟居后面的小祠
    { geo: new THREE.BoxGeometry(0.9, 0.8, 0.8), p: [0, 0.4, 0], color: '#6a4a30' },
    { geo: new THREE.ConeGeometry(0.85, 0.5, 4).rotateY(Math.PI / 4), p: [0, 1.05, 0], s: [1, 1, 0.9], color: '#3a2a22' }], o.p, o.ry, body); }
  addLantern(35.4, -2.7); addLantern(35.8, 2.9); addLantern(N + 14.2, 3.1); addLantern(N + 14.2, -3.1);
  addSign(N + 11.5, -2.2, '富士山頂', '3776m');

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mk = (parts, mat, name) => { const m = new THREE.Mesh(util.merged(parts), mat); m.name = name; scene.add(m); return m; };
  mk(body, vc, 'huts');
  mk(glass, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'hutWindows');
  mk(red, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a0c06' }), 'torii');
  const signs = util.textSigns(texts, { size: 96 }); signs.renderOrder = 1; scene.add(signs);
  glowSet = glows(glowItems); scene.add(glowSet.mesh);

  // ---- 火山岩：路边碎石 + 岩场大块；左侧 4.4 以内只放矮的（镜头在左后方）
  const rocks = [], rc = ['#3b2826', '#4c3029', '#2a2022', '#5c3628', '#33292a'];
  const huts = [[22.4, -4.0], [31, -4.0], [31.5, 7.6]].map(([s, l]) => route.at(s, l).pos);
  const toriiP = [route.at(36.8, -4.4).pos, route.at(N + 15).pos];
  const tryRock = (s, lat, sc) => {
    const a = route.at(s, lat), x = a.pos.x, z = a.pos.z;
    if (!util.offRoad(route, x, z, 0.55 + sc)) return;
    if (lat > 0 && lat < 4.6 && sc > 0.32) sc = 0.32;
    if (lat > 4.6 && sc > 0.42) sc = 0.42;                  // 左坡：别挡坡上的头灯光带
    if (huts.some(h => Math.hypot(x - h.x, z - h.z) < 3.4) || toriiP.some(h => Math.hypot(x - h.x, z - h.z) < 3.2)) return;
    if (Math.hypot(x - SCp.x, z - SCp.z) < 7 && sc > 0.25) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.5, R() * 6.28, (R() - 0.5) * 0.5));
    rocks.push({ p: [x, hAt(x, z) - sc * 0.22, z], q, s: [sc * (0.8 + R() * 0.5), sc * (0.7 + R() * 0.6), sc * (0.8 + R() * 0.5)], color: rc[(R() * rc.length) | 0] });
  };
  for (let k = 0; k < 360; k++) { const sd = R() < 0.5 ? 1 : -1; tryRock(-12 + R() * (N + 26), sd * (1.9 + Math.pow(R(), 1.6) * 24), 0.15 + Math.pow(R(), 2) * 0.75); }
  for (let k = 0; k < 70; k++) { const sd = R() < 0.5 ? 1 : -1; tryRock(16.5 + R() * 8, sd * (2.0 + R() * 5.5), 0.45 + R() * 0.9); }      // 岩场
  const rockMesh = util.instanced(rockGeo(), new THREE.MeshLambertMaterial({ flatShading: true }), rocks); rockMesh.name = 'rocks'; scene.add(rockMesh);

  // ---- 化身的头灯：一盏跟着化身走的暖色点光，照亮脚下一圈（天亮渐弱）
  torch = new THREE.PointLight('#ffe2b0', 8, 11, 1.6); torch.name = 'torch'; scene.add(torch);
  torch.position.copy(route.at(0).pos).setY(1.5);
  update(0, { t: 0, progress: 0, summit: false });
}

export function update(dt, st) {
  if (!sky) return;
  const p = st.summit ? 1.12 : Math.max(0, Math.min(1, st.progress || 0)), k = palette(p);
  const sunEl = -0.16 + 0.18 * smooth(0.5, 1.0, p) + 0.06 * smooth(1.0, 1.12, p);
  const dir = sky.update(st.t || 0, k, sunEl);
  scn.fog.color.copy(k.fog); scn.fog.near = k.fogN; scn.fog.far = k.fogF;   // 夜里远处沉进黑暗（只剩灯光），天亮后看得远
  const L = lightsR, e = smooth(0.55, 1.05, p);
  L.hemi.color.copy(k.hemiSky); L.hemi.groundColor.copy(k.hemiGnd); L.hemi.intensity = k.hemiI;
  L.sun.color.copy(k.sunCol); L.sun.intensity = k.sunI;
  const el = 0.95 + (Math.max(dir.y, 0.1) - 0.95) * e;              // 夜里月光从高处照；天亮后贴着地平线从前方照（暖色边缘光）
  L.sun.position.set(CEN.x + sunXZ.x * Math.cos(el) * 40, SCp.y + Math.sin(el) * 40, CEN.z + sunXZ.z * Math.cos(el) * 40);
  lamps.uni.op.value = k.lamp; glowSet.uni.op.value = k.glow;
  if (dt) lamps.update(dt);
  if (st.avatar) lamps.uni.av.value.copy(st.avatar);
  torch.intensity = 8 * k.lamp;
  if (st.avatar) {
    const h = st.heading || 0;
    torch.position.set(st.avatar.x + Math.cos(h) * 1.2, st.avatar.y + 1.6, st.avatar.z + Math.sin(h) * 1.2);
  }
}
