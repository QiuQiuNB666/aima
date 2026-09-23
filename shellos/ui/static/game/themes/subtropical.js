// 深圳梧桐山·好汉坡：晴朗湿润的亚热带山林。
//   一眼认出：山脚「梧桐山」红字石 + 大榕树（垂气根）→ 缓坡 →「好汉坡」石 + 两侧木护栏的长石阶 → 观景台（木平台、望远镜，右边是深圳天际线和海湾）
//            → 石阶 → 山脊（两边都往下掉，芒草）→ 大梧桐「鹏城第一峰」石。
//   氛围：蓝天积云、湿润薄雾（谷雾 + 林间雾团）、穿林光柱、谷上飞鸟、红土路肩。
// 子模块：subtropical/far.js（天、城、海、雾、光柱、鸟）、flora.js（阔叶树、榕树、蕨、灌丛、芒草）、props.js（护栏、观景台、刻字石、木牌）。
import * as THREE from 'three';
import { buildFar, LAND_Y } from './subtropical/far.js';
import { buildFlora } from './subtropical/flora.js';
import { buildProps } from './subtropical/props.js';

const C = {
  zenith: '#4d9ad8', hz: '#dbe9ea', fog: '#d3e2df', mist: '#f2f7f5', ray: '#fff4cf', bird: '#26312d',
  farHill: '#7f9aa8', land: '#5b7464', sea: '#9dbfcf', towers: ['#d4dce0', '#c3ced5', '#e2e7e8', '#b4c1ca', '#cbd3d6'],   // 楼：阳光下的浅灰白，压在灰绿城区上
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let far = null;

// 石阶贴图：浅灰花岗岩麻点 + 深色边线（一级一级分得清）+ 边角一点青苔
function stoneTex(util, kit) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.84 + 0.1 * kit.noise2(x * 0.09, y * 0.09) + 0.12 * (kit.hash2(x, y) - 0.5);
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y), e = edge < 4 ? 0.6 : 1;
      const moss = edge < 14 ? Math.max(0, kit.noise2(x * 0.18 + 5, y * 0.18) - 0.55) * 2.2 * (1 - edge / 14) : 0;
      const v = n * e * 255, i = (y * w + x) * 4;
      im.data[i] = v * (1 - 0.45 * moss); im.data[i + 1] = v * (1 - 0.1 * moss); im.data[i + 2] = v * (0.97 - 0.5 * moss); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

export function pathMaterials({ THREE, util, kit }) {
  return {
    road: new THREE.MeshLambertMaterial({ color: '#a39684' }),
    stairs: new THREE.MeshLambertMaterial({ color: '#ffffff', map: stoneTex(util, kit) }),
  };
}

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M } = ctx, N = route.N, c = kit.routeCenter(route);
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize();
  const RT = new THREE.Vector3(-D.z, 0, D.x);                        // 右（= -left）
  const sunDir = D.clone().multiplyScalar(0.55).addScaledVector(RT, -0.5).add(new THREE.Vector3(0, 0.95, 0)).normalize();   // 前左上方：踏面亮、立面背光

  kit.fog(scene, C.fog, 24, 125);
  scene.background = new THREE.Color(C.hz);
  lights.hemi.color.set('#e6f4ff'); lights.hemi.groundColor.set('#3b5632'); lights.hemi.intensity = 1.2;
  lights.sun.color.set('#fff0d2'); lights.sun.intensity = 1.75;
  lights.sun.position.copy(c).addScaledVector(sunDir, 40);

  // 山体：左高右低；右侧远处缓缓落到山下城区平面以下（海岸由 far.js 的平面画）；山脊段两侧都往下掉
  const ground = kit.terrain(ctx, { amp: 9, drop: 0.9, rough: 1.7, reach: 15, seed: 21 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cc = new THREE.Color();
    const soil = new THREE.Color('#9a5a38'), dark = new THREE.Color('#2c5a28'), mid = new THREE.Color('#3d7232'), lite = new THREE.Color('#6a9a40');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z);
      let y = p.getY(i);
      // 山脊：路左 ~16 以内也落到路面以下（两边都往下掉）；再远还是高山（登顶平台延长线最近的一大片左侧山坡不受影响）
      const ridge = smooth(N - 6, N - 1, nr.s) * (1 - smooth(14, 34, nr.d));
      if (nr.side > 0 && ridge > 0) y += ((nr.y - 0.06 - 3.5 * smooth(2.5, 12, nr.d)) - y) * ridge * smooth(2.2, 4.5, nr.d);
      if (nr.side < 0) { const k = smooth(14, 58, nr.d); y = y * (1 - k) + (LAND_Y - 3) * k; }   // 右侧陡降到山下城区（树顶都在视线下面，城市露出来）
      p.setY(i, y);
      const n = kit.fbm(x * 0.09, z * 0.09, 3);
      cc.copy(dark).lerp(mid, smooth(0.3, 0.6, n)).lerp(lite, smooth(0.55, 0.8, kit.noise2(x * 0.3 + 3, z * 0.3)) * 0.7);   // 大斑 + 树冠般的小斑
      cc.lerp(soil, smooth(2.9, 1.5, nr.d) * (0.55 + 0.4 * kit.noise2(x * 0.6, z * 0.6)));   // 路肩红土
      cc.multiplyScalar(0.92 + 0.18 * kit.noise2(x * 0.45, z * 0.45));
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  }
  // 地面取高：高度场网格双线性插值
  const gp = ground.geometry.parameters, gs = gp.width, gn = gp.widthSegments, cell = gs / gn, gpos = ground.geometry.attributes.position;
  const hAt = (x, z) => {
    const fx = Math.max(0, Math.min(gn - 1e-6, (x - c.x + gs / 2) / cell)), fz = Math.max(0, Math.min(gn - 1e-6, (z - c.z + gs / 2) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, Y = (a, b) => gpos.getY(b * (gn + 1) + a);
    return (Y(ix, iz) * (1 - u) + Y(ix + 1, iz) * u) * (1 - v) + (Y(ix, iz + 1) * (1 - u) + Y(ix + 1, iz + 1) * u) * v;
  };

  // 台阶：浅灰花岗岩，隔级略暗
  if (M.stairs && M.stairIndex.length) {
    const sc = new THREE.Color('#d9d4c8'), tmp = new THREE.Color();
    for (let n = 0; n < M.stairIndex.length; n++) M.stairs.setColorAt(n, tmp.copy(sc).multiplyScalar(n % 2 ? 1 : 0.9));
    M.stairs.instanceColor.needsUpdate = true;
  }
  if (M.camp) M.camp.visible = false;             // 景区入口，不搭帐篷

  // 关键位置
  const obs = route.segs.find(sg => sg.label === '观景台') || { start: 21, steps: 2 };
  const deckS = obs.start + obs.steps / 2 + 1.2;         // 往前挪一点：到观景台时平台在右前方
  const SC = route.at(N + 1.2).pos;                // 登顶环绕镜头中心（半径 5.2）
  const B = {
    c, D, R: RT, sunDir, hAt, landY: LAND_Y,
    banyans: [[2.2, -5.4, 1.0, 0.4], [12.5, 8.2, 0.95, 1.9], [29.5, 8.5, 0.9, 3.1], [-9, -6.5, 0.85, 2.4]],
    rails: [[-1, 8, -1], [8, obs.start - 1, 1], [8, obs.start - 3, -1], [obs.start + obs.steps, N - 5, 1], [obs.start + obs.steps + 2, N - 1, -1]],
    deck: { s: deckS, len: 2.4, w: 3.4, tele: [0.6, 2.4, 0.3] },
    stones: [
      { text: '梧桐山', s: 2.6, lat: 3.4, k: 0.45, w: 2.4, h: 1.3, d: 1.0, charH: 0.7 },          // 山脚路左（矮于 1.5，不挡镜头）
      { text: '好汉坡', s: 8.2, lat: -3.1, k: -0.55, w: 2.2, h: 1.35, d: 1.0, charH: 0.72 },
      { text: '好汉坡', s: 17.5, lat: -2.3, k: -0.3, w: 0.62, h: 1.6, board: true, vertical: true, charH: 1.45 },
      { text: '观景台', s: deckS - 1.6, lat: -1.6, k: -0.2, w: 1.25, h: 0.42, board: true, deck: true, charH: 0.32 },
      { text: '鹏城第一峰', s: N + 4.5, lat: -3.3, k: -0.4, w: 3.6, h: 1.3, d: 1.0, charH: 0.5, col: '#bdb5a5' },
    ],
  };
  const deckA = route.at(deckS), deckC = deckA.pos.clone().addScaledVector(deckA.left, -(1.1 + B.deck.w / 2));
  const clearOf = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  // 放东西的规矩：路左 3 以内不放高的、观景台和它右前方的视野留空、登顶环绕圈留空、榕树周围留空
  const PN = route.P[N], DN = route.at(N).dir;
  const banyanP = B.banyans.map(([s, lat]) => route.at(s, lat).pos.clone());
  B.keep = (x, z, lat, s, kind) => {
    if (!util.offRoad(route, x, z, kind === 'low' ? 0.45 : 1.6)) return false;
    if (clearOf(x, z, SC, kind === 'low' ? 5.9 : 8)) return false;
    if (clearOf(x, z, deckC, kind === 'low' ? 2.6 : 5.5)) return false;
    if (kind === 'tree') {
      if (lat > 0 && lat < 4.5) return false;
      if (banyanP.some(p => clearOf(x, z, p, 4.6))) return false;
      // 好汉坡中段往上的右侧、登顶平台往前：只留树顶低于路面的（谷底林海），城市露出来
      const ahead = (x - PN.x) * DN.x + (z - PN.z) * DN.z > 2 && lat < 14;        // 山顶往前（镜头正前方）
      if (((lat < 0 && s > 14) || ahead) && hAt(x, z) + 11 > route.heightAt(Math.min(s, N)) - 0.8) return false;   // 11 = 最高的树模板 × 最大缩放
      if (lat < 0 && lat > -6 && s > -3 && s < 8) return false;                   // 山脚右侧：给榕树和城市留缝
      if (s > N - 5 && Math.abs(lat) < 10) return false;                          // 山脊：只有芒草和矮灌
    }
    return true;
  };

  far = buildFar(scene, ctx, B, C);
  buildFlora(scene, ctx, B);
  buildProps(scene, ctx, B);
}

export function update(dt, st) {
  if (far) far.update(st.t);
}
