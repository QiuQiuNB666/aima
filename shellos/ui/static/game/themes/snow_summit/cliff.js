// 悬崖三段（球球：「最好是在悬崖峭壁上走，有感觉一些，然后加上一个搭梯子过悬崖的环节」）。按路段名找，没有就什么都不做（「一句话造山」的雪山照样能用）：
//   横梯 = 名字带「梯」的平路（北坳裂缝·横梯）；刀脊 = 带「刀脊」；横切 = 带「横切 / 栈道」。
//   ① 冰裂缝 + 横梯：裂缝是个透镜形的缝（沿路 2、横着 15），壁从雪白 → 冰蓝 → 深蓝 → 黑底、越往下越窄；地面在缝里的三角形删掉，
//      四周一圈雪沿（贴地面高度）盖住删出来的锯齿；路面在缝上那 4 步挖掉——梯子就是路。两道梯子并排（化身 / 影子各走一道），
//      每道两架首尾绑接；两侧扶手绳 + 雪锥。梯子在顶点着色器里往下弯（踩哪弯哪，每跨一级弹一下），不稳时左右抖。
//   ② 刀脊：路面收到 1 m，两侧约 60° 往下掉 26（左侧先悬出一道雪檐再往下），坡面上一道道岩肋；路绳只剩脊上一根。
//   ③ 贴壁栈道：路面收到 1.4（外 0.6 / 里 0.8），右边一堵往外探的灰岩壁（层理），左边深渊。
//   地面在刀脊 / 横切两侧跟着往下挖（cliffGround，snow_summit.js 的地面循环调），挖得比坡面再低一点：地面永远藏在坡面下面。
//   坡面 / 岩壁 / 裂缝 / 梯子并成 1 个网格（不投影、只接影）；雾带 + 往上涌的雪雾 1 个（雪雾是广告牌，在着色器里转）；滚石 1 个。
//   三个都只在附近才画（第一帧照画一遍：管线先建好，之后开关不卡）。
// 过梯（只动画面和声音，不碰控制）：步频 > 110 或站在梯上 > 4 s → 不稳：镜头晃、梯子抖、峰哥「慢点，一步一档」；连续不稳 2.5 s → 失足：
//   镜头往下一栽 → 黑场 + 惨叫 → 淡回来，失足计数 +1（window.__fgFalls，并派 'fg:fall' 事件给 HUD）；稳稳走过去 → 「过了，这是个好事儿啊」。
//   ponytail: 「化身拉回梯子起点」没做——化身位置归引擎的步进器（me），跳回去后它按 5 步/s 追平，黑场 0.9 s 里就追回来了，看不出拉回；
//   要做得引擎给一个「视觉步数暂停」钩子。
import * as THREE from 'three';
import { STEP, ROAD_W, rng } from '../../path.js';
import { fgSay } from './lines.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const HW = ROAD_W / 2, LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'low';
// 折线剖面：x（离路沿往外）→ 往下多深；超出最后一点按最后一段的斜率接着掉
const prof = (X, D) => x => {
  if (x <= X[0]) return D[0];
  for (let i = 1; i < X.length; i++) if (x <= X[i]) return mix(D[i - 1], D[i], (x - X[i - 1]) / (X[i] - X[i - 1]));
  const n = X.length - 1; return D[n] + (x - X[n]) * (D[n] - D[n - 1]) / (X[n] - X[n - 1]);
};
const KX = [0, 0.12, 0.35, 0.8, 1.5, 2.6, 4.2, 6.5, 9.5, 13.5], KD = [0, 0.05, 0.3, 1.0, 2.4, 4.9, 8.6, 13.5, 19.5, 26];            // 刀脊右侧
const CX = [0, 0.25, 0.5, 0.6, 0.45, 0.6, 1.2, 2.2, 3.8, 6, 9, 13.5], CD = [0, 0.03, 0.14, 0.3, 0.55, 0.9, 2.2, 4.4, 7.8, 12.5, 19, 26];   // 左侧：先悬出一道雪檐（x 往回收 = 檐下掏空）
const VX = [0, 0.1, 0.3, 0.7, 1.4, 2.6, 4.5, 7, 10.5, 15], VD = [0, 0.08, 0.5, 1.8, 4.2, 8.3, 14, 21, 29, 38];                    // 横切外侧深渊
// 横切岩壁（x 往右为正，h = 离栈道高）：贴着路沿立起来，2.3 处往外探一点，5.4 高后往后倒下去（岩脊背面，积雪）
const WX = [0, 0.04, 0.12, 0.17, 0.13, 0.25, 0.55, 1.2, 2.2, 3.6, 5.2, 7.2, 9.5], WH = [-0.3, 0.25, 0.9, 1.7, 2.3, 3.2, 4.2, 5.0, 5.4, 5.1, 3.6, 1.0, -3];
const kD = prof(KX, KD), vD = prof(VX, VD);

export function cliffZones(route) {
  const find = re => route.segs.find(g => re.test(g.label || '')) || null, end = g => g.start + g.steps;
  const xing = route.segs.find(g => g.kind === 'flat' && /梯/.test(g.label || '')) || null, knife = find(/刀脊/), trav = find(/横切|栈道/);
  const C = { xing, knife, trav, end };
  C.wK = s => knife ? smooth(knife.start - 6, knife.start - 0.5, s) * (1 - smooth(end(knife) - 1, end(knife), s)) : 0;
  C.wT = s => trav ? smooth(trav.start + 0.2, trav.start + 1.2, s) * (1 - smooth(end(trav) - 0.8, end(trav) + 0.2, s)) : 0;
  C.hw = (s, o = [0, 0]) => { const k = C.wK(s), t = C.wT(s); o[0] = HW - (HW - 0.5) * k - (HW - 0.6) * t; o[1] = HW - (HW - 0.5) * k - (HW - 0.8) * t; return o; };   // 路面半宽 [左, 右]
  if (xing) { C.sc = xing.start + xing.steps / 2; C.g0 = xing.start + 0.5; C.g1 = end(xing) - 0.5; }   // 缝在路上占 [g0, g1]（4 步 = 2 个单位）
  // 刀脊 / 横切的横向用一个固定方向（段中间的左方向）：路在入口拐一点，坡面远处不打折
  const frame = (s0, s1, w) => { const a = route.at((s0 + s1) / 2); return { s0, s1, w, L: a.left.clone(), D: a.dir.clone(), cx: a.pos.x, cz: a.pos.z, r: (s1 - s0) * STEP / 2 + 34 }; };
  if (knife) C.K = frame(knife.start - 6, end(knife), C.wK);
  if (trav) C.T = frame(trav.start, end(trav) + 0.4, C.wT);
  return C;
}
const _hw = [0, 0], _a = {}, _v = new THREE.Vector3();
// 世界点 → 段坐标（s = 沿固定方向投影回路中心线，lat = 离中心线沿固定左方向多远）
function toSeg(route, F, x, z, out) {
  let s = (F.s0 + F.s1) / 2;
  for (let k = 0; k < 4; k++) { route.at(s, 0, _a); s += ((x - _a.pos.x) * F.D.x + (z - _a.pos.z) * F.D.z) / STEP; }
  route.at(s, 0, _a); out.s = s; out.lat = (x - _a.pos.x) * F.L.x + (z - _a.pos.z) * F.L.z;
  return out;
}
const _sl = {};
// 地面循环调：刀脊两侧 / 横切外侧的地面挖到坡面下面（再低 1）；横切右侧（岩壁）不动——地面在岩壁里面看不见
export function cliffGround(C, route, x, z, y) {
  for (const F of [C.K, C.T]) {
    if (!F || Math.hypot(x - F.cx, z - F.cz) > F.r) continue;
    const q = toSeg(route, F, x, z, _sl);
    if (q.s < F.s0 || q.s > F.s1) continue;
    const w = F.w(q.s); if (w < 0.02) continue;
    const hw = C.hw(q.s, _hw), left = q.lat >= 0, xx = Math.abs(q.lat) - hw[left ? 0 : 1];
    if (xx <= 0) continue;
    const u = xx / w, r = route.heightAt(q.s);
    if (F === C.K) y = Math.min(y, r - w * (kD(u) * (left ? 1 + 0.6 * (1 - smooth(0.6, 1.6, u)) : 1) + smooth(0.2, 1.5, u)));   // 左边雪檐下掏空：地面再深一点
    else if (left) y = Math.min(y, r - w * (vD(u) + smooth(0.2, 1.5, u)));
  }
  return y;
}

// 路面（引擎给的 M.road：每个小段 4 个顶点 = [s0 左, s0 右, s1 左, s1 右]，uv.x = 横向（左正）、uv.y = s × STEP）：
//   刀脊 / 横切把两侧顶点往里收；裂缝那 4 步整段缩成一点（跨缝的那段截到缝口）
export function shapeRoad(C, route, road) {
  const g = road.geometry, p = g.attributes.position, uv = g.attributes.uv, a = {};
  for (let i = 0; i < p.count; i++) {
    const s = uv.getY(i) / STEP, sg = uv.getX(i) > 0 ? 1 : -1;
    if (C.wK(s) < 1e-3 && C.wT(s) < 1e-3) continue;
    const lat = sg * C.hw(s, _hw)[sg > 0 ? 0 : 1];
    route.at(s, lat, a); p.setX(i, a.pos.x); p.setZ(i, a.pos.z); uv.setX(i, lat);
  }
  if (C.xing) for (let q = 0; q + 3 < p.count; q += 4) {
    const s0 = uv.getY(q) / STEP, s1 = uv.getY(q + 2) / STEP;
    if (s1 <= C.g0 || s0 >= C.g1) continue;
    const move = (k, s) => { for (const j of [k, k + 1]) { route.at(s, (uv.getX(j) > 0 ? 1 : -1) * HW, a); p.setXYZ(j, a.pos.x, a.pos.y, a.pos.z); uv.setY(j, s * STEP); } };
    if (s0 >= C.g0 && s1 <= C.g1) for (let j = 1; j < 4; j++) p.setXYZ(q + j, p.getX(q), p.getY(q), p.getZ(q));
    else if (s0 < C.g0) move(q + 2, C.g0);
    else move(q, C.g1);
  }
  p.needsUpdate = true; uv.needsUpdate = true; g.computeBoundingSphere();
}

// 裂缝：以缝中心为原点的局部直角坐标（a = 沿路，c = 横着，左正），半宽 G、半长 Lc
const G = 1.0, Lc = 7.5;
const hg = c => G * Math.sqrt(Math.max(0, 1 - (c / Lc) ** 2)) * (1 + 0.14 * Math.sin(c * 1.9 + 1) * smooth(1.2, 2.5, Math.abs(c)));

export function buildCliff(scene, ctx, { C, ground, hAt }) {
  const { route, kit } = ctx, R = rng(77), parts = [], col = new THREE.Color();
  let grp = 0;
  if (!C.xing && !C.knife && !C.trav) return null;
  const add = (g, glow = 0, ld = 0) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aGlow'].includes(k)) g.deleteAttribute(k);   // 用自己的 aLd / aGrp
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.aGlow) g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    g.setAttribute('aLd', new THREE.BufferAttribute(new Float32Array(n).fill(ld), 1));
    g.setAttribute('aGrp', new THREE.BufferAttribute(new Float32Array(n).fill(grp), 1));
    parts.push(g);
  };
  // 网格面：rows[i][j] = [x, y, z, r, g, b, glow]；closed = 每行首尾相接（雪沿那一圈）
  const grid = (rows, closed = false) => {
    const nr = rows.length, nc = rows[0].length, pos = [], cl = [], gl = [], idx = [];
    for (const row of rows) for (const v of row) { pos.push(v[0], v[1], v[2]); cl.push(v[3], v[4], v[5]); gl.push(v[6] || 0); }
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - (closed ? 0 : 1); j++) {
      const j1 = (j + 1) % nc, a = i * nc + j, b = i * nc + j1, c = a + nc, d = b + nc; idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(gl, 1)); g.setIndex(idx); g.computeVertexNormals();
    add(g);
  };
  const piece = (geo, color, glow, ld, p, q) => { if (q) geo.applyQuaternion(q); geo.translate(p.x, p.y, p.z); const g = geo.toNonIndexed(), n = g.attributes.position.count, a = new Float32Array(n * 3); col.set(color); for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); add(g, glow, ld); };
  const qAlong = v => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.clone().normalize());
  const stick = (a, b, r, color, glow, ld, seg = 5) => { const d = b.clone().sub(a); piece(new THREE.CylinderGeometry(r, r, d.length(), seg).rotateZ(Math.PI / 2), color, glow, ld, a.clone().lerp(b, 0.5), qAlong(d)); };
  const nz = (x, z) => kit.fbm(x, z, 3);
  const out = { C, U: null };

  // ---------- ① 冰裂缝 + 横梯 ----------
  if (C.xing) {
    const c0 = route.at(C.sc), O = c0.pos.clone(), D = c0.dir.clone(), Lf = c0.left.clone(), yR = route.heightAt(C.sc);
    const W = (a, c, y) => new THREE.Vector3(O.x + D.x * a + Lf.x * c, y, O.z + D.z * a + Lf.z * c);
    const gy = (a, c) => { const p = W(a, c, 0); return hAt(p.x, p.z); };
    // 地面挖洞：三角形只要有一个角 / 重心落进缝（外扩 0.15）就删；洞边的锯齿由下面的雪沿盖住（雪沿外扩 2.3 > 一格对角线）
    {
      const g = ground.geometry, p = g.attributes.position, ix = g.index.array, keep = [];
      const inside = (x, z) => { const dx = x - O.x, dz = z - O.z, a = dx * D.x + dz * D.z, c = dx * Lf.x + dz * Lf.z; return Math.abs(c) < Lc + 0.15 && Math.abs(a) < hg(c) + 0.15; };
      for (let t = 0; t < ix.length; t += 3) {
        const A = ix[t], B = ix[t + 1], Cc = ix[t + 2], xs = [p.getX(A), p.getX(B), p.getX(Cc)], zs = [p.getZ(A), p.getZ(B), p.getZ(Cc)];
        if (Math.hypot(xs[0] - O.x, zs[0] - O.z) < Lc + 4 && (inside(xs[0], zs[0]) || inside(xs[1], zs[1]) || inside(xs[2], zs[2]) || inside((xs[0] + xs[1] + xs[2]) / 3, (zs[0] + zs[1] + zs[2]) / 3))) continue;
        keep.push(A, B, Cc);
      }
      g.setIndex(keep);
    }
    // 雪沿：绕缝一圈，5 道环（0 = 缝口，最外一道沉到地面下 → 接缝藏在地里）
    {
      const M = 72, OFF = [0, 0.3, 0.9, 1.9, 2.3], LIFT = [0.035, 0.035, 0.03, 0.02, -0.08], rows = [];
      for (let k = 0; k < OFF.length; k++) {
        const row = [];
        for (let m = 0; m < M; m++) {
          const th = m / M * Math.PI * 2, c = Lc * Math.cos(th), a = Math.sign(Math.sin(th)) * hg(c);
          let na = a / (G * G), nc = c / (Lc * Lc); const nl = Math.hypot(na, nc) || 1; na /= nl; nc /= nl;
          const aa = a + na * OFF[k], cc = c + nc * OFF[k], v = 0.9 + 0.06 * nz(aa * 0.8, cc * 0.8);
          col.set(k === 0 ? '#d8e8f4' : '#eaf0f6').multiplyScalar(v);
          const p = W(aa, cc, gy(aa, cc) + LIFT[k]); row.push([p.x, p.y, p.z, col.r, col.g, col.b, 0.05]);
        }
        rows.push(row);
      }
      grid(rows, true);
    }
    // 缝壁：两侧各一片，缝口 → 往下收窄（V 形），颜色 雪白 → 冰蓝 → 深蓝 → 黑；冰自己透光（glow），不靠太阳照
    {
      const DEP = [0, 0.12, 0.45, 1.2, 2.6, 5.5], INS = [1, 1.05, 0.95, 0.85, 0.68, 0.45], CO = ['#eef5fb', '#9fd4f0', '#3a86c6', '#0c3566', '#020b1c', '#000000'].map(h => new THREE.Color(h)), GL = [0.1, 0.85, 0.7, 0.35, 0.08, 0];
      for (const sd of [1, -1]) {
        const rows = [];
        for (let m = 0; m <= 44; m++) {
          const c = -Lc + 2 * Lc * m / 44, h = hg(c), kc = Math.pow(Math.max(0, 1 - (c / Lc) ** 2), 0.35), y0 = gy(sd * h, c) + 0.035, row = [];
          for (let j = 0; j < DEP.length; j++) {
            const a = sd * (h * INS[j] + (j === 1 ? 0.04 : 0)), streak = 0.82 + 0.36 * nz(c * 2.3 + sd * 5, j * 0.7);
            col.copy(CO[j]).multiplyScalar(j ? streak : 1);
            const p = W(a, c, y0 - DEP[j] * kc); row.push([p.x, p.y, p.z, col.r, col.g, col.b, GL[j]]);
          }
          rows.push(row);
        }
        grid(rows);
      }
    }
    // 横梯：两道并排（c = 0.35 化身、c = −0.5 影子），每道两架首尾绑接；边梁 + 横档（30 cm 一根）+ 接头处缠绳；梯头压着雪锥
    const AL = '#d6dce3', aE = G + 0.32, yL = yR + 0.03;
    for (const ct of [0.35, -0.5]) {
      for (const [a0, a1] of [[-aE, 0.02], [-0.02, aE]]) {
        for (const e of [0.22, -0.22]) piece(new THREE.BoxGeometry(a1 - a0, 0.07, 0.035), AL, 0.25, 1, W((a0 + a1) / 2, ct + e, yL - 0.035), qAlong(D));
        for (let a = a0 + 0.12; a < a1 - 0.05; a += 0.3) piece(new THREE.CylinderGeometry(0.017, 0.017, 0.44, 6), AL, 0.25, 1, W(a, ct, yL - 0.01), qAlong(Lf).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)));
      }
      for (const e of [0.22, -0.22]) for (let k = -1; k <= 1; k++) piece(new THREE.BoxGeometry(0.03, 0.1, 0.06), k ? '#e8a21c' : '#d7342b', 0.1, 1, W(k * 0.07, ct + e, yL - 0.035), qAlong(D));   // 接头缠绳
      for (const sa of [-1, 1]) for (const e of [0.3, -0.3]) piece(new THREE.BoxGeometry(0.04, 0.34, 0.03), AL, 0.2, 0, W(sa * (aE - 0.08), ct + e, gy(sa * aE, ct) + 0.12));   // 梯头两边的雪锥
    }
    for (const a of [-aE + 0.15, 0, aE - 0.15]) stick(W(a, 0.35 - 0.22, yL - 0.05), W(a, -0.5 + 0.22, yL - 0.05), 0.012, '#e8a21c', 0.1, 1, 4);   // 两道梯子之间横着绑
    // 扶手绳：两侧各一根，两头系在 1 m 高的雪锥顶上，中间往下垂
    for (const [cr, rc] of [[0.93, '#d7342b'], [-1.08, '#2f6fd6']]) {
      const pa = W(-(G + 1.0), cr, gy(-(G + 1.0), cr)), pb = W(G + 1.0, cr, gy(G + 1.0, cr));
      for (const p of [pa, pb]) piece(new THREE.BoxGeometry(0.05, 1.05, 0.03), AL, 0.2, 0, p.clone().setY(p.y + 0.45));
      const n = 10; let prev = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n, a = mix(-(G + 1.0), G + 1.0, f), y = mix(pa.y, pb.y, f) + 0.95 - 0.16 * 4 * f * (1 - f), p = W(a, cr, y);
        if (prev) stick(prev, p, 0.013, rc, 0.15, 0.5 * Math.sin(Math.PI * f), 4);
        prev = p;
      }
    }
    // 梯子弯 / 抖的参数（着色器）：梯子是直的，从 A 到 B
    const A = W(-aE, 0, 0), B = W(aE, 0, 0);
    out.lad = { A, len: 2 * aE, D: D.clone() };
  }

  // ---------- ② 刀脊两侧坡面 ----------
  grp = 1;
  const snowC = new THREE.Color('#f4f8fc'), under = new THREE.Color('#c9dcec'), rockA = new THREE.Color('#47433f'), rockB = new THREE.Color('#5f5851'), deep = new THREE.Color('#aab8c6');
  if (C.K) {
    const F = C.K;
    for (const side of [1, -1]) {
      const X = side > 0 ? CX : KX, Dd = side > 0 ? CD : KD, rows = [];
      for (let s = F.s0; s <= F.s1 + 1e-6; s += 0.25) {
        const w = F.w(s), hw = C.hw(s, _hw)[side > 0 ? 0 : 1], y0 = route.heightAt(s), c0 = route.at(s).pos, row = [];
        for (let j = 0; j < X.length; j++) {
          const lat = side * (hw + X[j] * w), px = c0.x + F.L.x * lat, pz = c0.z + F.L.z * lat, n = nz(s * 0.9 + side * 7, X[j] * 0.35);
          const rib = smooth(0.44, 0.56, n) * smooth(0.7, 1.8, X[j]);                                      // 岩肋：竖着一道道（往下约一半是岩）
          col.copy(side > 0 && j >= 3 && j <= 5 ? under : snowC).lerp(rockA.clone().lerp(rockB, nz(px, pz)), rib).lerp(deep, smooth(12, 24, Dd[j]) * 0.6);
          row.push([px, y0 - Dd[j] * w, pz, col.r, col.g, col.b, side > 0 && j === 4 ? 0.2 : 0.06]);
        }
        rows.push(row);
      }
      grid(rows);
    }
  }

  // ---------- ③ 横切：右边岩壁 + 左边深渊 ----------
  if (C.T) {
    const F = C.T, GR = ['#77726b', '#8a847b', '#6a655f', '#9a9388'].map(h => new THREE.Color(h)), rowsW = [], rowsV = [];
    for (let s = F.s0; s <= F.s1 + 1e-6; s += 0.25) {
      const w = F.w(s), hw = C.hw(s, _hw), y0 = route.heightAt(s), c0 = route.at(s).pos, rw = [], rv = [];
      for (let j = 0; j < WX.length; j++) {
        const lat = -(hw[1] + WX[j] * w), px = c0.x + F.L.x * lat, pz = c0.z + F.L.z * lat, y = y0 + WH[j] * w - (1 - w) * 0.3;
        const band = GR[Math.floor((y + 0.35 * nz(px * 0.8, pz * 0.8)) / 0.42 + 100) % 4], crack = 0.8 + 0.35 * smooth(0.35, 0.6, nz(s * 2.2, j * 0.3));
        col.copy(band).multiplyScalar(crack).lerp(snowC, j >= 8 ? 0.55 + 0.4 * smooth(0.35, 0.6, nz(px * 0.5, pz * 0.5)) : 0);   // 顶上 / 背面积雪
        rw.push([px, y, pz, col.r, col.g, col.b, 0.14]);                                                // 阴面也别发黑
      }
      for (let j = 0; j < VX.length; j++) {
        const lat = hw[0] + VX[j] * w, px = c0.x + F.L.x * lat, pz = c0.z + F.L.z * lat, n = nz(s * 0.8 + 3, VX[j] * 0.3);
        col.copy(snowC).lerp(rockA.clone().lerp(rockB, nz(px, pz)), smooth(0.4, 0.52, n) * smooth(0.3, 1.2, VX[j])).lerp(deep, smooth(14, 30, VD[j]) * 0.6);
        rv.push([px, y0 - VD[j] * w, pz, col.r, col.g, col.b, 0.05]);
      }
      rowsW.push(rw); rowsV.push(rv);
    }
    grid(rowsW); grid(rowsV);
  }

  if (!parts.length) return null;
  const geo = mergeAll(parts);
  const U = { uP0: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) }, uLen: { value: 1 }, uFoot: { value: -10 }, uDip: { value: 0 }, uShake: { value: 0 }, uT: { value: 0 }, uRevA: { value: 1 }, uRevB: { value: 0 } };
  if (out.lad) { U.uP0.value.set(out.lad.A.x, out.lad.A.z); U.uDir.value.set(out.lad.D.x, out.lad.D.z).normalize(); U.uLen.value = out.lad.len; }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute float aGlow; attribute float aLd; attribute float aGrp; uniform vec2 uP0, uDir; uniform float uLen, uFoot, uDip, uShake, uT, uRevA, uRevB; varying float vGlow, vRev;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vGlow = aGlow; vRev = aGrp < 0.5 ? uRevA : uRevB;
      if (aLd > 0.0) {                                                  // 梯子：以脚下为中心往下弯（两头不动）+ 不稳时左右抖
        float d = dot(transformed.xz - uP0, uDir), b = sin(3.14159 * clamp(d / uLen, 0.0, 1.0)), x = (d - uFoot) / 0.8;
        transformed.y -= aLd * b * (uDip * exp(-x * x) + 0.025);
        transformed.xz += vec2(-uDir.y, uDir.x) * aLd * b * uShake * sin(uT * 23.0 + d * 2.1);
        transformed.y += aLd * b * uShake * 0.5 * sin(uT * 31.0 + d * 3.3);
      }`);
    sh.fragmentShader = 'varying float vGlow, vRev;\n' + sh.fragmentShader     // 走到才露面：同 props.js 的屏幕噪声溶解，只是每组一个进度
      .replace('void main() {', 'void main() {\n  if (vRev < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= vRev) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  mat.customProgramCacheKey = () => 'snowCliff';
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'cliff'; scene.add(mesh);
  out.mesh = mesh; out.U = U;

  // ---------- 雾带（两层，往下 5.5 / 11）+ 往上涌的雪雾（广告牌）：1 次绘制 ----------
  {
    const zs = [C.K, C.T].filter(Boolean), s0 = Math.min(...zs.map(F => F.s0)), s1 = Math.max(...zs.map(F => F.s1)), ctr = route.at((s0 + s1) / 2).pos, yb = route.heightAt((s0 + s1) / 2);
    const pos = [], uv = [], ab = [], idx = [];
    const quad = (p, corners, uvs, b) => { const i0 = pos.length / 3; corners.forEach((cq, k) => { pos.push(p.x + cq[0], p.y + cq[1], p.z + cq[2]); uv.push(...uvs[k]); ab.push(...b(k)); }); idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); };
    if (zs.length) for (const [dy, S] of [[-5.5, 60], [-11, 75]]) quad(new THREE.Vector3(ctr.x, yb + dy, ctr.z), [[-S, 0, -S], [S, 0, -S], [S, 0, S], [-S, 0, S]], [[0, 0], [1, 0], [1, 1], [0, 1]], () => [0, 0, 0, 0]);
    const CN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0, n = zs.length ? (LOW ? 24 : 56) : 0; i < n; i++) {
      const F = zs[i % zs.length], s = mix(F.s0, F.s1, R()), side = F === C.T ? 1 : R() < 0.5 ? 1 : -1, lat = side * (1.8 + R() * 6), c0 = route.at(s).pos;
      const p = new THREE.Vector3(c0.x + F.L.x * lat, route.heightAt(s) - 3 - R() * 2, c0.z + F.L.z * lat), sz = 1.4 + R() * 1.6, ph = R();
      quad(p, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]], k => [CN[k][0], CN[k][1], sz, ph]);
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aB', new THREE.Float32BufferAttribute(ab, 4)); g.setIndex(idx);
      const FU = { uT: { value: 0 }, uK: { value: 0 }, uCol: { value: new THREE.Color('#e8eef5') }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3(1, 0, 0) } };
      const fm = new THREE.ShaderMaterial({
        uniforms: FU, transparent: true, depthWrite: false, fog: false,
        vertexShader: `attribute vec4 aB; uniform float uT; uniform vec3 uWind; varying vec2 vUv; varying float vA, vKind; varying vec3 vW;
          void main(){
            vec3 p = position;
            if (aB.z > 0.0) {                                          // 雪雾：约 20 s 从深渊里涌上来一轮，两头淡出（循环接缝看不见）；顺风飘
              float ph = fract(uT * 0.05 * (0.7 + 0.6 * fract(aB.w * 7.1)) + aB.w);
              p.y += -6.0 + 8.5 * ph; p += uWind * (sin(uT * 0.3 + aB.w * 6.0) * 0.8 + ph * 2.0);
              vA = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.55, 1.0, ph)); vKind = 1.0; vUv = aB.xy * 0.5 + 0.5; vW = p;
              vec4 mv = modelViewMatrix * vec4(p, 1.0); mv.xy += aB.xy * aB.z * (0.8 + 0.5 * ph);
              gl_Position = projectionMatrix * mv;
            } else { vA = 1.0; vKind = 0.0; vUv = uv; vW = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }
          }`,
        fragmentShader: `uniform float uT, uK; uniform vec3 uCol, uCam; varying vec2 vUv; varying float vA, vKind; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
          float fbm(vec2 p){ return 0.5 * n(p) + 0.25 * n(p * 2.03) + 0.125 * n(p * 4.1); }
          void main(){
            vec2 q = vUv - 0.5; float a;
            if (vKind > 0.5) a = (1.0 - smoothstep(0.05, 0.25, dot(q, q))) * (0.5 + 0.5 * fbm(vUv * 3.0 + vec2(0.0, -uT * 0.08))) * 0.42 * vA;
            else a = (1.0 - smoothstep(0.55, 1.0, length(q) * 2.0)) * smoothstep(0.32, 0.7, fbm(vW.xz * 0.07 + vec2(uT * 0.012, uT * 0.007))) * 0.8;
            float d = distance(vW, uCam); a *= uK * (1.0 - smoothstep(60.0, 120.0, d)) * smoothstep(0.6, 3.0, d);
            if (a < 0.004) discard;
            gl_FragColor = vec4(uCol, a);
            #include <colorspace_fragment>
          }`,
      });
      const fog = new THREE.Mesh(g, fm); fog.name = 'cliffMist'; fog.renderOrder = 3; fog.frustumCulled = false; scene.add(fog);
      out.fog = fog; out.FU = FU;
    }
  }
  // 滚石：刀脊 / 横切时偶尔从路沿滚下去一块（进段 1.2 s 一块，之后约 30 s 一块）
  if (C.K || C.T) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0).scale(1.2, 0.85, 1), new THREE.MeshLambertMaterial({ color: '#4d4a47', flatShading: true }));
    rock.name = 'cliffRock'; scene.add(rock); out.rock = { m: rock, on: false, t: 0, s: 0, lat: 0, y: 0, vl: 0, vy: 0, sd: 1, F: null, next: 1e9, bounces: 0 };
  }
  out.first = 0;
  return out;
}

// 并成一个非索引几何：position / normal / color / aGlow / aLd / aGrp
function mergeAll(parts) {
  const names = ['position', 'normal', 'color', 'aGlow', 'aLd', 'aGrp'], size = { position: 3, normal: 3, color: 3, aGlow: 1, aLd: 1, aGrp: 1 };
  const n = parts.reduce((m, g) => m + g.attributes.position.count, 0), g = new THREE.BufferGeometry();
  for (const k of names) {
    const a = new Float32Array(n * size[k]); let o = 0;
    for (const p of parts) { a.set(p.attributes[k].array, o); o += p.attributes[k].array.length; }
    g.setAttribute(k, new THREE.BufferAttribute(a, size[k]));
  }
  g.computeBoundingSphere();
  return g;
}

// ---------- 每帧：过梯的稳 / 不稳 / 失足，镜头晃、FOV，雾，滚石 ----------
export function makeCliffState() {
  return { wob: 0, instT: 0, stillT: 0, lastS: null, fallT: -1, falls: 0, said: {}, maxWob: 0, onL: false, ldStep: null, ldK: 0, fov0: null, fovK: 0, veil: null, rockNext: 1e9, lastRock: -99, lap: -1 };
}
export function updateCliff(CL, X, dt, st, { kit, route, fovK, fogColor, windDir }) {
  const { C } = CL, s = st.s, t = st.t || 0, cam = st.camera, live = !st.preview && !st.summit;
  // 第一帧照画（建管线），之后只在附近才画
  CL.first++;
  const warm = CL.first > 2, near = (a, b) => s > a && s < b;
  // 裂缝在地面上挖了洞：过裂缝之前一直画（大本营也看得见北坳）；刀脊 / 横切离段口 6 → 1 步溶出来（过了北坳；雾里看不出），登顶不画（横切岩壁比顶峰高）
  const last = C.T || C.K, onCliff = !st.summit && s < (last ? last.s1 + 4 : C.end(C.xing) + 8);
  if (CL.mesh) {
    CL.mesh.visible = !warm || onCliff; CL.mesh.frustumCulled = warm;
    const first = C.K || C.T; CL.U.uRevB.value = first ? smooth(first.s0 - 6, first.s0 - 1, s) : 0;
  }
  // 新一圈：台词、滚石重置
  if (C.xing && s < C.xing.start - 5) { X.said = {}; X.lap++; X.rockNext = 1e9; X.falls = 0; }

  // —— 横梯 ——
  if (C.xing && CL.U) {
    const U = CL.U, inL = !st.summit && s > C.g0 - 0.6 && s < C.g1 + 0.6, onL = inL && live;
    const G_ = window.__game, SS = G_ && G_.S ? G_.S() : null, cad = SS && SS.gait ? SS.gait.cadence || 0 : 0;
    X.stillT = X.lastS !== null && Math.abs(s - X.lastS) < 1e-4 ? X.stillT + dt : 0; X.lastS = s;
    const bad = onL && X.fallT < 0 && (cad > 110 || X.stillT > 4);
    X.instT = bad ? X.instT + dt : 0;
    X.wob = Math.max(0, Math.min(1, X.wob + (bad ? dt * 1.6 : -dt * 1.2)));
    if (onL) X.maxWob = Math.max(X.maxWob, X.wob);
    if (onL && !X.onL) { X.maxWob = 0; X.fellHere = false; }
    if (bad && X.wob > 0.3 && !X.said.wobble) { X.said.wobble = t; fgSay('ladder_wobble'); }
    if (X.said.wobble && t - X.said.wobble > 8) X.said.wobble = 0;                          // 8 s 后再晃可以再提醒
    if (X.instT > 2.5 && X.fallT < 0) { X.fallT = 0; X.instT = 0; X.falls++; X.fellHere = true; fall(kit); }
    if (X.onL && !onL && s >= C.g1 + 0.6 && !X.fellHere && !X.said.pass) { X.said.pass = 1; fgSay('ladder_pass'); }
    X.onL = onL;
    // 梯子往下弯：踩哪弯哪、每跨一级弹一下
    const k = Math.floor(s);
    if (onL && X.ldStep !== null && k !== X.ldStep) X.ldK = 1;                               // 声音（铝梯「当」）M2 的声景按路段名「梯」已经出了
    X.ldStep = k; X.ldK = Math.max(0, X.ldK - dt * 3);
    U.uDip.value = st.preview ? (inL ? 0.08 : 0) : U.uDip.value + ((inL ? 0.06 + 0.05 * X.ldK : 0) - U.uDip.value) * Math.min(1, dt * 8);
    if (st.avatar) U.uFoot.value = (st.avatar.x - U.uP0.value.x) * U.uDir.value.x + (st.avatar.z - U.uP0.value.y) * U.uDir.value.y;
    U.uShake.value = 0.035 * X.wob + (X.fallT >= 0 && X.fallT < 0.4 ? 0.08 : 0);
    U.uT.value = t % 1000;
  }
  // —— 失足：0–0.35 s 镜头往下一栽 + 黑场起，0.35–1.25 全黑，1.25–2.05 淡回来 ——
  let veilA = 0, lurch = 0;
  if (X.fallT >= 0) {
    X.fallT += dt; const f = X.fallT;
    lurch = smooth(0, 0.35, f) * (1 - smooth(1.2, 1.3, f));
    veilA = f < 0.35 ? smooth(0.1, 0.35, f) : f < 1.25 ? 1 : 1 - smooth(1.25, 2.05, f);
    if (f > 1.3 && !X.saidFall) { X.saidFall = true; fgSay('fall'); }
    if (f > 2.05) { X.fallT = -1; X.saidFall = false; X.wob = 0; }
  }
  setVeil(X, veilA);
  // —— 镜头：晃（不稳）/ 往下栽（失足）/ 刀脊横切 FOV +8° ——（主题 update 在引擎摆完镜头之后，这里叠一点偏移；__camHold 调试时不动）
  if (cam && !window.__camHold) {
    if (X.fov0 === null) X.fov0 = cam.fov;
    X.fovK += ((st.summit ? 0 : fovK) - X.fovK) * Math.min(1, dt * 3);
    const fov = X.fov0 + 8 * X.fovK;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const tk = Math.min(X.fovK, C.wK(s));                                                   // 刀脊：往左边深渊偏一点、低一点头（横切不偏：右边的岩壁要在画里）
    if (tk > 0.001) { cam.rotateY(0.2 * tk); cam.rotateX(-0.1 * tk); }
    const w = X.wob;
    if (w > 0.001 || lurch > 0.001) {
      const a = route.at(s);
      cam.position.addScaledVector(a.left, 0.07 * w * Math.sin(t * 6.3)).y += 0.035 * w * Math.sin(t * 9.1) - 0.7 * lurch;
      cam.rotateZ(0.05 * w * Math.sin(t * 4.7) + 0.2 * lurch);
      cam.rotateX(-0.45 * lurch);
    }
  }
  // —— 台词：进刀脊 / 进横切各一句 ——
  if (live && C.knife && s > C.knife.start + 0.5 && s < C.end(C.knife) && !X.said.knife) { X.said.knife = 1; fgSay('knife'); }
  if (live && C.trav && s > C.trav.start + 0.5 && s < C.end(C.trav) && !X.said.trav) { X.said.trav = 1; fgSay('traverse'); }
  // —— 雾带 / 雪雾 ——
  if (CL.fog) {
    const zs = [C.K, C.T].filter(Boolean), s0 = Math.min(...zs.map(F => F.s0)), s1 = Math.max(...zs.map(F => F.s1));
    const k = st.summit ? 0 : smooth(s0 - 12, s0 - 4, s) * (1 - smooth(s1 + 1, s1 + 5, s));
    CL.FU.uK.value = k; CL.FU.uT.value = t % 1000;
    if (cam) CL.FU.uCam.value.copy(cam.position);
    if (fogColor) CL.FU.uCol.value.copy(fogColor).lerp(WHITE, 0.35);
    if (windDir) CL.FU.uWind.value.copy(windDir);
    CL.fog.visible = !warm || k > 0.001;
  }
  // —— 滚石 ——
  if (CL.rock) rockUpdate(CL, X, dt, st, kit, route, live, warm);
}
const WHITE = new THREE.Color('#ffffff');

function fall(kit) {
  kit.sfx('scream', 1); kit.sfx('ice', 1, { pitch: 0.7 }); kit.sfx('ladder', 0.9, { pitch: 0.62 });   // 惨叫（kit 里没有 'scream' 就不出声）+ 冰爪刮冰 + 梯子一声闷响
  window.__fgFalls = (window.__fgFalls || 0) + 1;
  try { window.dispatchEvent(new CustomEvent('fg:fall', { detail: { n: window.__fgFalls, map: 'everest_north', where: '北坳裂缝·横梯' } })); } catch (e) { /* 老浏览器 */ }
}
function setVeil(X, a) {
  if (!X.veil) {
    if (a <= 0) return;
    const cv = document.getElementById('c'); if (!cv) return;
    const d = document.createElement('div'); d.className = 'cliffVeil'; d.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;';
    cv.insertAdjacentElement('afterend', d); X.veil = d;
  }
  const v = a.toFixed(3); if (X.veil.style.opacity !== v) X.veil.style.opacity = v;
}

const _p = new THREE.Vector3(), _r = {};
function rockUpdate(CL, X, dt, st, kit, route, live, warm) {
  const { C } = CL, K = CL.rock, s = st.s, t = st.t || 0;
  const inK = C.K && s > C.knife.start - 0.5 && s < C.end(C.knife), inT = C.T && s > C.trav.start - 0.3 && s < C.end(C.trav);
  if (live && (inK || inT) && X.rockNext > t + 1.5 && t - X.lastRock > 8 && !X.said['rock' + (inK ? 'K' : 'T')]) { X.said['rock' + (inK ? 'K' : 'T')] = 1; X.rockNext = t + 1.2; }   // 进段 1.2 s 来一块
  if (live && !K.on && (inK || inT) && t >= X.rockNext) {
    const F = inK ? C.K : C.T, s0 = Math.min(F.s1 - 0.5, s + 2.5 + Math.random()), sd = F === C.T ? 1 : Math.random() < 0.5 ? 1 : -1, hw = C.hw(s0, _hw)[sd > 0 ? 0 : 1];
    Object.assign(K, { on: true, t: 0, s: s0, lat: sd * (hw + 0.05), y: route.heightAt(s0) + 0.2, vl: sd * 0.7, vy: 0.6, sd, F, bounces: 0 });
    X.lastRock = t; X.rockNext = t + 26 + Math.random() * 8;
    kit.sfx('rock', 0.8, { pitch: 1.3 });
  }
  if (K.on) {
    K.t += dt; K.vy -= 7 * dt; K.lat += K.vl * dt; K.y += K.vy * dt;
    const w = K.F.w(K.s), hw = C.hw(K.s, _hw)[K.sd > 0 ? 0 : 1], x = Math.max(0, Math.abs(K.lat) - hw) / Math.max(0.05, w);
    const floor = route.heightAt(K.s) - w * (K.F === C.K ? kD(x) : vD(x)) + 0.17;
    if (K.y < floor && K.t > 0.05) {
      K.y = floor; K.vy = Math.abs(K.vy) * 0.38 + 0.25; K.vl += K.sd * 0.5; K.bounces++;
      if (K.bounces < 4) kit.sfx('rock', 0.55 / K.bounces, { pitch: 1.1 - 0.1 * K.bounces });
    }
    route.at(K.s, 0, _r); _p.copy(_r.pos).addScaledVector(K.F.L, K.lat); _p.y = K.y;
    K.m.position.copy(_p); K.m.rotation.x += dt * 9 * K.sd; K.m.rotation.z += dt * 5;
    if (K.t > 5 || K.y < route.heightAt(K.s) - 30) K.on = false;
  }
  K.m.visible = !warm || K.on;
}
