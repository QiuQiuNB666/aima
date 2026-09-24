// 珠峰北坡（高海拔雪山）：大本营经幡 + 帐篷、远处的珠峰北壁和旗云 → 冰川碛石路、右侧冰塔林 → 前进营地
//   → 北坳冰壁（冰塔、路右的固定绳、冰爪痕）→ 北坳营地（帐篷、氧气瓶）→ 北山脊风雪 → 第一台阶 → 第二台阶铝梯（中国梯）
//   → 顶峰雪坡、排队的人影 → 顶峰红色测量觇标 + 经幡，脚下云海、头顶蓝黑天。
// 天气随进度：低处晴（藏蓝天、白太阳）→ 北坳往上起风雪（雾收近、雪粒横飞、远山褪进灰白）→ 排队处转晴 → 登顶云海 + 蓝黑天。
// 缺氧：按海拔（world.alt 插值）四周变暗、变糊，随呼吸一明一暗（snow_summit/hypoxia.js，DOM 层，不动画面）。
// 地标按路段找（不写死步号）：第一段上台阶 = 冰壁、最后一段上台阶 = 铝梯、冰壁之后的台阶 = 岩石台阶、前 80% 里的红灯 = 北坳营地、
//   最后 20% 里的红灯 = 排队。「一句话造山」生成的 snow_summit 世界照样能用。
// 路线只有 28 个单位长，大本营一眼能看到顶：岩石台阶 / 铝梯 / 排队的人 / 觇标「走到才露面」（抖动溶解，离地标 ~8 个单位开始显出来）。
// ?fx=low：雪粒 / 经幡 / 排队人数减半、不要模糊层、地面网格粗一档（展位机器吃紧时用）。
// 互动（只动画面和声音）：走过经幡，近处的旗被一阵猛风抽得乱飞、啪啪响；排队段前面的人一个个往上挪，轮到你时最前面那个往右让一步；
//   北坳吸氧：化身旁边弹出氧气面罩图标、嘶——一口、呼出白气（缺氧暗角也松一点）；登顶时觇标上卷着的红旗展开。?fx=low 不要白气。
// 悬崖三段（北坳裂缝·横梯 / 大风口·刀脊 / 北壁横切·贴壁栈道）：snow_summit/cliff.js（几何、过梯晃 / 失足、镜头 FOV、雾带、滚石）。
// 子模块：snow_summit/sky.js（天、群峰、远处北壁、云海）、snow.js（雪粒）、props.js（道具几何）、hypoxia.js（缺氧）；头顶图标用 cliff_path/interact.js，音效用 kit.sfx / kit.sfxLoop。
import * as THREE from 'three';
import { STEP, ROAD_W } from '../path.js';
import { SEG, WHO, UI } from '../style.js';
import { stairNoses } from './cliff_path/props.js';
import { buildSky } from './snow_summit/sky.js';
import { buildSnow } from './snow_summit/snow.js';
import { makeHypoxia } from './snow_summit/hypoxia.js';
import { prayerFlags, bottleGeo, spireGeo, seracGeo, fixedRope, ladderParts, beaconParts, rockGeo, revealable, beaconFlag, crevasseGeo, iceSheen, spindrift } from './snow_summit/props.js';
import { climberGeo, climberMaterials } from './snow_summit/climber_model.js';
import { sfx as play } from './kit.js';
import { popIcon } from './cliff_path/interact.js';
import { buildCamp } from './snow_summit/camp.js';
import { buildHeli } from './snow_summit/heli.js';
import { buildYaks } from './snow_summit/yaks.js';
import { fgSay } from './snow_summit/lines.js';
import { makeSoundscape } from './snow_summit/soundscape.js';
import { tentGeo, glowMaterial } from './snow_summit/tent_model.js';
import { cliffZones, cliffGround, shapeRoad, buildCliff, makeCliffState, updateCliff } from './snow_summit/cliff.js';

const LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'low';
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const HW = ROAD_W / 2;

// ---------- 调色：低处晴 / 高处晴 / 风雪 / 登顶 四组，按进度和风雪强度插 ----------
const PAL = {
  low:   { top: '#1447a2', hz: '#a8c8ea', below: '#d9e3ee', fog: '#c6d6ea', fogN: 45, fogF: 380, hemiS: '#e2ecff', hemiG: '#8d887c', hemiI: 1.0, sunC: '#fff3de', sunI: 1.75, band: 0.35, halo: 1, sun: 1, haze: 0.1 },
  high:  { top: '#0a2266', hz: '#86aee0', below: '#dde6f0', fog: '#bccfe6', fogN: 45, fogF: 380, hemiS: '#dfe9ff', hemiG: '#8b93a3', hemiI: 1.0, sunC: '#fff7ea', sunI: 1.8, band: 0.45, halo: 1, sun: 1, haze: 0.12 },
  storm: { top: '#9aa6b8', hz: '#d3d9e1', below: '#e1e5ea', fog: '#d5dbe3', fogN: 6, fogF: 36, hemiS: '#eef2f7', hemiG: '#a5adb8', hemiI: 1.3, sunC: '#eef2f8', sunI: 0.5, band: 0, halo: 0.08, sun: 0.1, haze: 1 },
  summit:{ top: '#030c36', hz: '#4f80cc', below: '#e6edf6', fog: '#c9d9ee', fogN: 90, fogF: 650, hemiS: '#e2eaff', hemiG: '#7d879a', hemiI: 0.95, sunC: '#fffaf0', sunI: 1.95, band: 0.6, halo: 1.3, sun: 1, haze: 0.06 },
};
for (const k in PAL) for (const n in PAL[k]) if (typeof PAL[k][n] === 'string') PAL[k][n] = new THREE.Color(PAL[k][n]);
const K = Object.fromEntries(Object.entries(PAL.low).map(([n, v]) => [n, v.isColor ? v.clone() : v]));
function blend(out, a, b, t) { for (const n in out) { if (out[n].isColor) out[n].copy(a[n]).lerp(b[n], t); else out[n] = mix(a[n], b[n], t); } }
function blendInto(out, b, t) { if (t <= 0) return; for (const n in out) { if (out[n].isColor) out[n].lerp(b[n], t); else out[n] = mix(out[n], b[n], t); } }

let S = null;   // 模块状态（build 填，update / rigFor 读）

// 地标所在的路段（按类型找，不写死步号）
function zonesOf(route) {
  const { segs, N } = route, su = segs.filter(g => g.kind === 'stairs_up'), waits = segs.filter(g => g.kind === 'wait');
  const wall = su[0] || null, ladder = su.length > 1 ? su[su.length - 1] : null, rocks = su.slice(1);
  const col = waits.find(w => w.start < N * 0.8) || null;
  const queue = [...waits].reverse().find(w => w.start >= N * 0.8 && w !== col) || null;
  const wi = wall ? segs.indexOf(wall) : -1, pre = wi > 0 && segs[wi - 1].kind === 'flat' ? segs[wi - 1] : null;
  const snowS = pre ? pre.start : wall ? wall.start : Math.round(N * 0.4);     // 雪线：前进营地（冰壁前那段平地）
  const glacier = segs.find(g => g.kind === 'up' && g.start < (pre || wall || { start: N }).start) || null;   // 东绒布冰川：前进营地之前的上坡（牦牛）
  const ci = col ? segs.indexOf(col) : -1, ridge = ci >= 0 ? segs.slice(ci + 1).find(g => g.kind === 'up') || null : null;   // 北山脊·大风口：北坳之后的上坡（直升机悬停）
  return { wall, ladder, rocks, col, queue, abc: pre, snowS, glacier, ridge, end: e => e.start + e.steps };
}

// ---------- 贴图 ----------
// 雪道：踩实的沟（中间略灰）+ 两排冰爪脚印（化身线 lat 0.35、影子线 lat −0.5，每步一个，左右脚交替）
function trailTexture(util, kit) {
  const t = util.canvasTexture(256, 256, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const L = (x / w - 0.5) * ROAD_W, bank = smooth(0.75, 1.05, Math.abs(L));
      let v = 0.9 + 0.1 * bank + 0.05 * kit.noise2(x * 0.06, y * 0.06) + 0.06 * (kit.hash2(x, y) - 0.5);
      const i = (y * w + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      im.data[i] = c * 0.97; im.data[i + 1] = c * 0.985; im.data[i + 2] = c; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const print = (L, v, a) => {                        // 一只冰爪印：椭圆压痕 + 10 个齿坑
      const cx = (0.5 + L / ROAD_W) * w, cy = (1 - v) * h;
      g.fillStyle = `rgba(40,60,90,${a})`; g.beginPath(); g.ellipse(cx, cy, 7, 30, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(20,35,60,${a * 1.6})`;
      for (let k = 0; k < 5; k++) for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * 4.5, cy - 24 + k * 12, 1.6, 0, Math.PI * 2); g.fill(); }
    };
    for (const [L, a] of [[0.35, 0.16], [-0.5, 0.1]]) { print(L + 0.1, 0.25, a); print(L - 0.1, 0.75, a); print(L + 0.1, 1.25, a); print(L - 0.1, -0.25, a); }
  }, { repeat: true });
  t.repeat.set(1 / ROAD_W, 1); t.offset.set(0.5, 0);
  return t;
}
function grainTexture(util, kit) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.93 + 0.08 * kit.noise2(x * 0.1, y * 0.1) + 0.1 * (kit.hash2(x, y) - 0.5), e = (x < 3 || y < 3 || x > w - 4 || y > h - 4) ? 0.78 : 1;
      const v = Math.max(0, Math.min(255, n * e * 255)), i = (y * w + x) * 4;
      im.data[i] = v * 0.97; im.data[i + 1] = v * 0.99; im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

export function pathMaterials(ctx) {
  const { util, kit } = ctx;
  ctx.theme.stairsRiser = 0.5;                          // 立面压暗：雪地里一级一级也看得出
  return {
    road: new THREE.MeshLambertMaterial({ color: '#ffffff', map: trailTexture(util, kit), vertexColors: true }),   // 顶点色在 build 里按路段给（碛石 → 雪）
    stairs: iceSheen(new THREE.MeshLambertMaterial({ color: '#ffffff', map: grainTexture(util, kit) }), 1, 'blue'),   // 冰壁那几级（偏蓝的）有冰面反光，岩台阶没有
  };
}

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M, world } = ctx, N = route.N, R = ctx.rand, Z = zonesOf(route), CZ = cliffZones(route);
  const c = kit.routeCenter(route);
  // 远处的珠峰：大本营开场看出去的方向（前 8 步的平均朝向）
  let hs = 0; const n8 = Math.min(8, N); for (let i = 0; i < n8; i++) hs += route.H[i]; const fwdA = n8 ? hs / n8 : 0;
  const aN = route.at(N), right = aN.left.clone().negate();
  const sunXZ = new THREE.Vector3(Math.cos(fwdA + 0.9), 0, Math.sin(fwdA + 0.9));   // 太阳在右前上方：台阶踏面亮、立面背光
  lights.sun.position.set(c.x + sunXZ.x * 30, 42, c.z + sunXZ.z * 30);
  const windDir = right.clone().multiplyScalar(-1).addScaledVector(aN.dir, -0.35);  // 西风：从右往左、略迎面
  kit.fog(scene, '#c6d6ea', 45, 380);

  const sky = buildSky(scene, ctx, { fwdA, sunXZ });

  // ---------- 地面：谷地（大本营 → 前进营地，两侧谷壁）→ 山体（雪线以上，两侧往下跌；顶峰金字塔更陡） ----------
  const ground = kit.terrain(ctx, { amp: 0, drop: 0, rough: 0, size: 210, seg: LOW ? 130 : 170, seed: 5 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cell = 210 / (LOW ? 130 : 170), inner = HW + cell + 0.35;
    const meta = new Float32Array(p.count * 3), P0 = route.P[0], PN = route.P[N], ax = PN.x - P0.x, az = PN.z - P0.z, L2 = ax * ax + az * az || 1;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z), d = nr.d, s = nr.s;
      const u = ((x - P0.x) * ax + (z - P0.z) * az) / L2 * N;                     // 沿路线总方向的平滑坐标（步）：分区按它过渡，离路远处不会因为最近点跳段而起一堵墙
      const n1 = kit.fbm(x * 0.045 + 3, z * 0.045, 4), n2 = kit.fbm(x * 0.2, z * 0.2 + 7, 3);
      const zs = mix(u, s, 1 - smooth(4, 12, d));
      const valley = 1 - smooth(Z.snowS - 1, Z.snowS + 9, zs), top = smooth(N - 10, N + 1, zs), near = smooth(inner, inner + 1.2, d);
      const col = Z.col ? 1 - smooth(1.5, 4.5, Math.abs(s - Z.col.start - 1)) : 0;      // 北坳是个鞍部：营地这一段两侧先平一阵再往下掉
      // 谷壁：离路 4–16 升起一道冰碛垄（≤ 2.6，比顶峰低：登顶回头看全在脚下），再往外落下去，别在远处留一整块平台
      const V = (nr.side > 0 ? 2.6 : 2.0) * smooth(4, 16, d) * (1 - smooth(26, 55, d)) * (0.5 + n1) - 6 * smooth(30, 70, d) + 0.7 * (n2 - 0.5) * smooth(2.5, 6, d);
      const drop = nr.side > 0 ? 3.2 * smooth(2.6, 9, d) + 17 * smooth(9, 48, d) : 4.2 * smooth(2.6, 9, d) + 27 * smooth(9, 52, d);
      const Mh = -drop * (0.75 + 0.5 * n1) * (1 + 0.45 * top) * (1 - 0.85 * col * (1 - smooth(6, 14, d))) + 1.3 * (n2 - 0.5) * smooth(2.6, 8, d) * (1 - col);
      p.setY(i, cliffGround(CZ, route, x, z, p.getY(i) + near * mix(Mh, V, valley)));   // 刀脊 / 横切两侧挖到坡面下面
      meta[i * 3] = zs; meta[i * 3 + 1] = d * (nr.side > 0 ? 1 : -1); meta[i * 3 + 2] = valley;
    }
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const nrm = g.attributes.normal, cc = new THREE.Color();
    const gravel = [new THREE.Color('#7b7368'), new THREE.Color('#8f877b'), new THREE.Color('#6a645c')], ice = new THREE.Color('#a9c2d4');
    const snow = new THREE.Color('#edf2f8'), snowB = new THREE.Color('#dde7f2'), rock = new THREE.Color('#4b4a4c'), rockL = new THREE.Color('#6e6a64');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = meta[i * 3], lat = meta[i * 3 + 1], valley = meta[i * 3 + 2], ny = nrm.getY(i);
      const n = kit.fbm(x * 0.11, z * 0.11, 3), n2 = kit.noise2(x * 0.5, z * 0.5);
      cc.copy(gravel[0]).lerp(gravel[1], smooth(0.4, 0.6, n)).lerp(gravel[2], smooth(0.6, 0.75, n2));
      if (lat < -3 && valley > 0.3) cc.lerp(ice, smooth(0.45, 0.62, n + 0.12) * smooth(3, 7, -lat) * valley);   // 右侧冰川面（冰塔林脚下）
      const cover = valley > 0.02 ? smooth(0.62, 0.72, n + 0.28 * (s / Math.max(1, Z.snowS)) + 0.35 * smooth(6, 30, Math.abs(lat)) + 0.25 * (1 - valley)) : 1;
      const sn = cc.clone().lerp(snow, 1).lerp(snowB, smooth(0.45, 0.7, n2) * 0.6);
      cc.lerp(sn, Math.max(cover, 1 - valley));
      const steep = smooth(0.8, 0.55, ny) * (1 - valley * 0.6) + smooth(0.72, 0.82, n + 0.3 * n2) * (1 - valley) * smooth(3, 8, Math.abs(lat)) * 0.8;
      cc.lerp(rock.clone().lerp(rockL, n2), Math.min(1, steep));                        // 陡坡、零星岩头：黑岩
      cc.multiplyScalar(0.94 + 0.08 * n2);
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true;
  }
  const hAt = util.gridHeight(ground);
  const CLF = buildCliff(scene, ctx, { C: CZ, ground, hAt });                  // 裂缝（地面挖洞）+ 横梯、刀脊坡面、横切岩壁、雾带、滚石

  // ---------- 路面：碛石 → 雪道（顶点色 × 冰爪印贴图）；台阶：冰壁 = 冰、之后 = 岩 ----------
  {
    const rg = M.road.geometry, uv = rg.attributes.uv, cols = new Float32Array(uv.count * 3), cc = new THREE.Color();
    const grav = new THREE.Color('#a39a8d'), trench = new THREE.Color('#dce4ee'), crest = new THREE.Color('#eef3f8');
    for (let i = 0; i < uv.count; i++) {
      const s = uv.getY(i) / STEP;
      cc.copy(grav).lerp(trench, smooth(Z.snowS - 2.5, Z.snowS + 0.5, s)).lerp(crest, smooth(N + 1.5, N + 4, s));
      cols.set([cc.r, cc.g, cc.b], i * 3);
    }
    rg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  if (M.stairs && M.stairIndex.length) {
    const iceT = new THREE.Color('#f1f6fb'), rockT = new THREE.Color('#948d82'), tmp = new THREE.Color();
    M.stairIndex.forEach((i, n) => {
      const isIce = Z.wall && i >= Z.wall.start && i < Z.end(Z.wall) || route.steps[i].kind === 'stairs_down';
      M.stairs.setColorAt(n, tmp.copy(isIce ? iceT : rockT).multiplyScalar(n % 2 ? 1 : 0.93));
    });
    M.stairs.instanceColor.needsUpdate = true;
  }
  shapeRoad(CZ, route, M.road);                                               // 刀脊 / 横切路面收窄，裂缝上那段挖掉
  // 给追兵 NPC（J，npc.js）用：路面半宽 [左, 右] + 横梯上该走哪条（化身 0.35 / 影子 −0.5 两道梯子）
  window.__fgRoad = st => { const w = CZ.hw(st); return { left: w[0], right: w[1], lane: CZ.xing && st > CZ.g0 - 0.6 && st < CZ.g1 + 0.6 ? -0.5 : null }; };
  const nose = stairNoses(ctx, SEG.stairs_up); if (nose) scene.add(nose);   // 美术范式：雪白台阶在雪地里认不出，每级前缘一条台阶黄
  const sfx = kit.stepFx(ctx, { dust: '#f4f8ff', flash: '#dff0ff' });       // 落阶反馈：雪地踩下去是雪沫
  for (const k of ['lines', 'edges', 'startLine', 'camp', 'flag']) if (M[k]) M[k].visible = false;
  for (const sg of M.signals) { sg.group.visible = false; sg.stop.visible = false; }   // 红灯 = 北坳歇脚 / 排队：不要车用信号灯

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  // 山下的营地（大本营 / 前进营地 / 北坳的帐篷、经幡、玛尼堆、碛石、冰塔林、大本营石）过了北坳往上就溶掉：
  //   路线压得太短，站在第二台阶回头能看见 20 个单位外的大本营帐篷，戳穿 8000 多米的感觉
  const revLow = { value: 1 }, hideLow = [], lowVc = revealable(new THREE.MeshLambertMaterial({ vertexColors: true }), revLow);
  const texts = [];
  const rightOf = (s, lat, h = 0) => { const a = route.at(s, lat); return a.pos.clone().setY(Math.max(hAt(a.pos.x, a.pos.z), route.heightAt(s) - 0.4) + h); };
  const clearOfRoad = (x, z, m) => util.offRoad(route, x, z, m);
  const clearH = lat => Math.abs(lat) < HW + 2 ? 1.5 : Math.abs(lat) < HW + 3 ? 2.4 : 99;   // 路两侧净空：离路沿 2 m 内 ≤ 1.5、3 m 内 ≤ 2.4（跟拍镜头左右各 3 m 看得见路）

  // ---------- 大本营：玛尼堆 + 经幡杆（路右 4.5）、帐篷群、大本营石 ----------
  const flagLines = [];
  {
    const pole = rightOf(0.6, -4.6), top = pole.clone().setY(pole.y + 4.6), P = [];
    P.push({ geo: new THREE.CylinderGeometry(0.05, 0.07, 4.8, 6), p: [pole.x, pole.y + 2.4, pole.z], color: '#8a6a44' });
    P.push({ geo: new THREE.BoxGeometry(1.5, 0.7, 1.5), p: [pole.x, pole.y + 0.3, pole.z], color: '#e9e5dc' });            // 玛尼堆底座（白灰）
    P.push({ geo: new THREE.CylinderGeometry(0.45, 0.62, 0.55, 8), p: [pole.x, pole.y + 0.9, pole.z], color: '#d8d2c6' });
    P.push({ geo: new THREE.ConeGeometry(0.3, 0.6, 8), p: [pole.x, pole.y + 1.45, pole.z], color: '#c9a64a' });
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283, r = 0.9 + 0.3 * R(); P.push({ geo: new THREE.IcosahedronGeometry(0.22 + 0.12 * R(), 0), p: [pole.x + Math.cos(a) * r, pole.y + 0.1, pole.z + Math.sin(a) * r], color: R() < 0.6 ? '#8d877d' : '#e6e2da' }); }
    // 从杆顶往四周拉到地上（避开路面那一侧）
    const aim = route.at(0.6), away = aim.left.clone().negate();
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9 - 0.5) * 2.6, dir = away.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang), L = 5.5 + 2 * R();
      const g = pole.clone().addScaledVector(dir, L); g.y = hAt(g.x, g.z) + 0.15;
      flagLines.push({ a: top.clone(), b: g, sag: 0.5, shift: k });
    }
    const pole2 = rightOf(3.2, 5.8), top2 = pole2.clone().setY(pole2.y + 4.0);
    P.push({ geo: new THREE.CylinderGeometry(0.05, 0.07, 4.2, 6), p: [pole2.x, pole2.y + 2.1, pole2.z], color: '#8a6a44' });
    // 左边那根也往四周斜拉到地上（评审 r1：别横跨路面拉成节日彩带）；靠路那几条落在路沿外 1 m，走过时照样被风抽
    for (const [ds, lt, k] of [[-2.6, 2.1, 2], [0, 2.0, 3], [2.6, 2.2, 4], [-2.2, 9.2, 0], [2.4, 9.6, 1]]) { const g = rightOf(3.2 + ds, lt, 0.15); flagLines.push({ a: top2.clone(), b: g, sag: 0.45, shift: k }); }
    const chorten = new THREE.Mesh(util.merged(P), lowVc); chorten.name = 'chorten'; scene.add(chorten); hideLow.push(chorten);
  }
  // 大本营村落（石碑、玛尼堆、餐厅大帐、大穹顶帐篷、停机坪、晾衣绳）：snow_summit/camp.js
  const tentGlow = { value: 0.06 }, glowVc = glowMaterial(revealable, revLow, tentGlow);   // 帐篷 / 大本营门窗：天暗了里面亮灯（update 里按风雪调）
  const CAMP = buildCamp(ctx, { hAt, rightOf, texts, glowMat: glowVc, Z, windDir, LOW });
  const smoke = LOW || !CAMP.smokeAt ? null : kit.particles(ctx, { color: '#7d7a76', alpha: 0.6, n: 90, gravity: -0.22, name: 'campSmoke' });   // 餐厅帐烟囱冒烟
  for (const m of CAMP.meshes) { scene.add(m); hideLow.push(m); }
  // 帐篷：大本营、前进营地、北坳营地；路右（影子那侧）多、路左少且在 3.5 以外
  const tents = [], bottles = [];
  const TC = ['#f2c21b', '#f2c21b', '#f2c21b', '#e8781c', '#d63b2a', '#2f8f4e'];   // 黄最多，其次橙 / 红 / 绿（考据 §3；蓝撞下坡蓝 / 捷风）
  const camp = (s0, s1, latR, latL, n, seedK, squash = 1) => {                  // squash < 1：被风压低的帐篷（北坳）
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const s = mix(s0, s1, R()), side = R() < 0.72 ? -1 : 1, lat = side * mix(...(side < 0 ? latR : latL), R()), a = route.at(s, lat);
      if (!clearOfRoad(a.pos.x, a.pos.z, 1.0) || tents.some(t => Math.hypot(t.p[0] - a.pos.x, t.p[2] - a.pos.z) < 1.9) || CAMP.blockers.some(b => Math.hypot(b.x - a.pos.x, b.z - a.pos.z) < b.r + 0.9)) continue;
      tents.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) - 0.02, a.pos.z], ry: -a.heading + (R() - 0.5) * 1.2 + (side < 0 ? Math.PI / 2 : -Math.PI / 2), s: (k => squash === 1 ? k : [k, k * squash, k * 1.08])(0.8 + 0.3 * R()), color: TC[(k + seedK) % TC.length] });
      k++;
    }
  };
  camp(-3, 3.5, [2.8, 12], [4, 11], LOW ? 7 : 12, 0);                        // 圆顶帐只在登山大本营（起点往前）；起点身后是游客营地（camp.js）
  if (Z.abc) camp(Z.abc.start - 2, Z.end(Z.abc) + 1, [2.6, 8], [4, 8], LOW ? 5 : 10, 2);
  if (Z.col) {
    camp(Z.col.start - 0.5, Z.col.start + 3.5, [2.4, 6], [4.2, 6], LOW ? 3 : 6, 4, 0.7);
    // 氧气瓶：一排立着 + 几个躺着，路右
    for (let k = 0; k < (LOW ? 6 : 10); k++) {
      const a = route.at(Z.col.start - 0.2 + k * 0.22, -1.75 - (k % 3) * 0.17), lie = k >= 7;
      bottles.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) + (lie ? 0.08 : 0), a.pos.z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(lie ? Math.PI / 2 : 0, -a.heading + R(), 0)), s: 1 });
    }
  }
  const tm = util.instanced(tentGeo(LOW), glowVc, tents); tm.name = 'tents'; scene.add(tm); hideLow.push(tm);
  if (bottles.length) { const bm = util.instanced(bottleGeo(util), lowVc, bottles); bm.name = 'oxygen'; scene.add(bm); hideLow.push(bm); }
  if (Z.abc) {                                                                // 前进营地一小串经幡
    const a = rightOf(Z.abc.start - 0.5, -3.2, 2.1), b = rightOf(Z.end(Z.abc) + 1.5, -3.6, 2.0);
    flagLines.push({ a, b, sag: 0.35, shift: 1 });
  }

  // ---------- 冰川：碛石 + 冰塔林（右侧），谷里零星冰塔（左侧远处） ----------
  const spires = [], boulders = [];
  //   评审 r1 #6 + 考据 §2 §9-6：冰川走过 35% 才有（大本营、冰川口看不到）；每座离路沿 ≥ 6（跟拍镜头在身后 5–6、高 2，左右留 3 m 以上）；高 ×2.5
  const sp0 = Z.glacier ? Z.glacier.start + 0.35 * Z.glacier.steps : 7;
  for (let k = 0, tries = 0; k < (LOW ? 30 : 55) && tries < 1500; tries++) {       // 冰塔林：只在右侧冰川面上，成片（噪声高处）
    const s = mix(sp0, Z.snowS - 0.5, R()), lat = -(HW + 6.2 + Math.pow(R(), 1.2) * 11), a = route.at(s, lat);
    if (kit.fbm(a.pos.x * 0.12 + 5, a.pos.z * 0.12, 3) < 0.5 || !clearOfRoad(a.pos.x, a.pos.z, 6.0)) continue;
    const hgt = 2.5 * (1.1 + 2.2 * R()) * (0.7 + 0.5 * smooth(7, 15, -lat));    // 离路越远越高（冰塔林往冰川中间越来越密越高）
    spires.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) - 0.15, a.pos.z], ry: R() * 6.28, s: [0.45 + 0.4 * R(), hgt, 0.45 + 0.4 * R()] }); k++;
  }
  if (spires.length) { const sm = util.instanced(spireGeo(3), iceSheen(revealable(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#10202c' }), revLow), 1), spires); sm.name = 'icePinnacles'; scene.add(sm); hideLow.push(sm); }
  const stones = [], crags = [];
  // 碛石：大本营 → 前进营地。一多半堆在冰川两侧的侧碛带里（随路弯弯曲曲）、一部分沿冰川中间一条中碛、剩下零散；大小是长尾（碎石多、大块少）
  for (let k = 0, tries = 0; k < (LOW ? 110 : 220) && tries < 1800; tries++) {
    const s = -12 + R() * (Z.snowS + 12), side = R() < 0.5 ? 1 : -1, mode = R();
    const lat = mode < 0.55 ? side * (4.2 + 3.2 * R() + 1.3 * Math.sin(s * 0.35 + side)) : mode < 0.8 ? -(7 + 1.6 * Math.sin(s * 0.22)) + (R() - 0.5) * 1.3 : side * (1.55 + Math.pow(R(), 1.6) * 12), a = route.at(s, lat);
    if (!clearOfRoad(a.pos.x, a.pos.z, 0.4)) continue;
    const sz = 0.06 + Math.pow(R(), 3) * 0.75;
    if (side > 0 && lat < 3 && sz > 0.45) continue;
    stones.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) + sz * 0.15, a.pos.z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)), s: [sz * (1 + R() * 0.7), sz * (0.55 + R() * 0.4), sz], color: new THREE.Color('#857d71').multiplyScalar(0.8 + 0.35 * R()) });
    k++;
  }
  for (let k = 0, tries = 0; k < (LOW ? 50 : 90) && tries < 1500; tries++) {                    // 雪线以上：零星积雪的岩头，离路远一点
    const s = Z.snowS + R() * (N - Z.snowS + 6), side = R() < 0.5 ? 1 : -1, lat = side * (2.1 + Math.pow(R(), 1.4) * 12), a = route.at(s, lat);
    if (!clearOfRoad(a.pos.x, a.pos.z, 0.9) || (s > N - 3 && Math.abs(lat) < 6)) continue;   // 顶峰半径内不放岩头（考据 §7：岩石不露）
    const sz = 0.15 + R() * R() * 0.6;
    if (side > 0 && lat < 3 && sz > 0.35) continue;
    crags.push({ p: [a.pos.x, hAt(a.pos.x, a.pos.z) + sz * 0.1, a.pos.z], ry: R() * 6.28, s: [sz * (1 + R() * 0.6), sz * (0.6 + R() * 0.5), sz], color: new THREE.Color().setScalar(0.85 + 0.3 * R()) });
    k++;
  }
  const stm = util.instanced(new THREE.IcosahedronGeometry(1, 0), revealable(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), revLow), stones); stm.name = 'moraine'; scene.add(stm); hideLow.push(stm);
  const crm = util.instanced(rockGeo('#5b5853', 2), vc, crags); crm.name = 'crags'; scene.add(crm);

  // ---------- 北坳冰壁：右侧冰塔（高）、左侧矮冰块；固定绳从冰壁一路拉到顶 ----------
  const ropeSway = { uT: { value: 0 }, uWind: { value: 1 }, uWD: { value: windDir.clone().setY(0).normalize() } };   // 路绳随风晃（update 里给风力）
  let ladderU = null;                                                          // 中国梯往下弯（下面梯子那段给）
  const seracs = [];
  if (Z.wall) {
    const s0 = Z.wall.start - 2, s1 = Z.end(Z.wall) - 0.4;              // 冰塔只沿冰壁：坳口（营地、氧气瓶）空出来
    for (let s = s0; s <= s1; s += 0.55) {
      // 冰块几何是 ±1 的多面体（顶面在 +0.85·tall）：p.y = 路面 + 露出高度 − 半高，扎进雪里
      // 净空（评审 r1）：路沿外 2 m 内不高于 1.5、跟拍视野左右 3 m 内不高于 2.4（镜头在身后 5–6、高 2）
      const put = (lat, w, up) => { up = Math.min(up, clearH(lat)); const a = route.at(s, lat), y0 = route.heightAt(s); seracs.push({ p: [a.pos.x, y0 + up - 1.15 * (up + 0.8) / 2, a.pos.z], ry: R() * 6.28, s: [w, (up + 0.8) / 2, w * (0.7 + 0.4 * R())] }); };
      put(-(2.0 + R() * 0.5), 0.45 + 0.35 * R(), (0.7 + 1.4 * R()) * smooth(s0, s0 + 2, s) + 0.2);
      if (R() < 0.45) put(-(3.0 + R() * 2.5), 0.55 + 0.4 * R(), 1.0 + 1.4 * R());
      if (R() < 0.5) put(1.7 + R() * 0.8, 0.3 + 0.25 * R(), 0.3 + 0.6 * R());   // 左侧 < 1.0
      if (R() < 0.35) put(3.8 + R() * 3, 0.6 + 0.5 * R(), 0.8 + 1.4 * R());
    }
    const sm = util.instanced(seracGeo(5), iceSheen(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#0e1c28' }), 1.2), seracs); sm.name = 'seracs'; scene.add(sm);
    const E = CZ.end, rr = [];                                                 // 路右沿外：镜头在左边，别从镜头底下穿过去
    let r0 = Z.wall.start - 1;
    if (CZ.xing) { rr.push([r0, CZ.g0 - 0.7]); r0 = CZ.g1 + 1.2; }                 // 横梯段断开（梯子两侧自己有扶手绳）
    if (CZ.knife) { rr.push([r0, CZ.knife.start - 6.4], [CZ.knife.start - 6, E(CZ.knife) - 0.4, { lat: -0.05, h: 0.3 }]); r0 = E(CZ.knife) + 0.2; }   // 刀脊：只剩脊上一根，贴着雪
    if (CZ.trav) { rr.push([r0, CZ.trav.start + 0.2, { lat: -1.2 }], [CZ.trav.start + 0.8, E(CZ.trav) - 0.2, { lat: -0.78, h: 1.0 }]); r0 = E(CZ.trav) + 0.2; }   // 横切：拉在岩壁那侧、手扶高度
    rr.push([r0, N - 4]);
    for (const m of fixedRope(ctx, rr, { lat: -1.5, every: 2, sway: ropeSway })) scene.add(m);
  }
  // 冰裂缝：北坳上下两侧的雪坡上（不压帐篷、冰塔、停机坪，彼此隔开），横着坡走向（和路大致垂直）、贴着地面斜度；离路 ≥ 1.1
  {
    const cr = [], nrm = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), s0 = Z.snowS + 2, s1 = Z.col ? Z.col.start + 5 : Z.snowS + 10;
    for (let k = 0, tries = 0; k < (LOW ? 8 : 16) && tries < 900; tries++) {
      const s = mix(s0, s1, R()), side = R() < 0.5 ? 1 : -1, lat = side * (2.6 + Math.pow(R(), 1.4) * 6.5), a = route.at(s, lat);
      const far = (arr, r) => !arr.some(t => Math.hypot((t.p ? t.p[0] : t.x) - a.pos.x, (t.p ? t.p[2] : t.z) - a.pos.z) < r + (t.r || 0));
      if (!clearOfRoad(a.pos.x, a.pos.z, 1.1) || !far(tents, 2.6) || !far(seracs, 1.4) || !far(CAMP.blockers, 1.0) || !far(cr, 2.6) || (CZ.xing && Math.abs(s - CZ.sc) < 4 + Math.abs(lat) * 0.6)) continue;   // 路绕回来时别落到停机坪边上；彼此隔开，不叠成一簇
      const x = a.pos.x, z = a.pos.z, e = 0.4, h0 = hAt(x, z);
      nrm.set(hAt(x - e, z) - hAt(x + e, z), 2 * e, hAt(x, z - e) - hAt(x, z + e)).normalize();
      qa.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm); qb.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a.heading + Math.PI / 2 + (R() - 0.5) * 0.6);
      cr.push({ p: [x, h0 + 0.03, z], q: qa.clone().multiply(qb), s: [2.2 + 3.2 * R(), 1, 0.26 + 0.34 * R()] }); k++;
    }
    const cm = util.instanced(crevasseGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), cr);
    cm.name = 'crevasses'; scene.add(cm);
  }

  // ---------- 岩石台阶（第一 / 第二台阶）：两侧一堆扎进地里的岩块（第一台阶偏黄 = 黄带那种石灰岩），左侧 3 以内 ≤ 1.2；
  //   岩顶都压在顶峰高度以下（登顶环绕镜头看下去是山体，不是比顶峰还高的石塔）；最后一段上台阶铺铝梯 ----------
  const revRock = { value: 0 }, revTop = { value: 0 }, hideRock = [], hideTop = [];   // 溶解到 0 时整个藏起来：光影线的阴影不会给还没露面的东西投影
  const blocks = [[], []], hTop = route.heightAt(N);
  for (const sg of Z.rocks) {
    const yel = sg !== Z.ladder ? 1 : 0;
    for (let s = sg.start - 1.4; s <= Z.end(sg) + 0.5; s += 0.42) {
      const y0 = route.heightAt(s), cap = hTop + 0.25 - y0;
      for (const side of [1, -1]) for (const far of [0, 1]) {
        if (far && R() < 0.55) continue;
        const lat = side * (far ? 2.4 + R() * 2.8 : 1.55 + R() * 0.45), a = route.at(s + (R() - 0.5) * 0.3, lat);
        if (CZ.wK(s) > 0.05 || (side > 0 && CZ.wT(s) > 0.05) || (CZ.knife && far && side > 0 && sg !== Z.ladder) || (CZ.trav && side > 0 && s < CZ.end(CZ.trav) + 2.5)) continue;   // 刀脊 / 横切的深渊那侧不摆（第一台阶左边远处的也不要：挡住刀脊左边的深渊）
        const up = Math.min(cap, side > 0 && !far ? 0.3 + 0.6 * R() : 0.4 + 0.8 * R()), deep = 2.4 + R();
        const w = far ? 0.55 + 0.5 * R() : 0.4 + 0.3 * R();
        blocks[yel].push({ p: [a.pos.x, y0 + (up - deep) / 2, a.pos.z], ry: R() * 6.28, s: [w, (up + deep) / 2, w * (0.7 + 0.4 * R())], color: new THREE.Color().setScalar(0.8 + 0.35 * R()) });
      }
    }
  }
  const rockMat = revealable(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), revRock);
  [rockGeo('#4f4c49', 7), rockGeo('#7a6d5a', 9)].forEach((g, k) => { if (!blocks[k].length) return; const m = util.instanced(g, rockMat, blocks[k]); m.name = 'rockStep'; scene.add(m); hideRock.push(m); });
  if (Z.ladder) {
    const lmat = revealable(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a4450' }), revRock), lbase = lmat.onBeforeCompile;
    // 踩上去梯子往下弯一点：以脚下为中心的一个凹（两头梯脚 / 梯顶不动），每上一级再弹一下
    const a0 = route.at(Z.ladder.start - 0.35, 0.35).pos, a1 = route.at(Z.end(Z.ladder), 0.35).pos, ld = a1.clone().sub(a0).setY(0);
    ladderU = { uP0: { value: new THREE.Vector2(a0.x, a0.z) }, uDir: { value: new THREE.Vector2(ld.x, ld.z).normalize() }, uLen: { value: ld.length() }, uFoot: { value: -10 }, uDip: { value: 0 } };
    lmat.onBeforeCompile = sh => {
      lbase(sh); Object.assign(sh.uniforms, ladderU);
      sh.vertexShader = 'uniform vec2 uP0, uDir; uniform float uLen, uFoot, uDip;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float d = dot(transformed.xz - uP0, uDir), x = (d - uFoot) / 0.7;
          transformed.y -= uDip * sin(3.14159 * clamp(d / uLen, 0.0, 1.0)) * exp(-x * x); }`);
    };
    lmat.customProgramCacheKey = () => 'snowRevLadder';
    const lm = new THREE.Mesh(util.merged([...ladderParts(ctx, Z.ladder, { lat: 0.35 }), ...ladderParts(ctx, Z.ladder, { lat: -0.3, width: 0.5 })]), lmat);   // 两副并排（考据 §6：现役 1–2 副；影子走右边那副）
    lm.name = 'ladder'; scene.add(lm); hideRock.push(lm);
  }

  // ---------- 顶峰：红色测量觇标 + 经幡；雪檐 ----------
  const bcnS = N + 3.0, bcn = route.at(bcnS, -0.85), bcnPos = bcn.pos.clone().setY(route.heightAt(N));
  let summitFlags = null, BF = null;
  {
    const m = new THREE.Mesh(util.merged(beaconParts()), revealable(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2a0806' }), revTop));
    m.position.copy(bcnPos); m.rotation.y = -bcn.heading; m.name = 'surveyBeacon'; scene.add(m); hideTop.push(m);
    BF = beaconFlag(); BF.mesh.position.copy(bcnPos).setY(bcnPos.y + 1.64); BF.mesh.rotation.y = Math.atan2(-windDir.z, windDir.x);   // 顺着西风往下风展开
    scene.add(BF.mesh); hideTop.push(BF.mesh);
    // 经幡从觇标顶往前方 / 右侧拉到雪里（按路线方向摆，不按世界角度）；经过化身、影子登顶站位 0.7 以内的绳不要
    const top = bcnPos.clone().setY(bcnPos.y + 1.7), lines = [];
    const spots = [route.at(N + 1.2, 0.35).pos, route.at(N + 1.4, -0.5).pos], near = (a, b) => {
      for (let f = 0; f <= 1.001; f += 0.1) { const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f; if (spots.some(q => Math.hypot(q.x - x, q.z - z) < 0.7)) return true; }
      return false;
    };
    for (const [ds, lat] of [[3.2, -0.9], [5.5, -0.4], [4.6, -2.6], [2.2, -3.4], [0.2, -3.0], [5.0, 1.6], [3.0, -1.9]]) {
      const g = route.at(bcnS + ds, -0.85 + lat).pos;
      if (near(top, g)) continue;
      g.y = Math.max(hAt(g.x, g.z), route.heightAt(N) - 1.2) + 0.1;
      lines.push({ a: top, b: g, sag: 0.25, shift: lines.length });
    }
    const TF = prayerFlags(ctx, lines, { cap: LOW ? 60 : 120, rev: revTop });
    for (const m of TF.meshes) scene.add(m);
    hideTop.push(...TF.meshes); summitFlags = TF.U;
  }
  const PF = prayerFlags(ctx, flagLines, { cap: LOW ? 220 : 520, rev: revLow });
  for (const m of PF.meshes) scene.add(m);
  hideLow.push(...PF.meshes);

  // ---------- 排队的人影（最后那段红灯 → 顶峰），数量有上限 ----------
  let people = null;
  if (Z.queue) {
    // 登山者：一个 InstancedMesh（climber_model.js），羽绒服 / 背包颜色、跺脚 / 搓手 / 抬头 / 走都是实例属性
    const n = LOW ? 3 : 4, geos = [0, 1, 2].map(l => climberGeo(l)), geo = geos[0], CM = climberMaterials(revealable, revTop);   // LOD 三级：离镜头最近那人 < 10 全细节、< 24 中、再远粗
    // 评审 r1 #2（盖过美术范式 §10.6 的低饱和）：8000 m 以上的连体羽绒 红 / 黄 / 黑 / 橙（考据 §6：红 45%、黄橙 35%、黑 15%）；不用钴蓝 / 紫
    const SUIT = ['#c8352b', '#e2a922', '#1e2024', '#e0701f'], PK = ['#2b2f36', '#3a3c40', '#5a5040', '#40464e'];
    const suitA = new Float32Array(n * 3), packA = new Float32Array(n * 3), anim = new Float32Array(n * 4), c = new THREE.Color();
    for (let k = 0; k < n; k++) { suitA.set(c.set(SUIT[k]).toArray(), k * 3); packA.set(c.set(PK[k]).toArray(), k * 3); }
    const aSuit = new THREE.InstancedBufferAttribute(suitA, 3), aPk = new THREE.InstancedBufferAttribute(packA, 3), aAnim = new THREE.InstancedBufferAttribute(anim, 4);
    for (const gg of geos) { gg.setAttribute('aSuit', aSuit); gg.setAttribute('aPack', aPk); gg.setAttribute('aAnim', aAnim); }
    const sm = new THREE.InstancedMesh(geo, CM.mat, n); sm.customDepthMaterial = CM.depth;
    sm.frustumCulled = false; sm.name = 'queue'; scene.add(sm); hideTop.push(sm);
    const q0 = Z.queue.start;
    people = { sm, n, anim, aAnim, geos, lod: 0, ph: Array.from({ length: n }, (_, k) => k * 1.7), wk: new Array(n).fill(0), rb: new Array(n).fill(0), lk: new Array(n).fill(0), ps: new Array(n).fill(null), s: Array.from({ length: n }, (_, k) => q0 + 1.2 + k * 1.8), lat: Array.from({ length: n }, (_, k) => 0.15 + 0.4 * (k % 2)),
      red: k => q0 + 1.2 + k * 1.8, go: k => N + 4 + k * 1.1, sig: M.signals.find(g => g.seg.start === q0), wt: 0, aside: false, asideS: 0 };   // 间距 1.8 步（2.0 时第 4 个人站到顶峰外、被「翻过去」藏掉）
    people.cl = people.lat.slice();                                          // 当前横向位置（让路时往右挪）
  }

  // ---------- 文字（大本营石） ----------
  const signs = util.textSigns(texts, { size: 96 }); signs.name = 'signs'; revealable(signs.material, revLow); scene.add(signs); hideLow.push(signs);

  // ---------- 化身 / 影子：雪地上影子用深一点的蓝 + 深色描边，白底上才看得见 ----------
  ctx.theme.avatar = { leg: '#262b34', body: '#d2342a', head: '#e8ecf0', exo: '#ffb03a', rim: '#fff0da', rimK: 0.55, self: 0.12 };
  ctx.theme.ghost = ctx.theme.ghost || WHO.ghost.bright;                     // 美术范式：雪地里影子用深青（不用蓝：撞捷风、撞下坡）
  ctx.theme.ghostOpacity = ctx.theme.ghostOpacity || 0.55;
  if (ctx.theme.ghostRim === undefined) ctx.theme.ghostRim = '#063f3a';

  // ---------- 镜头 ----------
  const rig = ctx.camRig;
  // 登顶：镜头从化身左前方起（face 取右后方），看得见峰哥的脸；影子（右边 0.85）和觇标（右前）都错开在化身右侧，不被挡；
  //   停 1.2 s 再慢慢转
  Object.assign(rig.summit, { radius: 4.2, height: 1.8, lookY: 1.3, speed: 0.2, hold: 1.2, face: route.at(N + 1.2 - 4.8, 0.35 - 2.4).pos.setY(route.heightAt(N) + 1.2) });
  const snowFx = buildSnow(scene, { count: LOW ? 800 : 2600, windDir });
  const hyp = makeHypoxia({ blur: !LOW });

  ctx.theme.summitCard = 'left';                                              // 化身 + 觇标在画面正中，登顶卡放左下
  S = { ctx, sky, snow: snowFx, hyp, flags: [PF.U, summitFlags].filter(Boolean), people, Z, route, lights, scene, summitK: 0, sfx, anchors: camAnchors(Z, N, CZ),
    I: buildInteract(scene, ctx, { flagLines, BF, windDir }), tentGlow, smoke, smokeAt: CAMP.smokeAt, smokeT: 0, ropeSway, ladderU, flagT: 0, ldK: 0, ldStep: null,
    heli: buildHeli(ctx, { Z, pad: CAMP.pad, LOW, onTouchdown: () => fgSay('heli') }),
    yaks: LOW ? null : buildYaks(ctx, { Z, hAt, onYield: () => fgSay('yak') }),
    a0: world.alt ? +world.alt[0] : 0, a1: world.alt ? +world.alt[1] : 0, revRock, revTop, revLow, hideRock, hideTop, hideLow,
    rockS: Z.rocks.length ? Z.rocks[0].start : N, topS: Z.queue ? Z.queue.start : N - 4, CZ, CL: CLF, CX: makeCliffState(), fovK: 0, windDir, frames: 0, sd: spindrift(scene, { n: LOW ? 60 : 150 }), sdK: 0, confetti: null };
  if (S.yaks) hideLow.push(...S.yaks.meshes);                                 // 牦牛跟山下的东西一起：过了北坳就不画
  rigFor(0, rig, false);
  update(0, { t: 0, s: 0, progress: 0, summit: false, preview: ctx.preview, camera: ctx.camera, kind: 'flat', terrain: null });
}

// ---------- 镜头：按地标插值 ----------
const CAM = {
  open:  { back: 6.2, side: 1.0, height: 2.1, lookY: 1.9, clear: 1.7 },   // 大本营：经幡 + 远处北壁
  walk:  { back: 4.8, side: 1.3, height: 2.0, lookY: 1.35, clear: 1.7 },
  wall:  { back: 4.2, side: 1.0, height: 1.35, lookY: 1.95, clear: 1.25 }, // 冰壁：低机位仰拍
  col:   { back: 5.0, side: 1.5, height: 2.3, lookY: 1.15, clear: 1.7 },  // 北坳：看右边的帐篷和氧气瓶
  ridge: { back: 4.6, side: 1.3, height: 2.2, lookY: 1.3, clear: 1.7 },
  rock:  { back: 4.0, side: 0.9, height: 1.25, lookY: 2.05, clear: 1.2 }, // 台阶：低机位，梯子和岩壁
  queue: { back: 4.6, side: 1.05, height: 1.45, lookY: 2.2, clear: 1.3 }, // 排队：低机位，看见梯子上和坡上的人
  xing:  { back: 2.5, side: 1.35, height: 1.0, lookY: -0.55, clear: 0.55 }, // 横梯：压到腰高、偏外，低头看脚下的裂缝（往下看得见深蓝 → 黑）
  edge:  { back: 2.9, side: 0.8, height: 1.2, lookY: 0.7, clear: 0.9, fov: 1 },    // 刀脊 / 横切：1.2 m 高、往外 0.8（悬在深渊上）、略低头看得见脚下，FOV +8°
};
function camAnchors(Z, N, CZ) {
  const A = [[-1e9, CAM.open], [1.5, CAM.open], [4.5, CAM.walk]], X = CZ || {};
  if (Z.wall) A.push([Z.wall.start - 2, CAM.walk], [Z.wall.start, CAM.wall], [Z.end(Z.wall) - 0.3, CAM.wall]);
  if (X.xing) A.push([X.g0 - 0.2, CAM.xing], [X.g1 + 0.4, CAM.xing]);
  if (Z.col) A.push([Z.col.start + (X.xing ? 1.2 : 0.2), CAM.col], [Z.col.start + 1.4, CAM.col], [Z.col.start + 3.2, CAM.ridge]);
  else if (Z.wall) A.push([Z.end(Z.wall) + 2, CAM.ridge]);
  if (X.knife) A.push([X.knife.start - 4, CAM.ridge], [X.knife.start - 1.5, CAM.edge], [X.end(X.knife) - 0.3, CAM.edge]);
  if (X.trav) A.push([X.trav.start + 0.8, CAM.edge], [X.end(X.trav) - 1.2, CAM.edge]);
  const q = Z.queue, rs = Z.rocks.length ? Z.rocks[0].start : null, re = Z.rocks.length ? Z.end(Z.rocks[Z.rocks.length - 1]) : null;
  const qIn = q && rs !== null && q.start >= rs && q.start <= re;           // 排队在台阶之间（第二台阶下）
  if (rs !== null) {
    if (X.knife) A.push([rs + 0.4, CAM.rock]);                              // 刀脊直接接第一台阶：不回 ridge
    else A.push([rs - 2.4, CAM.ridge], [rs - 0.4, CAM.rock]);
    if (qIn) A.push([q.start - 0.3, CAM.queue], [q.start + 0.7, CAM.queue], [q.start + 1.4, CAM.rock]);
    A.push([re + 0.2, CAM.rock]);
  }
  if (q && !qIn) A.push([q.start - 1.4, CAM.queue], [q.start + 0.8, CAM.queue]);
  A.sort((a, b) => a[0] - b[0]);
  const out = A.filter((a, i) => i === 0 || a[0] > A[i - 1][0] + 1e-6);
  out.push([1e9, out[out.length - 1][1]]);
  return out;
}
export function rigFor(s, r, summit) {
  if (summit || !r || !S) return;
  const A = S.anchors, F = r.follow;
  let i = 0; while (i < A.length - 2 && s > A[i + 1][0]) i++;
  const [sa, pa] = A[i], [sb, pb] = A[i + 1], t = smooth(sa, sb, s);
  for (const k of ['back', 'side', 'height', 'lookY', 'clear']) F[k] = mix(pa[k], pb[k], t);
  S.fovK = mix(pa.fov || 0, pb.fov || 0, t);                                   // 刀脊 / 横切 FOV +8°（cliff.js 每帧套上）
  F.backStairs = F.back; F.sideStairs = F.side;
  F.upBonus = 0; F.stairsBonus = 0; F.lookUp = 0; F.footMin = -0.8;
}

// ---------- 每帧 ----------
const _c = new THREE.Vector3(), _mid = new THREE.Vector3(), _head = new THREE.Vector3(), _sc = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m4 = new THREE.Matrix4(), _t = new THREE.Vector3(), _u = new THREE.Vector3();
// 「藏」= 缩成一个点（退化三角形，不出片元、不投影），不用 visible = false：还在绘制列表里，第一帧就把着色器 / 管线建好
//   （ANGLE / Metal 在第一次绘制时才建管线，隐藏的东西第一次露面那帧会卡 0.2 s）；缩成点后包围球也缩了，关掉视锥裁剪保证照画
//   前两帧画过之后管线已经建好：改成直接 visible = false（连这次绘制也省了）
export function show(m, on) {
  const warm = !!S && S.frames > 2;
  if (m.userData.on === on && m.userData.warm === warm) return;
  if (m.userData.fc === undefined) { m.userData.fc = m.frustumCulled; m.userData.s0 = m.scale.clone(); }   // 记下原来的缩放（有的石头 build 里就缩放过）
  m.userData.on = on; m.userData.warm = warm;
  if (warm) { m.scale.copy(m.userData.s0); m.frustumCulled = m.userData.fc; m.visible = on; return; }
  if (on) m.scale.copy(m.userData.s0); else m.scale.setScalar(1e-6); m.frustumCulled = on && m.userData.fc;
}
const _A = {};
// 点 p 到线段 ab 的距离
function segDist(p, a, b) { _t.subVectors(b, a); _u.subVectors(p, a); const u = Math.max(0, Math.min(1, _t.dot(_u) / (_t.lengthSq() || 1))); return p.distanceTo(_t.multiplyScalar(u).add(a)); }
export function update(dt, st) {
  if (!S) return;
  if (st.t > 0) S.frames++;
  S.sfx.update(dt, st);
  const { route, Z } = S, N = route.N, p = Math.max(0, Math.min(1, st.s / N));
  S.summitK = st.summit ? (st.preview ? 1 : Math.min(1, S.summitK + dt * 0.8)) : Math.max(0, S.summitK - dt * 2);
  const sk = S.summitK * S.summitK * (3 - 2 * S.summitK);
  // 天气：进度 → 低处晴 / 高处晴；北坳往上起风雪，排队处转晴；登顶云海 + 蓝黑天
  const storm = smooth(0.42, 0.58, p) * (1 - smooth(0.9, 0.985, p)) * (1 - sk);
  blend(K, PAL.low, PAL.high, smooth(0.25, 1, p));
  blendInto(K, PAL.storm, storm);
  blendInto(K, PAL.summit, sk);
  const clr = Math.max(S.CZ.wK(st.s), S.CZ.wT(st.s)) * (1 - sk);                 // 刀脊 / 横切：雾拉开，看得见脚下的深渊和下面的雾带
  K.fogN = mix(K.fogN, 14, clr); K.fogF = mix(K.fogF, 130, clr);
  const fog = S.scene.fog;
  fog.color.copy(K.fog); fog.near = K.fogN; fog.far = K.fogF;
  S.scene.background.copy(K.fog);
  S.lights.hemi.color.copy(K.hemiS); S.lights.hemi.groundColor.copy(K.hemiG); S.lights.hemi.intensity = K.hemiI;
  S.lights.sun.color.copy(K.sunC); S.lights.sun.intensity = K.sunI;
  S.sky.apply({ top: K.top, hz: K.hz, below: K.below, band: K.band, halo: K.halo, sun: K.sun, haze: K.haze,
    sink: 48 * Math.max(smooth(0.08, 1, p), sk), cloud: Math.max(smooth(0.38, 0.62, p), sk), everest: (1 - smooth(0.3, 0.46, p)) * (1 - sk) }, st.t || 0);
  const vh = S.ctx.renderer.domElement.clientHeight || innerHeight;
  // 雪：风雪强度 + 越高越密；大风口（北坳后的上坡）贴地吹雪（?fx=low 不要）
  const R_ = Z.ridge, R2 = S.CZ.knife && R_ && S.CZ.knife.start >= R_.start ? S.CZ.knife : R_, rz = R_ ? smooth(R_.start - 1, R_.start + 1, st.s) * (1 - smooth(Z.end(R2), Z.end(R2) + 2, st.s)) : 0;   // 北山脊 → 刀脊
  S.snow.update(st.t || 0, st.dt || dt || 0, Math.min(1, storm * (LOW ? 0.7 : 1) + (0.12 * smooth(0.3, 0.42, p) + 0.3 * smooth(0.55, 0.9, p)) * (1 - sk)), st.camera, vh,
    LOW ? 0 : rz * (0.45 + 0.55 * storm) * (1 - sk), route.heightAt(st.s));
  // 风力分级：大本营微风 → 前进营地起风 → 北山脊风雪里大风（旗被扯平）；再叠一点阵风。旗的抖动频率也跟着风走（相位按帧累加，不跳）
  const t0 = st.t || 0, wind = (0.55 + 0.9 * smooth(0.02, 0.45, p) + 1.6 * storm) * (1 + 0.25 * Math.sin(t0 * 0.7) * Math.sin(t0 * 1.9 + 1)) * (1 - 0.3 * sk);
  S.flagT = (S.flagT + dt * (0.5 + 0.55 * wind)) % 1000;
  for (const f of S.flags) { f.uT.value = S.flagT; f.uWind.value = wind; }
  S.ropeSway.uT.value = S.flagT; S.ropeSway.uWind.value = wind;
  if (S.ladderU && S.Z.ladder) {                                                  // 梯子：人在梯上往下弯，每上一级弹一下
    const L = S.Z.ladder, on = !st.summit && st.s > L.start - 0.3 && st.s < L.start + L.steps + 0.2, k = Math.floor(st.s);
    if (on && S.ldStep !== null && k !== S.ldStep) S.ldK = 1;
    S.ldStep = k; S.ldK = Math.max(0, S.ldK - dt * 3);
    const U = S.ladderU; U.uDip.value += ((on ? 0.05 + 0.04 * S.ldK : 0) - U.uDip.value) * Math.min(1, dt * 8);
    if (st.avatar) U.uFoot.value = (st.avatar.x - U.uP0.value.x) * U.uDir.value.x + (st.avatar.z - U.uP0.value.y) * U.uDir.value.y;
  }
  S.revRock.value = st.summit ? 1 : smooth(S.rockS - 18, S.rockS - 12, st.s);    // 走到才露面：离地标 6–9 个单位开始显出来
  S.revTop.value = st.summit ? 1 : smooth(S.topS - 18, S.topS - 12, st.s);
  for (const m of S.hideRock) show(m, S.revRock.value > 0.001);
  for (const m of S.hideTop) show(m, S.revTop.value > 0.001);
  S.revLow.value = st.summit ? 0 : 1 - smooth(S.Z.snowS + 11, S.Z.snowS + 16, st.s);
  for (const m of S.hideLow) show(m, S.revLow.value > 0.001);
  // 缺氧：按海拔（world.alt 插值），登顶那几秒松一口气
  const alt = S.a0 + (S.a1 - S.a0) * route.heightAt(st.s) / route.hmax;
  S.tentGlow.value = 0.06 + 0.85 * storm;                                       // 风雪一起，帐篷里的灯透出来
  if (S.smoke && st.s < 24) { if ((S.smokeT -= dt) <= 0) { S.smokeT = 0.12; S.smoke.burst(S.smokeAt.x, S.smokeAt.y, S.smokeAt.z, 0.22, 1, { up: 2.6, life: 3.4, size: 3.4, spread: 0.04, floor: false }); } S.smoke.update(dt, st.camera); }
  S.heli.update(dt, st);
  if (S.yaks) S.yaks.update(dt, st);
  const oxy = interact(dt, st);                                                     // 互动；北坳吸上氧，缺氧暗角松一点
  const hypK = Math.pow(smooth(5300, 8849, alt), 1.1) * (1 - 0.25 * sk) * (1 - 0.45 * oxy);
  S.hyp.update(hypK, st.t || 0);
  (S.snd ||= makeSoundscape(S.ctx.kit)).update(Object.assign(st, { alt, hyp: hypK }));   // 声景（M2：风 / 脚步 / 路绳 / 喘气 / 营地）
  // 排队的人：红灯时站成一串（梯子上 + 坡上）；放行 / 登顶后往上走，翻过顶峰就不见了（登顶画面干净）；
  //   始终在化身前面；挡在镜头和化身之间（正面镜头）或贴着镜头的藏起来
  const P = S.people;
  if (P) {
    const go = st.summit || (P.sig && P.sig.state === 'green'), A = _A, q0 = Z.queue.start;
    _head.copy(st.avatar || _c).y += 1.1;
    if (st.s < q0 - 2 || st.summit) { P.wt = 0; P.aside = false; }                      // 新一圈 / 登顶：重新排好
    if (!go && st.s > q0 - 0.5 && st.s < q0 + 1) P.wt += dt;                             // 站在队尾等：前面的人从上往下一个个往上挪（每人 2 小步）
    if (go && !P.aside && !st.summit && st.s > q0 - 0.5 && st.s < q0 + 1.5) { P.aside = true; P.asideS = P.s[0]; fgSay('queue'); }   // 轮到你：最前面那个人往右让一步
    for (let k = 0; k < P.n; k++) {
      const aside = k === 0 && P.aside, hop = Math.max(0, Math.min(2, Math.floor((P.wt - 0.15 - (P.n - 1 - k) * 0.3) / 1.3) + 1));
      const floor = aside ? -1e9 : st.s + 1.1 + k * 1.8, want = aside ? P.asideS : Math.max(go ? P.go(k) : P.red(k) + 0.55 * hop, floor);
      // 往前走限速（慢慢挪上梯子）；但永远在化身前面（硬约束，走得快的人不会穿过去）；不往回走：新一圈直接回到排队位置；让路的人站住不动
      P.s[k] = st.preview || (want < P.s[k] - 0.5 && !aside) ? want : Math.max(floor, P.s[k] + Math.min(dt * 1.2, want - P.s[k]));
      const lt = aside ? -1.3 : P.lat[k];
      P.cl[k] = st.preview ? lt : P.cl[k] + Math.sign(lt - P.cl[k]) * Math.min(Math.abs(lt - P.cl[k]), dt * 2.2);
      route.at(P.s[k], P.cl[k], A);
      const y = route.heightAt(P.s[k]), lean = 0.12 + 0.03 * Math.sin((st.t || 0) * 1.7 + k);
      _q.setFromEuler(_e.set(0, -A.heading, -lean, 'YXZ'));
      _c.copy(A.pos).setY(y);
      _mid.copy(_c).setY(y + 0.8);
      const gone = 1 - smooth(N + 1.6, N + 2.6, P.s[k]);
      const block = st.camera && (st.camera.position.distanceTo(_mid) < 1.2 || segDist(_mid, st.camera.position, _head) < 0.42);
      _sc.setScalar(block ? 0 : 0.95 * gone);
      _m4.compose(_c, _q, _sc); P.sm.setMatrixAt(k, _m4);
      // 小动作：走 = 按实际挪动的速度；站着的时候每人轮着跺脚 / 搓手 / 抬头看梯子（各人错开）
      const v = P.ps[k] === null || dt <= 0 ? 0 : Math.abs(P.s[k] - P.ps[k]) / dt; P.ps[k] = P.s[k];
      const mode = Math.floor(((st.t || 0) * 0.22 + k * 0.61) % 3), fz = Math.min(1, dt * 3);
      P.wk[k] += ((st.preview ? 0 : Math.min(1, v * 1.5)) - P.wk[k]) * fz;
      P.rb[k] += ((mode === 1 ? 1 : 0) * (1 - P.wk[k]) - P.rb[k]) * fz; P.lk[k] += ((mode === 2 ? 1 : 0) * (1 - P.wk[k]) - P.lk[k]) * fz;
      P.ph[k] += dt * (3 + 4 * P.wk[k]);
      P.anim.set([P.ph[k], P.wk[k], P.rb[k], P.lk[k]], k * 4);
    }
    P.sm.instanceMatrix.needsUpdate = true; P.aAnim.needsUpdate = true;
    if (st.camera) {                                                               // LOD：按离镜头最近那人算，带回差
      let dmin = 1e9; for (let k = 0; k < P.n; k++) { route.at(P.s[k], P.cl[k], A); dmin = Math.min(dmin, st.camera.position.distanceTo(A.pos)); }
      const want = dmin < (P.lod === 0 ? 11 : 9) ? 0 : dmin < (P.lod === 1 ? 26 : 22) ? 1 : 2;
      if (want !== P.lod) { P.lod = want; P.sm.geometry = P.geos[want]; }
    }
  }
  // 登顶：引擎的彩纸（fx.js，一团 360 粒的 Points）在雪山里藏掉，换成风吹雪烟（评审 r1 #8）
  if (S.confetti === null && st.t > 0) S.confetti = S.scene.children.find(o => o.isPoints && o.material && o.material.isPointsMaterial && o.geometry.attributes.position.count === 360) || 0;
  if (S.confetti && st.summit) S.confetti.visible = false;
  S.sdK += ((st.summit ? 1 : 0) - S.sdK) * Math.min(1, dt * (st.summit ? 1.5 : 3));
  S.sd.update(st.t || 0, S.sdK, st.camera, vh); S.sd.mesh.visible = S.sdK > 0.01 || S.frames <= 2;
  if (S.CL) updateCliff(S.CL, S.CX, dt, st, { kit: S.ctx.kit, route, fovK: S.fovK, fogColor: fog.color, windDir: S.windDir });   // 过梯晃 / 失足、镜头、雾带、滚石
}

// ---------- 互动（只动画面和声音，不碰控制） ----------
function buildInteract(scene, ctx, { flagLines, BF, windDir }) {
  const icon = popIcon(scene, g => {                                            // 氧气面罩：白色罩子 + 橙色阀门和管子 + O₂
    g.translate(128, 96); g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = 'rgba(255,255,255,.14)'; g.strokeStyle = '#ffffff'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(-44, -38); g.quadraticCurveTo(0, -64, 44, -38); g.lineTo(32, 28); g.quadraticCurveTo(0, 50, -32, 28); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = UI.warn; g.beginPath(); g.arc(0, 2, 16, 0, 6.283); g.fill();
    g.strokeStyle = UI.warn; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 20); g.quadraticCurveTo(8, 62, 62, 58); g.stroke();
    g.fillStyle = '#ffffff'; g.font = `800 34px ${UI.font}`; g.textAlign = 'center'; g.fillText('O₂', 74, -34);
  }, '吸氧', { size: 0.32 });                                                      // 评审：图标缩到 1/3
  let puffs = null;
  if (!LOW) {                                                                   // 呼出来的白气（?fx=low 不要）
    const tex = ctx.util.canvasTexture(64, 64, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.5, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, w);
    });
    puffs = Array.from({ length: 6 }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      sp.name = 'breath'; sp.renderOrder = 5; scene.add(sp); return { sp, p0: new THREE.Vector3(), age: 9 };
    });
  }
  return { lines: flagLines.map(l => [l.a, l.b]), BF, wind: windDir.clone().normalize(), icon, puffs, pi: 0,
    gT: 99, lastLine: -1, oxyT: 0, oxy: 0, bT: 0, puffAt: 0, unf: 0, wasSummit: false };
}
const UP = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
// 返回吸氧程度 0..1（给缺氧暗角）
function interact(dt, st) {
  const I = S.I, { Z, route } = S, s = st.s, t = st.t || 0, av = st.avatar;
  // 经幡：走到任一串经幡 2.6 以内 → 一阵猛风（0.15 s 起、约 2 s 落），近处的旗乱飞、啪啪响；预览里走近了就一直吹（静态也看得见）
  let near = -1;
  if (av && !st.summit) { _p.copy(av).y += 1.4; for (let i = 0; i < I.lines.length; i++) if (segDist(_p, I.lines[i][0], I.lines[i][1]) < 2.6) { near = i; break; } }
  if (near >= 0 && near !== I.lastLine && I.gT > 1.2) { I.gT = 0; play('flutter', 1); }
  I.lastLine = near; I.gT += dt;
  const gw = st.summit ? 0 : st.preview ? (near >= 0 ? 1 : 0) : I.gT < 0.15 ? I.gT / 0.15 : Math.exp(-(I.gT - 0.15) * 1.5);
  if (av) for (const f of S.flags) f.uGust.value.set(av.x, av.y, av.z, gw);
  // 北坳吸氧：站定 0.3 s → 面罩图标弹出；1.9 s 一口：嘶——吸，0.95 s 后呼出一团白气
  const col = Z.col, atCol = !!col && !!st.terrain && st.terrain.segment === 'wait' && s > col.start - 0.6 && s < col.start + 1;
  I.oxyT = atCol ? I.oxyT + dt : 0;
  const onO2 = atCol && I.oxyT > 0.3;
  if (onO2 && !I.icon.wasOn) fgSay('oxygen');
  I.icon.wasOn = onO2; I.icon.on(onO2 && I.oxyT < 1.8);                              // 弹出 1.5 s 后淡掉（吸氧照常继续）
  if (av) I.icon.update(dt, _p.copy(av).addScaledVector(route.at(s).left, 0.62).setY(av.y + 1.0));   // 化身左边腰高（头顶是 HUD 的站定面板）
  I.oxy += ((onO2 ? 1 : 0) - I.oxy) * Math.min(1, dt * 2);
  if (onO2) {
    if ((I.bT -= dt) <= 0) { play('hiss', 0.8); I.bT = 1.9; I.puffAt = 0.95; }
    if (I.puffAt > 0 && (I.puffAt -= dt) <= 0 && I.puffs && av) { const P = I.puffs[I.pi++ % I.puffs.length]; P.age = 0; P.p0.copy(av).addScaledVector(route.at(s).dir, 0.22).y += 1.58; }
  } else I.bT = 0;
  if (I.puffs) for (const P of I.puffs) {
    P.age += dt; const u = P.age / 1.6;
    P.sp.material.opacity = u < 1 ? 0.6 * (1 - u) * Math.min(1, P.age * 8) : 0;
    P.sp.position.copy(P.p0).addScaledVector(I.wind, 0.5 * P.age).addScaledVector(UP, 0.25 * P.age); P.sp.scale.setScalar(0.14 + 0.55 * Math.min(u, 1));
  }
  // 登顶：觇标上卷着的红旗展开（啪啦一声）
  if (I.BF) {
    if (st.summit && !I.wasSummit) {
      play('flutter', 1.3); fgSay('summit');
      const o = route.at(route.N + 2.6, -0.2).pos; o.y = route.heightAt(route.N) + 0.05;   // 雪烟：从顶峰雪脊上被西风扯向东侧雪檐
      S.sd.start(o, route.at(route.N).dir, S.windDir);
    }
    I.wasSummit = !!st.summit;
    I.unf += ((st.summit ? 1 : 0) - I.unf) * Math.min(1, dt * (st.summit ? 1.8 : 6));
    I.BF.set(I.unf, t);
  }
  return I.oxy;
}
