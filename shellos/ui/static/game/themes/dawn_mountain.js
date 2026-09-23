// 泰山·十八盘：拂晓到清晨。
//   地理顺序和 HUD 一致：中天门牌坊（s=6，开场镜头整座框住上行石阶）→ 石栏杆 + 挂红布条的铁链 → 慢十八（松、「青云梯」）
//   → 紧十八（s 24–33：两侧花岗岩崖壁收成窄槽）→ 南天门（s=33，跨在十八盘顶，路从拱洞穿过）→ 天街 → 玉皇顶
//   （左前方崖面刻「五岳独尊」，右前方「泰山极顶 1545米」石，正前方偏右是云海日出）。
//   氛围：天顶蓝 → 地平线暖橙，太阳随爬升从云海下升起（登顶光晕最大）；2 层云海流动；4 层远山逐层变淡。
// 镜头：主题在 update 里按进度改 ctx.camRig（接口允许，镜头每帧读）：开场拉远看全中天门；慢十八下段压低从额枋下穿过；
//   紧十八起镜头居中、拉远抬高（窄槽两壁对称，南天门匾额进画）；登顶从拱洞里穿到化身背后，面朝日出。
// 子模块：dawn_mountain/sky.js（天、太阳、云海、远山）、arch.js（两座门）、props.js（栏杆、松、零碎、崖、刻字）。
import * as THREE from 'three';
import { buildSky } from './dawn_mountain/sky.js';
import { zhongTianMen, nanTianMen } from './dawn_mountain/arch.js';
import { railings, forest, scatter, cliff, carving, graniteColor, RAIL_LAT } from './dawn_mountain/props.js';

const C = {
  zenith: '#4a6a9c', hz: '#f6c28a', below: '#e8d3bb', sun: '#ffcf8c', fog: '#e3d6c8',
  ridgeNear: '#8a8aa0', ridgeFar: '#e6cdb9', cloudLit: '#fffaf4', cloudShade: '#cdc6d6', cloudHaze: '#f4e6d8', cloudRim: '#ffd6a8',
};
const ZT = 6, NT = 33, SUN_AZ = 25 * Math.PI / 180;     // 中天门、南天门所在步；太阳在终点朝向右偏 25°
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
let sky = null, rig = null, R0 = null;

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

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, c = kit.routeCenter(route);
  const aN = route.at(N), rightN = aN.left.clone().negate();
  const sunXZ = aN.dir.clone().multiplyScalar(Math.cos(SUN_AZ)).addScaledVector(rightN, Math.sin(SUN_AZ)).normalize();

  // 登顶镜头：站在南天门拱洞门口（离化身 4.3，低机位 1.4），隔着拱洞看化身背影 + 天街 + 日出。
  //   镜头就在门口（离门外皮 0.2），门洞侧壁在画框外；化身在登顶卡上面，太阳在顶部 HUD 下面；
  //   从紧十八镜头滑过来全程在门前这一侧，不穿墙。
  const SC = route.at(N + 1.2, 0.35).pos, arch = route.at(NT).pos;
  const toArch = arch.clone().sub(SC).setY(0).normalize(), SUM_R = 4.3;
  const camS = SC.clone().addScaledVector(toArch, SUM_R);
  // 五岳独尊崖面：从登顶镜头看左前 17°、11 远
  const aS = route.at(N + 1.2), wyCtr = camS.clone().addScaledVector(aS.dir, 11 * Math.cos(0.3)).addScaledVector(aS.left, 11 * Math.sin(0.3)).setY(route.heightAt(N));

  sky = buildSky(scene, ctx, sunXZ, C);
  kit.fog(scene, C.fog, 30, 170);
  scene.background = new THREE.Color(C.below);
  lights.hemi.color.set('#f2eee8'); lights.hemi.groundColor.set('#565a50'); lights.hemi.intensity = 1.15;
  lights.sun.color.set('#ffdcb0'); lights.sun.intensity = 1.55;
  lights.sun.position.set(c.x + sunXZ.x * 26, 24, c.z + sunXZ.z * 26);    // 从前方照：台阶立面背光、踏面亮
  ctx.theme.ghostOpacity = 0.5;                                              // 影子再实一点：身后的铁链透得少

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
      graniteColor(kit, rk, x, y, z, nrm.getY(i) * 0.6 + 0.2);
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
  const zt = zhongTianMen(ctx, ZT, gateMat), nt = nanTianMen(ctx, NT, gateMat);
  scene.add(zt.mesh, nt.mesh); texts.push(...zt.texts, ...nt.texts);
  const ztP = route.at(ZT).pos, ntP = nt.F.base;

  // ---------- 崖壁：慢十八左侧矮崖 → 紧十八两侧窄槽（崖脚 2.25、高 ≥ 12、上部前倾）→ 南天门两侧 → 天街左侧崖 ----------
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });   // 平直着色：块面分明，不像布
  const SLOT = 2.1;                               // 崖脚 = 2.1 + 0.12 + 起伏 0..0.35 → 2.2–2.6
  const latL = s => s < 22 ? 3.1 : s < 24 ? mix(3.1, SLOT, smooth(22, 24, s)) : s < 33.2 ? SLOT
    : mix(SLOT, 3.6, smooth(33.2, 34.4, s)) + 2.0 * smooth(46, 49, s) * (1 - smooth(57, 60, s));   // 刻字崖面那一段往后让，别挡字
  const latR = s => mix(3.2, SLOT, smooth(22.5, 24, s));
  const cliffs = [
    cliff(ctx, { side: 1, s0: 15, s1: N + 20, lat: latL, seed: 2,
      hOf: s => mix(mix(2.4, 12.5, smooth(17, 24, s)), 7.5, smooth(34, 38, s)),
      lean: s => 0.9 * smooth(23, 25, s) * (1 - smooth(33, 34, s)),
      rough: s => mix(1.2, 0.35, smooth(22, 24, s) * (1 - smooth(33.5, 35, s))),
      cracks: [25.4, 27.9, 30.3, 32.2] }),
    cliff(ctx, { side: -1, s0: 21, s1: 35, lat: latR, seed: 7,
      hOf: s => mix(3, 12.5, smooth(21.5, 24.5, s)), lean: s => 0.9 * smooth(23, 25, s),
      rough: s => mix(1.1, 0.35, smooth(22.5, 24, s)), cracks: [24.9, 27.0, 29.2, 31.5] }),
  ];
  cliffs.forEach(g => { const m = new THREE.Mesh(g, rockMat); m.name = 'cliff'; scene.add(m); });

  // ---------- 刻字 / 碑 ----------
  const face = (s, k) => { const a = route.at(s); return a.left.clone().multiplyScalar(-k).addScaledVector(a.dir, -(1 - k)).normalize(); };
  const put = (text, s, lat, up, o, k = 0.72) => {
    const a = route.at(s, lat), at = a.pos.clone().setY(route.heightAt(s) + up), cv = carving(ctx, text, at, face(s, k), o);
    if (cv.slabPart) slabs.push(cv.slabPart); texts.push(cv.txt);
  };
  put('青云梯', 19.5, 3.8, 1.2, { w: 0.9, h: 1.75, charH: 1.5, slab: '#b6ab98' });
  put('中天门', 3.6, 3.9, 1.1, { w: 0.8, h: 2.2, d: 0.34, charH: 1.75, slab: '#b6ab98' }, 0.55);        // 路左侧的碑（离开右中区的影子标签）
  // 五岳独尊：登顶点左前方一面花岗岩崖（从天街左崖伸出来的石壁），磨平处刻红字，正对登顶镜头
  {
    const ctr = wyCtr, nrm = camS.clone().sub(ctr).setY(0).normalize();
    const rf = rockFace(ctx, ctr, nrm, 3.6, 6.2, 11);
    const m = new THREE.Mesh(rf, rockMat); m.name = 'cliff'; scene.add(m);
    texts.push({ text: '五岳\n独尊', p: ctr.clone().addScaledVector(nrm, 0.05).setY(ctr.y + 2.1), ry: Math.atan2(nrm.x, nrm.z), h: 1.9, color: '#b3241a', weight: 900, pad: 0.1, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' });
  }
  // 泰山极顶 1545米：化身右前方约 2.3 的矮石，字面朝登顶镜头
  {
    const a = route.at(N + 1.2), p = SC.clone().addScaledVector(a.dir, 2.0).addScaledVector(a.left, -2.2);
    p.y = route.heightAt(N + 1.2) + 0.55;
    const f = camS.clone().sub(p).setY(0).normalize();
    const cv = carving(ctx, '泰山极顶\n1545米', p, f, { w: 1.5, h: 1.1, d: 0.6, charH: 0.85, slab: '#b0a794' });
    slabs.push(cv.slabPart); texts.push(cv.txt);
  }
  const slabMesh = new THREE.Mesh(util.merged(slabs), vc); slabMesh.name = 'slabs'; scene.add(slabMesh);

  // ---------- 石栏杆 + 铁链：缓坡起到天街尽头，南天门门洞里断开 ----------
  const gateHalf = nt.D / 2 / 0.5 + 0.6;       // 门墙前后各让 0.6 步
  for (const m of railings(ctx, [[3.5, NT - gateHalf], [NT + gateHalf + 0.4, N - 0.5]], mats)) scene.add(m);

  // ---------- 松：约 100 棵 + 日出方向的名松 ----------
  const windRy = Math.atan2(-rightN.z, rightN.x);  // 松枝伸向山谷（+x 局部 → 右侧）
  const keep = (x, z, lat, s) => {
    if (Math.hypot(x - ntP.x, z - ntP.z) < 5 || Math.hypot(x - ztP.x, z - ztP.z) < 3.6) return false;
    if (lat > 0 && lat < 7.5) return false;
    if (lat > 0 && s > 10 && lat < latL(s) + 5.5) return false;              // 左侧崖顶以里
    if (lat < 0 && s > 20 && s < 36 && -lat < 8) return false;              // 紧十八右崖
    if (lat < 0 && s > 38 && s < 75 && -lat < 16) return false;             // 登顶镜头看日出的扇区：只放名松
    return util.offRoad(route, x, z, 1.2);
  };
  const hy = s => route.heightAt(s) - 0.35;
  const F = forest(ctx, hAt, windRy, keep, mats, [
    { s: 12, lat: -3.6, sc: 1.0 }, { s: -3, lat: -3.6, sc: 1.05 }, { s: 20.5, lat: -3.8, sc: 0.95, ry: 0.3 },
    { s: 36.8, lat: -4.3, sc: 1.05, y: hy(36.8), ry: -0.3 },                     // 南天门右后：从拱洞 / 天街看是日出方向的剪影
    { s: 45.5, lat: -5.2, sc: 1.15, y: hy(45.5) - 0.6, ry: 0.4 },
    { s: 41.5, lat: -7.2, sc: 0.95, y: hy(41.5) - 1.4, ry: -0.2 },
  ], 95);
  for (const m of F.meshes) scene.add(m);

  // ---------- 栏杆外 1–4 单位：灌丛 / 草簇 / 碎石 ----------
  {
    const R = ctx.rand, spots = [];
    for (let k = 0; k < 900 && spots.length < 420; k++) {
      const s = -14 + R() * (N + 30), side = R() < 0.5 ? 1 : -1;
      const inSlot = s > 22.5 && s < 34.8, room = side > 0 ? latL(s) : (s > 21 && s < 35 ? latR(s) : 99);
      let lat = RAIL_LAT + 0.25 + R() * 4;
      if (lat > room - 0.15) { if (!inSlot || R() < 0.5) continue; lat = RAIL_LAT + 0.2 + R() * (room - RAIL_LAT - 0.35); }
      const a = route.at(s, side * lat);
      if (Math.hypot(a.pos.x - ntP.x, a.pos.z - ntP.z) < 3.8 || Math.hypot(a.pos.x - ztP.x, a.pos.z - ztP.z) < 1.2) continue;
      if (s > N - 1 && Math.hypot(a.pos.x - SC.x, a.pos.z - SC.z) < 3.2) continue;
      if (!util.offRoad(route, a.pos.x, a.pos.z, 0.4)) continue;
      spots.push({ x: a.pos.x, z: a.pos.z, y: Math.max(hAt(a.pos.x, a.pos.z), route.heightAt(s) - 0.3) });
    }
    for (const m of scatter(ctx, spots, mats)) scene.add(m);
  }

  const signs = util.textSigns(texts, { size: 96 }); signs.renderOrder = 1; scene.add(signs);
  sky.update(0, 0, false);

  // ---------- 镜头 ----------
  rig = ctx.camRig; R0 = JSON.parse(JSON.stringify(rig.follow));
  const sumFace = SC.clone().multiplyScalar(2).sub(arch).setY(SC.y);           // 环绕起点 = 化身 → 拱洞中心的方向
  Object.assign(rig.summit, { radius: SUM_R, height: 1.4, lookY: 0.64, speed: 0.012, face: sumFace });
  followFor(0);
}

// 地面细节：花岗岩麻点 / 裂纹贴图按世界坐标三平面投影（陡坡不拉伸），陡处强、缓坡（草地）弱
function triplanarGranite(mat, util, kit) {
  const tex = util.canvasTexture(256, 256, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = kit.fbm(x * 0.03, y * 0.03, 4), cr = Math.abs(kit.noise2(x * 0.045 + 3, y * 0.012) - 0.5);   // 竖向为主的裂纹
      let v = 0.72 + 0.35 * n + 0.18 * (kit.hash2(x, y) - 0.5);
      if (cr < 0.025) v *= 0.55 + 12 * cr;
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

// 跟随镜头按进度调：开场拉远抬高（整座中天门进画）→ 慢十八下段不加上坡高度（从额枋下穿过）→ 紧十八起居中、拉远、抬高看点
function followFor(s) {
  if (!rig) return;
  const F = rig.follow, k0 = 1 - smooth(1.5, 8, s), kz = smooth(22, 26, s);
  const start = { back: 8.5, backStairs: 8.5, side: 1.0, sideStairs: 1.0, height: 2.8, lookY: 3.0 };
  // 紧十八起：拉远 7.5、抬高 3.4 → 窄槽 + 南天门匾额都在 HUD 下沿以下；过门后压到 3.1：登顶那一下镜头从拱洞正中滑过去（拱高 3.4）
  const zone = { back: 7.5, backStairs: 7.5, side: 0.25, sideStairs: 0.25, height: mix(3.4, 3.1, smooth(34, 37, s)), lookY: 2.2, upBonus: 0, stairsBonus: 0 };
  for (const k of ['back', 'backStairs', 'side', 'sideStairs', 'height', 'lookY', 'upBonus', 'stairsBonus']) {
    let v = R0[k];
    if (k in start) v = mix(v, start[k], k0);
    if (k === 'upBonus') v *= smooth(15, 18, s);
    F[k] = mix(v, zone[k], kz);
  }
}

export function update(dt, st) {
  if (sky) sky.update(st.t, st.progress, st.summit);
  if (!st.summit) followFor(st.s);
}
