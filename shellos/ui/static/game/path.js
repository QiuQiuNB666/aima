// 路线 → 几何。高度规则和 shellos/control/terrain.py 的 RISE 一致：每步水平 0.5，坡 ±0.08，台阶 ±0.12。
// 坐标：y 向上；起点在原点，大致朝 +X 走。left = 行进方向的左手边。
import * as THREE from 'three';

export const STEP = 0.5;
export const RISE = { flat: 0, up: 0.08, down: -0.08, stairs_up: 0.12, stairs_down: -0.12, wait: 0 };
export const ROAD_W = 2.2;
export const APRON = 8;          // 起点前 / 山顶后的平地（单位），给营地和登顶平台
export const KIND_NAME = { flat: '平地', up: '上坡', down: '下坡', stairs_up: '上台阶', stairs_down: '下台阶', wait: '红灯' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rng(seed) {                // mulberry32，主题摆道具也用它，保证同一世界每次一样
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// route: [{kind, steps, label, turns?}]
export function makeRoute(route, seed = 1) {
  const steps = [], segs = [];
  let h = 0;
  route.forEach((sg, j) => {
    segs.push({ kind: sg.kind, label: sg.label, start: steps.length, steps: sg.steps, turns: sg.turns || 0 });
    for (let k = 0; k < sg.steps; k++) { steps.push({ kind: sg.kind, label: sg.label, seg: j, h0: h, h1: h + RISE[sg.kind] }); h += RISE[sg.kind]; }
  });
  const N = steps.length, r = rng(seed);
  // 朝向：台阶段保持直线；坡/平地轻微拐弯；有 turns 的段走 Z 字；每步最多转 0.35 rad 保证路面连续
  const H = []; let hd = 0, base = 0;
  for (const sg of segs) {
    const stairs = sg.kind.startsWith('stairs');
    if (!stairs) base = clamp(base + (r() - 0.5) * 0.9, -0.6, 0.6);
    for (let k = 0; k < sg.steps; k++) {
      let target = stairs ? hd : base;
      if (sg.turns > 1) target = base + ((Math.floor(k / (sg.steps / sg.turns)) % 2) ? -0.8 : 0.8);
      hd += clamp(target - hd, -0.35, 0.35);
      H.push(hd);
    }
  }
  const P = [new THREE.Vector3(0, 0, 0)];
  for (let i = 0; i < N; i++) P.push(new THREE.Vector3(P[i].x + STEP * Math.cos(H[i]), steps[i].h1, P[i].z + STEP * Math.sin(H[i])));
  const dirOf = hdg => new THREE.Vector3(Math.cos(hdg), 0, Math.sin(hdg));
  const H0 = H[0] || 0, HN = H[N - 1] || 0;
  const hmax = Math.max(0.001, ...P.map(p => p.y));

  function heightAt(s) {
    if (s <= 0) return 0;
    if (s >= N) return P[N].y;
    const i = Math.floor(s), f = s - i, st = steps[i];
    if (st.kind === 'stairs_up') return f < 0.3 ? st.h0 + (st.h1 - st.h0) * (f / 0.3) : st.h1;
    if (st.kind === 'stairs_down') return f > 0.7 ? st.h0 + (st.h1 - st.h0) * ((f - 0.7) / 0.3) : st.h0;
    return st.h0 + (st.h1 - st.h0) * f;
  }
  function headingAt(s) {                      // 步中点之间线性插值，拐弯处平滑
    if (N === 0) return 0;
    const x = clamp(s - 0.5, 0, N - 1), i = Math.floor(x), f = x - i;
    return i + 1 < N ? H[i] + (H[i + 1] - H[i]) * f : H[N - 1];
  }
  // s = 连续步数（可 <0 或 >N，落在营地/山顶平台）；lateral = 向左偏移
  function at(s, lateral = 0, out = {}) {
    const pos = out.pos || new THREE.Vector3();
    let hdg;
    if (s <= 0) { hdg = H0; pos.copy(P[0]).addScaledVector(dirOf(H0), s * STEP); }
    else if (s >= N) { hdg = HN; pos.copy(P[N]).addScaledVector(dirOf(HN), (s - N) * STEP); }
    else { const i = Math.floor(s); pos.lerpVectors(P[i], P[i + 1], s - i); hdg = headingAt(s); }
    pos.y = heightAt(s);
    const dir = (out.dir || new THREE.Vector3()).set(Math.cos(hdg), 0, Math.sin(hdg));
    const left = (out.left || new THREE.Vector3()).set(dir.z, 0, -dir.x);
    if (lateral) pos.addScaledVector(left, lateral);
    out.pos = pos; out.dir = dir; out.left = left; out.heading = hdg;
    out.i = clamp(Math.floor(s), 0, Math.max(0, N - 1)); out.kind = N ? steps[out.i].kind : 'flat';
    return out;
  }
  // 地面采样用：路线折线（含两端平台），[x,z,y]
  const poly = [];
  for (let s = -APRON / STEP; s <= N + APRON / STEP; s += 1) { const a = at(s); poly.push([a.pos.x, a.pos.z, s < 0 ? 0 : s > N ? P[N].y : Math.min(P[Math.floor(s)].y, P[Math.min(N, Math.floor(s) + 1)].y)]); }
  return { N, steps, segs, P, H, hmax, heightAt, headingAt, at, poly, dirOf };
}

// 最近路线点：给地面高度场/摆道具。返回 {d 距离, side 左正右负, y 路面高度, s 近似步数}
export function nearest(route, x, z) {
  const p = route.poly; let best = 1e9, bs = 0, by = 0, bsd = 1;
  for (let k = 0; k < p.length - 1; k++) {
    const ax = p[k][0], az = p[k][1], bx = p[k + 1][0], bz = p[k + 1][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const qx = ax + dx * t - x, qz = az + dz * t - z, d = qx * qx + qz * qz;
    if (d < best) { best = d; bs = k + t; by = p[k][2] + (p[k + 1][2] - p[k][2]) * t; bsd = (dx * (z - az) - dz * (x - ax)) < 0 ? 1 : -1; }
  }
  return { d: Math.sqrt(best), side: bsd, y: by, s: bs - APRON / STEP };
}

// 路面：平地/坡 = 连续带；台阶 = InstancedMesh 方块；刻度线 + 路沿线；红灯段 = 停止线 + 信号灯；起点营地；山顶旗
export function buildPathMeshes(scene, route, theme) {
  const { N, steps, P, at } = route;
  const acc = (theme.accent || ['#ffffff', '#88ccff', '#ffd000']).map(c => new THREE.Color(c));
  const roadCol = new THREE.Color(theme.path || '#444');
  const group = new THREE.Group(); group.name = 'path'; scene.add(group);
  const out = { group, signals: [], acc };

  // 1) 连续路面（含两端平台），跳过台阶步
  const pos = [], idx = [];
  const addQuad = (a0, a1) => {
    const hw = ROAD_W / 2, b = pos.length / 3;
    for (const a of [a0, a1]) for (const sgn of [1, -1]) pos.push(a.pos.x + a.left.x * hw * sgn, a.pos.y, a.pos.z + a.left.z * hw * sgn);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  const S0 = -APRON / STEP, S1 = N + APRON / STEP;
  for (let s = S0; s < S1; s += 1) {
    const i = Math.floor(s);
    if (i >= 0 && i < N && steps[i].kind.startsWith('stairs')) continue;
    const n = (i >= 0 && i < N && steps[i].kind !== 'flat' && steps[i].kind !== 'wait') ? 4 : 1;   // 坡细分一点
    for (let k = 0; k < n; k++) addQuad(at(s + k / n), at(s + (k + 1) / n));
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
  out.road = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: roadCol, side: THREE.DoubleSide }));
  out.road.name = 'road'; group.add(out.road);

  // 2) 台阶方块
  const stairIdx = [];
  for (let i = 0; i < N; i++) if (steps[i].kind.startsWith('stairs')) stairIdx.push(i);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Vector3(), yAx = new THREE.Vector3(0, 1, 0);
  out.stairs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, stairIdx.length));   // 颜色走 instanceColor
  out.stairs.count = stairIdx.length; out.stairs.name = 'stairs'; out.stairIndex = stairIdx;
  stairIdx.forEach((i, n) => {
    const st = steps[i], top = Math.max(st.h0, st.h1), bot = Math.min(st.h0, st.h1) - 0.9;
    c.lerpVectors(P[i], P[i + 1], 0.5); c.y = (top + bot) / 2;
    q.setFromAxisAngle(yAx, -route.H[i]); sc.set(STEP + 0.02, top - bot, ROAD_W);
    out.stairs.setMatrixAt(n, m4.compose(c, q, sc));
    out.stairs.setColorAt(n, roadCol.clone().multiplyScalar(n % 2 ? 1.0 : 0.88));
  });
  if (stairIdx.length) out.stairs.instanceColor.needsUpdate = true;
  group.add(out.stairs);

  // 3) 线：每步刻度（accent[1]）+ 两侧路沿（accent[0]）
  const lp = [], lc = [];
  const line = (a, b, col) => { lp.push(a.x, a.y, a.z, b.x, b.y, b.z); lc.push(col.r, col.g, col.b, col.r, col.g, col.b); };
  const tick = acc[1].clone().multiplyScalar(0.55), edge = acc[0];
  const hw = ROAD_W / 2, e = 0.012;
  for (let i = 0; i <= N; i++) {
    const st = steps[Math.min(i, N - 1)], stairs = i < N && st.kind.startsWith('stairs');
    const y = stairs ? Math.max(st.h0, st.h1) : (i < N ? st.h0 : P[N].y);
    const a = at(i), L = a.left;
    line(new THREE.Vector3(P[i].x + L.x * hw, y + e, P[i].z + L.z * hw), new THREE.Vector3(P[i].x - L.x * hw, y + e, P[i].z - L.z * hw), stairs ? acc[2] : tick);
  }
  for (const sgn of [1, -1]) {
    let prev = null;
    for (let s = S0; s <= S1; s += 0.5) {
      const a = at(s), i = Math.floor(s);
      const y = (i >= 0 && i < N && steps[i].kind.startsWith('stairs')) ? Math.max(steps[i].h0, steps[i].h1) : a.pos.y;
      const p = new THREE.Vector3(a.pos.x + a.left.x * hw * sgn, y + e, a.pos.z + a.left.z * hw * sgn);
      if (prev) line(prev, p, edge);
      prev = p;
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  out.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
  out.lines.name = 'lines'; group.add(out.lines);

  // 4) 红灯：停止线 + 信号灯（灯杆在路左侧）
  for (const sg of route.segs) {
    if (sg.kind !== 'wait') continue;
    const a = at(sg.start), g = new THREE.Group();
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(0.12, ROAD_W), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    stop.rotation.set(-Math.PI / 2, 0, 0); stop.position.set(0, 0.015, 0);
    const stopG = new THREE.Group(); stopG.add(stop); stopG.position.copy(a.pos); stopG.rotation.y = -a.heading; group.add(stopG);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), new THREE.MeshLambertMaterial({ color: 0x333842 }));
    pole.position.y = 1.3; g.add(pole);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.3), new THREE.MeshLambertMaterial({ color: 0x15171c }));
    box.position.set(0, 2.45, 0); g.add(box);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    const green = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x20ff80 }));
    red.position.set(-0.12, 2.6, 0); green.position.set(-0.12, 2.3, 0); g.add(red, green);
    const b = at(sg.start + sg.steps);     // 灯在斑马线对面、路右侧，灯面朝走过来的人；停在停止线时正好在前方
    g.position.copy(b.pos).addScaledVector(b.left, -(hw + 0.5)); g.rotation.y = -b.heading;
    group.add(g);
    const sig = { seg: sg, group: g, red, green, state: '' };
    sig.set = st => { if (st === sig.state) return; sig.state = st; red.material.color.set(st === 'red' ? 0xff2030 : 0x2a0a0c); green.material.color.set(st === 'green' ? 0x20ff80 : 0x0a2a14); };
    sig.set('red'); out.signals.push(sig);
  }

  // 5) 起点营地（小帐篷 + 起点线）与山顶旗
  const a0 = at(0.5, -3.6);
  const camp = new THREE.Group(); camp.name = 'camp';
  const tent = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.75, 4), new THREE.MeshLambertMaterial({ color: acc[1] }));
  tent.position.y = 0.37; tent.rotation.y = Math.PI / 4; camp.add(tent);
  camp.position.copy(a0.pos); group.add(camp); out.camp = camp;
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, ROAD_W), new THREE.MeshBasicMaterial({ color: acc[1] }));
  const a1 = at(0); startLine.rotation.set(-Math.PI / 2, 0, 0); const sl = new THREE.Group(); sl.add(startLine);
  sl.position.copy(a1.pos).setY(0.014); sl.rotation.y = -a1.heading; group.add(sl);

  const aN = at(N + 2.2, 0.9);
  const flag = new THREE.Group(); flag.name = 'flag';
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  fp.position.y = 1.2; flag.add(fp);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 1), new THREE.MeshBasicMaterial({ color: acc[0], side: THREE.DoubleSide }));
  cloth.position.set(0.45, 2.1, 0); flag.add(cloth); out.cloth = cloth;
  flag.position.copy(aN.pos); flag.rotation.y = -aN.heading; group.add(flag); out.flag = flag;
  return out;
}

// 每 10 Hz 由引擎调用：信号灯随位置变色
export function updateSignals(meshes, pos) {
  for (const s of meshes.signals) s.set(pos >= s.seg.start + s.seg.steps ? 'green' : 'red');
}
