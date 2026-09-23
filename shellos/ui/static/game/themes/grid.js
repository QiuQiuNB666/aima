// 训练场（台阶 / 长坡共用）—— 干净的科技实验室：
//   一眼认出：路段按类型上色（与 /worlds 一致）+ 发光路沿；台阶踏步前缘亮条；每步脚印 + 步号；
//            路段起点地面大字（上台阶 ▲ / 下坡 ▼…）；路右侧高度刻度尺（整米刻度 + 剖面线 + 跟着化身走的当前高度游标）。
//   氛围：平地基座（路下有立墙，像实验室里的步道模型）、细网格地面、远处一圈柔光墙、柔和环境光。
import * as THREE from 'three';
import { ROAD_W, STEP, APRON } from '../path.js';

const KC = { flat: '#556070', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff4d4f' };
const TXT = { ...KC, flat: '#c3ceda' };                          // 地面文字：平地用浅灰，其余同路段色
const NAME = { up: '上坡 ▲', down: '下坡 ▼', stairs_up: '上台阶 ▲', stairs_down: '下台阶 ▼', wait: '红灯' };
const C = { skyTop: '#0a0f15', skyBot: '#1b2531', fog: '#141b24', ground: '#141a22', road: '#2a323d', plinth: '#2e3844', gauge: '#6f8296' };
const HW = ROAD_W / 2, GAUGE = HW + 0.75;                       // 刻度尺在路右侧（影子在右 0.6，尺紧贴在它身后，别跑进右下 HUD）
let cursor = null, route = null, cur = {};

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

// 远处一圈柔光墙：底色 = 雾色（和地面雾接上），地平线上一道柔光带 + 淡竖向面板缝
function wallTex(util) {
  return util.canvasTexture(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, C.fog); gr.addColorStop(0.18, '#1e2a38'); gr.addColorStop(0.26, '#2a3a4d'); gr.addColorStop(0.4, '#1a2431'); gr.addColorStop(1, C.skyBot);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,150,180,0.10)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, h * 0.35, 2, h * 0.5);
    g.fillStyle = 'rgba(160,200,230,0.12)'; g.fillRect(0, h * 0.74, w, 2);
  }, { repeat: true });
}

// 地面贴片朝向：跟随坡度（台阶取水平）。text=true 时是文字板（XY 平面，字头朝前）；否则是 XZ 平面（X 朝前）
const _m = new THREE.Matrix4(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
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

  // ---- 天、雾、光 ----
  kit.sky(scene, C.skyTop, C.skyBot, { exponent: 0.6 });
  kit.fog(scene, C.fog, 22, 95);
  scene.background = new THREE.Color(C.fog);
  lights.hemi.color.set('#e4eeff'); lights.hemi.groundColor.set('#1c2430'); lights.hemi.intensity = 1.35;
  const D = new THREE.Vector3().subVectors(route.P[N], route.P[0]).setY(0).normalize(), L = new THREE.Vector3(D.z, 0, -D.x);
  lights.sun.color.set('#ffffff'); lights.sun.intensity = 1.0;
  lights.sun.position.copy(c).addScaledVector(D, -18).addScaledVector(L, 12).setY(34);   // 身后左上：踏面亮、立面次之、侧面最暗

  // ---- 地面：y=0 平面 + 细网格；远处柔光墙 ----
  {
    const tex = gridTex(util), S = 260; tex.repeat.set(S / 5, S / 5);
    const g = new THREE.PlaneGeometry(S, S); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(c.x, -0.004, c.z); m.name = 'ground'; scene.add(m);
    const wt = wallTex(util); wt.repeat.set(10, 1);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 48, 64, 1, true), new THREE.MeshBasicMaterial({ map: wt, side: THREE.BackSide, fog: false, depthWrite: false }));
    w.position.set(c.x, 18, c.z); w.renderOrder = -9; w.name = 'labWall'; scene.add(w);
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

  // ---- 发光路沿（按路段色）+ 台阶前缘亮条 ----
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
  const fm = util.instanced(fg, new THREE.MeshBasicMaterial({ map: footTex, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false, opacity: 1 }), feet);
  fm.material.color.set('#ffffff'); fm.name = 'feet'; scene.add(fm);

  // ---- 地面文字（一张图集 = 1 次绘制）：步号、路段大字、起点/终点、刻度尺读数 ----
  const signs = [];
  for (let i = 0; i < N; i++) {
    const f = floorAt(i + 0.5, 0.86, 0.016, true);
    signs.push({ text: String(i + 1), p: f.p, q: f.q, h: 0.22, color: TXT[f.kind], bg: 'rgba(10,14,20,0.82)', weight: 800, pad: 0.22 });
  }
  for (const sg of segs) {
    if (sg.kind === 'flat') continue;
    const f = floorAt(sg.start - 1.5, -0.5, 0.016, true);   // 右半道：化身（左 0.35）挡不住
    signs.push({ text: `${NAME[sg.kind]}\n${sg.steps} 步`, p: f.p, q: f.q, h: 0.62, color: TXT[sg.kind], weight: 900, pad: 0.15 });
  }
  { const f = floorAt(-1.3, -0.2, 0.016, true); signs.push({ text: '起点', p: f.p, q: f.q, h: 0.34, color: '#e8eef5', weight: 900, pad: 0.15 }); }
  { const f = floorAt(N + 1.3, -0.2, 0.016, true); signs.push({ text: '终点', p: f.p, q: f.q, h: 0.34, color: '#e8eef5', weight: 900, pad: 0.15 }); }

  // ---- 高度刻度尺（路右侧）：整米横杆 + 半米细杆 + 每 2 步立柱 + 剖面线（按路段色）+ 读数 ----
  const [a0, a1] = world.alt || [0, 0], span = (a1 - a0) || 1, u = route.hmax / span;   // 1 米（虚拟）= u 单位，和 HUD 的海拔同一换算
  const top = Math.ceil(a1 - a0), gp = [], G0 = -3, G1 = N + 3, BH = (top + 0.6) * u;
  for (let s = G0; s < G1; s += 0.5) {
    const a = route.at(s, -GAUGE), b = route.at(s + 0.5, -GAUGE), len = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) + 0.004;
    const k = route.at(s + 0.25, -(GAUGE + 0.05));              // 背板：深色，影子（浅青）在它前面更显眼
    gp.push({ geo: box, p: [k.pos.x, BH / 2, k.pos.z], ry: -k.heading, s: [len, BH, 0.03], color: '#1e2835' });
    gp.push({ geo: box, p: [k.pos.x, BH, k.pos.z], ry: -k.heading, s: [len, 0.03, 0.05], color: C.gauge });
    for (let m = 0; m <= top * 2; m++) {
      const y = m / 2 * u, whole = m % 2 === 0;
      gp.push({ geo: box, p: [(a.pos.x + b.pos.x) / 2, y, (a.pos.z + b.pos.z) / 2], ry: -a.heading, s: [len, whole ? 0.022 : 0.01, whole ? 0.022 : 0.01], color: whole ? '#8a9bb0' : '#465566' });
    }
  }
  for (let s = G0; s <= G1; s += 4) {
    const a = route.at(s, -GAUGE);
    gp.push({ geo: box, p: [a.pos.x, BH / 2, a.pos.z], s: [0.04, BH, 0.04], color: C.gauge });
  }
  for (let i = 0; i < N; i++) {                                // 剖面线：每步一段，高度 = 本步踏面，贴在刻度尺前面一点
    const a = route.at(i, -(GAUGE - 0.04)), b = route.at(i + 1, -(GAUGE - 0.04)), st = steps[i];
    const y0 = stairs(st.kind) ? st.top : st.h0, y1 = stairs(st.kind) ? st.top : st.h1;
    const dq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(b.pos.x - a.pos.x, y1 - y0, b.pos.z - a.pos.z).normalize());
    gp.push({ geo: box, p: [(a.pos.x + b.pos.x) / 2, (y0 + y1) / 2, (a.pos.z + b.pos.z) / 2], q: dq, s: [Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z, y1 - y0) + 0.02, 0.05, 0.05], color: KC[st.kind] });
    if (stairs(st.kind) && i + 1 < N && steps[i + 1].kind === st.kind) {   // 台阶的竖边
      const e = b, yA = st.top, yB = steps[i + 1].top;
      gp.push({ geo: box, p: [e.pos.x, (yA + yB) / 2, e.pos.z], s: [0.05, Math.abs(yB - yA) + 0.05, 0.05], color: KC[st.kind] });
    }
  }
  const gauge = new THREE.Mesh(util.merged(gp), new THREE.MeshBasicMaterial({ vertexColors: true }));
  gauge.name = 'gauge'; scene.add(gauge);
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = G0 + 1; s <= G1; s += 8) {                     // 读数：每 8 步一组，字面朝路（略偏向来路，镜头看得清）
    const a = route.at(s, -(GAUGE - 0.06)), nrm = a.left.clone().addScaledVector(a.dir, -0.7).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(new THREE.Vector3().crossVectors(up, nrm), up, nrm));
    for (let m = 1; m <= top; m++) signs.push({ text: `${a0 + m} m`, p: a.pos.clone().setY(m * u - 0.075), q, h: 0.13, color: '#dbe5ef', weight: 800, pad: 0.1 });
  }
  const text = util.textSigns(signs, { size: 72 });
  text.renderOrder = 1; text.name = 'floorText'; scene.add(text);

  // ---- 当前高度游标：刻度尺上一个白色光条，跟着化身高度 ----
  cursor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.045, 0.09), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  cursor.name = 'heightCursor'; scene.add(cursor);
}

export function update(dt, st) {
  if (!cursor) return;
  route.at(Math.max(-3, Math.min(route.N + 3, st.s)), -(GAUGE - 0.09), cur);
  cursor.position.set(cur.pos.x, st.avatar.y + 0.02, cur.pos.z);
  cursor.rotation.y = -cur.heading;
}
