// 深圳梧桐山·好汉坡：晴朗湿润的亚热带山林。
//   一眼认出：山脚「梧桐山」红字石 + 大榕树（垂气根）→ 缓坡 →「好汉坡」石 + 两侧木护栏的长石阶 → 观景台（木平台、望远镜，右边是深圳天际线和海湾）
//            → 石阶 → 山脊（两边都往下掉，芒草）→ 大梧桐「鹏城第一峰」石。
//   氛围：蓝天积云、湿润薄雾（谷雾 + 林间雾团）、穿林光柱、谷上飞鸟、红土路肩。
// 子模块：subtropical/far.js（天、城、海、雾、光柱、鸟）、flora.js（阔叶树、榕树、蕨、灌丛、芒草）、props.js（护栏、观景台、刻字石、木牌）。
import * as THREE from 'three';
import { buildFar, LAND_Y } from './subtropical/far.js';
import { buildFlora } from './subtropical/flora.js';
import { buildProps } from './subtropical/props.js';
import { buildStream } from './subtropical/stream.js';

const C = {
  zenith: '#4d9ad8', hz: '#dbe9ea', fog: '#d3e2df', mist: '#f2f7f5', ray: '#fff4cf', bird: '#26312d',
  farHill: '#7f9aa8', land: '#5b7464', sea: '#3d7aa6', towers: ['#9aa7b4', '#aab4be', '#b7bec6', '#c6ccd2', '#a4a39c', '#b4aea4'],   // 楼：暖灰 / 蓝灰（别一片白）；海湾深蓝
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let far = null, sceneRef = null, ghostDone = false, LIVE = [];   // LIVE：会动的小东西（山涧、蝴蝶、白鹭），每帧 update(dt)

// 石阶贴图：只管花岗岩麻点和一点青苔（亮度 ~0.85–1.1，乘到下面的定色上）
function stoneTex(util, kit) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.93 + 0.08 * kit.noise2(x * 0.09, y * 0.09) + 0.1 * (kit.hash2(x, y) - 0.5);
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const moss = edge < 12 ? Math.max(0, kit.noise2(x * 0.18 + 5, y * 0.18) - 0.6) * 1.6 * (1 - edge / 12) : 0;
      const v = n * 255, i = (y * w + x) * 4;
      im.data[i] = v * (1 - 0.35 * moss); im.data[i + 1] = v * (1 - 0.05 * moss); im.data[i + 2] = v * (1 - 0.45 * moss); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

// 台阶：踏面 / 立面定色（不吃光——太阳在前方，立面背光会和踏面糊成一片灰坡）。踏面 #C9C3B5、立面 #5A5750（亮度比 > 3:1），
//   踏面前沿一条 4 cm 浅色防滑条（= 一级一级的边）。踏面/立面靠引擎的顶点色区分（踏面 1.0、立面 0.6，build 里把实例色设成 1 / 0.95）。
export const STAIR = { tread: '#c9c3b5', riser: '#5a5750', nose: '#f1ece0', noseW: 0.04 / 0.52 };
export function pathMaterials({ THREE, util, kit }) {
  const stairs = new THREE.MeshLambertMaterial({ color: '#ffffff', map: stoneTex(util, kit) });
  const U = { uTread: { value: new THREE.Color(STAIR.tread) }, uRiser: { value: new THREE.Color(STAIR.riser) }, uNose: { value: new THREE.Color(STAIR.nose) }, uNoseW: { value: STAIR.noseW } };
  stairs.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTread, uRiser, uNose;\nuniform float uNoseW;')
      .replace('#include <opaque_fragment>', `{
        float tr = step(0.8, vColor.r), alt = tr > 0.5 ? vColor.r : vColor.r / 0.6;
        vec3 det = diffuseColor.rgb / max(vColor.rgb, vec3(0.01));        // 贴图细节（麻点、青苔）
        vec3 base = mix(uRiser, uTread, tr) * det * alt;
        if (tr > 0.5 && vMapUv.x < uNoseW) base = uNose * alt;
        outgoingLight = base;
      }
      #include <opaque_fragment>`);
  };
  stairs.customProgramCacheKey = () => 'subtropical-stairs';
  return { road: new THREE.MeshLambertMaterial({ color: '#ffffff', map: paveTex(util, kit) }), stairs };
}

// 路面：花岗岩铺砖（#B9B2A4 砖面、#8F887B 砖缝、错缝、少量苔点），和石阶一套材质。
//   路面 uv：u = 横向（-1.1…1.1）、v = 沿路距离（单位）→ 一张图 = 2.2 × 2.2：横 4 块 × 纵 6 排
function paveTex(util, kit) {
  const t = util.canvasTexture(256, 256, (g, w, h) => {
    const im = g.createImageData(w, h), cols = 4, rows = 6, cw = w / cols, rh = h / rows, J = 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.floor(y / rh), xo = (x + (r % 2) * cw / 2) % w, c = Math.floor(xo / cw);
      const jx = Math.min(xo - c * cw, (c + 1) * cw - xo), jy = Math.min(y - r * rh, (r + 1) * rh - y), joint = Math.min(jx, jy) < J / 2 + 0.5;
      const tone = 0.93 + 0.1 * kit.hash2(c * 7 + r, r * 13 + c), n = 0.94 + 0.07 * kit.noise2(x * 0.12, y * 0.12) + 0.07 * (kit.hash2(x, y) - 0.5);
      const moss = !joint && Math.min(jx, jy) < 7 && kit.noise2(x * 0.21 + 9, y * 0.21) > 0.72 && kit.hash2(x + 3, y) > 0.35;
      const i = (y * w + x) * 4;
      const [R, G, B] = joint ? [143, 136, 123] : moss ? [118, 132, 86] : [185 * tone * n, 178 * tone * n, 164 * tone * n];
      im.data[i] = R; im.data[i + 1] = G; im.data[i + 2] = B; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: true });
  t.repeat.set(1 / 2.2, 1 / 2.2);
  return t;
}

let SFX = null;                                      // 落阶反馈（kit.stepFx）
export function build(scene, ctx) {
  SFX = ctx.kit.stepFx(ctx, { dust: '#cbbf9f', flash: '#fffbe8' });
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
    const dark = new THREE.Color('#2c5a28'), mid = new THREE.Color('#3d7232'), lite = new THREE.Color('#6a9a40');
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

  soilStrip(scene, ctx, hAt);

  // 台阶：浅灰花岗岩，隔级略暗
  if (M.stairs && M.stairIndex.length) {
    const tmp = new THREE.Color();
    for (let n = 0; n < M.stairIndex.length; n++) M.stairs.setColorAt(n, tmp.setScalar(n % 2 ? 1 : 0.95));   // 定色在 pathMaterials；这里只给隔级明暗
    M.stairs.instanceColor.needsUpdate = true;
  }
  if (M.camp) M.camp.visible = false;             // 景区入口，不搭帐篷
  if (M.flag) M.flag.visible = false;             // 山顶有「鹏城第一峰」石，不插灰杆绿旗
  // 路沿 / 每步刻度：深褐灰（亮绿细线像调试线框）
  if (M.edges) { M.edges.material.color.set('#4a4036'); M.edges.material.opacity = 0.8; }
  if (M.lines) { const a = M.lines.geometry.attributes.color, k = new THREE.Color('#4a4036'); for (let i = 0; i < a.count; i++) a.setXYZ(i, k.r, k.g, k.b); a.needsUpdate = true; M.lines.material.opacity = 0.75; }
  // 影子：饱和一点的青 + 不透明度 0.55（浅色石阶、白城前也看得见）；轮廓光和光晕在 update 第一帧挂上（影子在 build 之后才加载）
  ctx.theme.ghost = '#1fb2e4'; ctx.theme.ghostOpacity = 0.55;
  sceneRef = scene;

  // 关键位置
  const obs = route.segs.find(sg => sg.label === '观景台') || { start: 21, steps: 2 };
  const deckS = obs.start + obs.steps / 2 + 1.2;         // 往前挪一点：到观景台时平台在右前方
  const SC = route.at(N + 1.2).pos;                // 登顶环绕镜头中心（半径 5.2）
  const B = {
    c, D, R: RT, sunDir, hAt, landY: LAND_Y,
    // 榕树 [s, lat, 缩放]。山脚那棵：往前挪到 s 4（右侧地面往下掉，再往右树冠会落到视平线上把海挡死），
    //   朝路方向的冠幅压到 0.62：pos0 只在右缘露树干 + 冠，右侧中段露出海湾；pos6 已在镜头侧后方
    banyans: [[4.0, -5.6, [0.62, 0.95, 0.9]], [12.5, 8.2, 0.95], [29.5, 8.5, 0.9], [-9, -6.5, 0.85]],
    rails: [[-1, 8, -1], [8, obs.start - 1, 1], [8, obs.start - 3, -1], [obs.start + obs.steps, N - 5, 1], [obs.start + obs.steps + 2, N - 1, -1]],
    deck: { s: deckS, len: 2.4, w: 3.4, tele: 0.45 },                // tele = 镜筒往右转（弧度，朝城区）
    wutong: null,
    stones: [
      // 刻字石：th = 字块高（字形约 0.7 th）。梧桐山在山脚左前（s 1.0、路左 3.85、字面朝山下（镜头来的方向）：山脚看得到，走到缓坡时已在镜头后面，不从左下角 HUD 下面露出来）；好汉坡石往右挪（不在影子正后方）
      { text: '梧桐山', s: 1.0, lat: 3.85, k: 0.12, tx: 0.32, w: 2.7, h: 1.4, d: 1.1, th: 0.66 },          // 路左 3.85（矮于 1.5，不挡镜头）
      { text: '↑ 好汉坡\n↑ 观景台 · 大梧桐', s: 2.4, lat: -2.2, k: -0.3, w: 2.5, h: 0.72, board: true, charH: 0.56, legs: 0.85 },   // 山脚棕色指路牌（深圳郊野公园的样式），开场帧右侧
      { text: '好汉坡', s: 9.4, lat: -3.9, fa: 36, w: 2.5, h: 1.4, d: 1.0, th: 0.66 },                        // fa 36° = 老朝向再往镜头转 15°；往前 1.2 步：pos6 整块在画面里
      { text: '好汉坡', s: 17.5, lat: -2.3, k: -0.3, w: 0.62, h: 1.6, board: true, vertical: true, charH: 1.45 },
      { text: '观景台', s: deckS - 1.6, lat: -1.75, k: -0.2, w: 1.3, h: 0.46, board: true, deck: true, charH: 0.36, legs: 1.3 },   // 牌子抬过平台栏杆（以前被栏杆柱挡掉「台」）
      // 鹏城第一峰：路尽头左侧（影子和它的标签在右边），登顶环绕圈（半径 5.2）外。矮、半埋（sink）：字压在离地 0.2–0.8，
      //   pos14 落在左上信息卡下沿和峰哥头像之间、左栏杆左边；pos22 在左栏杆尽头左边；pos33 在影子标签左边
      { text: '鹏城第一峰', s: N + 14.5, lat: 2.2, fa: -10, w: 4.6, h: 1.5, d: 1.2, th: 0.92, sink: 0.2, col: '#bdb5a5' },
      { text: '大梧桐 · 海拔 943.7 米', s: N + 12.8, lat: -2.3, k: -0.35, w: 2.5, h: 0.4, board: true, charH: 0.28, legs: 0.7 },   // 山顶海拔牌（真实的大梧桐 943.7 m），路右、和刻字石对称
    ],
  };
  { const a = route.at(N + 30, 3.0); B.wutong = { p: a.pos.clone().setY(hAt(a.pos.x, a.pos.z)), h: 6.8, ry: 0.6 }; }
  const deckA = route.at(deckS), deckC = deckA.pos.clone().addScaledVector(deckA.left, -(1.1 + B.deck.w / 2));
  const clearOf = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
  // 放东西的规矩：路左 3 以内不放高的、观景台和它右前方的视野留空、登顶环绕圈留空、榕树周围留空
  const PN = route.P[N], DN = route.at(N).dir;
  const banyanP = B.banyans.map(([s, lat]) => route.at(s, lat).pos.clone());
  const stoneP = B.stones.filter(S => !S.board).map(S => route.at(S.s, S.lat).pos.clone());
  B.keep = (x, z, lat, s, kind) => {
    if (!util.offRoad(route, x, z, kind === 'low' ? 0.45 : 1.6)) return false;
    if (stoneP.some(p => clearOf(x, z, p, kind === 'low' ? 1.5 : 3.2))) return false;
    if (clearOf(x, z, SC, kind === 'low' ? 5.9 : 8)) return false;
    if (clearOf(x, z, deckC, kind === 'low' ? 2.6 : 5.5)) return false;
    if (clearOf(x, z, B.wutong.p, kind === 'low' ? 1.2 : 9)) return false;
    if (kind === 'tree') {
      if (lat > 0 && lat < 4.5) return false;
      if (banyanP.some(p => clearOf(x, z, p, 4.6))) return false;
      // 好汉坡中段往上的右侧、登顶平台往前：只留树顶低于路面的（谷底林海），城市露出来
      const ahead = (x - PN.x) * DN.x + (z - PN.z) * DN.z > 2 && lat < 45;        // 山顶往前（镜头正前方；左边远坡也算：大梧桐背后要是天）
      if (((lat < 0 && s > 14) || ahead) && hAt(x, z) + 11 > route.heightAt(Math.min(s, N)) - 0.8) return false;   // 11 = 最高的树模板 × 最大缩放
      if (lat < 0 && lat > -6 && s > -3 && s < 8) return false;                   // 山脚右侧：给榕树和城市留缝
      if (s > N - 5 && Math.abs(lat) < 10) return false;                          // 山脊：只有芒草和矮灌
      if (s > N - 12 && lat > 0 && lat < 13) return false;                        // 山脊左坡：不留高树（pos33 顶部 HUD 后面不透出树冠，大梧桐的剪影干净）
    }
    return true;
  };

  far = buildFar(scene, ctx, B, C);
  buildFlora(scene, ctx, B);
  buildProps(scene, ctx, B);
  // 第 2 批：缓坡上一条山涧（左坡流下 → 从路面下穿过 → 右坡跌水进山谷）、路边两群蝴蝶（橙 / 蓝）、山谷里盘旋的白鹭
  const k = ctx.kit, at = (s, lat) => route.at(s, lat).pos.clone();
  LIVE = [
    buildStream(scene, ctx, hAt, [[10.6, 12], [9.7, 8], [8.9, 4.6], [8.35, 2.3], [8.15, 0], [8.3, -2.3], [8.9, -5], [8.3, -9], [7.5, -13]]),   // 左坡正对镜头，水带看得全
    k.flock(ctx, { count: k.LOW ? 3 : 6, center: at(2.8, -2.4), radius: 1.1, spread: 0.7, height: 1.35, size: 0.42, color: '#ff9a2a', speed: 1.1, flap: 7, name: 'butterflies' }),
    k.flock(ctx, { count: k.LOW ? 3 : 5, center: at(12.5, -2.5), radius: 1.0, spread: 0.6, height: 1.4, size: 0.4, color: '#46a0ff', speed: -1.0, flap: 7.5, name: 'butterflies' }),
    k.flock(ctx, { count: k.LOW ? 3 : 5, center: at(24, -9), radius: 5, spread: 2.5, height: -0.5, size: 1.5, color: '#f6f6f0', speed: 0.14, flap: 1.2, name: 'egrets' }),
  ];
}

// 路肩红土：路沿外 0.8 m 一条贴地带（跟着地面高度），外沿用噪声 alpha 咬出不规则的边（alphaTest，干净利落，不是顶点色糊开）
function soilStrip(scene, ctx, hAt) {
  const { route, util, kit } = ctx, N = route.N, W0 = 1.1, W1 = 1.95, NC = 4;
  const tex = util.canvasTexture(64, 256, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / (w - 1), n = kit.fbm(x * 0.06, y * 0.035, 3), grit = kit.hash2(x, y);
      const edge = 0.7 + 0.24 * n;                                             // 外沿在 70–94 % 之间起伏
      const a = u < edge ? 255 : 0, k = 0.86 + 0.2 * kit.noise2(x * 0.2, y * 0.08) + 0.12 * (grit - 0.5) - 0.12 * Math.max(0, u - edge + 0.08) / 0.08;
      const i = (y * w + x) * 4;
      im.data[i] = 158 * k; im.data[i + 1] = 90 * k; im.data[i + 2] = 56 * k; im.data[i + 3] = a;
      if (grit > 0.985 && a) { im.data[i] = im.data[i + 1] = im.data[i + 2] = 190; }   // 小石子
    }
    g.putImageData(im, 0, 0);
  });
  tex.wrapT = THREE.RepeatWrapping;
  const pos = [], uv = [], idx = [], S0 = -16, S1 = N + 16, ds = 0.25;
  for (const side of [1, -1]) {
    const b0 = pos.length / 3;
    let rows = 0;
    for (let s = S0; s <= S1 + 1e-6; s += ds, rows++) for (let c = 0; c <= NC; c++) {
      const w = W0 + (W1 - W0) * c / NC, a = route.at(s, side * w);
      pos.push(a.pos.x, hAt(a.pos.x, a.pos.z) + 0.035, a.pos.z); uv.push(c / NC, s * 0.25);
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < NC; c++) {
      const a = b0 + r * (NC + 1) + c, b = a + NC + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.name = 'soilStrip'; scene.add(m);
}

export function update(dt, st) {
  if (SFX) SFX.update(dt, st);
  if (far) far.update(st.t);
  for (const o of LIVE) o.update(dt);
  if (!ghostDone && sceneRef) { ghostDone = true; dressGhost(sceneRef); }
}

// 影子：给引擎的半透明材质补菲涅尔轮廓光（#5FE3FF，边缘更不透明）+ 身后一团固定的青色光晕。
//   在渲染前第一帧改（材质还没编译）；引擎每帧改 opacity 照常生效。ponytail: 该进引擎 loadAvatar(ghost)，见 engine_requests
function dressGhost(scene) {
  const g = scene.getObjectByName('ghost');
  if (!g) return;
  const rim = { value: new THREE.Color('#5fe3ff') };
  g.traverse(o => {
    if (!o.isMesh || !o.material || o.material.userData.rim) return;
    const m = o.material; m.userData.rim = true;
    m.onBeforeCompile = sh => {
      sh.uniforms.uRim = rim;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN, vGV;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_SKINNING\nvGN = normalize(transformedNormal);\n#else\nvGN = normalize(normalMatrix * normal);\n#endif\nvGV = -mvPosition.xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN, vGV;\nuniform vec3 uRim;')
        .replace('#include <opaque_fragment>', `float fr = pow(1.0 - abs(dot(normalize(vGN), normalize(vGV))), 1.8);
          outgoingLight = mix(outgoingLight, uRim, fr);
          diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.8 * fr));
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'subtropical-ghost-rim';
    m.needsUpdate = true;
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: '#5fe3ff', transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
  halo.scale.set(1.5, 2.3, 1); halo.position.y = 0.85; halo.renderOrder = 1; halo.name = 'ghostHalo';
  g.add(halo);
}
function haloTex() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
