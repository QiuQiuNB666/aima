// 训练场（台阶 / 长坡共用）—— 干净的科技实验室：
//   一眼认出：路段按类型上色（与 /worlds 一致）+ 发光路沿；台阶踏步前缘亮条；每步脚印 + 步号；
//            路段开始前 3 步路中线上的地面大字；起点蓝线 / 终点白线；路右外侧的简化高度尺（整米细线 + 路段起止立柱 + 剖面线），
//            只画化身前方、投影不进右下 HUD 的那一截；一把跟着化身走的读数尺 + 三角游标（当前海拔）。
//   氛围：平地基座、细网格地面、远处一圈龙门架（顶端冷青灯条）、终点方向的训练场大牌、地平线光带、压暗的天顶。
import * as THREE from 'three';
import { ROAD_W, STEP, APRON } from '../path.js';

const KC = { flat: '#556070', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff4d4f' };
const TXT = { ...KC, flat: '#c3ceda' };                          // 地面文字：平地用浅灰，其余同路段色
const NAME = { up: '上坡 ▲', down: '下坡 ▼', stairs_up: '上台阶 ▲', stairs_down: '下台阶 ▼', wait: '红灯' };
const C = { skyTop: '#070a0f', skyBot: '#17202b', fog: '#141b24', ground: '#141a22', road: '#2a323d', plinth: '#2e3844', gauge: '#6f8296', band: '#3b5a78', glow: '#5fd3ff' };
const HW = ROAD_W / 2, GAUGE = HW + 1.4;                       // 高度尺在路右外侧 1.4（影子在右 0.5，尺在它身后远一点）
// 高度尺可见范围：投影后 x ≤ 1560/1920、y ≤ 830/1080（NDC），不进右下 HUD
const NDC_X = 1560 / 960 - 1, NDC_Y = 1 - 830 / 540;
let route = null, gaugeMeshes = [], ruler = null, cursor = null, flag = null, flagBase = null, U = 1, TOP = 1, A0 = 0;
const cur = {}, _v = new THREE.Vector3(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

const col = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const stairs = k => k.startsWith('stairs');

export function pathMaterials({ THREE }) {
  return {
    road: new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }),   // 路段色写在顶点色里（build 里填）
    stairs: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  };
}

// 地面网格：一块贴图 = 5×5 单位；0.25 细线、1 单位中线、5 单位粗线
function gridTex(util) {
  const t = util.canvasTexture(1280, 1280, (g, w) => {
    g.fillStyle = C.ground; g.fillRect(0, 0, w, w);
    const u = w / 5;
    g.fillStyle = '#1a212b'; for (let k = 0; k < 20; k++) { g.fillRect(k * u / 4, 0, 2, w); g.fillRect(0, k * u / 4, w, 2); }
    g.fillStyle = '#243040'; for (let k = 0; k < 5; k++) { g.fillRect(k * u, 0, 3, w); g.fillRect(0, k * u, w, 3); }
    g.fillStyle = '#34465a'; g.fillRect(0, 0, 5, w); g.fillRect(0, 0, w, 5);
  }, { repeat: true });
  t.anisotropy = 8;
  return t;
}

// 远处一圈墙：底 = 雾色（接地面），地平线一道亮光带（#3b5a78），往上淡出成透明，露出压暗的天顶
function wallTex(util) {
  return util.canvasTexture(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, C.fog); gr.addColorStop(0.13, C.fog); gr.addColorStop(0.19, C.band); gr.addColorStop(0.24, 'rgba(38,56,76,0.9)');
    gr.addColorStop(0.36, 'rgba(24,34,46,0.55)'); gr.addColorStop(0.55, 'rgba(20,28,38,0)'); gr.addColorStop(1, 'rgba(20,28,38,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,200,235,0.22)'; g.fillRect(0, h * (1 - 0.19), w, 2);
  }, { repeat: true });
}

// 地面贴片朝向：跟随坡度（台阶取水平）。text=true 时是文字板（XY 平面，字头朝前）；否则是 XZ 平面（X 朝前）
const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
function floorAt(s, lateral, lift, text) {
  const a = route.at(s, lateral), i = a.i, st = route.steps[i];
  const inside = s >= 0 && s < route.N, rise = inside && !stairs(st.kind) ? st.h1 - st.h0 : 0;
  _d.set(a.dir.x * STEP, rise, a.dir.z * STEP).normalize();
  _r.copy(a.left).negate(); _n.crossVectors(_r, _d);
  const q = new THREE.Quaternion().setFromRotationMatrix(text ? _m.makeBasis(_r, _d, _n) : _m.makeBasis(_d, _n, _r));
  const y = inside && stairs(st.kind) ? st.top : a.pos.y;
  return { p: a.pos.clone().setY(y).addScaledVector(_n, lift), q, kind: inside ? st.kind : 'flat', a };
}

// 游标贴图：「2.4 m」+ 指向尺子的三角（白底、路段色描边）。只在数值 / 路段变了时重画
function drawCursor(g, w, h, txt, kc) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(8,12,18,0.85)'; g.strokeStyle = kc; g.lineWidth = 5;
  g.beginPath(); g.roundRect(3, h * 0.12, w * 0.66, h * 0.76, 14); g.fill(); g.stroke();
  g.font = `900 ${h * 0.52}px -apple-system,"PingFang SC",sans-serif`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, w * 0.33 + 2, h * 0.52);
  g.beginPath(); g.moveTo(w * 0.72, h * 0.16); g.lineTo(w - 6, h * 0.5); g.lineTo(w * 0.72, h * 0.84); g.closePath();
  g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 7; g.strokeStyle = kc; g.stroke();
}

export function build(scene, ctx) {
  const { world, kit, util, lights, meshes: M, rand } = ctx;
  route = ctx.route;
  const { N, steps, segs } = route, c = kit.routeCenter(route);
  const kindAt = s => (s >= 0 && s < N) ? steps[Math.floor(s)].kind : 'flat';

  // ---- 路面：按路段顶点上色（每个四边形 4 个独立顶点，按四边形中心取路段）----
  {
    const g = M.road.geometry, p = g.attributes.position, cc = new Float32Array(p.count * 3), k = new THREE.Color();
    for (let q = 0; q < p.count; q += 4) {
      const x = (p.getX(q) + p.getX(q + 3)) / 2, z = (p.getZ(q) + p.getZ(q + 3)) / 2, n = util.nearestRoute(route, x, z);
      const kind = kindAt(Math.floor(n.s + 0.02));
      k.copy(kind === 'flat' ? new THREE.Color('#38414d') : col(C.road, KC[kind], 0.36));
      for (let v = 0; v < 4; v++) cc.set([k.r, k.g, k.b], (q + v) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  }
  // ---- 台阶：踏面按路段色（隔级略暗），立面引擎已 ×0.6 ----
  M.stairIndex.forEach((i, n) => M.stairs.setColorAt(n, col('#3a424e', KC[steps[i].kind], 0.86).multiplyScalar(n % 2 ? 1 : 0.9)));
  if (M.stairIndex.length) M.stairs.instanceColor.needsUpdate = true;
  // 引擎刻度线按路段上色（前 N+1 条是每步刻度）
  {
    const ca = M.lines.geometry.attributes.color, k = new THREE.Color();
    for (let i = 0; i <= N; i++) { k.set(KC[steps[Math.min(i, N - 1)].kind]); ca.setXYZ(2 * i, k.r, k.g, k.b); ca.setXYZ(2 * i + 1, k.r, k.g, k.b); }
    ca.needsUpdate = true;
  }
  if (M.camp) M.camp.visible = false;                          // 实验室里不搭帐篷
  if (M.flag) M.flag.visible = false;                          // 换成路外带底座的终点旗（下面）

  // ---- 天、雾、光 ----
  kit.sky(scene, C.skyTop, C.skyBot, { exponent: 0.5 });
  kit.fog(scene, C.fog, 22, 95);
  scene.background = new THREE.Color(C.fog);
  lights.hemi.color.set('#e4eeff'); lights.hemi.groundColor.set('#1c2430'); lights.hemi.intensity = 1.35;
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize(), L = new THREE.Vector3(D.z, 0, -D.x);
  lights.sun.color.set('#ffffff'); lights.sun.intensity = 1.0;
  lights.sun.position.copy(c).addScaledVector(D, -18).addScaledVector(L, 12).setY(34);   // 身后左上：踏面亮、立面次之、侧面最暗

  // ---- 地面：y=0 平面 + 细网格；远处墙（地平线光带）----
  {
    const tex = gridTex(util), S = 260; tex.repeat.set(S / 5, S / 5);
    const g = new THREE.PlaneGeometry(S, S); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(c.x, -0.004, c.z); m.name = 'ground'; scene.add(m);
    const wt = wallTex(util); wt.repeat.set(10, 1);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 48, 64, 1, true), new THREE.MeshBasicMaterial({ map: wt, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
    w.position.set(c.x, 18, c.z); w.renderOrder = -9; w.name = 'labWall'; scene.add(w);
  }

  // ---- 远景：一圈龙门架（半径 70–92，高 5–7.5：再高顶梁会伸进上沿 HUD），顶梁下一条冷青灯条；终点方向一块训练场大牌 ----
  {
    const dAng = Math.atan2(D.z, D.x), gs = [], lamp = [];
    const legs = util.merged([
      { geo: new THREE.BoxGeometry(0.7, 1, 0.7), p: [-3.2, 0.5, 0] }, { geo: new THREE.BoxGeometry(0.7, 1, 0.7), p: [3.2, 0.5, 0] },
      { geo: new THREE.BoxGeometry(7.4, 0.07, 0.8), p: [0, 0.965, 0] },
    ]);
    for (let k = 0; k < 18; k++) {
      const th = dAng + (k + 0.5) / 18 * Math.PI * 2 + (rand() - 0.5) * 0.12;
      if (Math.abs(Math.sin((th - dAng) / 2)) < 0.14) continue;   // 大牌前后不放
      const R = 70 + rand() * 22, H = 5 + rand() * 2.5, x = c.x + Math.cos(th) * R, z = c.z + Math.sin(th) * R, ry = -th - Math.PI / 2;
      gs.push({ p: [x, 0, z], ry, s: [1, H, 1] });
      lamp.push({ p: [x, H * 0.93 - 0.1, z], ry, s: [6.2, 0.16, 0.3] });
    }
    const gm = util.instanced(legs, new THREE.MeshBasicMaterial({ color: '#0b1017', fog: false, vertexColors: false }), gs); gm.name = 'gantries'; scene.add(gm);
    const lm = util.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: C.glow, fog: false }), lamp); lm.name = 'gantryLamps'; scene.add(lm);
    const label = world.id === 'train_slope' ? 'TRAINING 02 · 长坡' : 'TRAINING 01 · 台阶';
    const pnl = util.textPlane(label, 3.6, { size: 120, weight: 800, color: '#a9bccd', bg: '#0c131b', border: '#3b5a78', pad: 0.45, fog: false });
    pnl.material.transparent = false; pnl.material.depthWrite = true;
    pnl.position.copy(c).addScaledVector(D, 92).setY(3.4); pnl.lookAt(c.x, 3.4, c.z); pnl.name = 'trainingBoard'; scene.add(pnl);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(pnl.geometry.parameters.width, 0.25, 0.3), new THREE.MeshBasicMaterial({ color: C.glow, fog: false }));
    bar.position.set(0, -2.0, 0.1); pnl.add(bar);
  }

  // ---- 基座：路面两侧立墙落到 y=0；台阶段贴在方块侧面外一点，把彩色侧面盖成中性灰（只剩踏面和立面带色）----
  const S0 = -APRON / STEP, S1 = N + APRON / STEP, pos = [];
  for (let s = S0; s < S1; s += 0.25) {
    const st = steps[Math.floor(s)], onStair = stairs(kindAt(s)), w = onStair ? HW + 0.006 : HW;
    const a = route.at(s), b = route.at(s + 0.25);
    for (const sg of [1, -1]) {
      const ax = a.pos.x + a.left.x * w * sg, az = a.pos.z + a.left.z * w * sg, bx = b.pos.x + b.left.x * w * sg, bz = b.pos.z + b.left.z * w * sg;
      const ay = onStair ? st.top : a.pos.y - 0.005, by = onStair ? st.top : b.pos.y - 0.005;
      if (ay < 0.01 && by < 0.01) continue;
      pos.push(ax, ay, az, ax, 0, az, bx, by, bz, bx, by, bz, ax, 0, az, bx, 0, bz);
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: C.plinth, side: THREE.DoubleSide })); m.name = 'plinth'; scene.add(m);
  }

  // ---- 发光路沿（按路段色）+ 台阶前缘亮条 + 终点白线 ----
  const box = new THREE.BoxGeometry(1, 1, 1), parts = [];
  for (let s = S0; s < S1 - 1e-6; s += 0.25) {
    const kind = kindAt(s), i = Math.floor(s), st = steps[i];
    for (const sg of [1, -1]) {
      const a = route.at(s, sg * (HW - 0.03)), b = route.at(s + 0.25, sg * (HW - 0.03));
      const ya = stairs(kind) ? st.top : a.pos.y, yb = stairs(kind) ? st.top : b.pos.y;
      const mid = new THREE.Vector3((a.pos.x + b.pos.x) / 2, (ya + yb) / 2 + 0.018, (a.pos.z + b.pos.z) / 2);
      const len = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z, yb - ya) + 0.01;
      const dq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(b.pos.x - a.pos.x, yb - ya, b.pos.z - a.pos.z).normalize());
      parts.push({ geo: box, p: mid, q: dq, s: [len, 0.04, 0.06], color: kind === 'flat' ? '#7d8ea3' : KC[kind] });
    }
  }
  for (const i of M.stairIndex) {                              // 踏步前缘：上台阶在本级起点，下台阶在本级终点（踏空的那条边）
    const st = steps[i], up = st.kind === 'stairs_up', s = up ? i + 0.06 : i + 0.94, a = route.at(s);
    parts.push({ geo: box, p: a.pos.clone().setY(st.top + 0.012), ry: -a.heading, s: [0.1, 0.03, ROAD_W - 0.14], color: KC[st.kind] });
  }
  { const a = route.at(N); parts.push({ geo: box, p: a.pos.clone().setY(a.pos.y + 0.012), ry: -a.heading, s: [0.24, 0.02, ROAD_W], color: '#f4f8fc' }); }
  const edges = new THREE.Mesh(util.merged(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  edges.name = 'edges'; scene.add(edges);

  // ---- 脚印（化身道：左 0.35，左右脚交替）----
  const footTex = util.canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(w * 0.62, h * 0.5, w * 0.3, h * 0.36, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w * 0.2, h * 0.52, w * 0.15, h * 0.27, 0, 0, Math.PI * 2); g.fill();
  });
  const feet = [];
  for (let i = 0; i < N; i++) {
    const f = floorAt(i + 0.5, 0.35 + (i % 2 ? -0.11 : 0.11), 0.014, false);
    feet.push({ p: f.p, q: f.q, s: [1, 1, i % 2 ? -1 : 1], color: col('#ffffff', KC[f.kind], 0.35) });
  }
  const fg = new THREE.PlaneGeometry(0.28, 0.12); fg.rotateX(-Math.PI / 2);
  const fm = util.instanced(fg, new THREE.MeshBasicMaterial({ map: footTex, alphaTest: 0.5, side: THREE.DoubleSide }), feet);
  fm.material.color.set('#ffffff'); fm.name = 'feet'; scene.add(fm);

  // ---- 地面文字（一张图集 = 1 次绘制）：步号、路段大字（路段开始前 3 步、路中线）、起点 / 终点 ----
  const signs = [];
  for (let i = 0; i < N; i++) {
    const f = floorAt(i + 0.5, 0.86, 0.016, true);
    signs.push({ text: String(i + 1), p: f.p, q: f.q, h: 0.22, color: TXT[f.kind], bg: 'rgba(10,14,20,0.82)', weight: 800, pad: 0.22 });
  }
  for (const sg of segs) {
    if (sg.kind === 'flat') continue;
    const f = floorAt(Math.max(sg.start - 3, 1.8), 0, 0.016, true);   // 第一段离起点太近：至少放在起点前方 1.8 步，别压在起点线上
    signs.push({ text: `${NAME[sg.kind]}\n${sg.steps} 步`, p: f.p, q: f.q, h: 0.8, color: TXT[sg.kind], weight: 900, pad: 0.15 });
  }
  { const f = floorAt(-1.6, 0, 0.016, true); signs.push({ text: '起点', p: f.p, q: f.q, h: 0.42, color: '#e8eef5', weight: 900, pad: 0.15 }); }
  { const f = floorAt(N - 2, 0, 0.016, true); signs.push({ text: '终点', p: f.p, q: f.q, h: 0.62, color: '#ffffff', weight: 900, pad: 0.15 }); }
  const text = util.textSigns(signs, { size: 72 });
  text.renderOrder = 1; text.name = 'floorText'; scene.add(text);

  // ---- 终点旗：路右沿外 0.4、终点线后 0.6 步，0.3 m 深灰底座 + 灰杆 + 8×4 细分旗面（update 里正弦摆）----
  {
    const a = route.at(N + 0.6, -(HW + 0.4)), fc = new THREE.Color((ctx.theme.accent || [])[0] || '#3ddc84');
    flag = new THREE.Group(); flag.name = 'finishFlag';
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: '#2b323b' })); base.position.y = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 2.3, 10), new THREE.MeshLambertMaterial({ color: '#c9d2dc' })); pole.position.y = 1.27;
    const cg = new THREE.PlaneGeometry(0.9, 0.55, 8, 4); cg.translate(0.45, 0, 0);
    const cloth = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: fc, emissive: fc.clone().multiplyScalar(0.4), side: THREE.DoubleSide }));
    cloth.position.set(0.03, 2.1, 0);
    flag.add(base, pole, cloth); flag.position.copy(a.pos); flag.rotation.y = -a.heading; scene.add(flag);
    flagBase = Float32Array.from(cg.attributes.position.array); flag.userData.cloth = cloth;
  }

  // ---- 高度尺（路右外侧 GAUGE）：整米细线（≤5 根，透明 0.25）+ 路段起止立柱 + 剖面线（路段色）----
  //   几何按步号顺序合并，offO/offB[i] = 第 i 步开始的顶点下标；update 里用 drawRange 只画化身前方、投影在 HUD 外的那一截
  const [a0, a1] = world.alt || [0, 0], span = (a1 - a0) || 1;
  U = route.hmax / span; A0 = a0; TOP = Math.min(5, Math.ceil(a1 - a0));   // 1 米（虚拟）= U 单位，和 HUD 的海拔同一换算
  const bounds = new Set([N]); segs.forEach(sg => bounds.add(sg.start));
  const opaque = [], bars = [], offO = [], offB = [];
  for (let i = 0; i < N; i++) {
    offO.push(opaque.length * 36); offB.push(bars.length * 36);
    const a = route.at(i, -GAUGE), b = route.at(i + 1, -GAUGE), st = steps[i], len = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) + 0.004;
    const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2, ry = -route.at(i + 0.5).heading;
    for (let m = 1; m <= TOP; m++) bars.push({ geo: box, p: [mx, m * U, mz], ry, s: [len, 0.02, 0.02], color: '#9fb2c6' });
    if (bounds.has(i)) opaque.push({ geo: box, p: [a.pos.x, TOP * U / 2 + 0.02, a.pos.z], s: [0.045, TOP * U + 0.04, 0.045], color: C.gauge });
    const y0 = stairs(st.kind) ? st.top : st.h0, y1 = stairs(st.kind) ? st.top : st.h1;
    const dq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(b.pos.x - a.pos.x, y1 - y0, b.pos.z - a.pos.z).normalize());
    opaque.push({ geo: box, p: [mx, (y0 + y1) / 2, mz], q: dq, s: [Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z, y1 - y0) + 0.02, 0.05, 0.05], color: KC[st.kind] });
    if (stairs(st.kind) && i + 1 < N && steps[i + 1].kind === st.kind) {   // 台阶的竖边
      const yB = steps[i + 1].top;
      opaque.push({ geo: box, p: [b.pos.x, (st.top + yB) / 2, b.pos.z], s: [0.05, Math.abs(yB - st.top) + 0.05, 0.05], color: KC[st.kind] });
    }
    if (i === N - 1) { const e = route.at(N, -GAUGE); opaque.push({ geo: box, p: [e.pos.x, TOP * U / 2 + 0.02, e.pos.z], s: [0.045, TOP * U + 0.04, 0.045], color: C.gauge }); }
  }
  offO.push(opaque.length * 36); offB.push(bars.length * 36);
  const gO = new THREE.Mesh(util.merged(opaque), new THREE.MeshBasicMaterial({ vertexColors: true }));
  const gB = new THREE.Mesh(util.merged(bars), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, depthWrite: false }));
  gO.name = 'gauge'; gB.name = 'gaugeBars'; gO.frustumCulled = gB.frustumCulled = false; scene.add(gO, gB);
  gaugeMeshes = [[gO, offO], [gB, offB]];

  // ---- 读数尺（整条路线只 1 组）：竖尺 + 整米刻度 + 「n m」+ 三角游标（当前海拔），update 里摆在化身前方 ----
  ruler = new THREE.Group(); ruler.name = 'heightRuler';
  const rp = [{ geo: box, p: [0, TOP * U / 2, 0], s: [0.05, TOP * U + 0.06, 0.03], color: '#c3ceda' }], rs = [];
  for (let m = 0; m <= TOP; m++) {
    rp.push({ geo: box, p: [0.07, m * U, 0], s: [0.14, 0.022, 0.03], color: '#c3ceda' });
    if (m) rs.push({ text: `${a0 + m} m`, p: [0.4, m * U, 0.01], h: 0.19, color: '#dbe5ef', bg: 'rgba(8,12,18,0.8)', weight: 800, pad: 0.12 });
  }
  ruler.add(new THREE.Mesh(util.merged(rp), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const rl = util.textSigns(rs, { size: 64 }); rl.renderOrder = 2; rl.material.depthTest = false; ruler.add(rl);
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 110;
  const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
  cursor = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.268), new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  cursor.renderOrder = 3; cursor.userData = { cv, ct, key: '' }; ruler.add(cursor);
  scene.add(ruler);
}

// 高度尺第 k 步起点（尺底 / 尺顶）投影进不进右下 HUD
function gaugeOk(k, cam) {
  route.at(k, -GAUGE, cur);
  _v.set(cur.pos.x, 0, cur.pos.z).project(cam);
  if (_v.z > 1 || _v.x > NDC_X || _v.y < NDC_Y) return false;
  _v.set(cur.pos.x, TOP * U, cur.pos.z).project(cam);
  return _v.x <= NDC_X;
}

// 化身 + 影子在屏幕上的框（NDC）：弯道上远处那截尺会从人身后穿过（像杆子扎进脑袋），碰到框就截断
const box2 = [0, 0, 0, 0];
function bodyBox(st, cam) {
  box2[0] = box2[2] = Infinity; box2[1] = box2[3] = -Infinity;
  for (const p of [st.avatar, st.ghost]) if (p) for (const h of [0, 1.85]) {
    _v.set(p.x, p.y + h, p.z).project(cam);
    box2[0] = Math.min(box2[0], _v.x - 0.05); box2[1] = Math.max(box2[1], _v.x + 0.05);
    box2[2] = Math.min(box2[2], _v.y); box2[3] = Math.max(box2[3], _v.y + 0.04);
  }
}
function hitsBody(k, cam) {
  route.at(k, -GAUGE, cur);
  _v.set(cur.pos.x, TOP * U, cur.pos.z).project(cam); const xt = _v.x, yt = _v.y;
  _v.set(cur.pos.x, 0, cur.pos.z).project(cam);
  return Math.max(xt, _v.x) > box2[0] && Math.min(xt, _v.x) < box2[1] && Math.min(yt, _v.y) < box2[3] && Math.max(yt, _v.y) > box2[2];
}

export function update(dt, st) {
  if (!route) return;
  const N = route.N, cam = st.camera;
  cam.updateMatrixWorld();
  // 高度尺：从化身前 3 步起找第一处投影在 HUD 外的步（前面的不画），再往前画到碰到人为止
  let k = Math.max(0, Math.ceil(st.s + 3));
  while (k < N && !gaugeOk(k, cam)) k++;
  bodyBox(st, cam);
  let e = k;
  while (e < N && !hitsBody(e + 1, cam)) e++;
  for (const [m, off] of gaugeMeshes) { m.visible = !st.summit && e > k; m.geometry.setDrawRange(off[Math.min(k, N)], off[e] - off[Math.min(k, N)]); }
  // 读数尺：摆在可见段起点后 0.8 步，字面朝路、略偏向来路
  ruler.visible = !st.summit && k < N;
  if (ruler.visible) {
    route.at(Math.min(N, k + 0.8), -(GAUGE - 0.12), cur);
    _n.copy(cur.left).addScaledVector(cur.dir, -0.8).normalize();
    _r.crossVectors(UP, _n);
    ruler.quaternion.setFromRotationMatrix(_m.makeBasis(_r, UP, _n));
    ruler.position.set(cur.pos.x, 0, cur.pos.z);
    const y = st.avatar.y, kind = st.kind || 'flat', txt = `${(A0 + y / U).toFixed(1)} m`, key = txt + kind;
    cursor.position.set(-0.45, y, 0.02);
    const ud = cursor.userData;
    if (ud.key !== key) { ud.key = key; drawCursor(ud.cv.getContext('2d'), ud.cv.width, ud.cv.height, txt, KC[kind] || KC.flat); ud.ct.needsUpdate = true; }
  }
  // 终点旗：远处弯道上旗杆正好落在人身后（像杆子扎进脑袋）时先藏起来，走近再出现；旗面正弦摆（旗根不动）
  if (flag) {
    let hide = false;
    if (st.s < N - 5) {
      _v.copy(flag.position).project(cam); const xb = _v.x, yb = _v.y;
      _v.set(flag.position.x, flag.position.y + 2.4, flag.position.z).project(cam);
      hide = Math.max(xb, _v.x) > box2[0] && Math.min(xb, _v.x) < box2[1] && Math.min(yb, _v.y) < box2[3] && Math.max(yb, _v.y) > box2[2];
    }
    flag.visible = !hide;
    const p = flag.userData.cloth.geometry.attributes.position, t = st.t;
    for (let i = 0; i < p.count; i++) {
      const x = flagBase[i * 3], y = flagBase[i * 3 + 1];
      p.setZ(i, Math.sin(x * 7 - t * 4.2 + y * 1.5) * 0.07 * (x / 0.9));
    }
    p.needsUpdate = true;
  }
}
