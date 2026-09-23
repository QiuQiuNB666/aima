// 街道：斑马线 + 横穿马路（红灯时车流）、步行者信号灯（红人/绿人 + 等待格，跟 /state 的 wait_still 联动）、
//   天桥（桥下挖出一条大街：挡土墙、车道线、车流；桥上栏杆 + 霓虹灯带、桥墩）。
import * as THREE from 'three';
import { ROAD_W } from '../../path.js';
import { quads, glowMat, streakTex, shade } from './lib.js';

const TRENCH = [10.8, 19.2], FLOOR = -1.6;         // 天桥下的大街：这段步数范围的地面挖到 FLOOR
const XWALK = [6.7, 10.3];                         // 横穿马路（斑马线）
let cars = null, lanes = [], nCross = 0, nAll = 0, sig = null, route = null, T = 0;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

export function buildStreet(scene, ctx, E) {
  const { util, theme } = ctx, acc = theme.accent;
  route = ctx.route;
  const wait = route.segs.find(s => s.kind === 'wait');
  const pedGo = wait ? wait.start + wait.steps : 0;

  // ---- 挖桥下大街：地面网格在这段挖掉（碰到这段的三角形都删），补坑底、两头挡土墙、墙外一圈盖住锯齿边的路面 ----
  const gg = E.ground.geometry, gp = gg.attributes.position, inT = new Uint8Array(gp.count), idx = gg.index.array, keep = [];
  for (let i = 0; i < gp.count; i++) { const n = util.nearestRoute(route, gp.getX(i), gp.getZ(i)); inT[i] = n.s > TRENCH[0] && n.s < TRENCH[1] ? 1 : 0; }
  for (let k = 0; k < idx.length; k += 3) if (!(inT[idx[k]] || inT[idx[k + 1]] || inT[idx[k + 2]])) keep.push(idx[k], idx[k + 1], idx[k + 2]);
  gg.setIndex(keep);

  const lam = [], lit = [], marks = quads(), hw = ROAD_W / 2;
  const L = (s, lat = 0) => route.at(s, lat);
  const slab = quads();
  const band = (s0, s1, y, color) => { const a = L((s0 + s1) / 2), c = a.pos.clone(); c.y = y; slab.add(c, a.left.clone().multiplyScalar(45), a.dir.clone().multiplyScalar((s1 - s0) * 0.25), color); };
  band(TRENCH[0] - 0.3, TRENCH[1] + 0.3, FLOOR, E.groundColor.clone().multiplyScalar(0.8));
  band(TRENCH[0] - 3.4, TRENCH[0] - 0.1, -0.055, E.groundColor); band(TRENCH[1] + 0.1, TRENCH[1] + 3.0, -0.055, E.groundColor);
  const slabMesh = slab.mesh(new THREE.MeshPhongMaterial({ vertexColors: true, map: E.asphalt, specularMap: E.asphalt, specular: '#3a3450', shininess: 50, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }), 'trenchGround');
  const suv = slabMesh.geometry.attributes.uv;
  for (let k = 0; k < suv.count; k++) suv.setXY(k, suv.getX(k) * 90 / 6, suv.getY(k) * 2);
  scene.add(slabMesh);
  // 挡土墙（整宽，路下那截藏在台阶块里），墙顶一条霓虹
  for (const s of [TRENCH[0] - 0.15, TRENCH[1] + 0.15]) {
    const a = L(s), ry = -a.heading;
    lam.push({ geo: new THREE.BoxGeometry(0.3, 1.58, 90), p: [a.pos.x, FLOOR / 2 - 0.06, a.pos.z], ry, color: '#2c2f3c' });
    for (const side of [1, -1]) { const b = L(s, side * (hw + 22.6)); lit.push({ geo: new THREE.BoxGeometry(0.32, 0.05, 44.8), p: [b.pos.x, -0.07, b.pos.z], ry, color: side > 0 ? acc[1] : acc[0] }); }
  }
  // 车道线：大街（坑底）+ 横穿马路（地面）；斑马线（垂直于行进方向的白色粗条）
  const lane = (s, y, lat0, lat1, width, color, dash = 0) => {
    const a = L(s), d = a.dir.clone().multiplyScalar(width / 2);
    for (const sg of [1, -1]) {
      for (let l = lat0; l < lat1; l += dash ? dash * 2 : lat1 - lat0) {
        const l1 = Math.min(lat1, l + (dash || lat1 - lat0)), c = a.pos.clone().addScaledVector(a.left, sg * (l + l1) / 2); c.y = y;
        marks.add(c, a.left.clone().multiplyScalar((l1 - l) / 2), d, color);
      }
    }
  };
  const fy = FLOOR + 0.03;
  lane(11.5, fy, 0, 45, 0.08, '#d8dde8'); lane(18.5, fy, 0, 45, 0.08, '#d8dde8');
  lane(14.85, fy, 0, 45, 0.07, '#ffc020'); lane(15.15, fy, 0, 45, 0.07, '#ffc020');
  lane(13.2, fy, 0, 45, 0.07, '#b8bcc8', 1.0); lane(16.8, fy, 0, 45, 0.07, '#b8bcc8', 1.0);
  lane(XWALK[0], -0.02, 1.5, 45, 0.07, '#d8dde8'); lane(XWALK[1], -0.02, 1.5, 45, 0.07, '#d8dde8');
  lane((XWALK[0] + XWALK[1]) / 2, -0.02, 1.9, 45, 0.06, '#d8dde8', 0.9);
  for (let s = XWALK[0] + 0.3; s < XWALK[1] - 0.2; s += 0.88) {
    const a = L(s), c = a.pos.clone(); c.y = 0.014;
    marks.add(c, a.left.clone().multiplyScalar(hw + 0.35), a.dir.clone().multiplyScalar(0.11), '#e8ecf2');
  }
  const markMesh = marks.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'roadMarkings');
  scene.add(markMesh);

  // ---- 天桥：栏杆（沿台阶鼻线）+ 灯带 + 桥墩 ----
  const st = route.steps, stairs = st.filter(x => x.kind.startsWith('stairs') && x.i < 22).map(x => x.i);
  if (stairs.length) {
    const i0 = stairs[0], i1 = stairs[stairs.length - 1];
    const pts = [];                                          // 鼻线：上台阶在步起点、下台阶在步终点，取踏面高度
    for (const i of stairs) {
      const top = Math.max(st[i].h0, st[i].h1);
      if (st[i].kind === 'stairs_up') pts.push([i, top]); else pts.push([i + 1, top]);
      if (st[i].kind === 'stairs_up' && st[i + 1] && st[i + 1].kind === 'stairs_down') pts.push([i + 0.5, top]);
    }
    const RAIL = 0.85;
    for (const side of [1, -1]) {
      const lat = side * (hw + 0.07), P = pts.map(([s, y]) => { const a = L(s, lat); a.pos.y = y; return a.pos; });
      P.forEach(p => lam.push({ geo: new THREE.BoxGeometry(0.05, RAIL, 0.05), p: [p.x, p.y + RAIL / 2, p.z], color: '#8a90a6' }));
      for (let k = 0; k + 1 < P.length; k++) {
        const a = P[k], b = P[k + 1], len = a.distanceTo(b), qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.subVectors(b, a).normalize());
        const mid = a.clone().add(b).multiplyScalar(0.5);
        lam.push({ geo: new THREE.BoxGeometry(len + 0.05, 0.06, 0.07), p: [mid.x, mid.y + RAIL, mid.z], q: qq, color: '#9aa0b8' });
        lam.push({ geo: new THREE.BoxGeometry(len, 0.04, 0.04), p: [mid.x, mid.y + RAIL * 0.5, mid.z], q: qq, color: '#6a7088' });
        lit.push({ geo: new THREE.BoxGeometry(len, 0.035, 0.02), p: [mid.x, mid.y + RAIL - 0.07, mid.z], q: qq, color: side > 0 ? acc[1] : acc[0] });
      }
    }
    // 桥墩：两根一组，顶上一道横梁顶住台阶块底
    for (const s of [i0 + 2.2, i1 - 1.2]) {
      const a = L(s), stp = st[Math.floor(s)], bot = Math.min(stp.h0, stp.h1) - 0.9, hgt = bot - FLOOR;
      for (const sg of [1, -1]) { const b = L(s, sg * 0.75); lam.push({ geo: new THREE.CylinderGeometry(0.14, 0.16, hgt, 10), p: [b.pos.x, FLOOR + hgt / 2, b.pos.z], color: '#474c5e' }); }
      lam.push({ geo: new THREE.BoxGeometry(0.4, 0.18, ROAD_W + 0.2), p: [a.pos.x, bot - 0.09, a.pos.z], ry: -a.heading, color: '#3b4052' });
    }
  }

  // ---- 步行者信号灯（斑马线对面、路左侧离路 3.6：右侧已有引擎的车用信号灯；左侧是镜头这边，离远点不糊镜头）----
  {
    const a = L(pedGo + 3.4, 3.6), ry = -a.heading - Math.PI / 2, g = new THREE.Group();
    g.position.copy(a.pos); g.position.y = 0; g.rotation.y = ry; g.name = 'pedSignal';
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.76, 0.2), new THREE.MeshLambertMaterial({ color: '#22252e' }));
    box.position.y = 2.05;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.45, 8), new THREE.MeshLambertMaterial({ color: '#4a4e5a' }));
    pole.position.y = 1.22;
    const man = (walk, col) => util.canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#050507'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 12;
      c.beginPath(); c.arc(64, 26, 12, 0, 7); c.fill();
      c.lineCap = 'round'; c.strokeStyle = col; c.lineWidth = 16;
      const seg = pts => { c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.stroke(); };
      if (walk) { seg([[64, 46], [58, 78]]); seg([[58, 78], [40, 112]]); seg([[58, 78], [84, 110]]); seg([[62, 52], [40, 74]]); seg([[62, 52], [86, 70]]); }
      else { seg([[64, 46], [64, 80]]); seg([[56, 80], [56, 114]]); seg([[72, 80], [72, 114]]); seg([[54, 50], [46, 84]]); seg([[74, 50], [82, 84]]); }
    });
    const redM = new THREE.MeshBasicMaterial({ map: man(false, '#ff2a2a'), toneMapped: false }), grnM = new THREE.MeshBasicMaterial({ map: man(true, '#2dffa0'), toneMapped: false });
    const red = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), redM), grn = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), grnM);
    red.position.set(0, 2.23, 0.105); grn.position.set(0, 1.87, 0.105);
    const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: '#ff5030', toneMapped: false }), 8);
    for (let k = 0; k < 8; k++) bar.setMatrixAt(k, m4.makeTranslation(0.24, 1.76 + k * 0.08, 0.06));
    const barBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, 0.06), new THREE.MeshLambertMaterial({ color: '#1a1c22' }));
    barBack.position.set(0.24, 2.04, 0.02);
    g.add(box, pole, red, grn, bar, barBack); scene.add(g);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), glowMat(E.radial, { vertexColors: false }));
    glow.position.set(0, 2.23, 0.12); g.add(glow);
    // 信号灯在湿路面上的倒影：从灯脚斜拉向镜头（红灯时红、放行变绿），落在斑马线前的路面上
    const f = L(pedGo - 8, 1.4).pos, b = a.pos, d = new THREE.Vector3(f.x - b.x, 0, f.z - b.z), len = Math.min(5.5, d.length() - 0.5);
    d.normalize();
    const rq = quads(); rq.add(new THREE.Vector3(b.x + d.x * len / 2, 0.02, b.z + d.z * len / 2), new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(0.28), d.clone().multiplyScalar(len / 2), '#ffffff');
    const refl = rq.mesh(glowMat(streakTex(util), { ground: true, vertexColors: false, opacity: 0.75 }), 'signalReflection'); refl.renderOrder = 1;
    scene.add(refl);
    sig = { redM, grnM, bar, glow, pedGo, wait, refl };
  }

  // ---- 坂道：一整条连续深沥青（#3a3448 + 顺路方向细纵纹），每 2 步一个朝坡上的青色人字箭头；横线一条都不出现（横线只给台阶）。
  //   两侧扶手 + 灯带各是一根连续倾斜的直杆（坡段一根、坡顶巷子一根），立柱每步一根 ----
  const up = route.segs.find(sg => sg.kind === 'up');
  if (up) {
    const s0 = up.start, s1 = up.start + up.steps, road = quads(), arrows = quads();
    const strip = (g, sa, sb, lat0, lat1, y, color) => {
      const A = L(sa), B = L(sb), la = (lat0 + lat1) / 2, hwid = (lat1 - lat0) / 2;
      const pa = A.pos.clone().addScaledVector(A.left, la), pb = B.pos.clone().addScaledVector(B.left, la); pa.y += y; pb.y += y;
      g.add(pa.clone().add(pb).multiplyScalar(0.5), A.left.clone().add(B.left).normalize().multiplyScalar(hwid), pb.sub(pa).multiplyScalar(0.5), color);
    };
    for (let k = 0; k < 4 * up.steps; k++) strip(road, s0 + k / 4, s0 + (k + 1) / 4, -hw, hw, 0.006, '#ffffff');   // 细分只为贴合坡面；uv 横向一致 → 看不出接缝
    for (let s = s0 + 1; s < s1; s += 2) strip(arrows, s - 0.45, s + 0.45, -0.45, 0.45, 0.014, '#ffffff');
    const slopeTex = util.canvasTexture(256, 64, (c, w, h) => {
      c.fillStyle = '#3a3448'; c.fillRect(0, 0, w, h);
      for (let x = 6; x < w; x += 11) { c.fillStyle = x % 2 ? 'rgba(120,112,150,.35)' : 'rgba(20,16,30,.45)'; c.fillRect(x, 0, 2, h); }   // 顺路方向细纵纹
      c.fillStyle = '#6c648a'; c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);                                                           // 路沿两道浅边
    });
    const rm = road.mesh(new THREE.MeshBasicMaterial({ map: slopeTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'slopeRoad');
    const chev = util.canvasTexture(128, 128, (c, w, h) => {
      c.strokeStyle = '#fff'; c.lineWidth = 20; c.lineJoin = 'miter'; c.lineCap = 'butt';
      for (const y of [40, 88]) { c.beginPath(); c.moveTo(10, y + 34); c.lineTo(64, y - 14); c.lineTo(118, y + 34); c.stroke(); }   // 画布上方 = uv v 大 = 坡上
    });
    chev.flipY = true;
    const am = arrows.mesh(shade(new THREE.MeshBasicMaterial({ map: chev, color: '#3ff0ff', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), { neon: true }), 'slopeArrows');
    am.renderOrder = 1;
    scene.add(rm, am);
    // 引擎每步刻度线在坡上收成 0 长度（坡上不要横线）
    const ln = ctx.meshes && ctx.meshes.lines;
    if (ln) { const lp = ln.geometry.attributes.position; for (let i = s0 + 1; i <= s1; i++) if (2 * i + 1 < lp.count) lp.setXYZ(2 * i + 1, lp.getX(2 * i), lp.getY(2 * i), lp.getZ(2 * i)); lp.needsUpdate = true; }
    const RH = 0.85;
    for (const side of [1, -1]) {
      const lat = side * (hw + 0.35), at = s => { const a = L(s, lat); return a.pos.clone(); };
      for (let s = s0; s <= s1 + 3.01; s += 1) { const p = at(s); lam.push({ geo: new THREE.BoxGeometry(0.05, RH, 0.05), p: [p.x, p.y + RH / 2 - 0.03, p.z], color: '#7d8398' }); }
      for (const [a, b] of [[at(s0), at(s1)], [at(s1), at(s1 + 3)]]) {
        const len = a.distanceTo(b), qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.subVectors(b, a).normalize()), mid = a.clone().add(b).multiplyScalar(0.5);
        lam.push({ geo: new THREE.BoxGeometry(len + 0.05, 0.05, 0.06), p: [mid.x, mid.y + RH, mid.z], q: qq, color: '#9aa0b8' });
        lit.push({ geo: new THREE.BoxGeometry(len + 0.03, 0.035, 0.022), p: [mid.x, mid.y + RH - 0.06, mid.z], q: qq, color: side > 0 ? acc[1] : acc[0] });
      }
    }
  }

  // ---- 车流：车身（暗色方块）+ 车灯拖尾（加色）；大街一直有车，横穿马路只在行人红灯时有车 ----
  const trail = util.canvasTexture(256, 16, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(0.85, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    const vg = c.createLinearGradient(0, 0, 0, h); vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = vg; c.fillRect(0, 0, w, h);
  });
  const mk = (s, y, dirSign, speed, n, color, span = 90) => { for (let k = 0; k < n; k++) lanes.push({ s, y, dirSign, speed, span, phase: k / n * span + s * 7, color }); };
  mk(12.4, FLOOR, 1, 7.5, 3, '#fff2d0'); mk(14.2, FLOOR, 1, 9, 3, '#fff2d0'); mk(15.9, FLOOR, -1, 8.5, 3, '#ff3040'); mk(17.6, FLOOR, -1, 7, 3, '#ff3040');
  nAll = lanes.length;
  mk(7.9, 0, 1, 9, 3, '#fff2d0', 36); mk(9.2, 0, -1, 10, 3, '#ff3040', 36);
  nCross = lanes.length - nAll; nAll = lanes.length;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.42, 0.56), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#0a0a12' }), nAll);
  const lamp = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.5), glowMat(E.radial, { vertexColors: false }), nAll);   // 车头灯/尾灯光晕
  const tr = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat(trail, { vertexColors: false }), nAll);
  const col = new THREE.Color();
  lanes.forEach((l, k) => { tr.setColorAt(k, col.set(l.color)); lamp.setColorAt(k, col.set(l.color)); body.setColorAt(k, col.set(['#3a4258', '#4a3a5a', '#2c3c5a', '#8a8e9c'][k % 4])); });
  tr.instanceColor.needsUpdate = body.instanceColor.needsUpdate = lamp.instanceColor.needsUpdate = true;
  tr.frustumCulled = body.frustumCulled = lamp.frustumCulled = false; tr.name = 'carTrails'; body.name = 'cars'; lamp.name = 'carLamps'; tr.renderOrder = lamp.renderOrder = 2;
  cars = { body, tr, lamp };
  scene.add(body, tr, lamp);

  const lamMesh = new THREE.Mesh(util.merged(lam), new THREE.MeshLambertMaterial({ vertexColors: true })); lamMesh.name = 'streetProps';
  const litMesh = new THREE.Mesh(util.merged(lit), shade(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { mask: true, neon: true })); litMesh.name = 'streetLit';
  scene.add(lamMesh, litMesh);
  updateStreet(0, { pos: 0, terrain: null });
}

export function updateStreet(dt, st) {
  T += dt;
  if (!cars) return;
  // 信号：pos 过了红灯段 = 绿；红灯段里按 wait_still / wait_need 减等待格
  const green = st.pos >= sig.pedGo, tr = st.terrain;
  sig.redM.color.setScalar(green ? 0.02 : 1); sig.grnM.color.setScalar(green ? 1 : 0.02);
  let segs = 0;
  if (!green) {
    const still = tr && tr.segment === 'wait' ? tr.wait_still : null, need = (tr && tr.wait_need) || 1.5;
    segs = still == null ? 8 : Math.max(0, Math.ceil(8 * (1 - Math.min(1, still / need))));
  }
  sig.bar.count = segs;
  sig.glow.position.y = green ? 1.87 : 2.23; sig.glow.material.color.set(green ? '#2dffa0' : '#ff2a2a'); sig.refl.material.color.copy(sig.glow.material.color);
  // 车：横穿马路的车只在行人红灯时开（排在数组最后，绿灯时 count 截掉）
  const n = green ? nAll - nCross : nAll;
  cars.body.count = cars.tr.count = cars.lamp.count = n;
  for (let k = 0; k < n; k++) {
    const l = lanes[k], lat = l.dirSign * ((((l.phase + T * l.speed) % l.span) + l.span) % l.span - l.span / 2), a = route.at(l.s, lat);
    const ry = -a.heading - Math.PI / 2;               // 局部 X = 路右手方向 = 车沿 -left 走
    q.setFromAxisAngle(Y, ry);
    v.copy(a.pos); v.y = l.y + 0.29;
    cars.body.setMatrixAt(k, m4.compose(v, q, sc.set(1, 1, 1)));
    const len = 3.2, back = -l.dirSign;                // 车往 +left（dirSign 1）走 = 局部 -X；拖尾在车后
    v.addScaledVector(a.left, -l.dirSign * len * 0.5 + l.dirSign * 0.5); v.y = l.y + 0.24;
    cars.tr.setMatrixAt(k, m4.compose(v, q, sc.set(len * back, 0.14, 1)));
    v.addScaledVector(a.left, l.dirSign * (len * 0.5 + 0.1)); v.addScaledVector(a.dir, -0.3); v.y = l.y + 0.26;   // 车头（朝镜头那面前一点）
    cars.lamp.setMatrixAt(k, m4.compose(v, q, sc.set(1, 1, 1)));
  }
  cars.body.instanceMatrix.needsUpdate = cars.tr.instanceMatrix.needsUpdate = cars.lamp.instanceMatrix.needsUpdate = true;
}
