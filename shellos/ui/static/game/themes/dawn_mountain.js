// 泰山·十八盘：拂晓到清晨。
//   一眼认出：中天门牌坊 → 石阶两侧石栏杆 + 挂红布条的铁链 → 慢十八（松、「青云梯」）→ 紧十八（两侧崖壁夹着、「五岳独尊」）
//            → 十八盘顶的南天门（红墙拱门 + 摩空阁，在山顶平台上，从紧十八往上就能看到）→ 玉皇顶「泰山极顶」石。
//   氛围：天顶蓝 → 地平线暖橙，太阳随爬升从云海下升起（登顶光晕最大）；3 层云海流动；4 层远山逐层变淡。
// 子模块：dawn_mountain/sky.js（天、太阳、云海、远山）、arch.js（两座门）、props.js（栏杆、松、石、崖、刻字）。
import * as THREE from 'three';
import { buildSky } from './dawn_mountain/sky.js';
import { zhongTianMen, nanTianMen } from './dawn_mountain/arch.js';
import { railings, forest, cliff, carving } from './dawn_mountain/props.js';

const C = {
  zenith: '#4a6a9c', hz: '#f6c28a', below: '#e8d3bb', sun: '#ffcf8c', fog: '#e6d6c4',
  ridgeNear: '#8a8aa0', ridgeFar: '#e6cdb9', cloudLit: '#fffaf4', cloudShade: '#cdc6d6', cloudHaze: '#f4e6d8',
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let sky = null;

// 花岗岩贴图：细麻点 + 深色边线（每级台阶的踏面前后沿都描一道，台阶一级一级更清楚）
function granite(util, kit, edge) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.82 + 0.12 * kit.noise2(x * 0.08, y * 0.08) + 0.12 * (kit.hash2(x, y) - 0.5);
      const e = edge && (x < 4 || y < 4 || x > w - 5 || y > h - 5) ? 0.62 : 1;
      const v = Math.max(0, Math.min(255, n * e * 255)), i = (y * w + x) * 4;
      im.data[i] = v; im.data[i + 1] = v * 0.98; im.data[i + 2] = v * 0.95; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: !edge });
}

export function pathMaterials({ THREE, util, kit }) {
  return {
    road: new THREE.MeshLambertMaterial({ color: '#ada594' }),
    stairs: new THREE.MeshLambertMaterial({ color: '#ffffff', map: granite(util, kit, true) }),
  };
}

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, c = kit.routeCenter(route);
  // 太阳在前进方向偏右（山谷 / 云海那一侧），爬的时候一直在前方
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize();
  const right = new THREE.Vector3(-D.z, 0, D.x), sunXZ = D.clone().addScaledVector(right, 0.45).normalize();

  sky = buildSky(scene, ctx, sunXZ, C);
  kit.fog(scene, C.fog, 30, 170);
  scene.background = new THREE.Color(C.below);
  lights.hemi.color.set('#ffe8c8'); lights.hemi.groundColor.set('#58624a'); lights.hemi.intensity = 1.2;
  lights.sun.color.set('#ffc890'); lights.sun.intensity = 1.7;
  lights.sun.position.set(c.x + sunXZ.x * 26, 24, c.z + sunXZ.z * 26);    // 从前方照：台阶立面背光、踏面亮

  // 山体：左侧高、右侧跌进云海。kit.terrain 之后再把左侧抬成陡山壁（紧十八最陡），登顶环绕圈里压平；按坡度/高出路面上色
  const ground = kit.terrain(ctx, { amp: 11, drop: 1.05, rough: 1.8, reach: 15, seed: 3, map: granite(util, kit, false), uvScale: 5 });
  const SC = route.at(N + 1.2).pos.clone();      // 登顶点：环绕镜头半径 5.2、离地 2.3
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cc = new THREE.Color(), up = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z);
      let y = p.getY(i);
      if (nr.side > 0) {
        const wall = 8 * smooth(2.9, 7.5, nr.d) * (0.6 + 0.8 * kit.fbm(x * 0.15 + 7, z * 0.15, 3)) * (0.45 + 0.55 * smooth(17, 26, nr.s));
        const orbit = smooth(5.8, 7.2, Math.hypot(x - SC.x, z - SC.z));
        y += wall * orbit;
      }
      const past = smooth(N + 14, N + 18, nr.s);   // 南天门背后的山头压下去：从门洞里看出去是天和云海，不是一堵土
      if (past > 0) y = y * (1 - past) + (nr.y - 4 * smooth(1.5, 9, nr.d)) * past;
      p.setY(i, y);
      up[i] = y - nr.y;
    }
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const nrm = g.attributes.normal;
    const grass = new THREE.Color('#6a7a4a'), moss = new THREE.Color('#4a5e3a'), rock = new THREE.Color('#a0978a');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), n = kit.fbm(x * 0.12, z * 0.12, 3);
      const steep = smooth(0.88, 0.62, nrm.getY(i)) + smooth(1.2, 4.5, up[i]) * (0.55 + 0.6 * n);   // 陡处和高出路面的山头 = 花岗岩
      cc.copy(grass).lerp(moss, smooth(0.35, 0.65, n)).lerp(rock, Math.min(1, steep + smooth(0.62, 0.8, n) * 0.4));
      cc.multiplyScalar(1.05 + 0.25 * (kit.noise2(x * 0.5, z * 0.5) - 0.5));
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true;
  }
  // 地面取高：直接在高度场网格上双线性插值（比射线快两个数量级，撒 200 棵松不卡加载）
  const gp = ground.geometry.parameters, gs = gp.width, gn = gp.widthSegments, cell = gs / gn, gpos = ground.geometry.attributes.position;
  const hAt = (x, z) => {
    const fx = Math.max(0, Math.min(gn - 1e-6, (x - c.x + gs / 2) / cell)), fz = Math.max(0, Math.min(gn - 1e-6, (z - c.z + gs / 2) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, Y = (a, b) => gpos.getY(b * (gn + 1) + a);
    return (Y(ix, iz) * (1 - u) + Y(ix + 1, iz) * u) * (1 - v) + (Y(ix, iz + 1) * (1 - u) + Y(ix + 1, iz + 1) * u) * v;
  };

  // 台阶：浅色花岗岩，隔级略暗
  if (M.stairs && M.stairIndex.length) {
    const sc = new THREE.Color('#d3cab9'), tmp = new THREE.Color();
    for (let n = 0; n < M.stairIndex.length; n++) M.stairs.setColorAt(n, tmp.copy(sc).multiplyScalar(n % 2 ? 1 : 0.9));
    M.stairs.instanceColor.needsUpdate = true;
  }
  if (M.camp) M.camp.visible = false;           // 中天门广场上不搭帐篷

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mats = {
    vc, stoneRail: new THREE.MeshLambertMaterial({ color: '#d6cdbb' }), iron: new THREE.MeshLambertMaterial({ color: '#2b2826' }),
    cloth: new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), lambert: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    rock: new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
  };
  const gateMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2a140c' });   // 门脸背光（太阳在前方），提一点
  const texts = [], slabs = [];

  // 两座门
  const ZT = 2.5, NT = N + 15;                   // 南天门在山顶平台尽头：墙面离登顶点 6.1 > 环绕半径 5.2（浏览器里按一圈射线查过，最近 ≥ 0.8）
  const zt = zhongTianMen(ctx, ZT, gateMat), nt = nanTianMen(ctx, NT, gateMat, 0.8);   // 南天门往左挪 0.8：匾额落在 HUD 顶部面板左边的空当里
  scene.add(zt.mesh, nt.mesh); texts.push(...zt.texts, ...nt.texts);
  const ztP = route.at(ZT).pos, ntP = nt.F.base;

  // 登顶环绕镜头（半径 5.2、离地 2.3）附近压低一切：崖壁高度上限
  const cap = (x, z) => { const d = Math.hypot(x - SC.x, z - SC.z); return SC.y + 1.0 + Math.max(0, d - 5.6) * 20; };   // 圈内压低（别挡化身）；圈外镜头朝里看，高墙只当背景
  // 崖脚离路：下段贴着路；接近山顶时沿环绕圈（半径 5.6）绕开 = 南天门所在的垭口
  const wrap = base => s => Math.max(base, Math.sqrt(Math.max(0, 32.5 - (0.5 * (N + 1.2 - s)) ** 2)) + 0.15);
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const cliffs = [
    cliff(ctx, { side: 1, s0: 11, s1: 40, lat: wrap(3.05), seed: 2, cap, hOf: s => 2.4 + 7.6 * smooth(19, 28, s) }),
    cliff(ctx, { side: -1, s0: 21, s1: 40, lat: wrap(3.6), seed: 7, cap, hOf: s => 1.8 + 3.6 * smooth(22, 29, s) }),
  ];
  cliffs.forEach(g => { const m = new THREE.Mesh(g, rockMat); m.name = 'cliff'; scene.add(m); });

  // 紧十八：两侧崖壁贴着路（左 3.05、右 3.6），到顶沿环绕圈张开
  // 摩崖石刻：石面朝下山方向、偏向路，从镜头看是正的
  const face = (s, k) => { const a = route.at(s); return a.left.clone().multiplyScalar(-k).addScaledVector(a.dir, -(1 - k)).normalize(); };
  const put = (text, s, lat, up, o, k = 0.72, onGround = false) => {
    const a = route.at(s, lat), y0 = onGround ? Math.max(route.heightAt(s), hAt(a.pos.x, a.pos.z)) : route.heightAt(s);
    const at = a.pos.clone().setY(y0 + up), cv = carving(ctx, text, at, face(s, k), o);
    slabs.push(cv.slabPart); texts.push(cv.txt);
  };
  put('青云梯', 19.5, 3.8, 1.2, { w: 0.9, h: 1.75, charH: 1.5 });
  put('五岳独尊', N + 11, -4.7, 1.3, { w: 1.3, h: 3.2, charH: 2.8 }, -0.35, true);   // 山顶平台右边、南天门旁（在环绕圈外），紧十八往上看在门右侧
  put('中天门', 6.5, -2.45, 1.3, { w: 0.95, h: 2.4, d: 0.34, charH: 1.9, slab: '#cfc6b5' }, -0.5);            // 路右侧的碑
  put('泰山极顶\n1545米', N + 4, 2.9, 0.48, { w: 1.3, h: 0.9, d: 0.55, charH: 0.8, slab: '#bdb3a2' }, 0.4);      // 玉皇顶的石（矮，环绕镜头从上面过）
  const slabMesh = new THREE.Mesh(util.merged(slabs), vc); slabMesh.name = 'slabs'; scene.add(slabMesh);

  // 石栏杆 + 铁链：缓坡起到天街尽头，中天门广场不围
  for (const m of railings(ctx, [[3.5, N - 0.5]], mats)) scene.add(m);

  // 松 + 石：离路、离门、离崖、离登顶环绕圈
  const windRy = Math.atan2(-right.z, right.x);  // 松枝伸向山谷（+x 局部 → 路右侧）
  const keep = (x, z, lat, s, isRock) => {
    if (Math.hypot(x - SC.x, z - SC.z) < 7.4) return false;
    if (Math.hypot(x - ntP.x, z - ntP.z) < 5.2 || Math.hypot(x - ztP.x, z - ztP.z) < 3.4) return false;
    if (lat > 0 && lat < (isRock ? 4.2 : 7.5)) return false;
    if (lat > 0 && s > 10 && s < 40 && lat < 8.5) return false;      // 左侧崖壁
    if (lat < 0 && s > 20 && s < 40 && -lat > 3.5 && -lat < 7.5) return false;
    return util.offRoad(route, x, z, 1.2);
  };
  const F = forest(ctx, hAt, windRy, keep, mats, [
    { s: 12, lat: -3.2, sc: 1.2 }, { s: 26.5, lat: -3.0, sc: 1.15, ry: 0.3 }, { s: N + 8.5, lat: -5.6, sc: 1.4 }, { s: N + 9, lat: 7.6, sc: 1.5, ry: -0.4 }, { s: N + 3, lat: 8.2, sc: 1.3 }, { s: N - 3, lat: 9.5, sc: 1.4, ry: 0.5 }, { s: N + 12, lat: 8.4, sc: 1.2 }, { s: -3, lat: -3.4, sc: 1.3 },
  ]);
  for (const m of F.meshes) scene.add(m);

  const signs = util.textSigns(texts, { size: 96 }); signs.renderOrder = 1; scene.add(signs);
  sky.update(0, 0, false);
}

export function update(dt, st) {
  if (sky) sky.update(st.t, st.progress, st.summit);
}
