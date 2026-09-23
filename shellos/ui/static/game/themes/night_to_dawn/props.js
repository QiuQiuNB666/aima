// 路边的东西：石垒（沿路连续、圆顺）、山小屋（木屋 + 暖灯窗 + 站名牌）、鸟居、石灯笼、火山岩、合目路牌。
// 全部 merged / instanced：每类 1 次绘制。几何都按「本地坐标 → place() 摆到路边」拼。
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const qy = a => new THREE.Quaternion().setFromAxisAngle(Y, a);

// 本地零件 parts（p, ry, s, geo, color）整体平移到 at、绕 y 转 ry
export function place(parts, at, ry, out = []) {
  const q = qy(ry);
  for (const pt of parts) {
    const p = new THREE.Vector3(...(pt.p || [0, 0, 0])).applyQuaternion(q).add(at);
    out.push({ ...pt, p, q: q.clone().multiply(qy(pt.ry || 0)), ry: undefined });
  }
  return out;
}

// 石垒贴图：深色砂浆里一块块不规则的火山石
export function stoneTexture(util, R) {
  return util.canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#1c1616'; g.fillRect(0, 0, w, h);
    for (let row = 0, y = 4; row < 4; row++, y += 31) {
      for (let x = -((row * 23) % 40); x < w;) {
        const sw = 30 + R() * 34, v = 70 + R() * 60, r = v * (1.05 + R() * 0.25);
        g.fillStyle = `rgb(${r | 0},${v * 0.78 | 0},${v * 0.68 | 0})`;
        g.beginPath(); g.roundRect(x + 2, y + R() * 3, sw - 4, 26 + R() * 3, 7); g.fill();
        g.fillStyle = 'rgba(255,230,200,0.10)'; g.fillRect(x + 6, y + 3, sw - 14, 4);   // 上沿一点高光
        x += sw;
      }
    }
  }, { repeat: true });
}

// 沿路石垒：侧向用平滑过的朝向（±1 步平均）偏移，Z 字拐角内侧也不会折；每段 = 内立面 + 顶面 + 外立面三条带
// runs: [{ side: 1 左 / -1 右, s0, s1, lat, h, th }]
export function wallSamples(route, s0, s1, side, lat, ds = 0.25) {
  const out = [];
  for (let s = s0; s <= s1 + 1e-6; s += ds) {
    let hx = 0, hz = 0;
    for (let k = -4; k <= 4; k++) { const h = route.headingAt(s + k * 0.25); hx += Math.cos(h); hz += Math.sin(h); }
    const n = Math.hypot(hx, hz), L = [hz / n, -hx / n], c = route.at(s).pos;
    out.push({ x: c.x + L[0] * side * lat, z: c.z + L[1] * side * lat, lx: L[0] * side, lz: L[1] * side, y: route.heightAt(s) });
  }
  return out;
}
export function stoneWalls(ctx, runs, mat) {
  const { route, util } = ctx, parts = [];
  for (const r of runs) {
    const S = wallSamples(route, r.s0, r.s1, r.side, r.lat), th = r.th || 0.4, h = r.h, bot = 0.9;
    const strip = (fa, fb, vScale) => {                    // fa/fb(sample) → [x,y,z]：一条带的两条边
      const pos = [], uv = [], idx = []; let acc = 0;
      S.forEach((q, i) => {
        if (i) acc += Math.hypot(q.x - S[i - 1].x, q.z - S[i - 1].z);
        const a = fa(q), b = fb(q); pos.push(...a, ...b); uv.push(acc / 1.3, 0, acc / 1.3, vScale);
        if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    const P = (q, off, y) => [q.x + q.lx * off, y, q.z + q.lz * off];
    parts.push({ geo: strip(q => P(q, 0, q.y - bot), q => P(q, 0, q.y + h), (h + bot) / 0.55), color: '#ffffff' });            // 内立面（朝路）
    parts.push({ geo: strip(q => P(q, 0, q.y + h), q => P(q, th, q.y + h + 0.02), 0.5), color: '#c9b8a8' });                 // 顶面
    parts.push({ geo: strip(q => P(q, th, q.y + h + 0.02), q => P(q, th + 0.25, q.y - bot), (h + bot) / 0.55), color: '#b0a090' });  // 外坡面
  }
  const m = new THREE.Mesh(util.merged(parts), mat); m.name = 'stoneWalls';
  return m;
}

// 山小屋（本地：x 沿路宽 w，z 离路方向深 d，正面在 z = -d/2 朝路）。返回 { body, glass, glow, text }
export function hut({ w = 4.2, d = 2.4, h = 2.0, name, roof = '#6a2c22', lit = 3 } = {}) {
  const body = [], glass = [], glow = [], text = [];
  body.push({ geo: new THREE.BoxGeometry(w + 0.5, 3.0, d + 0.5), p: [0, -1.42, 0], color: '#3a302d' });          // 石基（埋进坡里）
  body.push({ geo: new THREE.BoxGeometry(w, h, d), p: [0, h / 2, 0], color: '#5b3b27' });
  for (let k = -1; k <= 1; k += 2) body.push({ geo: new THREE.BoxGeometry(0.14, h, 0.14), p: [k * (w / 2 - 0.02), h / 2, -d / 2 - 0.02], color: '#2c1c12' });
  const tri = new THREE.Shape(); tri.moveTo(-d / 2 - 0.35, 0); tri.lineTo(d / 2 + 0.35, 0); tri.lineTo(0, 0.95); tri.closePath();
  const rg = new THREE.ExtrudeGeometry(tri, { depth: w + 0.5, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-(w + 0.5) / 2, 0, 0);
  body.push({ geo: rg, p: [0, h, 0], color: roof });
  body.push({ geo: new THREE.BoxGeometry(w + 0.2, 0.12, 0.5), p: [0, h - 0.02, -d / 2 - 0.3], color: '#2e2420' });   // 挑檐
  const n = lit, gap = w / (n + 1);
  for (let k = 1; k <= n; k++) {
    const x = -w / 2 + gap * k, door = k === Math.ceil(n / 2);
    const gw = door ? 0.75 : 0.62, gh = door ? 1.35 : 0.5, gy = door ? 0.7 : 1.2;
    glass.push({ geo: new THREE.PlaneGeometry(gw, gh).rotateY(Math.PI), p: [x, gy, -d / 2 - 0.015], color: door ? '#ffb24a' : '#ffcf78' });
    glass.push({ geo: new THREE.PlaneGeometry(0.05, gh).rotateY(Math.PI), p: [x, gy, -d / 2 - 0.02], color: '#3a2412' });   // 窗棂
    glow.push({ p: [x, gy, -d / 2 - 0.25], c: '#ffbf64', sz: door ? 2.6 : 2.0 });
  }
  glow.push({ p: [w / 2 - 0.3, h - 0.3, -d / 2 - 0.45], c: '#ffd890', sz: 1.6 });                         // 檐下灯
  if (name) text.push({ text: name, p: [0, h + 0.42, -d / 2 - 0.2], ry: Math.PI, h: 0.5, color: '#2a1a10', bg: '#efe2c4', border: '#3a2414', weight: 900 });
  return { body, glass, glow, text };
}

// 鸟居（本地：柱子在 z = ±hw，横梁沿 z，正面朝 -x = 来路）
export function torii({ hw = 2.3, H = 3.4, red = '#c8361f', black = '#1d1414' } = {}) {
  const P = [], len = hw * 2 + 1.5;
  for (const z of [-hw, hw]) {
    P.push({ geo: new THREE.CylinderGeometry(0.15, 0.19, H, 14), p: [0, H / 2, z], color: red });
    P.push({ geo: new THREE.CylinderGeometry(0.23, 0.25, 0.42, 14), p: [0, 0.2, z], color: black });
  }
  const kasagi = new THREE.BoxGeometry(0.36, 0.24, len, 1, 1, 16), kp = kasagi.attributes.position;
  for (let i = 0; i < kp.count; i++) { const t = kp.getZ(i) / (len / 2); kp.setY(i, kp.getY(i) + 0.2 * t * t * t * t); }   // 两端上翘
  kasagi.computeVertexNormals();
  P.push({ geo: kasagi, p: [0, H + 0.2, 0], color: black });
  P.push({ geo: new THREE.BoxGeometry(0.3, 0.16, len - 0.35), p: [0, H - 0.02, 0], color: red });            // 岛木
  P.push({ geo: new THREE.BoxGeometry(0.2, 0.2, hw * 2 + 0.7), p: [0, H - 0.8, 0], color: red });             // 贯
  P.push({ geo: new THREE.BoxGeometry(0.18, 0.66, 0.2), p: [0, H - 0.4, 0], color: red });                    // 额束
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
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => ({ geo: new THREE.BoxGeometry(0.05, 0.3, 0.05), p: [x * 0.13, 1.0, z * 0.13], color: c })),   // 火袋留空：灯光（光点）从中间透出来
      { geo: new THREE.ConeGeometry(0.38, 0.28, 4).rotateY(Math.PI / 4), p: [0, 1.28, 0], color: c },
    ],
    light: [0, 1.0, 0],
  };
}

// 合目路牌：木桩 + 牌（本地原点在地面；放在路右侧，牌面朝来路、略偏向路）
export function signpost(text, sub) {
  return {
    parts: [{ geo: new THREE.BoxGeometry(0.12, 1.5, 0.12), p: [0, 0.75, 0.05], color: '#4a3524' }],
    text: [{ text: sub ? `${text}\n${sub}` : text, p: [-0.1, 1.35, 0], ry: -Math.PI / 2 - 0.4, h: sub ? 0.62 : 0.4, color: '#20140c', bg: '#eadcb8', border: '#4a3524', weight: 900 }],
  };
}

// 火山岩：一块 20 面体随机拉扁，instanced
export function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * Math.abs(Math.sin(p.getX(i) * 7.1 + p.getZ(i) * 3.3)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.62 * k, p.getZ(i) * k); }
  g.computeVertexNormals();
  return g;
}
