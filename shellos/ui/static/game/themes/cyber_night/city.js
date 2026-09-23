// 城市：临街楼 + 远景高楼（窗格灯，1 次绘制）、竖排霓虹招牌（图集 1 次）+ 招牌光晕 + 湿地面倒影、
//   坂道两侧低层商铺、电线杆与电线、路灯与光晕、自动贩卖机、大屏、楼顶航空灯。
import * as THREE from 'three';
import { STEP } from '../../path.js';
import { quads, glowMat, streakTex, shade, axisX, axisZ, UP, hudProbe } from './lib.js';

const WIN_W = 6.4, WIN_H = 9.6;             // 窗格贴图一张 = 32 列 × 32 层窗对应的世界尺寸（窗距 0.2 × 0.3）；远景楼再 ×TOWER_K
const TOWER_K = 1.7;
const GAP = [6.2, 19.8];                    // 斑马线路口 + 天桥下的大街：这一段不盖临街楼
const SLOPE = [19.8, 28.2];                 // 坂道 + 巷子：低层商铺
const SIGNS = ['渋谷', 'ラーメン', '薬', 'カラオケ', '電脳', '酒', '居酒屋', '焼鳥', '義体', '質', 'ホテル', 'ゴースト', '餃子', '寿司', '宇田川町', '珈琲', '雀荘', '光学迷彩', 'BAR', '二十四時'];   // 攻壳致敬：混进 電脳 / 義体 / ゴースト / 光学迷彩（单词、概念，不是原作画面）
const BOX = ['焼鳥', 'おでん', '餃子', '酒'];
let bxi = 0;
const SHOP = ['中華そば', 'たばこ', '定食', 'やきとり', '古着', 'コインランドリー', '理容', '文具', 'おでん', '銭湯'];
let screenTex = null, aviMat = null, T = 0;

// 窗格：32 列 × 32 层，小窗密排；亮窗约 30%（暖白 / 冷白，整层亮暗有起伏），其余深灰蓝；
//   belts = 横向霓虹腰线 + 空调外机小方块（临街楼用；远景楼不要，免得一栋楼上十几道）
function windowsTex(util, rand, belts) {
  return util.canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#0b0e18'; g.fillRect(0, 0, w, h);
    const warm = ['#ffd9a0', '#ffe6bf', '#f2c68a'], cool = ['#bfe0ff', '#d6ebff', '#a9cff5'];
    for (let r = 0; r < 32; r++) {
      const y = r * 32, p = rand() < 0.3 ? 0.62 : rand() < 0.5 ? 0.28 : 0.1, pal = rand() < 0.55 ? warm : cool;   // 整层偏亮 / 一般 / 偏暗
      g.fillStyle = '#121626'; g.fillRect(0, y + 27, w, 3);                                      // 楼层线
      for (let c = 0; c < 32; c++) {
        const x = c * 32, on = rand() < p;
        g.fillStyle = on ? pal[Math.floor(rand() * 3)] : '#141a2a';
        g.globalAlpha = on ? 0.55 + rand() * 0.45 : 1;
        g.fillRect(x + 7, y + 6, 18, 17);
        g.globalAlpha = 1;
        if (belts && !on && rand() < 0.12) { g.fillStyle = '#3a3f4e'; g.fillRect(x + 9, y + 20, 14, 8); g.fillStyle = '#23262f'; g.fillRect(x + 12, y + 22, 8, 4); }   // 空调外机
      }
    }
    if (belts) for (const [r, col] of [[9, '#ff2e88'], [23, '#29e7ff']]) {                         // 霓虹腰线（发光带 + 外晕）
      const y = r * 32 + 28; g.fillStyle = col; g.globalAlpha = 0.35; g.fillRect(0, y - 5, w, 14); g.globalAlpha = 1; g.fillRect(0, y, w, 4);
    }
  }, { repeat: true });
}

// 单位方块，uv 按楼的尺寸放大（窗子大小不随楼变形）；顶/底面取贴图角上的墙色
function boxUV(w, h, d, u0, v0, k = 1) {
  const g = new THREE.BoxGeometry(1, 1, 1), uv = g.attributes.uv;
  for (let v = 0; v < uv.count; v++) {
    const f = Math.floor(v / 4);                            // 0 px, 1 nx, 2 py, 3 ny, 4 pz, 5 nz
    if (f === 2 || f === 3) { uv.setXY(v, 0.002, 0.002); continue; }
    uv.setXY(v, u0 + uv.getX(v) * (f < 2 ? d : w) / (WIN_W * k), v0 + uv.getY(v) * h / (WIN_H * k));
  }
  return g;
}

export function buildCity(scene, ctx, E) {
  const { route, util, theme, rand } = ctx;
  const acc = theme.accent, N = route.N;
  const bParts = [], tParts = [], lam = [], lit = [], signs = [], halos = quads(), refl = quads(), pools = quads(), haloPts = [], haloCol = [];
  const gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06;       // 与 kit.terrain 同一规则的地面高度
  const nx = new THREE.Vector3(), nz = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3();
  const inGap = (a, b) => b > GAP[0] && a < GAP[1];

  // ---- 楼：临街一排（左 4.2、右 3.2 起）+ 后排 + 远景 ----
  const building = (s, lat, w, d, h, color, far = false) => {
    const a = route.at(s, lat), y0 = gy(a.pos.x, a.pos.z);
    (far ? tParts : bParts).push({ geo: boxUV(w, h + 1, d, Math.floor(rand() * 32) / 32, Math.floor(rand() * 32) / 32, far ? TOWER_K : 1), p: [a.pos.x, y0 + h / 2 - 0.5, a.pos.z], ry: -a.heading, s: [w, h + 1, d], color });
    return { a, y0 };
  };
  const tint = () => new THREE.Color('#b4b8d4').offsetHSL((rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.2);   // 近中性：暖白/冷白窗不被染紫
  const near = [], rear = [];
  for (const side of [1, -1]) {
    const front = side > 0 ? 5.6 : 4.4;                        // 出发的街宽一点（涩谷站前），镜头不贴楼
    for (let s = -24; s < GAP[0];) {
      const w = 1.6 + rand() * 1.8, ds = w / STEP, sc = s + ds / 2;
      if (sc + ds / 2 < GAP[0] + 0.4) {
        const d = 3 + rand() * 3, h = (side > 0 ? 3.5 : 2.8) + rand() * 5.5;
        near.push({ side, sc, ds, w, h, front, ...building(sc, side * (front + d / 2), w, d, h, tint()) });
      }
      s += ds + 0.25;
    }
    for (const [r0, r1] of [[-26, GAP[0]], [GAP[1], 28]]) for (let s = r0; s < r1;) {   // 后排（杂居楼）：在前排和商铺头顶露出来；神社山上不盖
      const w = 2.2 + rand() * 2.6, ds = w / STEP, sc = s + ds / 2;
      if (sc + ds / 2 < r1 + 1) {
        const d = 4 + rand() * 3, h = 6 + rand() * 12, fr = (sc > GAP[1] ? 6.8 : 9) + rand() * 1.5;
        rear.push({ side, sc, ds, w, h, front: fr, ...building(sc, side * (fr + d / 2), w, d, h, tint()) });
      }
      s += ds + 0.4;
    }
  }
  // 远景高楼（天际线）：两侧 22–95 外 + 神社后方正前方一片，高 30–120（鸟居 ≈3）；雾浓度 ×0.18 → 越远越淡、但整片天际线始终压在头顶
  const towers = [];
  const tower = (s, lat) => {
    const a = route.at(s, lat), n = util.nearestRoute(route, a.pos.x, a.pos.z);
    if (n.s > GAP[0] - 1 && n.s < GAP[1] + 1 && Math.abs(s - n.s) < 3) return;   // 路口/大街走廊留空
    if (n.d < 16) return;
    const w = 5 + rand() * 9, h = 30 + Math.pow(rand(), 1.5) * 90;
    building(s, lat, w, w * (0.7 + rand() * 0.6), h, new THREE.Color('#9a98c0').multiplyScalar(0.55 + rand() * 0.35), true);
    if (h > 55) towers.push([a.pos.x, a.pos.y + h + 0.6, a.pos.z]);
  };
  for (let k = 0; k < 150; k++) { const side = k % 2 ? 1 : -1; tower(-50 + rand() * (N + 160), side * (22 + Math.pow(rand(), 0.8) * 73)); }
  for (let k = 0; k < 40; k++) tower(N + 40 + rand() * 120, (rand() - 0.5) * 110);
  const winMat = new THREE.MeshBasicMaterial({ map: windowsTex(util, rand, true), vertexColors: true });
  const bmesh = new THREE.Mesh(util.merged(bParts), winMat); bmesh.name = 'buildings'; scene.add(bmesh);
  const twrMat = shade(new THREE.MeshBasicMaterial({ map: windowsTex(util, rand, false), vertexColors: true }), { fogK: 0.18 });
  const tmesh = new THREE.Mesh(util.merged(tParts), twrMat); tmesh.name = 'skyline'; scene.add(tmesh);

  // ---- 竖排霓虹招牌（突き出し看板）：挂在临街楼正面，朝迎面走来的人 ----
  const leftCols = [acc[0], acc[1], '#00ffc6', '#ff4fd8', '#b46bff'], rightCols = [acc[0], '#00ffc6', acc[1], '#ff2e88', '#e8f6ff'];   // 青绿 + 品红为主（攻壳致敬版的雨夜色），黄橙只留在个别大招牌
  let si = Math.floor(rand() * SIGNS.length);
  // 湿地面倒影条：从灯/招牌脚下斜着拉向「它在画面正中时镜头所在处」（镜头在 11 步前、路左 1.4）——
  //   倒影在画面上正好落在招牌正下方，一路拖进画面下三分之一。台阶上不铺（坂道的倒影不拖进天桥台阶）
  const bv = new THREE.Vector3(), tv = new THREE.Vector3(), dv = new THREE.Vector3();
  const streak = (x, z, color, wd, L) => {
    const nb = util.nearestRoute(route, x, z);
    if (nb.s > 29.3 || (nb.s > 9.6 && nb.s < 20.2)) return;
    const f = route.at(nb.s - 11, 1.4).pos;
    dv.set(f.x - x, 0, f.z - z); L = Math.min(L, dv.length() * 0.8); dv.normalize();   // 反射点在灯脚和镜头之间偏镜头一侧
    let nt = util.nearestRoute(route, x + dv.x * L, z + dv.z * L);
    const floor = nb.s >= 20.2 ? 20.4 : -1e9;
    if (nt.s < floor) { L *= (nb.s - floor) / Math.max(0.01, nb.s - nt.s); if (L < 0.8) return; nt = util.nearestRoute(route, x + dv.x * L, z + dv.z * L); }
    bv.set(x, nb.y + 0.015, z); tv.set(x + dv.x * L, nt.y + 0.015, z + dv.z * L);
    refl.add(c.addVectors(bv, tv).multiplyScalar(0.5), nx.set(-dv.z, 0, dv.x).multiplyScalar(wd / 2), tmp.subVectors(tv, bv).multiplyScalar(0.5), color);
  };
  // 关键帧（pos 0 / 5 / 11）里会压进 HUD 面板的招牌：先往下挪（底边不低于地面 +1.9，别压店面），还压着就不挂
  const hud = hudProbe(route, ctx.camRig, [0, 5, 11]);
  const addSign = (text, p, ry, h, color, vertical = true, free = false) => {
    const aspect = vertical ? (96 * 1.15 + 58) / ([...text].length * 104 + 58) : null;   // drawText 的版面（size 96、pad 0.3）
    const w = vertical ? h * aspect : h * ([...text].length * 92 + 58) / 173;
    if (!free) {
      p = p.clone(); const floor = gy(p.x, p.z) + 1.9 + h / 2, ax = axisX(ry, nx).multiplyScalar(w / 2 + 0.2);
      while (hud(p, ax, h / 2 + 0.2) && p.y - 0.5 >= floor) p.y -= 0.5;
      if (hud(p, ax, h / 2 + 0.2)) return 0;
    }
    signs.push({ text, p: p.clone(), ry, h, color, vertical, bg: '#0c0612', border: color, glow: 1, weight: 900 });
    halos.add(c.copy(p).addScaledVector(axisZ(ry, nz), -0.04), axisX(ry, nx).multiplyScalar(w * 1.1 + 0.35), tmp.copy(UP).multiplyScalar(h * 0.62 + 0.3), color);
    streak(p.x, p.z, color, Math.min(0.65, Math.max(0.35, w * 0.5)), 4 + Math.min(1.5, h * 0.4));
    return w;
  };
  for (const b of near) {
    if (rand() > 0.85) continue;
    const text = SIGNS[si++ % SIGNS.length], h = Math.min(b.side < 0 ? 2.3 : 9, 1.2 + [...text].length * 0.42 + rand() * 0.4);   // 右侧近处的竖招牌贴着画面右缘，封顶 2.3
    const along = b.sc + (rand() - 0.5) * b.ds * 0.4, lat = b.side * (b.front - 0.38);
    const a = route.at(along, lat), y = b.y0 + Math.max(h / 2 + 1.0, Math.min(b.h - h / 2 - 0.2, 1.7 + h / 2 + rand() * 1.4));
    const cols = b.side > 0 ? leftCols : rightCols, col = cols[Math.floor(rand() * cols.length)];
    addSign(text, a.pos.clone().setY(y), -a.heading - Math.PI / 2, h, text === '薬' ? '#3fd8ff' : col);   // 薬 = 药妆店的青
  }
  // 路口两角的楼、坂道后面的杂居楼：一栋挂 2–3 块（镜头在路中间往前看，招牌要在画面中段）
  const corner = [1, -1].map(sd => near.filter(q => q.side === sd).reduce((m, q) => q.sc > m.sc ? q : m));
  for (const b of [...corner, ...rear.filter(q => q.sc > GAP[1] - 1)]) {
    const k = b.sc > GAP[1] ? 2 : 1, cols = b.side > 0 ? leftCols : rightCols;
    for (let j = 0; j < k; j++) {
      const text = SIGNS[si++ % SIGNS.length], h = Math.min(b.side < 0 && b.sc < GAP[0] ? 2.3 : 9, 1.4 + [...text].length * 0.5);
      const a = route.at(b.sc + (j / Math.max(1, k - 1) - 0.5) * b.ds * 0.7, b.side * (b.front - 0.4));
      addSign(text, a.pos.clone().setY(b.y0 + Math.min(b.h - h / 2, 1.9 + h / 2 + j * 0.9 + rand())), -a.heading - Math.PI / 2, h, cols[Math.floor(rand() * cols.length)]);
    }
  }
  // 屋顶大字（斜 45° 朝路口）
  for (const [s, side, text, col] of [[-5, 1, 'カラオケ', acc[0]]]) {
    const b = near.filter(q => q.side === side).reduce((m, q) => Math.abs(q.sc - s) < Math.abs(m.sc - s) ? q : m);
    const a = route.at(b.sc, side * (b.front + 1.2));
    addSign(text, a.pos.clone().setY(b.y0 + b.h + 0.75), -a.heading - (side > 0 ? Math.PI / 4 : 3 * Math.PI / 4), 1.2, col, false);
  }

  // ---- 店面：亮着的橱窗 + 雨棚 + 横招牌 +（可选）红灯笼、竖招牌；橱窗光洒在人行道上 ----
  const shopCols = ['#ffcf8a', '#ffe3b0', '#bfe3ff', '#ffb0d0', '#fff0c8'];
  let shi = 0;
  const shopFront = (sc, ds, w, side, front, y0, extras) => {
    const a = route.at(sc), ry = side > 0 ? -a.heading : -a.heading + Math.PI;   // 店面朝路
    const fa = route.at(sc, side * (front - 0.02)), col = shopCols[Math.floor(rand() * shopCols.length)];
    lit.push({ geo: new THREE.PlaneGeometry(w * 0.84, 1.05), p: [fa.pos.x, y0 + 0.62, fa.pos.z], ry, color: new THREE.Color(col).multiplyScalar(0.62) });
    refl.add(c.copy(fa.pos).setY(y0 + 0.035).addScaledVector(a.left, -side * 0.9), axisX(ry, nx).multiplyScalar(w * 0.45), tmp.copy(a.left).multiplyScalar(-side * 0.9), new THREE.Color(col).multiplyScalar(0.55));
    const aw = route.at(sc, side * (front - 0.32));                     // 雨棚
    const awCol = extras ? ['#c8202a', '#c8202a', '#1c2c6b', '#c8202a', '#2a6b52'][Math.floor(rand() * 5)] : [acc[0], '#c8102e', '#2a6b52', '#d9d2c0', '#1c2c6b'][Math.floor(rand() * 5)];
    lam.push({ geo: new THREE.BoxGeometry(w * 0.92, 0.05, 0.5), p: [aw.pos.x, y0 + 1.34, aw.pos.z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, ry, 0, 'YXZ')), color: awCol });
    const text = SHOP[shi++ % SHOP.length], sa = route.at(sc, side * (front - 0.03));
    if (extras && side > 0) {                                           // 坂道左侧（镜头这边、前景）：雨棚下挂暖簾（深蓝底白字），不再是一块素色平板
      const na = route.at(sc, side * (front - 0.56));
      signs.push({ text, p: [na.pos.x, y0 + 1.07, na.pos.z], ry, h: 0.42, color: '#ffffff', bg: '#1c2a5a', glow: 0, weight: 800 });
    } else signs.push({ text, p: [sa.pos.x, y0 + 1.72, sa.pos.z], ry, h: 0.36, color: '#fff4dc', bg: '#1a0f1e', border: acc[2], glow: 0.6, weight: 800 });
    if (extras && side < 0) {                                           // 坂道右侧：橱窗换成灯箱（暖白底红字）
      const t = BOX[bxi++ % BOX.length], la = route.at(sc, side * (front - 0.05));
      signs.push({ text: t, p: [la.pos.x, y0 + 0.66, la.pos.z], ry, h: 0.78, color: '#d8202a', bg: '#fff1dc', border: '#d8202a', glow: 0, weight: 900 });
    }
    if (!extras) return;
    if (rand() < 0.55) {                                                // 红灯笼（提灯）挂在店门口两侧
      for (const o of [-0.38, 0.38]) {
        const la = route.at(sc + o * ds, side * (front - 0.45));
        haloPts.push(la.pos.x, y0 + 1.05, la.pos.z); haloCol.push(1, 0.25, 0.15);
        lit.push({ geo: new THREE.SphereGeometry(0.11, 10, 8), p: [la.pos.x, y0 + 1.05, la.pos.z], s: [1, 1.35, 1], color: '#ff4a2a' });
      }
    }
    if (rand() < 0.6 && side < 0) {                                   // 店上方的竖招牌只在右侧（左侧离镜头近，高过 1.5 会糊在画面左缘）
      const ta = route.at(sc + ds * 0.3, side * (front - 0.35)), t2 = SIGNS[si++ % SIGNS.length];
      addSign(t2, ta.pos.clone().setY(y0 + 2.6), -ta.heading - Math.PI / 2, 0.9 + [...t2].length * 0.3, (side > 0 ? leftCols : rightCols)[Math.floor(rand() * 5)]);
    }
  };
  for (const b of near) shopFront(b.sc, b.ds, b.w, b.side, b.front, b.y0, false);
  // 坂道 / 巷子：低层商铺
  for (const side of [1, -1]) {
    const front = side > 0 ? 3.8 : 2.3;                       // 左侧 3.3 时雨棚（离路 3.0）从天桥下来就糊在镜头左下角
    for (let s = SLOPE[0]; s < SLOPE[1];) {
      const w = 1.3 + rand() * 0.9, ds = w / STEP, sc = s + ds / 2;
      if (sc + ds / 2 > SLOPE[1] + 0.5) break;
      const { y0 } = building(sc, side * (front + 1.3), w, 2.6, 2.3 + rand() * 1.3, tint().multiplyScalar(0.8));
      shopFront(sc, ds, w, side, front, y0, true);
      s += ds + 0.12;
    }
  }
  // 大竖招牌（开场帧的「一眼日本」，约 1.3 宽 × 3–4 高）：位置按 pos 0 的镜头算过 —— カラオケ 在左上 HUD 和中间 HUD 之间的
  //   空档（x 520–630，躲开步行者信号灯），ラーメン / 居酒屋 在中间 HUD 和右上 HUD 之间（x 1240–1460），第四块是近处右侧的青色「薬」。
  //   ラーメン 是斑马线对面街角的立柱招牌，居酒屋 挂在坂道右侧杂居楼上，カラオケ 是坂顶商铺的突き出し看板（底边离地 2 m）
  for (const [s, side, lat, text, col, h, y] of [[27, 1, 3.6, 'カラオケ', '#ff3fa4', 3.8, 3.9],
    [10, -1, 4.2, 'ラーメン', '#ffd23f', 3.4, 2.4], [23, -1, 7.2, '居酒屋', '#ff4a3a', 3.0, 4.2]]) {
    const b = rear.filter(q => q.side === side).reduce((m, q) => Math.abs(q.sc - s) < Math.abs(m.sc - s) ? q : m);
    const a = route.at(s, side * (lat > 6 ? Math.min(lat, b.front - 0.3) : lat)), g0 = gy(a.pos.x, a.pos.z), ry = -a.heading - Math.PI / 2;
    addSign(text, a.pos.clone().setY(g0 + y), ry, h, col, true, true);
    if (y - h / 2 > 0.05) lam.push({ geo: new THREE.BoxGeometry(0.1, y - h / 2, 0.1), p: [a.pos.x, g0 + (y - h / 2) / 2, a.pos.z], color: '#2a2c36' });
  }
  { // 坂名：道玄坂（右侧屋顶，正对上坡的人）
    const a = route.at(20.6, -3.4);
    addSign('道玄坂', a.pos.clone().setY(gy(a.pos.x, a.pos.z) + 3.4), -a.heading - Math.PI / 2 - 0.35, 0.75, acc[2], false);
  }

  // ---- 电线杆 + 电线（坂道/巷子，和出发的街）----
  const poles = [];
  for (const s of [20.5, 24.2]) for (const side of [-1]) {                 // 只在右侧：左侧离路 3 以内不能立高杆，商铺又占着 3.3 以外
    const lat = side > 0 ? 3.05 : -1.75, a = route.at(s, lat), y0 = gy(a.pos.x, a.pos.z), ry = -a.heading, o = side * 0.35;   // 横担往外伸（左侧不伸进离路 3 以内）
    lam.push({ geo: new THREE.CylinderGeometry(0.06, 0.09, 5, 7), p: [a.pos.x, y0 + 2.5, a.pos.z], color: '#6d6f78' });
    for (const hy of [4.55, 4.15]) lam.push({ geo: new THREE.BoxGeometry(0.06, 0.06, 1.0), p: [a.pos.x + a.left.x * o, y0 + hy, a.pos.z + a.left.z * o], ry, color: '#4a4c55' });
    if ((s * 7) % 3 < 1.5) lam.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, 0.42, 8), p: [a.pos.x + a.left.x * side * 0.22, y0 + 3.5, a.pos.z + a.left.z * side * 0.22], color: '#5a5d66' });
    poles.push({ s, side, a, y0 });
  }
  const wp = [];
  const wire = (p0, p1, sag) => {
    for (let k = 0; k < 10; k++) {
      const u0 = k / 10, u1 = (k + 1) / 10;
      for (const u of [u0, u1]) wp.push(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u - sag * 4 * u * (1 - u), p0.z + (p1.z - p0.z) * u);
    }
  };
  const armEnd = (P, hy, o) => new THREE.Vector3(P.a.pos.x + P.a.left.x * P.side * o, P.y0 + hy, P.a.pos.z + P.a.left.z * P.side * o);   // o = 往外（离路）
  for (const side of [1, -1]) {
    const ps = poles.filter(q => q.side === side);
    for (let k = 0; k + 1 < ps.length; k++) {
      if (inGap(ps[k].s, ps[k + 1].s)) continue;
      for (const [hy, o] of [[4.55, -0.1], [4.55, 0.8], [4.15, 0], [4.15, 0.7]]) wire(armEnd(ps[k], hy, o), armEnd(ps[k + 1], hy, o), 0.28);
    }
  }
  for (const R of poles) {                                               // 横穿马路拉到左边商铺屋顶
    const a = route.at(R.s + 0.6, 4.2), p = new THREE.Vector3(a.pos.x, gy(a.pos.x, a.pos.z) + 3.4, a.pos.z);
    wire(armEnd(R, 4.55, 0), p, 0.35); wire(armEnd(R, 4.15, 0.1), p.clone().setY(p.y - 0.3), 0.3);
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#07060c' })); wires.name = 'wires'; scene.add(wires);

  // ---- 路灯（右侧贴路、左侧离路 3.6）+ 光晕 + 地上光斑 ----
  const radial = E.radial;
  for (let s = -14; s <= SLOPE[1]; s += 6) {
    if ((s > GAP[0] - 1 && s < GAP[1]) || s > 26) continue;              // 鸟居柱子那儿不立灯
    for (const side of s + 3 < GAP[0] ? [1, -1] : [-1]) {                 // 坂道左侧是商铺，不立灯杆
      const s2 = s + (side > 0 ? 3 : 0), wide = s2 < GAP[0], lat = side > 0 ? (wide ? 4.9 : 3.6) : (wide ? -2.3 : -1.7), a = route.at(s2, lat), y0 = gy(a.pos.x, a.pos.z);
      const hx = a.pos.x - a.left.x * side * 0.55, hz = a.pos.z - a.left.z * side * 0.55;
      lam.push({ geo: new THREE.CylinderGeometry(0.045, 0.06, 3.3, 6), p: [a.pos.x, y0 + 1.65, a.pos.z], color: '#3a3d48' });
      lam.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.6), p: [(a.pos.x + hx) / 2, y0 + 3.28, (a.pos.z + hz) / 2], ry: -a.heading, color: '#3a3d48' });
      lit.push({ geo: new THREE.BoxGeometry(0.34, 0.06, 0.16), p: [hx, y0 + 3.22, hz], ry: -a.heading, color: '#fff1d6' });
      haloPts.push(hx, y0 + 3.18, hz); haloCol.push(1, 0.85, 0.6);
      pools.add(c.set(hx, y0 + 0.04, hz), tmp.set(1.4, 0, 0), nz.set(0, 0, 1.4), '#7a6040');   // 地上光斑
      streak(hx, hz, '#c89a60', 0.5, 5);
    }
  }

  // ---- 自动贩卖机：发光正面（饮料格）+ 机身 ----
  const vendTex = util.canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#e9f2ff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a22'; g.fillRect(0, h * 0.64, w, h * 0.36);
    g.fillStyle = '#2d3140'; g.fillRect(w * 0.12, h * 0.82, w * 0.76, h * 0.12);
    g.fillStyle = '#ffd000'; g.fillRect(w * 0.72, h * 0.68, w * 0.14, h * 0.08);
    const bc = ['#e8322b', '#2a7de1', '#21b36b', '#ffb000', '#8b4a2b', '#ffffff', '#ff5fa8', '#16c1d8'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
      const x = 8 + k * 19, y = 10 + r * 38;
      g.fillStyle = bc[(r * 3 + k * 5) % bc.length]; g.fillRect(x, y, 13, 26); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x + 2, y + 3, 3, 18);
      g.fillStyle = (r + k) % 3 ? '#3ddc84' : '#ff3040'; g.fillRect(x + 3, y + 30, 7, 3);
    }
  });
  const vend = [];
  for (const [s, side] of [[2.4, -1], [3.8, -1], [5.0, 1], [5.9, 1], [22.9, -1], [27.2, 1], [26.7, -1]]) {
    // 街上的往外挪（左侧 = 镜头这一侧，贴着楼面放，不占前景）；坂道的贴着店面
    const lat = side > 0 ? (s < GAP[0] ? 5.3 : 3.2) : (s < GAP[0] ? -3.7 : -2.05), a = route.at(s, lat), y0 = gy(a.pos.x, a.pos.z), ry = side > 0 ? -a.heading : -a.heading + Math.PI;
    vend.push({ s, side, a, y0, ry, col: ['#b9bfcc', '#8e1a2a', '#2c3c78'][vend.length % 3] });
  }
  // 机身 1.25 高（化身约 1.4）、0.62 宽；侧面压暗，不再是一大块纯色
  const vbody = util.instanced(new THREE.BoxGeometry(0.62, 1.25, 0.5), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#101014' }),
    vend.map(v => ({ p: [v.a.pos.x, v.y0 + 0.625, v.a.pos.z], ry: v.ry, color: v.col })));
  const vfront = util.instanced(new THREE.PlaneGeometry(0.52, 1.13), shade(new THREE.MeshBasicMaterial({ map: vendTex, toneMapped: false, color: '#d8d8d8' }), { mask: true, neon: true }),
    vend.map(v => ({ p: [v.a.pos.x + axisZ(v.ry, nz).x * 0.255, v.y0 + 0.64, v.a.pos.z + nz.z * 0.255], ry: v.ry })));
  vbody.name = 'vendBody'; vfront.name = 'vendFront'; scene.add(vbody, vfront);
  for (const v of vend) {
    axisZ(v.ry, nz);
    streak(v.a.pos.x + nz.x * 0.3, v.a.pos.z + nz.z * 0.3, '#a8c4ea', 0.5, 4);
    haloPts.push(v.a.pos.x + nz.x * 0.4, v.y0 + 0.8, v.a.pos.z + nz.z * 0.4); haloCol.push(0.45, 0.55, 0.7);
  }

  // ---- 大屏（左侧楼顶，朝路口）：画布上画渐变 + 大字，uv 横向滚动 ----
  screenTex = util.canvasTexture(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    [acc[0], '#6a2cff', acc[1], '#ff8a2a', acc[0]].forEach((cc, i, A) => gr.addColorStop(i / (A.length - 1), cc));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.font = `900 150px ${util.FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.shadowColor = '#fff'; g.shadowBlur = 20; g.fillText('渋谷  SHIBUYA', w / 2, h / 2 + 6);
  }, { repeat: true });
  {
    const b = near.filter(q => q.side > 0).reduce((m, q) => Math.abs(q.sc - 3.5) < Math.abs(m.sc - 3.5) ? q : m), a = route.at(b.sc, b.front + 1.5);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.7), shade(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), { mask: true, neon: true }));
    scr.position.set(a.pos.x, b.y0 + b.h + 1.1, a.pos.z); scr.rotation.y = -a.heading - Math.PI / 4; scr.name = 'bigScreen'; scene.add(scr);
    halos.add(c.copy(scr.position).addScaledVector(axisZ(scr.rotation.y, nz), -0.05), axisX(scr.rotation.y, nx).multiplyScalar(4.2), tmp.copy(UP).multiplyScalar(1.5), '#8a3aff');
  }
  // ---- 合并出网格 ----
  const lamMesh = new THREE.Mesh(util.merged(lam), new THREE.MeshLambertMaterial({ vertexColors: true })); lamMesh.name = 'cityProps';
  const litMesh = new THREE.Mesh(util.merged(lit), shade(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { mask: true, neon: true })); litMesh.name = 'cityLit';
  const signMesh = util.textSigns(signs, { size: 96 }); shade(signMesh.material, { mask: true, neon: true }); signMesh.userData.items = signs;
  const haloMesh = halos.mesh(glowMat(radial, { opacity: 0.55 }), 'signHalos');
  const reflMesh = refl.mesh(glowMat(streakTex(util), { ground: true, opacity: 0.5 }), 'wetReflections');
  const poolMesh = pools.mesh(glowMat(radial, { ground: true, opacity: 0.8 }), 'lampPools');
  reflMesh.renderOrder = poolMesh.renderOrder = 1;
  scene.add(lamMesh, litMesh, signMesh, haloMesh, reflMesh, poolMesh);
  // 路灯/灯笼/贩卖机的光晕：Points（1 次绘制）；楼顶航空灯（红，闪）
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(haloPts, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(haloCol, 3));
  const haloP = new THREE.Points(hg, shade(new THREE.PointsMaterial({ size: 1.3, map: radial, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { mask: true, addFog: true, neon: true }));
  haloP.name = 'lampHalos'; scene.add(haloP);
  const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(towers.flat(), 3));
  aviMat = new THREE.PointsMaterial({ size: 1.6, map: radial, color: '#ff2030', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const avi = new THREE.Points(ag, aviMat); avi.name = 'aviation'; scene.add(avi);
  E.signs = signs.length; E.vend = vend; E.near = near; E.rear = rear;   // 临街楼（gits.js 挂港式出挑招牌 / 空调外机）   // 贩卖机位置给 interact.js（走近掉罐饮料）
}

export function updateCity(dt) {
  T += dt;
  if (screenTex) screenTex.offset.x = (T * 0.04) % 1;
  if (aviMat) aviMat.opacity = 0.25 + 0.75 * (Math.sin(T * 2.4) > 0.6 ? 1 : 0);
}
