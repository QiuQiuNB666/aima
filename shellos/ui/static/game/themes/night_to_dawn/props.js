// 路边的东西：石垒（黑灰火山石干垒）、山小屋（波纹铁皮顶 + 木格窗 + 暖帘 + 竖木牌）、鸟居、石灯笼、幟旗、石柱、火山岩。
// 几何都按「本地坐标 → place() 摆到路边」拼，按站分组 merged：每站每种材质 1 次绘制。
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const qy = a => new THREE.Quaternion().setFromAxisAngle(Y, a);

// 本地零件 parts（p, ry, s, geo, color）整体平移到 at、绕 y 转 ry
export function place(parts, at, ry, out = []) {
  const q = qy(ry);
  for (const pt of parts) {
    const p = new THREE.Vector3(...(pt.p || [0, 0, 0])).applyQuaternion(q).add(at);
    out.push({ ...pt, p, q: q.clone().multiply(pt.q || qy(pt.ry || 0)), ry: undefined });
  }
  return out;
}

// 石垒中线：离路中心 lat 的偏移点再沿路前后各 3 步做加权平均（Z 字坡上不会跟着路扭成波浪），
//   平均完离路太近的点沿法线推回去（路沿 1.1 + 石块半厚）
function wallCurve(route, util, s0, s1, side, lat, ds = 0.125) {
  const out = [], W = 3, K = 12;
  for (let s = s0; s <= s1 + 1e-6; s += ds) {
    let x = 0, z = 0, wsum = 0;
    for (let k = -K; k <= K; k++) {
      const w = 1 - Math.abs(k) / (K + 1), a = route.at(s + k * W / K, side * lat);
      x += a.pos.x * w; z += a.pos.z * w; wsum += w;
    }
    x /= wsum; z /= wsum;
    const nr = util.nearestRoute(route, x, z), min = lat - 0.12;
    if (nr.d < min) { const c = route.at(s); const dx = x - c.pos.x, dz = z - c.pos.z, L = Math.hypot(dx, dz) || 1; x = c.pos.x + dx / L * min; z = c.pos.z + dz / L * min; }
    out.push({ s, x, z, y: route.heightAt(s) });
  }
  let acc = 0;
  out.forEach((q, i) => { if (i) acc += Math.hypot(q.x - out[i - 1].x, q.z - out[i - 1].z); q.d = acc; });
  return out;
}
function sampleAt(C, d) {                    // 按弧长取点 + 切向
  let i = 1; while (i < C.length - 1 && C[i].d < d) i++;
  const a = C[i - 1], b = C[i], f = Math.max(0, Math.min(1, (d - a.d) / Math.max(1e-6, b.d - a.d)));
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f, tx: b.x - a.x, tz: b.z - a.z };
}

// 火山石：拍扁的不规则块（顶点按方向抖动），instanced + flatShading
export function stoneGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.86 + 0.14 * Math.sin(x * 9.1 + y * 5.7 + z * 7.3) * Math.cos(x * 3.1 - z * 4.9);
    p.setXYZ(i, x * k, y * (0.9 + 0.1 * Math.sin(x * 13 + z * 11)), z * k);
  }
  g.computeVertexNormals();
  return g;
}

// 沿路石垒：黑色背板（石缝里的黑）+ 两层火山石（下层整齐、上层参差），石块 0.35–0.6，高 0.5–0.6。
// runs: [{ side: 1 左 / -1 右, s0, s1, lat }]；返回 { back: Mesh, stones: items[] }
export function stoneWalls(ctx, runs, R) {
  const { route, util } = ctx, stones = [], parts = [];
  const c0 = new THREE.Color('#2e2a29'), c1 = new THREE.Color('#4a3a34'), cc = new THREE.Color();
  for (const r of runs) {
    const C = wallCurve(route, util, r.s0, r.s1, r.side, r.lat), L = C[C.length - 1].d;
    // 背板：朝路的一面 + 顶，比石头矮一点、往外缩 0.08
    const pos = [], idx = [];
    C.forEach((q, i) => {
      const n = sampleAt(C, q.d), tl = Math.hypot(n.tx, n.tz) || 1, ox = n.tz / tl * r.side, oz = -n.tx / tl * r.side;   // 离路方向（左 = (tz, -tx)）
      const bx = q.x + ox * 0.08, bz = q.z + oz * 0.08;
      pos.push(bx, q.y - 0.9, bz, bx, q.y + 0.42, bz, bx + ox * 0.3, q.y + 0.42, bz + oz * 0.3);
      if (i) { const k = (i - 1) * 3; idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    parts.push({ geo: g.toNonIndexed(), color: '#0b0909' });
    for (let course = 0; course < 2; course++) {
      let d = course ? R() * 0.3 : R() * 0.1;
      while (d < L) {
        const w = 0.35 + R() * 0.25;
        if (course && R() < 0.12) { d += w * 0.6; continue; }          // 上层偶尔缺一块：顶面参差
        const q = sampleAt(C, Math.min(L, d + w / 2)), tl = Math.hypot(q.tx, q.tz) || 1;
        const ox = q.tz / tl * r.side, oz = -q.tx / tl * r.side;
        const h = course ? 0.2 + R() * 0.16 : 0.34 + R() * 0.06, th = 0.32 + R() * 0.16;
        const y0 = course ? q.y + 0.28 + R() * 0.04 : q.y - 0.12;
        const hd = Math.atan2(q.tz, q.tx);
        stones.push({
          p: [q.x + ox * th * 0.45, y0 + h / 2, q.z + oz * th * 0.45],
          q: new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.12, -hd + (R() - 0.5) * 0.25, (R() - 0.5) * 0.14, 'YXZ')),
          s: [w * 0.94, h, th],
          color: '#' + cc.copy(c0).lerp(c1, R()).multiplyScalar(0.9 + R() * 0.25).getHexString(),
        });
        d += w + 0.015;
      }
    }
  }
  const back = new THREE.Mesh(util.merged(parts), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  back.name = 'wallBacking';
  return { back, stones };
}

// 波纹铁皮：竖向波纹（灰蓝 #5a6a78），u 方向重复
export function tinTexture(util) {
  return util.canvasTexture(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = 0.5 + 0.5 * Math.sin(x / w * Math.PI * 2 * 16), v = 0.72 + 0.42 * k;
      g.fillStyle = `rgb(${90 * v | 0},${106 * v | 0},${120 * v | 0})`; g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = 'rgba(40,30,26,0.35)';                                 // 锈斑
    for (let i = 0; i < 40; i++) { const x = (i * 97) % w, y = (i * 53) % h; g.fillRect(x, y, 3 + (i % 5), 2 + (i % 3)); }
  }, { repeat: true });
}

// 山小屋（本地：x 沿路宽 w，z 离路方向深 d，正面在 z = -d/2 朝路）。
// 返回 { body（lambert 顶点色）, roof（铁皮贴图）, glass（不吃光：窗、门、月光屋脊）, glow, text, noren（暖帘挂点）, lamps（檐下提灯）}
export function hut({ w = 4.2, d = 2.4, h = 2.0, name, yago, lit = 3, chochin = false } = {}) {   // yago = 屋号（门楣上的横木牌，真实的吉田口山小屋名）
  const body = [], roof = [], glass = [], glow = [], text = [], noren = [], lamps = [];
  const wood = '#6a4630', dark = '#2a1b12';
  body.push({ geo: new THREE.BoxGeometry(w + 0.5, 3.0, d + 0.5), p: [0, -1.42, 0], color: '#6e3a27' });          // 石基（埋进坡里；火山砂色，下坡那侧露出来也像地面不像黑底座）
  body.push({ geo: new THREE.BoxGeometry(w, h, d), p: [0, h / 2, 0], color: wood });
  for (let k = 0; k < 4; k++) body.push({ geo: new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02), p: [0, 0.35 + k * 0.45, 0], color: '#553722' });   // 横板缝
  for (const kx of [-1, 1]) for (const kz of [-1, 1]) body.push({ geo: new THREE.BoxGeometry(0.16, h, 0.16), p: [kx * (w / 2 - 0.02), h / 2, kz * (d / 2 - 0.02)], color: dark });
  // 山墙（两端三角）+ 双坡铁皮屋顶 + 屋脊（冷蓝月光边）+ 压顶石
  const rise = 0.85, half = d / 2 + 0.35, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const eave = rise * (half - d / 2) / half, tri = new THREE.Shape(); tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(d / 2, eave); tri.lineTo(0, rise - 0.04); tri.lineTo(-d / 2, eave); tri.closePath();
  for (const kx of [-1, 1]) body.push({ geo: new THREE.ShapeGeometry(tri).rotateY(Math.PI / 2), p: [kx * (w / 2 + 0.001), h, 0], color: '#5a3c28' });
  for (const kz of [-1, 1]) {
    const g = new THREE.BoxGeometry(w + 0.6, 0.06, slope);
    roof.push({ geo: g, p: [0, h + rise / 2 - 0.02, kz * half / 2], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), kz * ang), color: '#ffffff' });
    for (let i = 0; i < 3; i++) {                                         // 压顶石
      const f = 0.35 + 0.3 * (i % 2), x = (i - 1) * (w / 3) + (i % 2 ? 0.2 : -0.15);
      body.push({ geo: new THREE.DodecahedronGeometry(0.2, 0), p: [x, h + rise * (1 - f) + 0.12, kz * half * f], s: [1.2, 0.7, 1], color: '#3d3836' });
    }
  }
  glass.push({ geo: new THREE.BoxGeometry(w + 0.64, 0.07, 0.12), p: [0, h + rise + 0.02, 0], color: '#6f86c8' });            // 屋脊月光边
  for (const kz of [-1, 1]) glass.push({ geo: new THREE.BoxGeometry(w + 0.62, 0.03, 0.05), p: [0, h - 0.02, kz * (half + 0.01)], color: '#4a5a8c' });   // 檐口冷光
  // 窗（木格 2×3）与门（暖帘）
  const n = lit, gap = w / (n + 1), front = -d / 2 - 0.015;
  for (let k = 1; k <= n; k++) {
    const x = -w / 2 + gap * k, door = k === Math.ceil(n / 2);
    if (door) {
      glass.push({ geo: new THREE.PlaneGeometry(0.8, 1.45).rotateY(Math.PI), p: [x, 0.73, front], color: '#ffb24a' });
      for (const kx of [-1, 1]) noren.push({ p: [x + kx * 0.2, 1.45, front - 0.03], color: '#e9e2d0' });   // 白布暖帘（左右两幅，挂点在上沿；入口统一做成会飘的实例）
      glass.push({ geo: new THREE.BoxGeometry(0.95, 0.05, 0.05), p: [x, 1.46, front - 0.04], color: '#1a120c' });
      body.push({ geo: new THREE.BoxGeometry(0.1, 1.5, 0.08), p: [x - 0.45, 0.75, front - 0.02], color: dark }, { geo: new THREE.BoxGeometry(0.1, 1.5, 0.08), p: [x + 0.45, 0.75, front - 0.02], color: dark });
      if (name) {                                                        // 竖木牌：立在前方屋角外（走近时先看到），写站名
        const sx = w / 2 + 0.34, sz = front - 0.1;
        body.push({ geo: new THREE.BoxGeometry(0.4, 1.46, 0.07), p: [sx, 1.05, sz + 0.05], color: '#b08a5c' }, { geo: new THREE.BoxGeometry(0.09, 0.4, 0.09), p: [sx, 0.2, sz + 0.05], color: dark });
        text.push({ text: name, p: [sx, 1.05, sz], ry: Math.PI, h: 1.34, vertical: true, color: '#1e120a', bg: '#c49c68', border: '#4a3020', weight: 900, pad: 0.12 });
      }
      if (yago) {                                                        // 屋号横牌：门楣上方、檐下
        body.push({ geo: new THREE.BoxGeometry(0.2 + 0.36 * [...yago].length, 0.44, 0.06), p: [x, 1.74, front - 0.03], color: '#3a2616' });
        text.push({ text: yago, p: [x, 1.74, front - 0.07], ry: Math.PI, h: 0.36, color: '#f4ead2', bg: '#3a2616', border: '#c9a24a', weight: 900, pad: 0.1 });
      }
      glow.push({ p: [x, 0.8, front - 0.25], c: '#ffbf64', sz: 2.6 });
    } else {
      const gw = 0.66, gh = 0.62, gy = 1.2;
      glass.push({ geo: new THREE.PlaneGeometry(gw, gh).rotateY(Math.PI), p: [x, gy, front], color: '#ffcf78' });
      const bar = (bw, bh, bx, by) => body.push({ geo: new THREE.BoxGeometry(bw, bh, 0.05), p: [x + bx, gy + by, front - 0.02], color: '#2c1c10' });
      bar(gw + 0.1, 0.07, 0, gh / 2); bar(gw + 0.1, 0.07, 0, -gh / 2); bar(0.07, gh, -gw / 2, 0); bar(0.07, gh, gw / 2, 0);   // 框
      bar(0.04, gh, 0, 0); bar(gw, 0.035, 0, gh / 6); bar(gw, 0.035, 0, -gh / 6);                                       // 2 列 × 3 行
      glow.push({ p: [x, gy, front - 0.25], c: '#ffbf64', sz: 1.9 });
    }
  }
  glow.push({ p: [w / 2 - 0.3, h - 0.25, -half - 0.1], c: '#ffd890', sz: 1.5 });                        // 檐下灯
  if (chochin) for (let x = -w / 2 + 0.25, k = 0; x <= w / 2 - 0.2; x += 0.42, k++)                     // 檐下一串提灯（红白相间）：入口统一做成实例，人走近才一盏盏点亮
    lamps.push({ p: [x, h - 0.28, -d / 2 - 0.3], color: k % 2 ? '#e8402a' : '#ffe0b0' });
  return { body, roof, glass, glow, text, noren, lamps };
}

// 鸟居（本地：柱子在 z = ±hw，横梁沿 z，正面朝 -x）
export function torii({ hw = 2.3, H = 3.4, red = '#c8361f', black = '#1d1414' } = {}) {
  const P = [], len = hw * 2 + 1.5;
  for (const z of [-hw, hw]) {
    P.push({ geo: new THREE.CylinderGeometry(0.15 * H / 3.4, 0.19 * H / 3.4, H, 14), p: [0, H / 2, z], color: red });
    P.push({ geo: new THREE.CylinderGeometry(0.23 * H / 3.4, 0.25 * H / 3.4, 0.42, 14), p: [0, 0.2, z], color: black });
  }
  const kasagi = new THREE.BoxGeometry(0.36, 0.26, len, 1, 1, 16), kp = kasagi.attributes.position;
  for (let i = 0; i < kp.count; i++) { const t = kp.getZ(i) / (len / 2); kp.setY(i, kp.getY(i) + 0.22 * t * t * t * t); }
  kasagi.computeVertexNormals();
  P.push({ geo: kasagi, p: [0, H + 0.2, 0], color: black });
  P.push({ geo: new THREE.BoxGeometry(0.3, 0.16, len - 0.35), p: [0, H - 0.02, 0], color: red });            // 島木
  P.push({ geo: new THREE.BoxGeometry(0.2, 0.2, hw * 2 + 0.7), p: [0, H - 0.8, 0], color: red });             // 貫
  P.push({ geo: new THREE.BoxGeometry(0.18, 0.66, 0.2), p: [0, H - 0.4, 0], color: red });                    // 額束
  return P;
}

// 石灯笼（本地原点在地面）；返回 { parts, light:[x,y,z] }
export function lantern() {
  const c = '#6d6560';
  return {
    parts: [
      { geo: new THREE.BoxGeometry(0.5, 0.18, 0.5), p: [0, 0.09, 0], color: c },
      { geo: new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), p: [0, 0.48, 0], color: c },
      { geo: new THREE.BoxGeometry(0.42, 0.08, 0.42), p: [0, 0.82, 0], color: c },
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => ({ geo: new THREE.BoxGeometry(0.05, 0.3, 0.05), p: [x * 0.13, 1.0, z * 0.13], color: c })),
      { geo: new THREE.ConeGeometry(0.38, 0.28, 4).rotateY(Math.PI / 4), p: [0, 1.28, 0], color: c },
    ],
    light: [0, 1.0, 0],
  };
}

// 合目路牌：木桩 + 牌（牌面朝来路、略偏向路）
export function signpost(text, sub, left = false) {
  const k = left ? -1 : 1;
  return {
    parts: [{ geo: new THREE.BoxGeometry(0.12, 1.5, 0.12), p: [0, 0.75, 0.05 * k], color: '#4a3524' }],
    text: [{ text: sub ? `${text}\n${sub}` : text, p: [-0.1, 1.35, 0], ry: -Math.PI / 2 - 0.4 * k, h: sub ? 0.62 : 0.4, color: '#20140c', bg: '#eadcb8', border: '#4a3524', weight: 900 }],
  };
}

// 幟（のぼり）：竹竿 + 竖长布（红白），布面朝来路
export function nobori(cloth = '#c8361f') {
  return {
    parts: [
      { geo: new THREE.CylinderGeometry(0.03, 0.035, 2.6, 6), p: [0, 1.3, 0], color: '#8a7a50' },
      { geo: new THREE.BoxGeometry(0.02, 0.03, 0.5), p: [0, 2.5, -0.25], color: '#8a7a50' },
    ],
    cloth: [
      { geo: new THREE.PlaneGeometry(0.46, 1.5).rotateY(Math.PI / 2), p: [0, 1.73, -0.25], color: cloth },
      { geo: new THREE.PlaneGeometry(0.46, 0.18).rotateY(Math.PI / 2), p: [0.002, 2.4, -0.25], color: '#f2ede2' },
      { geo: new THREE.PlaneGeometry(0.46, 0.12).rotateY(Math.PI / 2), p: [0.002, 1.06, -0.25], color: '#f2ede2' },
    ],
  };
}

// 山顶石柱：方柱 + 基座（本地原点在地面，正面朝 -x）
export function pillar() {
  return [
    { geo: new THREE.BoxGeometry(0.9, 0.3, 0.9), p: [0, 0.15, 0], color: '#5a5450' },
    { geo: new THREE.BoxGeometry(0.42, 1.9, 0.42), p: [0, 1.25, 0], color: '#77706a' },
    { geo: new THREE.ConeGeometry(0.33, 0.22, 4).rotateY(Math.PI / 4), p: [0, 2.31, 0], color: '#6a6460' },
  ];
}

// 火山岩：一块 20 面体随机拉扁，instanced
export function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * Math.abs(Math.sin(p.getX(i) * 7.1 + p.getZ(i) * 3.3)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.62 * k, p.getZ(i) * k); }
  g.computeVertexNormals();
  return g;
}
