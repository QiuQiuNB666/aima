// 训练场（台阶 / 长坡共用）—— 干净的科技实验室：
//   一眼认出：路段按类型上色（与 /worlds 一致）+ 发光路沿；每段起点一座路段色拱门（「上台阶 ▲ · 8 步」，悬在化身头顶上方）；
//            路两侧每步一根短立柱 + 扶手（柱顶跟路面高度走：坡 = 一排斜着的柱子，台阶 = 一级级的扶手）；坡面每步一个空心箭头；
//            台阶踏步前缘亮条；每步脚印 + 步号；终点黑白格旗 + 黑白格终点线。海拔只在 HUD 右上角（一位小数），场景里不再画尺。
//   氛围：细网格地面 + 路线周围一圈提亮；场地四周 1 m 黄黑警示矮墙；平行路线的地面青色灯带；6 根编号灯柱 T-01…T-06；
//         终点方向的训练场大牌、地平线光带、压暗的天顶。
import * as THREE from 'three';
import { ROAD_W, STEP, APRON } from '../path.js';

const KC = { flat: '#556070', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff4d4f' };
const TXT = { ...KC, flat: '#c3ceda' };                          // 地面步号：平地用浅灰，其余同路段色
const NAME = { up: '上坡 ▲', down: '下坡 ▼', stairs_up: '上台阶 ▲', stairs_down: '下台阶 ▼', wait: '红灯' };
const C = { skyTop: '#070a0f', skyBot: '#17202b', fog: '#141b24', ground: '#141a22', road: '#2a323d', plinth: '#2e3844', band: '#3b5a78', glow: '#5fd3ff' };
const HW = ROAD_W / 2, AW = HW + 0.3, TB = 2.55;                 // 拱门立柱在路沿外 0.3，横梁高 2.55（牌底 ≈ 1.7，化身头顶 1.46）
let route = null, flag = null, flagBase = null, finish = null, arches = [];
const finishEnds = [new THREE.Vector3(), new THREE.Vector3()];
const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

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

// 黑白格（终点旗 / 终点线）：cols × rows 格
const checker = (util, cols, rows, px) => util.canvasTexture(cols * px, rows * px, (g) => {
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) { g.fillStyle = (x + y) % 2 ? '#15191f' : '#f4f6f8'; g.fillRect(x * px, y * px, px, px); }
});

// 地面贴片朝向：跟随坡度（台阶取水平）。text=true 时是文字板（XY 平面，X = 右、Y = 前进方向）；否则是 XZ 平面（X 朝前）
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

export function build(scene, ctx) {
  const { world, kit, util, lights, meshes: M } = ctx;
  route = ctx.route; arches = [];
  const { N, steps, segs } = route, c = kit.routeCenter(route);
  const kindAt = s => (s >= 0 && s < N) ? steps[Math.floor(s)].kind : 'flat';
  const yAt = s => { const k = kindAt(s); return stairs(k) ? steps[Math.floor(s)].top : route.heightAt(s); };   // 路面（踏面）高度

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
  if (M.flag) M.flag.visible = false;                          // 换成路外带底座的黑白格终点旗（下面）

  // ---- 天、雾、光 ----
  kit.sky(scene, C.skyTop, C.skyBot, { exponent: 0.5 });
  kit.fog(scene, C.fog, 22, 95);
  scene.background = new THREE.Color(C.fog);
  lights.hemi.color.set('#e4eeff'); lights.hemi.groundColor.set('#1c2430'); lights.hemi.intensity = 1.35;
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize(), L = new THREE.Vector3(D.z, 0, -D.x);
  lights.sun.color.set('#ffffff'); lights.sun.intensity = 1.0;
  lights.sun.position.copy(c).addScaledVector(D, -18).addScaledVector(L, 12).setY(34);   // 身后左上：踏面亮、立面次之、侧面最暗

  // 场地半径：路线（含两端平台）离中心最远处 + 7
  let R = 0; for (const [x, z] of route.poly) R = Math.max(R, Math.hypot(x - c.x, z - c.z));
  R += 7;

  // ---- 地面：y=0 平面 + 细网格 + 路线周围 8 单位内提亮（加色叠一层模糊路线）；远处墙（地平线光带）----
  {
    const tex = gridTex(util), S = 260; tex.repeat.set(S / 5, S / 5);
    const g = new THREE.PlaneGeometry(S, S); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(c.x, -0.004, c.z); m.name = 'ground'; scene.add(m);
    const A = 2 * R, px = 1024 / A;                           // 叠加层：A×A 单位，按世界 xz 对齐
    const gt = util.canvasTexture(1024, 1024, (gx, w, h) => {
      gx.fillStyle = '#000'; gx.fillRect(0, 0, w, h);
      gx.filter = `blur(${Math.round(3.5 * px)}px)`;
      gx.strokeStyle = '#1b3148'; gx.lineWidth = 9 * px; gx.lineCap = gx.lineJoin = 'round';
      gx.beginPath();
      route.poly.forEach(([x, z], k) => { const u = (x - c.x + R) * px, v = (z - c.z + R) * px; k ? gx.lineTo(u, v) : gx.moveTo(u, v); });
      gx.stroke();
    });
    const og = new THREE.PlaneGeometry(A, A); og.rotateX(-Math.PI / 2);   // 旋转后 uv 的 v 朝 -z：贴图第 0 行在 z 最小处 → 和上面的 v = z 对上
    const ov = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ map: gt, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    ov.position.set(c.x, -0.002, c.z); ov.name = 'groundGlow'; scene.add(ov);
    const wt = wallTex(util); wt.repeat.set(10, 1);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 48, 64, 1, true), new THREE.MeshBasicMaterial({ map: wt, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
    w.position.set(c.x, 18, c.z); w.renderOrder = -9; w.name = 'labWall'; scene.add(w);
  }

  // ---- 场地：四周 1 m 高黄黑警示矮墙（上半条 45° 斜纹，下半深灰 + 一道青线）----
  {
    const ht = util.canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#1b232d'; g.fillRect(0, 0, w, h);
      g.save(); g.beginPath(); g.rect(0, 0, w, h * 0.46); g.clip();
      g.fillStyle = '#d9ae2c'; g.fillRect(0, 0, w, h * 0.46);
      g.fillStyle = '#12161b';
      for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 - h * 0.46, h * 0.46); g.lineTo(x - h * 0.46, h * 0.46); g.fill(); }
      g.restore();
      g.fillStyle = C.glow; g.fillRect(0, h * 0.62, w, 3);
    }, { repeat: true });
    ht.repeat.set(Math.round(2 * Math.PI * R / 2), 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1, 128, 1, true), new THREE.MeshLambertMaterial({ map: ht, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: ht, emissiveIntensity: 0.15 }));
    wall.position.set(c.x, 0.5, c.z); wall.name = 'hazardWall'; scene.add(wall);
  }

  // ---- 地面青色灯带：平行路线（D），两侧各 4 条，长 20 ----
  {
    const items = [];
    for (const off of [4.5, 7.5, 10.5, 13.5]) for (const sg of [1, -1]) {
      const p = c.clone().addScaledVector(L, off * sg);
      if (!util.offRoad(route, p.x, p.z, 1.5)) continue;
      items.push({ p: [p.x, 0.012, p.z], ry: -Math.atan2(D.z, D.x), s: [20, 0.02, 0.1] });
    }
    const m = util.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: C.glow, toneMapped: false }), items);
    m.name = 'floorStrips'; scene.add(m);
  }

  // ---- 6 根编号灯柱 T-01…T-06：路两侧 9 单位，沿路 -12 / 0 / +12；面板朝路、略朝来路 ----
  {
    const body = [], glow = [], txt = [];
    let n = 0;
    for (const along of [-12, 0, 12]) for (const sg of [1, -1]) {
      const p = c.clone().addScaledVector(D, along).addScaledVector(L, 9 * sg), H = 3.0;
      n++;
      const nx = -L.x * sg * 0.75 - D.x * 0.66, nz = -L.z * sg * 0.75 - D.z * 0.66, ry = Math.atan2(nx, nz);
      body.push({ geo: new THREE.BoxGeometry(0.42, H, 0.42), p: [p.x, H / 2, p.z], ry, color: '#26313d' });
      glow.push({ geo: new THREE.BoxGeometry(0.46, 0.12, 0.46), p: [p.x, H + 0.06, p.z], ry, color: C.glow });
      glow.push({ geo: new THREE.BoxGeometry(0.1, H - 1.1, 0.02), p: [p.x + nx * 0.22, (H - 1.1) / 2 + 0.1, p.z + nz * 0.22], ry, color: C.glow });
      txt.push({ text: `T-0${n}`, p: [p.x + nx * 0.23, H - 0.55, p.z + nz * 0.23], ry, h: 0.6, color: '#e6f6ff', bg: '#0e1822', border: C.glow, weight: 900, pad: 0.18 });
    }
    const bm = new THREE.Mesh(util.merged(body), new THREE.MeshLambertMaterial({ vertexColors: true })); bm.name = 'columns';
    const gm = new THREE.Mesh(util.merged(glow), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); gm.name = 'columnGlow';
    const tm = util.textSigns(txt, { size: 96 }); tm.name = 'columnTags';
    scene.add(bm, gm, tm);
  }

  // ---- 终点方向远处一块训练场大牌（字高 ≈ 60 px @1080p）----
  {
    const label = world.id === 'train_slope' ? 'TRAINING 02 · 长坡' : 'TRAINING 01 · 台阶';
    const pnl = util.textPlane(label, 5.6, { size: 160, weight: 800, color: '#b9cbdc', bg: '#0c131b', border: '#3b5a78', pad: 0.4, fog: false });
    pnl.material.transparent = false; pnl.material.depthWrite = true;
    pnl.position.copy(c).addScaledVector(D, 92).setY(3.0); pnl.lookAt(c.x, 3.0, c.z); pnl.name = 'trainingBoard'; scene.add(pnl);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(pnl.geometry.parameters.width, 0.35, 0.3), new THREE.MeshBasicMaterial({ color: C.glow, fog: false }));
    bar.position.set(0, -3.0, 0.1); pnl.add(bar);
  }

  // ---- 起点背后一块大牌（正面镜头回看来路时的背景）：游戏名 + 训练场编号 ----
  {
    const pnl = util.textPlane(world.id === 'train_slope' ? '峰哥亡命天涯 · 训练场 02' : '峰哥亡命天涯 · 训练场 01', 4.6, { size: 160, weight: 900, color: '#e8eef5', bg: '#0c131b', border: C.glow, pad: 0.4, fog: false });
    pnl.material.transparent = false; pnl.material.depthWrite = true;
    pnl.position.copy(c).addScaledVector(D, -70).setY(2.6); pnl.lookAt(c.x, 2.6, c.z); pnl.name = 'homeBoard'; scene.add(pnl);
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

  // ---- 发光路沿（按路段色）+ 台阶前缘亮条 + 两侧扶手（连每步立柱的柱顶）----
  const box = new THREE.BoxGeometry(1, 1, 1), parts = [];
  const bar = (a, b, th, color) => {                           // a、b = Vector3：两点间一根方棒
    const d = _v.subVectors(b, a), len = d.length() + 0.01;
    parts.push({ geo: box, p: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize()), s: [len, th, th], color });
  };
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
  // 每步一根立柱（步中点，路沿外 0.06），柱顶 = 踏面 + 柱高；扶手连相邻柱顶 → 坡 = 斜线、台阶 = 斜扶手 + 一级级的柱子
  //   左侧（镜头那边）柱高 0.5：近处不糊镜头、不挡左侧步号；右侧 0.9
  const postC = k => col('#000000', k === 'flat' ? '#8b9bb0' : KC[k], 0.7), posts = [];
  for (const sg of [1, -1]) {
    let prev = null; const PH = sg > 0 ? 0.5 : 0.9;
    for (let i = 0; i < N; i++) {
      const s = i + 0.5, a = route.at(s, sg * (HW + 0.06)), y = yAt(s), k = steps[i].kind;
      posts.push({ p: [a.pos.x, y + PH / 2, a.pos.z], ry: -a.heading, s: [0.06, PH, 0.06], color: postC(k) });
      const top = new THREE.Vector3(a.pos.x, y + PH, a.pos.z);
      if (prev) bar(prev, top, 0.035, postC(k));
      prev = top;
    }
  }
  const edges = new THREE.Mesh(util.merged(parts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  edges.name = 'edges'; scene.add(edges);
  const pm = util.instanced(box, new THREE.MeshBasicMaterial({ color: '#ffffff' }), posts); pm.name = 'posts'; scene.add(pm);

  // ---- 坡面箭头：每步一个 V 字（宽 = 半个路宽），指向行进方向；上坡 = 路段色 60%，下坡更浅 ----
  {
    const at = util.canvasTexture(352, 96, (g, w, h) => {
      g.fillStyle = '#fff';                                     // 实心 V 字：3 米外细描边看不清
      g.beginPath(); g.moveTo(w * 0.04, h * 0.95); g.lineTo(w * 0.5, h * 0.05); g.lineTo(w * 0.96, h * 0.95);
      g.lineTo(w * 0.76, h * 0.95); g.lineTo(w * 0.5, h * 0.45); g.lineTo(w * 0.24, h * 0.95); g.closePath(); g.fill();
    });
    const items = [];
    for (let i = 0; i < N; i++) {
      const k = steps[i].kind; if (k !== 'up' && k !== 'down') continue;
      const f = floorAt(i + 0.02, 0, 0.013, true);
      items.push({ p: f.p, q: f.q, color: k === 'up' ? col('#000000', KC.up, 0.75) : col(KC.down, '#ffffff', 0.35) });
    }
    if (items.length) {
      const m = util.instanced(new THREE.PlaneGeometry(1.1, 0.3), new THREE.MeshBasicMaterial({ map: at, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }), items);
      m.name = 'chevrons'; scene.add(m);
    }
  }

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

  // ---- 地面文字（一张图集 = 1 次绘制）：步号 + 起点（路段名挪到拱门上）----
  const signs = [];
  for (let i = 0; i < N; i++) {
    const f = floorAt(i + 0.5, 0.86, 0.016, true);
    signs.push({ text: String(i + 1), p: f.p, q: f.q, h: 0.22, color: TXT[f.kind], bg: 'rgba(10,14,20,0.82)', weight: 800, pad: 0.22 });
  }
  { const f = floorAt(-1.6, 0, 0.016, true); signs.push({ text: '起点', p: f.p, q: f.q, h: 0.42, color: '#e8eef5', weight: 900, pad: 0.15 }); }
  const text = util.textSigns(signs, { size: 72 });
  text.renderOrder = 1; text.name = 'floorText'; scene.add(text);

  // ---- 路段拱门：每个非平地路段起点 + 终点各一座。立柱 ±(路沿 + 0.3)，横梁 TB，挂 0.8 高路段色牌（深色字）----
  //   每座一个 Group（框 1 次 + 牌 1 次绘制）：化身走过就藏（镜头不会从门里穿过去，也不会挡在镜头和化身之间）
  {
    const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.25 });
    const list = segs.filter(sg => sg.kind !== 'flat').map(sg => ({ s: sg.start, kind: sg.kind, text: `${NAME[sg.kind]} · ${sg.steps} 步`, bg: KC[sg.kind] }));
    list.push({ s: N, kind: 'finish', text: '终点 · FINISH', bg: '#eef3f8' }, { s: 0, kind: 'finish', text: '起点 · START', bg: '#eef3f8' });   // 起点门：跟拍时一开场就走过了（藏），正面镜头回看时在身后
    for (const it of list) {
      const a = route.at(it.s), y0 = route.heightAt(it.s - 0.01), fc = '#9aa8b8', bc = it.kind === 'finish' ? '#c9d4e0' : it.bg;
      const g = new THREE.Group(); g.name = 'arch';
      // 横梁 + 两根立柱（落到地面 y=0）分开：立柱投影碰到化身 / 影子时单独藏那根（半透明影子后面竖一根杆 = 像被扎穿）
      g.add(new THREE.Mesh(util.merged([{ geo: box, p: [0, y0 + TB, 0], s: [0.14, 0.12, 2 * AW + 0.1], color: bc }]), frameMat));
      g.userData.posts = [AW, -AW].map(z => {
        const m = new THREE.Mesh(util.merged([
          { geo: box, p: [0, (y0 + TB) / 2, z], s: [0.1, y0 + TB, 0.1], color: fc }, { geo: box, p: [0, 0.03, z], s: [0.3, 0.06, 0.3], color: '#2b333d' },
        ]), frameMat);
        g.add(m);
        const lat = route.at(it.s, -z).pos;                   // 本地 +Z = 行进方向右手边 = route 的负 lateral
        return { m, a: new THREE.Vector3(lat.x, 0, lat.z), b: new THREE.Vector3(lat.x, y0 + TB, lat.z) };
      });
      const pnl = util.textPlane(it.text, 0.8, { size: 120, weight: 900, color: '#10151c', bg: it.bg, pad: 0.22 });
      const w = pnl.geometry.parameters.width; if (w > 2 * AW - 0.1) pnl.scale.setScalar((2 * AW - 0.1) / w);
      pnl.position.set(-0.07, y0 + TB - 0.05 - 0.4 * pnl.scale.y, 0); pnl.rotation.y = -Math.PI / 2;   // 牌面朝来路（-X 本地 = 化身来的方向）
      pnl.material.side = THREE.FrontSide;
      const back = pnl.clone(); back.position.x = 0.07; back.rotation.y = Math.PI / 2;   // 背面也挂一块：正面镜头回看刚走过的门，字是正的
      g.add(pnl, back);
      g.position.set(a.pos.x, 0, a.pos.z); g.rotation.y = -a.heading;
      g.userData.s = it.s; scene.add(g); arches.push(g);
    }
  }

  // ---- 终点：路面黑白格线（2 × 14 格）+ 路右沿外黑白格旗（8 × 4 格），旗杆顶一颗青色灯球 ----
  {
    const a = route.at(N), fg2 = new THREE.PlaneGeometry(0.3, ROAD_W - 0.08); fg2.rotateX(-Math.PI / 2);   // x = 前进方向 2 格，z = 横向 14 格
    finish = new THREE.Mesh(fg2, new THREE.MeshLambertMaterial({ map: checker(util, 2, 14, 32), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    finish.position.copy(a.pos).setY(route.heightAt(N) + 0.01); finish.rotation.y = -a.heading; finish.name = 'finishLine'; scene.add(finish);
    finishEnds[0].copy(route.at(N, HW).pos); finishEnds[1].copy(route.at(N, -HW).pos);

    const b = route.at(N + 0.8, -(HW + 1.5));                // 终点拱门右立柱外后方，别被立柱挡住
    flag = new THREE.Group(); flag.name = 'finishFlag';
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: '#2b323b' })); base.position.y = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 2.3, 10), new THREE.MeshLambertMaterial({ color: '#c9d2dc' })); pole.position.y = 1.27;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10), new THREE.MeshBasicMaterial({ color: C.glow, toneMapped: false })); ball.position.y = 2.48;
    const cg = new THREE.PlaneGeometry(0.9, 0.45, 8, 4); cg.translate(0.45, 0, 0);
    const cloth = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ map: checker(util, 8, 4, 32), emissive: '#ffffff', emissiveMap: checker(util, 8, 4, 32), emissiveIntensity: 0.35, side: THREE.DoubleSide }));
    cloth.position.set(0.03, 2.13, 0);
    flag.add(base, pole, ball, cloth); flag.position.copy(b.pos); flag.rotation.y = -b.heading; scene.add(flag);
    flagBase = Float32Array.from(cg.attributes.position.array); flag.userData.cloth = cloth;
  }
}

// 化身 + 影子在屏幕上的框（NDC）：远处的细杆 / 细线投影正好落在人身上时（像被扎穿）先藏起来
const box2 = [0, 0, 0, 0];
function bodyBox(st, cam) {
  box2[0] = box2[2] = Infinity; box2[1] = box2[3] = -Infinity;
  for (const p of [st.avatar, st.ghost]) if (p) for (const h of [0, 1.85]) {
    _v.set(p.x, p.y + h, p.z).project(cam);
    box2[0] = Math.min(box2[0], _v.x - 0.05); box2[1] = Math.max(box2[1], _v.x + 0.05);
    box2[2] = Math.min(box2[2], _v.y); box2[3] = Math.max(box2[3], _v.y + 0.04);
  }
}
const _w = new THREE.Vector3();
function hits(a, b, cam) {                                     // 线段 a-b（世界坐标）投影后的包围框碰不碰人
  _v.copy(a).project(cam); _w.copy(b).project(cam);
  return Math.max(_v.x, _w.x) > box2[0] && Math.min(_v.x, _w.x) < box2[1] && Math.min(_v.y, _w.y) < box2[3] && Math.max(_v.y, _w.y) > box2[2];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function update(dt, st) {
  if (!route) return;
  const N = route.N, cam = st.camera;
  cam.updateMatrixWorld();
  let next = true;                                             // 只显示前方最近的一座（后面几座叠在一起太乱）；走过就藏
  bodyBox(st, cam);
  if (window.__camMode === 'front') {                          // 正面镜头（V / ?cam=front）回看来路：反过来只显示身后最近的一座（刚走过的路段门）
    let best = null;
    for (const g of arches) { g.visible = false; if (!st.summit && g.userData.s <= st.s - 0.15 && (!best || g.userData.s > best.userData.s)) best = g; }
    if (best) { best.visible = true; for (const p of best.userData.posts) p.m.visible = !hits(p.a, p.b, cam); }
  } else for (const g of arches) {
    g.visible = next && !st.summit && st.s < g.userData.s - 0.15;
    if (g.visible) { next = false; for (const p of g.userData.posts) p.m.visible = !hits(p.a, p.b, cam); }
  }
  // 终点线：远处时是一道横在人身上的细线（像被扎穿），碰到人就先藏；走近（最后 6 步）照常显示
  if (finish) {
    let hide = false;
    if (st.s < N - 6) hide = hits(finishEnds[0], finishEnds[1], cam);
    finish.visible = !hide;
  }
  // 终点旗：远处弯道上旗杆正好落在人身后时先藏起来，走近再出现；旗面正弦摆（旗根不动）
  if (flag) {
    let hide = false;
    if (st.s < N - 5) hide = hits(_a.copy(flag.position), _b.copy(flag.position).setY(flag.position.y + 2.5), cam);
    flag.visible = !hide;
    const p = flag.userData.cloth.geometry.attributes.position, t = st.t;
    for (let i = 0; i < p.count; i++) {
      const x = flagBase[i * 3], y = flagBase[i * 3 + 1];
      p.setZ(i, Math.sin(x * 7 - t * 4.2 + y * 1.5) * 0.07 * (x / 0.9));
    }
    p.needsUpdate = true;
  }
}
