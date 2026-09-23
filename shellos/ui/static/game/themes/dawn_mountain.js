// 泰山·十八盘：拂晓到清晨。
//   地理顺序和 HUD 一致：中天门牌坊（s=6，开场镜头整座框住上行石阶）→ 石栏杆 + 挂红布条的铁链 → 慢十八（松、「青云梯」）
//   → 紧十八（s 24–33：两侧花岗岩崖壁收成窄槽）→ 南天门（s=33，跨在十八盘顶，路从拱洞穿过）→ 天街 → 玉皇顶
//   （左侧天街店铺 + 红灯笼、尽头「五岳独尊」立石，正前方山脊上玉皇庙，右前方「泰山极顶 1545米」石，右侧云海日出）。
//   氛围：天顶蓝 → 地平线暖橙，太阳随爬升从云海下升起（登顶光晕最大）；2 层云海流动；4 层远山逐层变淡。
// 镜头：rigFor 按进度改 ctx.camRig（见文件末 PH）：开场 6 远框住中天门；缓坡 / 慢十八 4.3、低机位；紧十八 4.4、比化身头还低仰拍；
//   过门段镜头对准南天门洞轴、停在南侧洞口外 0.6–0.9（洞口比视野大，红墙不进画），看天街店铺 → 玉皇庙 → 日出。
// 子模块：dawn_mountain/sky.js（天、太阳、云海、远山）、arch.js（两座门）、props.js（栏杆、松、零碎、崖、刻字）。
import * as THREE from 'three';
import { buildSky } from './dawn_mountain/sky.js';
import { zhongTianMen, nanTianMen, tianJie, lanternGeo, yuHuangMiao, shengXianFang, duiSongTing } from './dawn_mountain/arch.js';
import { railings, forest, scatter, cliff, carving, graniteColor, RAIL_LAT } from './dawn_mountain/props.js';
import { buildInteract } from './dawn_mountain/interact.js';
import { WHO } from '../style.js';

const C = {
  zenith: '#4a6a9c', hz: '#f6c28a', below: '#e8d3bb', sun: '#ffcf8c', fog: '#e3d6c8',
  ridgeNear: '#8a8aa0', ridgeFar: '#e6cdb9', cloudLit: '#fffaf4', cloudShade: '#cdc6d6', cloudHaze: '#f4e6d8', cloudRim: '#ffd6a8',
};
const ZT = 3, NT = 34.5, SUN_AZ = 25 * Math.PI / 180;     // 中天门、南天门所在步；太阳在终点朝向右偏 25°
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
let sky = null, rig = null, RT = null, GATE = null, AT = {}, HAWK = null, ACT = null;

// 石板路：每步一道缝（v 每 0.5 一块），错缝，两侧一条深色路缘石。灰度图，乘材质色
function slabTexture(util, kit) {
  const t = util.canvasTexture(256, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    const row = y => (y < 64 ? 0 : 1), cut = [[0.36, 0.7], [0.2, 0.55, 0.83]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, r = row(y), yy = y % 64, curb = u < 0.055 || u > 0.945;
      let v = 0.94 + 0.08 * kit.noise2(x * 0.09 + r * 7, y * 0.09) + 0.07 * (kit.hash2(x, y) - 0.5);
      const seam = yy < 2 || yy > 61 || (!curb && cut[r].some(c => Math.abs(u - c) < 0.006)) || Math.abs(u - 0.055) < 0.006 || Math.abs(u - 0.945) < 0.006;
      if (curb) v *= 0.8;
      if (seam) v *= 0.58;
      const i = (y * w + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      im.data[i] = c; im.data[i + 1] = c * 0.985; im.data[i + 2] = c * 0.96; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: true });
  t.repeat.set(1 / 2.2, 1); t.offset.set(0.5, 0);
  return t;
}
// 台阶面：细麻点 + 很浅的边线（前后沿），不压暗整体
function stairTexture(util, kit) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.95 + 0.06 * kit.noise2(x * 0.08, y * 0.08) + 0.08 * (kit.hash2(x, y) - 0.5);
      const e = (x < 3 || y < 3 || x > w - 4 || y > h - 4) ? 0.8 : 1;
      const v = Math.max(0, Math.min(255, n * e * 255)), i = (y * w + x) * 4;
      im.data[i] = v; im.data[i + 1] = v * 0.985; im.data[i + 2] = v * 0.96; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

export function pathMaterials({ THREE, util, kit }) {
  return {
    road: new THREE.MeshLambertMaterial({ color: '#948b7a', map: slabTexture(util, kit) }),
    stairs: new THREE.MeshLambertMaterial({ color: '#ffffff', map: stairTexture(util, kit) }),
  };
}

let SFX = null;                                      // 落阶反馈（kit.stepFx）
export function build(scene, ctx) {
  SFX = ctx.kit.stepFx(ctx, { dust: '#d9ccb6', flash: '#fff0c8' });   // 花岗岩石阶：浅灰尘
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, c = kit.routeCenter(route);
  const aN = route.at(N), rightN = aN.left.clone().negate();
  const sunXZ = aN.dir.clone().multiplyScalar(Math.cos(SUN_AZ)).addScaledVector(rightN, Math.sin(SUN_AZ)).normalize();

  // 登顶镜头：站在南天门拱洞门口（离化身 4.3，低机位 1.4），隔着拱洞看化身背影 + 天街 + 日出。
  //   镜头就在门口（离门外皮 0.2），门洞侧壁在画框外；化身在登顶卡上面，太阳在顶部 HUD 下面；
  //   从紧十八镜头滑过来全程在门前这一侧，不穿墙。
  const SC = route.at(N + 1.2, 0.35).pos, arch = route.at(NT).pos;
  const toArch = arch.clone().sub(SC).setY(0).normalize(), SUM_R = 3.5;
  const camS = SC.clone().addScaledVector(toArch, SUM_R);
  // 五岳独尊石：天街店铺尽头、路左侧（离开拱洞正前方的视线，不挡天街和日出）
  const wyCtr = route.at(N + 12.5, 3.9).pos.setY(route.heightAt(N));

  sky = buildSky(scene, ctx, sunXZ, C);
  kit.fog(scene, C.fog, 30, 170);
  scene.background = new THREE.Color(C.below);
  lights.hemi.color.set('#f2eee8'); lights.hemi.groundColor.set('#636858'); lights.hemi.intensity = 1.15;
  lights.sun.color.set('#ffdcb0'); lights.sun.intensity = 1.55;
  lights.sun.position.set(c.x + sunXZ.x * 26, 24, c.z + sunXZ.z * 26);    // 从前方照：台阶立面背光、踏面亮
  ctx.theme.ghostOpacity = 0.5;
  // 化身：深色连体服 + 橙色外骨骼件（3 米外先认出髋部发光环和腿侧连杆），头盔浅色；影子是浅青色，两者错开
  ctx.theme.avatar = { leg: '#222a34', body: '#3b4d63', head: '#e3e8ee', exo: WHO.fengge.exo, rim: '#ffd9a8', rimK: 0.85, self: 0.18 };                                              // 影子再实一点：身后的铁链透得少

  // ---------- 山体：左侧抬成山壁，右侧跌进云海；按坡度上色（陡 = 花岗岩，缓 = 三色草地），不贴拉伸的贴图 ----------
  const ground = kit.terrain(ctx, { amp: 11, drop: 1.35, rough: 1.8, reach: 15, seed: 3 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cc = new THREE.Color(), up = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z);
      let y = p.getY(i);
      if (nr.side > 0) y += 9 * smooth(2.8, 7.5, nr.d) * (0.6 + 0.8 * kit.fbm(x * 0.15 + 7, z * 0.15, 3)) * (0.2 + 0.8 * smooth(10, 24, nr.s));
      const dW = Math.hypot(x - wyCtr.x, z - wyCtr.z);                       // 刻字崖面前后压低：别让山坡把字埋了
      if (dW < 6) y = mix(y, Math.min(y, wyCtr.y - 0.2), 1 - smooth(3, 6, dW));
      p.setY(i, y);
      up[i] = y - nr.y;
    }
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const nrm = g.attributes.normal, G = [new THREE.Color('#5b6636'), new THREE.Color('#75753f'), new THREE.Color('#8a7c52')], rk = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = kit.fbm(x * 0.09, z * 0.09, 3), n2 = kit.noise2(x * 0.35, z * 0.35);
      cc.copy(G[0]).lerp(G[1], smooth(0.38, 0.52, n + 0.15 * (n2 - 0.5))).lerp(G[2], smooth(0.56, 0.7, n + 0.2 * (n2 - 0.5)));
      const steep = Math.min(1, smooth(0.86, 0.6, nrm.getY(i)) + smooth(1.5, 5, up[i]) * (0.5 + 0.6 * n));
      graniteColor(kit, rk, x, y, z, nrm.getY(i) * 0.6 + 0.2, 0, 0.12);   // 地面几乎不要层理带：否则缓坡上一圈圈像等高线
      cc.lerp(rk, steep).multiplyScalar(0.95 + 0.1 * n2);
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true;
  }
  const hAt = util.gridHeight(ground);
  triplanarGranite(ground.material, util, kit);

  // ---------- 路面：踏面 #b3ab9c、立面 #5e584f（立面顶点色 0.6 → 0.525）；去掉调试线 ----------
  if (M.stairs && M.stairIndex.length) {
    const sc = new THREE.Color('#b3ab9c'), tmp = new THREE.Color();
    for (let n = 0; n < M.stairIndex.length; n++) M.stairs.setColorAt(n, tmp.copy(sc).multiplyScalar(n % 2 ? 1 : 0.93));
    M.stairs.instanceColor.needsUpdate = true;
    const bc = M.stairs.geometry.attributes.color;
    if (bc) { for (let v = 0; v < bc.count; v++) if (bc.getX(v) < 0.99) bc.setXYZ(v, 0.525, 0.525, 0.525); bc.needsUpdate = true; }
  }
  for (const k of ['lines', 'edges', 'startLine', 'camp', 'flag']) if (M[k]) M[k].visible = false;

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mats = {
    vc, stoneRail: new THREE.MeshLambertMaterial({ color: '#bdb4a3' }), iron: new THREE.MeshLambertMaterial({ color: '#2b2826' }),
    cloth: new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), lambert: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    rock: new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
  };
  const gateMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2a140c' });   // 门脸背光（太阳在前方），提一点
  const texts = [], slabs = [];

  // ---------- 两座门 ----------
  // 南天门门轴对准天街（路在门后往左弯）：从门洞往里看，镜头视线和洞壁平行，洞壁不进画
  const zt = zhongTianMen(ctx, ZT, gateMat), nt = nanTianMen(ctx, NT, gateMat, route.headingAt(37));
  scene.add(zt.mesh, nt.mesh); texts.push(...zt.texts, ...nt.texts);
  const ztP = route.at(ZT).pos, ntP = nt.F.base;
  // 升仙坊（紧十八起点）、对松亭（不紧不慢又十八右侧山谷边）
  const tight = route.segs.filter(q => q.kind === 'stairs_up').pop(), SX = tight ? tight.start + 0.1 : 24.1;
  const sx = shengXianFang(ctx, SX, gateMat); scene.add(sx.mesh); texts.push(...sx.texts);
  const DS = [16.2, -4.4], dsA = route.at(DS[0], DS[1]).pos;

  // ---------- 崖壁：慢十八左侧矮崖 → 紧十八两侧窄槽（崖脚 2.25、高 ≥ 12、上部前倾）→ 南天门两侧 → 天街左侧崖 ----------
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });   // 平直着色：块面分明，不像布
  const SLOT = 2.1;                               // 崖脚 = 2.1 + 0.12 + 起伏 0..0.35 → 2.2–2.6
  const latL = s => s < 22 ? 3.4 : s < 24 ? mix(3.4, SLOT, smooth(22, 24, s)) : s < 33.2 ? SLOT
    : mix(SLOT, 5.0, smooth(35.4, 36.8, s)) + 2.0 * smooth(48, 51, s) * (1 - smooth(57, 60, s));   // 天街：让出店铺进深；刻字石那一段再往后让
  const latR = s => mix(3.2, SLOT, smooth(22.5, 24, s));
  const cliffs = [
    cliff(ctx, { side: 1, s0: -12, s1: N + 20, lat: latL, seed: 2,                 // 从中天门起就是分块花岗岩（不再是地面贴图的旋涡）
      hOf: s => mix(mix(4.2, 12.5, smooth(17, 24, s)), 7.5, smooth(35.5, 39, s)),
      lean: s => 0.9 * smooth(23, 25, s) * (1 - smooth(33, 34.5, s)),
      rough: s => mix(1.2, 0.35, smooth(22, 24, s) * (1 - smooth(35, 36.5, s))),
      cracks: [25.4, 27.9, 30.3, 32.2] }),
    cliff(ctx, { side: -1, s0: 21, s1: 37, lat: latR, seed: 7,                    // 右崖一直包到南天门墙后
      hOf: s => mix(3, 12.5, smooth(21.5, 24.5, s)), lean: s => 0.9 * smooth(23, 25, s),
      rough: s => mix(1.1, 0.35, smooth(22.5, 24, s)), cracks: [24.9, 27.0, 29.2, 31.5] }),
  ];
  // 崖顶朝太阳的一面：暖色边光（#d9a070），只作用在法线朝太阳、离地 > 8 的块
  const sunL = new THREE.Vector3(sunXZ.x * 26, 24, sunXZ.z * 26).normalize(), warm = new THREE.Color('#d9a070'), wc = new THREE.Color();
  for (const g of cliffs) {
    const p = g.attributes.position, n = g.attributes.normal, col = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, n.getX(i) * sunL.x + n.getY(i) * sunL.y + n.getZ(i) * sunL.z) * smooth(6.5, 10, p.getY(i));
      if (k > 0) { wc.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(warm, Math.min(1, k * 1.3) * 0.85); col.setXYZ(i, wc.r, wc.g, wc.b); }
    }
    col.needsUpdate = true;
  }
  cliffs.forEach(g => { const m = new THREE.Mesh(g, rockMat); m.name = 'cliff'; scene.add(m); });

  // ---------- 刻字 / 碑 ----------
  const face = (s, k) => { const a = route.at(s); return a.left.clone().multiplyScalar(-k).addScaledVector(a.dir, -(1 - k)).normalize(); };
  const CARV = [];                                                            // 摩崖石刻（interact.js 路过时发金光）
  const put = (text, s, lat, up, o, k = 0.72) => {
    const a = route.at(s, lat), at = a.pos.clone().setY(route.heightAt(s) + up), cv = carving(ctx, text, at, face(s, k), o);
    if (cv.slabPart) slabs.push(cv.slabPart); texts.push(cv.txt); CARV.push({ s, txt: cv.txt });
  };
  put('青云梯', 19.5, 3.8, 1.2, { w: 0.9, h: 1.75, charH: 1.5, slab: '#b6ab98' });
  put('天门长啸', 27.6, 1.9, 2.6, { w: 1.0, h: 3.4, charH: 3.1, slab: '#a89f8e' }, 0.4);   // 紧十八两侧崖上的摩崖石刻（李白「天门一长啸，万里清风来」）：窄槽里仰拍，满屏的红字
  put('万里清风', 29.4, -1.9, 2.6, { w: 1.0, h: 3.4, charH: 3.1, slab: '#a89f8e' }, -0.4);   // 右崖：k 取负 = 字面朝路（左）
  { // 「岱宗」（杜甫《望岳》「岱宗夫如何」）：慢十八左崖上 2 字各 2.4 高的红字，字面朝山上 —— 正面镜头回看来路时在峰哥身后右侧
    const a = route.at(9.5, 3.9), f = a.dir.clone().multiplyScalar(0.8).addScaledVector(a.left, -0.6).normalize(), at = a.pos.clone().setY(route.heightAt(9.5) + 3.4);
    const cv = carving(ctx, '岱宗', at, f, { w: 2.2, h: 5.2, d: 1.2, charH: 4.8, slab: '#a39a88' }); slabs.push(cv.slabPart); texts.push(cv.txt);
  }
  put('慢十八', 8.7, 3.7, 0.9, { w: 0.8, h: 1.55, charH: 1.3, slab: '#b6ab98' });          // 十八盘三段名刻在左侧石上：一眼知道走到哪段了
  put('不紧不慢又十八', 14.3, 3.6, 1.2, { w: 0.75, h: 2.6, charH: 2.4, slab: '#b6ab98' });
  { const y = Math.min(route.heightAt(DS[0]) - 0.05, hAt(dsA.x, dsA.z) + 0.35), ds = duiSongTing(ctx, DS[0], DS[1], y, gateMat, Math.max(0.6, y - hAt(dsA.x, dsA.z) + 0.5));   // 亭子坐在路下方的小平台上
    scene.add(ds.mesh); texts.push(...ds.texts); }
  // 五岳独尊：天街尽头路左侧一块立石，磨平处刻红字，斜对来路（拱洞 / 登顶镜头都看得到）
  {
    const ctr = wyCtr, aW = route.at(N + 12.5), nrm = aW.dir.clone().negate().multiplyScalar(0.75).addScaledVector(aW.left, -0.66).normalize();
    const rf = rockFace(ctx, ctr, nrm, 2.6, 4.4, 11);
    const m = new THREE.Mesh(rf, rockMat); m.name = 'cliff'; scene.add(m);
    texts.push({ text: '五岳\n独尊', p: ctr.clone().addScaledVector(nrm, 0.05).setY(ctr.y + 1.8), ry: Math.atan2(nrm.x, nrm.z), h: 1.6, color: '#b3241a', weight: 900, pad: 0.1, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' });
  }
  // 泰山极顶 1545米：按南天门门轴摆（门后 8.8、轴右 5.4）：登顶 / 天街镜头贴着洞口，看它在右前 30°；
  //   紧十八上镜头离洞 6 以上，洞只张 ±13°，它在洞外 → 爬坡时拱洞里看不到它（不剧透）
  {
    const p = nt.F.base.clone().addScaledVector(nt.F.dir, 8.8).addScaledVector(nt.F.left, -5.4);
    p.y = route.heightAt(N) + 0.75;
    const f = camS.clone().sub(p).setY(0).normalize();
    slabs.push({ geo: new THREE.BoxGeometry(2.4, 3.2, 1.0), p: [p.x, p.y - 2.9, p.z], ry: Math.atan2(f.x, f.z), color: '#8f887a' });   // 石座（在字下面）：右侧山坡往云海跌，别悬空
    const cv = carving(ctx, '泰山极顶\n1545米', p, f, { w: 2.1, h: 2.6, d: 0.7, charH: 1.25, slab: '#b0a794', vertical: false });
    slabs.push(cv.slabPart); texts.push(cv.txt);
  }
  const slabMesh = new THREE.Mesh(util.merged(slabs), vc); slabMesh.name = 'slabs'; scene.add(slabMesh);

  // ---------- 石栏杆 + 铁链：缓坡起到天街尽头，南天门门洞里断开 ----------
  const gateHalf = nt.D / 2 / 0.5 + 0.6;       // 门墙前后各让 0.6 步
  for (const m of railings(ctx, [[3.5, NT - gateHalf], [NT + gateHalf + 0.4, N - 0.5]], mats)) scene.add(m);

  // ---------- 松：约 100 棵 + 日出方向的名松 ----------
  const windRy = Math.atan2(-rightN.z, rightN.x);  // 松枝伸向山谷（+x 局部 → 右侧）
  const keep = (x, z, lat, s) => {
    if (Math.hypot(x - ntP.x, z - ntP.z) < 5 || Math.hypot(x - ztP.x, z - ztP.z) < 3.6 || Math.hypot(x - dsA.x, z - dsA.z) < 2.4) return false;
    if (lat > 0 && lat < 7.5) return false;
    if (lat > 0 && s > 10 && lat < latL(s) + 5.5) return false;              // 左侧崖顶以里
    if (lat < 0 && s > 20 && s < 36 && -lat < 8) return false;              // 紧十八右崖
    if (lat < 0 && s > 38 && s < 75 && -lat < 16) return false;             // 登顶镜头看日出的扇区：只放名松
    if (s > N + 10 && s < N + 26 && Math.abs(lat) < 7) return false;          // 玉皇庙前后
    return util.offRoad(route, x, z, 1.2);
  };
  const hy = s => route.heightAt(s) - 0.35;
  const F = forest(ctx, hAt, windRy, keep, mats, [
    { s: 12, lat: -3.6, sc: 1.0 }, { s: -3, lat: -3.6, sc: 1.05 }, { s: 20.5, lat: -3.8, sc: 0.95, ry: 0.3 },
    { s: 36.8, lat: -4.3, sc: 1.05, y: hy(36.8), ry: -0.3 },                     // 南天门右后：从拱洞 / 天街看是日出方向的剪影
    { s: 45.5, lat: -5.2, sc: 1.15, y: hy(45.5) - 0.6, ry: 0.4 },
    { s: 41.5, lat: -7.2, sc: 0.95, y: hy(41.5) - 1.4, ry: -0.2 },
  ], kit.LOW ? 45 : 95);
  for (const m of F.meshes) scene.add(m);
  ACT = buildInteract(scene, ctx, { carvings: CARV, gate: nt.F, gateS: NT });   // 场景互动：挑山工、石刻金光、南天门钟声惊鸟
  HAWK = kit.flock(ctx, { count: kit.LOW ? 4 : 6, center: route.at(36, -7).pos.setY(route.heightAt(34)), radius: 6, spread: 3, height: 8, size: 1.7, color: '#2e2a26', speed: 0.18, flap: 1.1, name: 'hawks' });   // 山谷云海上空盘旋的鹰

  // ---------- 栏杆外 1–4 单位：灌丛 / 草簇 / 碎石 ----------
  {
    const R = ctx.rand, spots = [];
    for (let k = 0; k < 900 && spots.length < (kit.LOW ? 180 : 420); k++) {
      const s = -14 + R() * (N + 30), side = R() < 0.5 ? 1 : -1;
      const inSlot = s > 22.5 && s < 34.8, room = side > 0 ? latL(s) : (s > 21 && s < 35 ? latR(s) : 99);
      let lat = RAIL_LAT + 0.25 + R() * 4;
      if (lat > room - 0.15) { if (!inSlot || R() < 0.5) continue; lat = RAIL_LAT + 0.2 + R() * (room - RAIL_LAT - 0.35); }
      const a = route.at(s, side * lat);
      if (Math.hypot(a.pos.x - ntP.x, a.pos.z - ntP.z) < 3.8 || Math.hypot(a.pos.x - ztP.x, a.pos.z - ztP.z) < 1.2) continue;
      if (s > N - 1 && Math.hypot(a.pos.x - SC.x, a.pos.z - SC.z) < 3.2) continue;
      if (Math.hypot(a.pos.x - dsA.x, a.pos.z - dsA.z) < 1.9) continue;                  // 对松亭
      if (side > 0 && s > NT + 1 && s < NT + 16) continue;                         // 天街店铺
      if (!util.offRoad(route, a.pos.x, a.pos.z, 0.4)) continue;
      spots.push({ x: a.pos.x, z: a.pos.z, y: Math.max(hAt(a.pos.x, a.pos.z), route.heightAt(s) - 0.3) });
    }
    for (const m of scatter(ctx, spots, mats)) scene.add(m);
  }

  // ---------- 天街店铺 + 红灯笼、玉皇庙 ----------
  {
    const tj = tianJie(ctx, NT + 1.4, 3, vc); tj.mesh.name = 'tianjie'; scene.add(tj.mesh); texts.push(...tj.texts);
    const lm = util.instanced(lanternGeo(util), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#6a1a0e' }), tj.lanterns);
    lm.name = 'lanterns'; scene.add(lm);
    const ym = yuHuangMiao(ctx, N + 17, 0.4, 0.6, gateMat); ym.mesh.name = 'yuhuang'; scene.add(ym.mesh); texts.push(...ym.texts);
  }

  const signs = util.textSigns(texts, { size: 96 }); signs.renderOrder = 1; scene.add(signs);
  sky.update(0, 0, false);

  // ---------- 镜头 ----------
  rig = ctx.camRig; RT = route; GATE = nt.F;
  if (typeof window !== 'undefined') window.__dawn = { gd: nt.F.dir, zt: zt.texts[0].p, nt: nt.texts[0].p, ym: route.at(N + 17, 0.4).pos.setY(route.heightAt(N) + 0.6 + 3.4) };   // 调试：匾额位置（量屏幕坐标用）
  const sumFace = SC.clone().multiplyScalar(2).sub(arch).setY(SC.y);           // 环绕起点 = 化身 → 拱洞中心的方向
  Object.assign(rig.summit, { radius: SUM_R, height: 1.4, lookY: 1.2, speed: 0.012, face: sumFace });
  ctx.theme.summitCard = 'left';                                              // 化身站在画面下部正中，登顶卡放左下
  rigFor(0, rig, false);
}

// 地面细节：花岗岩麻点 / 裂纹贴图按世界坐标三平面投影（陡坡不拉伸），陡处强、缓坡（草地）弱
function triplanarGranite(mat, util, kit) {
  const tex = util.canvasTexture(256, 256, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = kit.fbm(x * 0.09, y * 0.09, 3);
      let v = 0.8 + 0.22 * n + 0.2 * (kit.hash2(x, y) - 0.5);                // 只留麻点，不画裂纹（裂纹在缓坡上拉成旋涡）
      const i = (y * w + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      im.data[i] = im.data[i + 1] = im.data[i + 2] = c; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: true });
  mat.onBeforeCompile = sh => {
    sh.uniforms.gTex = { value: tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vGN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D gTex; varying vec3 vGW; varying vec3 vGN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 bw = pow(abs(vGN), vec3(4.)); bw /= dot(bw, vec3(1.));
          float tx = texture2D(gTex, vGW.zy * 0.22).r * bw.x + texture2D(gTex, vGW.xz * 0.22).r * bw.y + texture2D(gTex, vGW.xy * 0.22).r * bw.z;
          float steep = 1. - smoothstep(0.55, 0.9, vGN.y);
          diffuseColor.rgb *= mix(1., 0.45 + 1.1 * tx, 0.3 + 0.7 * steep); }`);
  };
  mat.customProgramCacheKey = () => 'dawnGranite';
}

// 一面独立花岗岩崖（登顶点左前方）：中心 ctr（地面）、朝向 nrm、宽 w、高 h；起伏只往背面推，中间一块磨平刻字
function rockFace(ctx, ctr, nrm, w, h, seed) {
  const { kit } = ctx, cols = 16, rows = 22, t = new THREE.Vector3(nrm.z, 0, -nrm.x), pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= cols; i++) for (let r = 0; r <= rows; r++) {
    const u = i / cols - 0.5, v = r / rows, top = h * (1 - 0.35 * Math.abs(u) * 2) * (0.85 + 0.3 * kit.fbm(i * 0.3 + seed, 1, 2));
    const yy = -1.2 + v * (top + 1.2), flat = smooth(0.34, 0.2, Math.abs(u)) * smooth(0.2, 0.3, v) * smooth(0.82, 0.68, v);
    const n = kit.fbm(u * 3 + seed, yy * 0.4, 4), push = (n * 0.9 + 0.25 * Math.abs(u) * 2 + 0.5 * v * v) * (1 - 0.9 * flat) + 0.1;
    const p = ctr.clone().addScaledVector(t, u * w).addScaledVector(nrm, -push); p.y = ctr.y + yy;
    pos.push(p.x, p.y, p.z);
    graniteColor(kit, c, p.x, p.y, p.z, 0.3 + 0.8 * (n - 0.45) + 0.4 * flat);
    col.push(c.r, c.g, c.b);
    if (i < cols && r < rows) { const k = i * (rows + 1) + r, k2 = k + rows + 1; idx.push(k, k + 1, k2, k + 1, k2 + 1, k2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 跟随镜头按进度调（rigFor：引擎每帧在镜头更新前调，无一帧延迟）。数值按 1920×1080 实测（匾额 / 脚底像素）调过：
//   开场：6 远，中天门匾 + 门洞里的南天门匾都在 HUD 下沿之下 → 缓坡 / 慢十八：4.3，化身约 380 px，南天门匾 y≈200–260
//   → 紧十八：4.4、居中、镜头离脚 0.5（比化身头低），仰拍台阶 + 南天门 → 过门：2.8、对准洞轴、停在洞口外，天街 + 玉皇庙 + 太阳进画
const PH = {
  open: { back: 6.0, side: 0.9, height: 1.6, lookY: 2.6 },
  climb: { back: 4.3, side: 0.8, height: 1.6, lookY: 2.25 },
  tight: { back: 4.4, side: 0.25, height: 0.5, lookY: 2.7 },
  gate: { back: 2.8, side: -0.35, height: 1.6, lookY: 1.3 },   // side 实际按拱洞轴线现算（路在这里有弯，拱洞是直的）
};
export function rigFor(s, r, summit) {
  if (summit || !r) return;
  const F = r.follow, a = 1 - smooth(1.5, 4, s), b = smooth(21, 24, s), g = smooth(30.5, 32.5, s);
  for (const k of ['back', 'side', 'height', 'lookY']) {
    const v = mix(mix(mix(PH.climb[k], PH.open[k], a), PH.tight[k], b), PH.gate[k], g);
    F[k] = v;
    if (k === 'back') F.backStairs = v;
    if (k === 'side') F.sideStairs = v;
  }
  if (g > 0 && RT && GATE) {                     // 过门段：镜头横向对准拱洞中轴（门框 F.left 方向偏差 = 0）
    const q = RT.at(s, 0.35, AT), px = q.pos.x - q.dir.x * F.back - GATE.base.x, pz = q.pos.z - q.dir.z * F.back - GATE.base.z;
    const k = q.left.x * GATE.left.x + q.left.z * GATE.left.z;
    if (Math.abs(k) > 0.3) F.side = F.sideStairs = mix(F.side, -(px * GATE.left.x + pz * GATE.left.z) / k, g);
  }
  F.ahead = mix(1.6, 0.6, g);                     // 过门段看点贴近化身：视线不跟着天街的弯往左甩
  F.clear = mix(1.7, 1.3, b * (1 - g));           // 紧十八：镜头贴着身后台阶（离踏面 1.3），仰拍
  F.upBonus = 0; F.stairsBonus = 0; F.lookUp = 0; F.footMin = -0.86;
}

export function update(dt, st) {
  if (SFX) SFX.update(dt, st);
  if (HAWK) HAWK.update(dt);
  if (ACT) ACT.update(dt, st);
  if (sky) sky.update(st.t, st.progress, st.summit);
}
