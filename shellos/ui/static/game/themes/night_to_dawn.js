// 富士山·吉田线夜登：天随爬升（pos/total）从星空深蓝 → 蓝调 → 日出橙，登顶御来光。
//   一眼认出：繁星 + 斜穿的银河 → 左坡 Z 字折返小路和一串串慢慢往上爬的头灯（上方 = 前面的人，下方跌进云海 = 后面的人）
//            → 火山岩红褐碎石路 + 黑灰火山石干垒 → 七/八合目山小屋（铁皮顶 + 暖灯木格窗 + 暖帘 + 竖木牌）→ 九合目鸟居小祠
//            → 山顶火口缘平台、「富士山頂」石柱、鸟居框住日出、云海上的影富士。
//   地标按里程「走到才露面」：每站在化身走到前 ~8 步才从暗处淡入（抖动溶解，不透明渲染不排序），同一画面最多当前站 + 下一站。
// 子模块：night_to_dawn/sky.js（天、星、银河、太阳、云海、远山、影富士）、lamps.js（折返小路 + 头灯光点）、props.js（石垒、小屋、鸟居、灯笼、幟、石柱、岩石）。
import * as THREE from 'three';
import { STEP } from '../path.js';
import { buildSky } from './night_to_dawn/sky.js';
import { headlamps, glows, trailRibbon, zigzag } from './night_to_dawn/lamps.js';
import { place, stoneGeo, stoneWalls, tinTexture, hut, torii, lantern, signpost, nobori, pillar, rockGeo } from './night_to_dawn/props.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 调色关键帧（p = 爬升进度；1.12 = 登顶画面）
const KEYS = [
  { p: 0.0, zenith: '#02030d', mid: '#070b24', hzCool: '#141a3a', hzWarm: '#1b1838', below: '#080a1a', sunGlow: '#ff9a50', warm: 0.0, halo: 0.0, stars: 1.0, milky: 1.0,
    fog: '#0e1128', ridge1: '#070a16', ridge2: '#0e1228', rim: '#3a4878', cloudLit: '#46528a', cloudShade: '#161c38', cloudHaze: '#141a3a',
    hemiSky: '#7282e0', hemiGnd: '#221828', hemiI: 0.95, sunCol: '#8fa4ff', sunI: 0.6, lamp: 1.0, glow: 1.0, fogN: 2.5, fogF: 16 },
  { p: 0.25, fogN: 3, fogF: 19 },
  { p: 0.42, zenith: '#03061c', mid: '#0b1032', hzCool: '#1d2250', hzWarm: '#4a2a4c', warm: 0.55, halo: 0.0, stars: 0.95, milky: 0.8,
    fog: '#14152f', ridge1: '#0a0b1e', ridge2: '#191a36', rim: '#3c3e6a', cloudLit: '#4a5084', cloudShade: '#1b1d3e', cloudHaze: '#22244c',
    hemiSky: '#747ad0', hemiGnd: '#221628', hemiI: 0.95, sunCol: '#a090d8', sunI: 0.6, lamp: 1.0, glow: 1.0, fogN: 5, fogF: 27 },
  { p: 0.75, zenith: '#0f1a46', mid: '#2a2c66', hzCool: '#634676', hzWarm: '#de6238', warm: 1.0, halo: 0.3, stars: 0.5, milky: 0.3,
    fog: '#352a48', ridge1: '#181226', ridge2: '#46304e', rim: '#8a4c48', cloudLit: '#d48878', cloudShade: '#46385c', cloudHaze: '#86586a',
    hemiSky: '#c49ac2', hemiGnd: '#2e1a24', hemiI: 1.0, sunCol: '#ff9a6a', sunI: 0.95, lamp: 0.85, glow: 0.8, fogN: 12, fogF: 60 },
  { p: 1.0, zenith: '#22407c', mid: '#57589a', hzCool: '#bb7878', hzWarm: '#ff8a3d', warm: 1.0, halo: 0.7, stars: 0.14, milky: 0.06,
    fog: '#664250', ridge1: '#2a1b30', ridge2: '#784856', rim: '#b0603c', cloudLit: '#ffcfa4', cloudShade: '#8a5e70', cloudHaze: '#dc9c86',
    hemiSky: '#ffd0ae', hemiGnd: '#3a2226', hemiI: 1.1, sunCol: '#ffb070', sunI: 1.5, lamp: 0.55, glow: 0.55, fogN: 28, fogF: 170 },
  { p: 1.12, zenith: '#3a62a6', mid: '#8a86b8', hzCool: '#e0a08a', hzWarm: '#ffa24a', warm: 1.0, halo: 1.25, stars: 0.0, milky: 0.0,
    fog: '#8a5a5a', ridge1: '#3a2634', ridge2: '#9a6064', rim: '#c07048', cloudLit: '#fff0d8', cloudShade: '#b07c80', cloudHaze: '#f0b494',
    hemiSky: '#ffe0c0', hemiGnd: '#4a2c2a', hemiI: 1.25, sunCol: '#ffb468', sunI: 2.0, lamp: 0.3, glow: 0.35, fogN: 40, fogF: 220 },
].reduce((A, k) => (A.push({ ...A[A.length - 1], ...k }), A), [])          // 没写的字段沿用上一帧
  .map(k => Object.fromEntries(Object.entries(k).map(([n, v]) => [n, typeof v === 'string' ? new THREE.Color(v) : v])));
const K = Object.fromEntries(Object.entries(KEYS[0]).map(([n, v]) => [n, v.isColor ? v.clone() : v]));
function palette(p) {
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], f = Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p)));
  for (const n in K) if (n !== 'p' && n in a) { if (K[n].isColor) K[n].copy(a[n]).lerp(b[n], f); else K[n] = a[n] + (b[n] - a[n]) * f; }
  K.kage = smooth(0.9, 1.0, p);                                         // 影富士
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

// 淡入：抖动溶解（片元按屏幕噪声丢弃），材质保持不透明，不和化身/台阶抢排序
function revealable(mat, U) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRev = U;
    sh.fragmentShader = 'uniform float uRev;\n' + sh.fragmentShader.replace('void main() {',
      'void main() {\n  if (uRev < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= uRev) discard;');
  };
  mat.customProgramCacheKey = () => 'ntd-reveal';
  return mat;
}

let sky = null, lamps = null, lightsR = null, scn = null, torch = null, SCp = null, sunXZ = null, CEN = null, groups = [], dressed = false, rigR = null;

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, R = ctx.rand;
  scn = scene; lightsR = lights; groups = []; dressed = false; rigR = ctx.camRig;
  const c = kit.routeCenter(route); CEN = c;
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize();
  const Lg = new THREE.Vector3(D.z, 0, -D.x);                           // 全局左（山坡往上那一侧）
  SCp = route.at(N + 1.2).pos.clone();                                 // 登顶环绕中心（化身站的地方）

  // ---- 登顶构图：镜头在化身身后、偏左 32°（化身站在鸟居右柱外，不挡鸟居），太阳方位 = 镜头 → 山顶鸟居中轴
  const TOR = route.at(N + 15).pos.clone(), TOR_H = 4.4, TOR_HW = 2.2;
  const u = TOR.clone().sub(SCp).setY(0).normalize(), uL = new THREE.Vector3(u.z, 0, -u.x);
  const camDir = u.clone().multiplyScalar(-Math.cos(0.56)).addScaledVector(uL, Math.sin(0.56)).normalize();
  const SR = ctx.camRig.summit; SR.radius = 5.2; SR.height = 1.6; SR.lookY = 1.6; SR.speed = 0.02;
  const cam0 = SCp.clone().addScaledVector(camDir, SR.radius);
  sunXZ = TOR.clone().sub(cam0).setY(0).normalize();
  const startDir = camDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.06);   // 慢慢漂过正构图（6 s ≈ 7°）
  SR.face = SCp.clone().addScaledVector(startDir, -10);

  sky = buildSky(scene, ctx, D, sunXZ);
  kit.fog(scene, '#0e1128', 2.5, 16);
  M.flag.visible = false;                                              // 引擎的白旗杆：换成路外的幟

  // 路面贴图坐标（按世界 xz）+ 台阶颜色：踏面比路亮、隔级略暗
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

  // ---- 山体：左侧（上坡）抬成火山坡、接近山顶放缓；右侧跌进云海；山顶 = 一块和路面齐平的火口缘平台（路尽头融进地面）
  const E = route.at(N + 16).pos.clone(), dN = route.at(N + 16).dir.clone(), PN = route.P[N], Pc = route.at(N + 8).pos.clone();
  const ground = kit.terrain(ctx, { size: 220, seg: 160, amp: 0.4, drop: 0.3, rough: 0.5, reach: 10, seed: 11, map: grain(util, kit, { speck: 0.5 }), uvScale: 3 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cc = new THREE.Color(), up = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z), nz = kit.fbm(x * 0.05 + 3, z * 0.05, 3);
      let y = p.getY(i);
      const ramp = Math.max(0, nr.d - 4);
      if (nr.side > 0) y += Math.min(34, 0.2 * ramp ** 1.4) * (0.8 + 0.45 * nz) * (1 - 0.6 * smooth(N - 8, N + 10, nr.s));
      else y -= Math.min(16, 0.17 * ramp * smooth(0, 3, ramp)) * (0.85 + 0.3 * nz);
      const along = (x - E.x) * dN.x + (z - E.z) * dN.z, past = smooth(-3, 2, along) * (nr.side < 0 ? 1 : 1 - smooth(8, 18, nr.d));
      if (past > 0) y = y * (1 - past) + Math.min(y, E.y - 0.5 * Math.max(0, along + 1)) * past;
      // 山顶平台：P[N] 往后、离平台中心 9 以内齐路面，9–13 过渡到原地形，外缘一圈微微隆起（火口缘）
      const aN = (x - PN.x) * dN.x + (z - PN.z) * dN.z, dP = Math.hypot(x - Pc.x, z - Pc.z);
      const wP = smooth(-1.5, 0.3, aN) * (1 - smooth(9, 13, dP));
      if (wP > 0) y = y * (1 - wP) + (Pc.y - 0.07 + 0.35 * smooth(7.5, 10, dP) * (1 - smooth(10, 12.5, dP))) * wP;
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
  const hAt = util.gridHeight(ground);
  const side = (s, lat) => { const a = route.at(s, lat); return { p: a.pos, ry: -a.heading, a }; };
  const onGround = (s, lat) => { const o = side(s, lat); o.p.y = Math.max(route.heightAt(s), hAt(o.p.x, o.p.z)); return o; };

  // ---- 头灯光带：两侧山坡上的 Z 字小路（u = 沿路前进距离，v = 全局左偏）
  const toWorld = ([uu, v]) => { const a = route.at(uu / STEP).pos; const x = a.x + Lg.x * v, z = a.z + Lg.z * v; return new THREE.Vector3(x, hAt(x, z), z); };
  const slopes = [
    zigzag(6, 30, 5.5, 17, 6, -0.12), zigzag(26, 48, 6, 20, 6, -0.12),
    zigzag(0, 14, -30, -9, 7, 0.55), zigzag(17, 32, -40, -9, 8, 0.55), zigzag(35, 50, -46, -11, 8, 0.55),
  ].map(t => t.map(toWorld));
  const onRoute = []; for (let s = -14; s <= N + 15; s += 0.25) onRoute.push(route.at(s, 0.55).pos.clone());
  lamps = headlamps(ctx, [...slopes.map(pts => ({ pts, gap: 0.6 })), { pts: onRoute, lift: 1.6, fade: 1, gap: 1.6 }]);
  lamps.mesh.renderOrder = -2; scene.add(lamps.mesh);
  const trailMat = new THREE.MeshLambertMaterial({ color: '#7a5646', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  scene.add(trailRibbon(slopes, 0.7, trailMat));

  // ---- 石垒：黑灰火山石干垒（4 段，台阶段和小屋门前留空）
  const W = stoneWalls(ctx, [
    { side: -1, s0: 2.5, s1: 18.7, lat: 1.5 }, { side: -1, s0: 33.6, s1: 36.7, lat: 1.5 },
    { side: 1, s0: 10.5, s1: 18.7, lat: 1.5 }, { side: 1, s0: 22.4, s1: 36.7, lat: 1.5 },
  ], R);
  scene.add(W.back);
  const wallMesh = util.instanced(stoneGeo(), new THREE.MeshLambertMaterial({ flatShading: true, emissive: '#0c0909' }), W.stones); wallMesh.name = 'stoneWallStones'; scene.add(wallMesh);

  // ---- 地标，按站分组：{ from = 化身走到第几步才淡入 }
  const tin = tinTexture(util);
  const G = {};
  const grp = (key, from) => (G[key] ||= { from, body: [], roof: [], glass: [], red: [], cloth: [], texts: [], glow: [] });
  const addHut = (g, s, lat, o) => {
    const { p, ry } = onGround(s, lat), h = hut(o), r = ry + (lat > 0 ? Math.PI : 0);
    place(h.body, p, r, g.body); place(h.roof, p, r, g.roof); place(h.glass, p, r, g.glass); place(h.text, p, r, g.texts);
    for (const gI of place(h.glow, p, r)) g.glow.push({ p: gI.p, c: gI.c, sz: gI.sz });
  };
  const addLantern = (g, s, lat) => { const o = onGround(s, lat), L = lantern(); place(L.parts, o.p, o.ry, g.body); g.glow.push({ p: o.p.clone().add(new THREE.Vector3(...L.light)), c: '#ffc76a', sz: 2.0 }); };
  const addSign = (g, s, lat, t, sub) => { const o = onGround(s, lat), S = signpost(t, sub, lat > 0); place(S.parts, o.p, o.ry, g.body); place(S.text, o.p, o.ry, g.texts); };
  const addNobori = (g, s, lat, col) => { const o = onGround(s, lat), F = nobori(col); place(F.parts, o.p, o.ry, g.body); place(F.cloth, o.p, o.ry, g.cloth); };

  const g0 = grp('base', -99);                                        // 五合目：开局就在
  addSign(g0, 1.6, -2.7, '吉田口', '五合目'); addLantern(g0, 2.2, 3.2); addLantern(g0, 2.2, -2.6);
  addSign(g0, 4.4, 3.3, '六合目');                                     // 放左边：右边是影子，头顶标签会叠在牌上
  addHut(grp('h7', 15), 24.2, -4.8, { name: '七合目', w: 3.2, lit: 3 });
  const g8 = grp('h8', 23);
  addHut(g8, 29.8, -5.3, { name: '八合目', w: 4.4, lit: 5 });
  addHut(g8, 31.5, 7.6, { w: 3.2, lit: 3 });                           // 八合目上面一层（左坡）
  const g9 = grp('g9', 30);
  addSign(g9, 31.2, -2.9, '九合目');
  { const a = route.at(36, -4.4); place(torii({ hw: 1.25, H: 2.6 }), a.pos.setY(Math.max(route.heightAt(36), hAt(a.pos.x, a.pos.z))), -a.heading, g9.red); }
  { const o = onGround(37.6, -4.4); place([
    { geo: new THREE.BoxGeometry(0.9, 0.8, 0.8), p: [0, 0.4, 0], color: '#6a4a30' },
    { geo: new THREE.ConeGeometry(0.85, 0.5, 4).rotateY(Math.PI / 4), p: [0, 1.05, 0], s: [1, 1, 0.9], color: '#3a2a22' }], o.p, o.ry, g9.body); }
  addLantern(g9, 35.4, -2.7); addLantern(g9, 35.8, 3.2);
  const gT = grp('top', 34);                                          // 山顶：九合目过了才看得见
  place(torii({ hw: TOR_HW, H: TOR_H }), TOR.clone().setY(Math.max(route.heightAt(N), hAt(TOR.x, TOR.z))), -Math.atan2(sunXZ.z, sunXZ.x), gT.red);
  addLantern(gT, N + 16.6, 3.4);
  { const o = onGround(N + 6, -3.4); place(pillar(), o.p, o.ry, gT.body);
    place([{ text: '富士山頂', p: [-0.23, 1.3, 0], ry: -Math.PI / 2 - 0.35, h: 1.3, vertical: true, color: '#1a1410', bg: '#b9b2a8', border: '#5a5450', weight: 900, pad: 0.1 },
      { text: '3776m', p: [-0.48, 0.5, 0], ry: -Math.PI / 2 - 0.35, h: 0.22, color: '#1a1410', bg: '#d8d0c4', weight: 900 }], o.p, o.ry, gT.texts); }
  addNobori(gT, N + 2.4, -3.2, '#c8361f'); addNobori(gT, N + 3.4, -3.5, '#f0ece0');

  for (const [key, g] of Object.entries(G)) {
    const U = { value: g.from < -50 ? 1 : 0 }, meshes = [];
    const mk = (parts, mat, name) => { if (!parts.length) return; const m = new THREE.Mesh(util.merged(parts), revealable(mat, U)); m.name = `${name}-${key}`; scene.add(m); meshes.push(m); };
    mk(g.body, new THREE.MeshLambertMaterial({ vertexColors: true }), 'props');
    mk(g.roof, new THREE.MeshLambertMaterial({ vertexColors: true, map: tin, emissive: '#10141c' }), 'tinRoof');
    mk(g.glass, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'hutLights');
    mk(g.red, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a0c06' }), 'torii');
    mk(g.cloth, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#1a1010' }), 'nobori');
    if (g.texts.length) { const t = util.textSigns(g.texts, { size: 96 }); revealable(t.material, U); t.renderOrder = 1; t.name = `signs-${key}`; scene.add(t); meshes.push(t); }
    const gl = g.glow.length ? glows(g.glow) : null; if (gl) { scene.add(gl.mesh); meshes.push(gl.mesh); }
    groups.push({ from: g.from, U, meshes, gl, top: key === 'top' });
  }

  // ---- 火山岩：路边碎石 + 岩场大块 + 山顶火口缘一圈；左侧 4.4 以内只放矮的（镜头在左后方）
  const rocks = [], rc = ['#3b2826', '#4c3029', '#2a2022', '#5c3628', '#33292a'];
  const avoid = [[24.2, -4.8, 3.6], [29.8, -5.3, 3.8], [31.5, 7.6, 3.4], [36.8, -4.4, 3.2], [N + 6, -3.4, 1.2]].map(([s, l, r]) => [route.at(s, l).pos, r]);
  avoid.push([TOR, 3.4]);
  const tryRock = (x, z, sc, lat) => {
    if (!util.offRoad(route, x, z, 0.55 + sc)) return;
    if (lat > 0 && lat < 4.6 && sc > 0.32) sc = 0.32;
    if (lat > 4.6 && sc > 0.42) sc = 0.42;
    if (avoid.some(([h, r]) => Math.hypot(x - h.x, z - h.z) < r)) return;
    if (Math.hypot(x - SCp.x, z - SCp.z) < 7 && sc > 0.25) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.5, R() * 6.28, (R() - 0.5) * 0.5));
    rocks.push({ p: [x, hAt(x, z) - sc * 0.22, z], q, s: [sc * (0.8 + R() * 0.5), sc * (0.7 + R() * 0.6), sc * (0.8 + R() * 0.5)], color: rc[(R() * rc.length) | 0] });
  };
  const tryAt = (s, lat, sc) => { const a = route.at(s, lat); tryRock(a.pos.x, a.pos.z, sc, lat); };
  for (let k = 0; k < 360; k++) { const sd = R() < 0.5 ? 1 : -1; tryAt(-12 + R() * (N + 12), sd * (1.9 + Math.pow(R(), 1.6) * 24), 0.15 + Math.pow(R(), 2) * 0.75); }
  for (let k = 0; k < 70; k++) { const sd = R() < 0.5 ? 1 : -1; tryAt(16.5 + R() * 8, sd * (2.0 + R() * 5.5), 0.45 + R() * 0.9); }      // 岩场
  for (let k = 0; k < 130; k++) {                                     // 火口缘碎石：平台外缘一圈（朝太阳那一段压矮，不挡日出）
    const a = R() * Math.PI * 2, r = 9.2 + R() * 2.4, x = Pc.x + Math.cos(a) * r, z = Pc.z + Math.sin(a) * r;
    const front = Math.max(0, Math.cos(a) * sunXZ.x + Math.sin(a) * sunXZ.z);
    if (((x - PN.x) * dN.x + (z - PN.z) * dN.z) < -1) continue;
    tryRock(x, z, (0.2 + Math.pow(R(), 1.5) * 0.7) * (1 - 0.6 * front), 0);
  }
  const rockMesh = util.instanced(rockGeo(), new THREE.MeshLambertMaterial({ flatShading: true }), rocks); rockMesh.name = 'rocks'; scene.add(rockMesh);

  // ---- 化身配色：纯色机甲（深灰腿、钢蓝躯干、浅色头盔）；发光条在 update 里挂到骨骼上
  ctx.theme.avatar = { leg: '#2a3038', body: '#5b6b80', head: '#e4e8ec', rim: '#9fdcff', rimK: 0.75, self: 0.3, headScale: 0.86 };

  // ---- 化身的头灯：一盏跟着化身走的暖色点光，照亮脚下一圈（天亮渐弱）
  torch = new THREE.PointLight('#ffe2b0', 8, 11, 1.6); torch.name = 'torch'; scene.add(torch);
  torch.position.copy(route.at(0).pos).setY(1.5);
  update(0, { t: 0, progress: 0, summit: false, s: 0, preview: true });
}

// 外骨骼发光条：腿外侧（大腿、小腿）+ 腰带 + 头灯，挂在化身骨骼上跟着动（橙 #ff8a3c，不吃光 = emissive 1.0）
function dressAvatar() {
  const av = scn.getObjectByName('avatar'); if (!av) return false;
  const B = {}; av.traverse(o => { if (o.isBone) B[o.name] = o; });
  if (!B.leg_joint_L_1) return true;
  av.updateMatrixWorld(true);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff8a3c', toneMapped: false, fog: false }), lamp = new THREE.MeshBasicMaterial({ color: '#fff4d8', toneMapped: false, fog: false });
  const wq = new THREE.Quaternion(), Yv = new THREE.Vector3(0, 1, 0);
  const local = (bone, v) => v.clone().applyQuaternion(bone.getWorldQuaternion(wq).invert());
  const avQ = av.getWorldQuaternion(new THREE.Quaternion());
  const leftW = new THREE.Vector3(0, 0, -1).applyQuaternion(avQ), fwdW = new THREE.Vector3(1, 0, 0).applyQuaternion(avQ);
  for (const [sd, sgn] of [['L', 1], ['R', -1]]) {
    for (const [a, b, rad] of [[`leg_joint_${sd}_1`, `leg_joint_${sd}_2`, 0.072], [`leg_joint_${sd}_2`, `leg_joint_${sd}_3`, 0.056]]) {
      const bone = B[a], child = B[b]; if (!bone || !child) continue;
      const ax = child.position.clone(), len = ax.length(); ax.normalize();
      const out = local(bone, leftW.clone().multiplyScalar(sgn)); out.addScaledVector(ax, -out.dot(ax)).normalize();
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.028, len * 0.78, 0.028), mat);
      m.quaternion.setFromUnitVectors(Yv, ax); m.position.copy(ax).multiplyScalar(len * 0.5).addScaledVector(out, rad);
      m.name = 'exoStrip'; bone.add(m);
    }
  }
  const pel = B.Skeleton_torso_joint_1;
  if (pel) {
    const ax = (B.Skeleton_torso_joint_2 ? B.Skeleton_torso_joint_2.position.clone() : new THREE.Vector3(0, 0, 1)).normalize();
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.014, 6, 28), mat);
    belt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax); belt.position.copy(ax).multiplyScalar(0.03); belt.name = 'exoBelt'; pel.add(belt);
  }
  const head = B.Skeleton_neck_joint_2;
  if (head) {
    const f = local(head, fwdW).normalize(), upL = local(head, new THREE.Vector3(0, 1, 0)).normalize();
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), lamp);
    hl.position.copy(f).multiplyScalar(0.105).addScaledVector(upL, 0.07); hl.name = 'exoHeadlamp'; head.add(hl);
  }
  return true;
}

export function update(dt, st) {
  if (!sky) return;
  if (!dressed) dressed = dressAvatar();
  const p = st.summit ? 1.12 : Math.max(0, Math.min(1, st.progress || 0)), k = palette(p);
  const sunEl = -0.16 + 0.18 * smooth(0.5, 1.0, p) + 0.03 * smooth(1.0, 1.12, p);   // 登顶 ≈ 3°：正好在鸟居里、云海线上
  const dir = sky.update(st.t || 0, k, sunEl);
  scn.fog.color.copy(k.fog); scn.fog.near = k.fogN; scn.fog.far = k.fogF;
  const L = lightsR, e = smooth(0.55, 1.05, p);
  L.hemi.color.copy(k.hemiSky); L.hemi.groundColor.copy(k.hemiGnd); L.hemi.intensity = k.hemiI;
  L.sun.color.copy(k.sunCol); L.sun.intensity = k.sunI;
  const el = 0.95 + (Math.max(dir.y, 0.1) - 0.95) * e;
  L.sun.position.set(CEN.x + sunXZ.x * Math.cos(el) * 40, SCp.y + Math.sin(el) * 40, CEN.z + sunXZ.z * Math.cos(el) * 40);
  lamps.uni.op.value = k.lamp;
  if (dt) lamps.update(dt);
  if (st.avatar) lamps.uni.av.value.copy(st.avatar);
  // 地标按里程淡入（预览直接到位）
  const s = st.summit ? 1e9 : (st.s ?? 0);
  for (const g of groups) {
    const want = st.summit ? +g.top || +(g.from < -50) : s >= g.from ? 1 : 0;   // 登顶环绕时只留山顶那组（别的站会从画面边角露出来）
    g.U.value = st.preview || !dt ? want : g.U.value + Math.sign(want - g.U.value) * Math.min(Math.abs(want - g.U.value), dt / 1.2);
    for (const m of g.meshes) m.visible = g.U.value > 0.002;
    if (g.gl) g.gl.uni.op.value = k.glow * g.U.value;
  }
  // 九合目往上看点慢慢抬高：山顶鸟居整个落在 HUD 上沿下面
  if (rigR) rigR.follow.lookY = 0.95 + 0.5 * smooth(34, 39.5, st.s ?? 0);
  torch.intensity = 8 * k.lamp;
  if (st.avatar) {
    const h = st.heading || 0;
    torch.position.set(st.avatar.x + Math.cos(h) * 1.2, st.avatar.y + 1.6, st.avatar.z + Math.sin(h) * 1.2);
  }
}
