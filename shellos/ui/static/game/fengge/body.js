// P 线：峰哥的身体（第 1 轮，9/23 夜）。CesiumMan 的网格是个方块小人，和照片脸不搭 → 按骨骼现摆一副低多边形身体，蒙皮到**同一套骨骼**
//   （A2 的动作照用），CesiumMan 网格藏掉。躯干 / 腿 / 鞋 / 手臂都是沿骨头的放样（每圈一个截面，平面着色），关节处按距离混两根骨头的权重。
// 每个顶点带：aReg（部位 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子）、aT（沿这一段 0..1）、aH（离髋关节多高，米，静止姿态）、
//   aAng（绕轴的朝向 cos/sin：cos = 前，sin > 0 = 往外 / 躯干是往左）、aSide（+1 左 −1 右 0 中间）→ 衣服颜色在片元里按这些算（outfit 的 GLSL），边界是清楚的。
// 尺寸（米，静止姿态）按峰哥：偏瘦、肩窄；腿 / 臂的长度由 shape.js 的骨骼决定，这里只管粗细。inflate(reg, t) = 衣服的蓬度（加到半径上）。
import * as THREE from 'three';

const REG = { torso: 0, upper: 1, fore: 2, thigh: 3, shin: 4, foot: 5, neck: 6 };
const lerp = (a, b, t) => a + (b - a) * t, ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const prof = (tab, s) => {                                   // 分段线性：[[s, 值...], ...]
  let i = 1; while (i < tab.length - 1 && tab[i][0] < s) i++;
  const a = tab[i - 1], b = tab[i], t = Math.min(1, Math.max(0, (s - a[0]) / (b[0] - a[0])));
  return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
};

// 身体尺寸表（半径 / 半宽，米）
const LEG = [[-0.18, 0.074], [0, 0.07], [0.5, 0.058], [0.88, 0.046], [1, 0.044], [1.28, 0.049], [1.6, 0.039], [1.92, 0.031], [2, 0.03]];   // s：0 髋 1 膝 2 踝
const ARM = [[-0.22, 0.044], [0, 0.046], [0.3, 0.041], [0.8, 0.035], [1, 0.033], [1.25, 0.036], [1.85, 0.027], [2, 0.026]];                 // s：0 肩 1 肘 2 腕
// 躯干：[h（相对髋关节 → 肩的比例，>1 往上按米加在肩上）, 半宽, 半厚, 前后偏移]
//   偏瘦：髋 / 腰 / 胸都收着；腋下（0.8–0.95）比胸口窄，垂下来的手臂贴着躯干而不是埋进去；肩线以上收成斜方肌和脖子
const TORSO = f => [[-0.095 / f, 0.092, 0.072, 0.0], [-0.04 / f, 0.128, 0.09, 0.0], [0.08, 0.132, 0.094, 0.004], [0.42, 0.116, 0.082, 0.006],
  [0.7, 0.13, 0.094, 0.01], [0.86, 0.124, 0.092, 0.006], [0.97, 0.13, 0.086, 0.0], [1.0 + 0.03 / f, 0.12, 0.08, -0.008], [1.0 + 0.065 / f, 0.074, 0.062, -0.012], [1.0 + 0.1 / f, 0.052, 0.052, -0.006]];

function part() { return { P: [], I: [], sk: [], sw: [], reg: [], t: [], h: [], ang: [], side: [] }; }
function pushV(o, p, bones, reg, t, h, c, s, side) {
  o.P.push(p.x, p.y, p.z); o.reg.push(reg); o.t.push(t); o.h.push(h); o.ang.push(c, s); o.side.push(side);
  const b = bones.slice(0, 4); while (b.length < 4) b.push([0, 0]);
  const sum = b.reduce((a, x) => a + x[1], 0) || 1;
  o.sk.push(...b.map(x => x[0])); o.sw.push(...b.map(x => x[1] / sum));
}
// 相邻两圈连成四边形；每段放样的截面转向不一定一致（左右肢体镜像），按第一个三角形的法线和「顶点 − 圈中心」比一下，反了就整段翻过来。
//   返回 flip（封口也按它定方向）
function ringsToFaces(o, base, nRings, nA) {
  const i0 = o.I.length;
  for (let j = 0; j < nRings - 1; j++) for (let i = 0; i < nA; i++) {
    const a = base + j * nA + i, b = base + j * nA + (i + 1) % nA, c = a + nA, d = b + nA;
    o.I.push(a, c, b, b, c, d);
  }
  const P = k => new THREE.Vector3(o.P[3 * k], o.P[3 * k + 1], o.P[3 * k + 2]), mid = Math.floor(nRings / 2);
  const ctr = new THREE.Vector3(); for (let i = 0; i < nA; i++) ctr.add(P(base + mid * nA + i)); ctr.divideScalar(nA);
  const a = P(base + mid * nA), n = P(base + mid * nA + nA).sub(a).cross(P(base + mid * nA + 1).sub(a));
  const flip = n.dot(a.clone().sub(ctr)) < 0;
  if (flip) for (let k = i0; k < o.I.length; k += 3) { const t = o.I[k + 1]; o.I[k + 1] = o.I[k + 2]; o.I[k + 2] = t; }
  return flip;
}
const fan = (o, c, ring, nA, flip, inward) => { for (let i = 0; i < nA; i++) { const a = ring + i, b = ring + (i + 1) % nA; (flip !== inward) ? o.I.push(c, a, b) : o.I.push(c, b, a); } };

// 沿一条折线（关节点列表）放样一根肢体。path = [p0, p1, p2]，s 0..1 在第一段、1..2 在第二段；radius(s) → r；
//   weights(s) → [[骨头索引, 权重], ...]；front = 截面「前」方向参考（化身 +X）；out = 往外的方向（左 = −Z → 左肢体 out = (0,0,−1)）
function limb(o, path, s0, s1, nR, nA, radius, weights, reg, side, H0, front, out, tOf, ell = 1) {
  const base = o.P.length / 3, pt = s => { const k = Math.min(path.length - 2, Math.max(0, Math.floor(s))); const u = s - k; return path[k].clone().lerp(path[k + 1], u); };
  const dir = s => { const e = 0.02; return pt(Math.min(path.length - 1, s + e)).sub(pt(Math.max(0, s - e))).normalize(); };
  for (let j = 0; j < nR; j++) {
    const s = s0 + (s1 - s0) * j / (nR - 1), c = pt(s), d = dir(Math.max(0, Math.min(path.length - 1, s)));
    const f = front.clone().addScaledVector(d, -front.dot(d)).normalize(), w = new THREE.Vector3().crossVectors(d, f).normalize();
    if (w.dot(out) < 0) w.negate();                          // w = 截面里「往外」的方向
    const r = radius(s), wt = weights(s);
    for (let i = 0; i < nA; i++) {
      const a = i / nA * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const p = c.clone().addScaledVector(f, ca * r).addScaledVector(w, sa * r * ell);
      pushV(o, p, wt, reg, tOf(s), p.y - H0, ca, sa, side);
    }
  }
  const flip = ringsToFaces(o, base, nR, nA);
  return { base, flip };
}

// 衣服的片元代码：在 outfit 里写 `vec3 fit(float reg, float t, float h, vec2 ang, float side)`，这里调它上色
export function buildBody(av, outfit, { tune } = {}) {
  const B = av.bones, outer = av.group;
  outer.updateMatrixWorld(true);
  const W = n => outer.worldToLocal(B[n].getWorldPosition(new THREE.Vector3()));
  const names = ['Skeleton_torso_joint_1', 'Skeleton_torso_joint_2', 'torso_joint_3', 'Skeleton_neck_joint_1', 'Skeleton_neck_joint_2',
    'leg_joint_L_1', 'leg_joint_L_2', 'leg_joint_L_3', 'leg_joint_L_5', 'leg_joint_R_1', 'leg_joint_R_2', 'leg_joint_R_3', 'leg_joint_R_5',
    'Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_', 'Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_'];
  const bones = names.map(n => B[n]), bi = n => names.indexOf(n), J = Object.fromEntries(names.map(n => [n, W(n)]));
  const o = part(), inf = (reg, t) => (outfit.inflate ? outfit.inflate(reg, t) : 0);
  const hipY = (J.leg_joint_L_1.y + J.leg_joint_R_1.y) / 2, shY = (J.Skeleton_arm_joint_L__4_.y + J.Skeleton_arm_joint_R.y) / 2, span = shY - hipY;
  const X = new THREE.Vector3(1, 0, 0);

  // ① 躯干：竖直放样，截面 = 超椭圆（前后厚 d、左右宽 w）；中心沿骨盆 → 胸 → 脖子的 x 插值
  const tab = TORSO(span), nA = 20, rows = [];
  const yOf = h => hipY + (h > 1 ? span + (h - 1) * span : h * span), topY = J.Skeleton_neck_joint_2.y + 0.01;
  for (let k = 0; k < tab.length; k++) rows.push(tab[k]);
  rows.push([(topY - hipY) / span, 0.048, 0.048, -0.004]);
  const nT = 16, tBase = o.P.length / 3, torsoW = y => {             // 按高度混骨头：骨盆 → 腰 → 胸 → 颈 → 头
    const js = [['Skeleton_torso_joint_1', J.Skeleton_torso_joint_1.y - 1], ['Skeleton_torso_joint_2', J.Skeleton_torso_joint_2.y], ['torso_joint_3', J.torso_joint_3.y - 0.03],
      ['Skeleton_neck_joint_1', J.Skeleton_neck_joint_1.y], ['Skeleton_neck_joint_2', J.Skeleton_neck_joint_2.y + 0.02]];
    let k = 0; while (k < js.length - 1 && y > js[k + 1][1]) k++;
    if (k === js.length - 1) return [[bi(js[k][0]), 1]];
    const nb = js[k + 1], u = ss(nb[1] - 0.045, nb[1] + 0.045, y);
    return [[bi(js[k][0]), 1 - u], [bi(nb[0]), u]];
  };
  const hTop = rows[rows.length - 1][0], hBot = rows[0][0];
  for (let j = 0; j < nT; j++) {
    const hh = hBot + (hTop - hBot) * Math.pow(j / (nT - 1), 1.0), [w0, d0, cx] = prof(rows, hh), y = yOf(hh);
    const ctr = y < J.Skeleton_torso_joint_2.y ? J.Skeleton_torso_joint_1.clone().lerp(J.Skeleton_torso_joint_2, ss(J.Skeleton_torso_joint_1.y - 0.1, J.Skeleton_torso_joint_2.y, y))
      : J.Skeleton_torso_joint_2.clone().lerp(J.Skeleton_neck_joint_1, ss(J.Skeleton_torso_joint_2.y, J.Skeleton_neck_joint_1.y, y));
    const t = (hh - hBot) / (hTop - hBot), reg = hh > 1 + 0.07 / span ? REG.neck : REG.torso, pad = inf(reg, t), w = w0 + pad, d = d0 + pad;
    for (let i = 0; i < nA; i++) {
      const a = i / nA * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / 2.4;
      const p = new THREE.Vector3(ctr.x + cx + Math.sign(ca) * Math.pow(Math.abs(ca), e) * d, y, ctr.z + Math.sign(sa) * Math.pow(Math.abs(sa), e) * w);
      pushV(o, p, torsoW(y), reg, t, y - hipY, ca, -sa, 0);      // 躯干的 ang.y：+ = 化身左（−Z）
    }
  }
  const tFlip = ringsToFaces(o, tBase, nT, nA);
  const cb = o.P.length / 3; pushV(o, new THREE.Vector3(J.Skeleton_torso_joint_1.x, yOf(hBot) - 0.012, J.Skeleton_torso_joint_1.z), [[bi('Skeleton_torso_joint_1'), 1]], REG.torso, 0, yOf(hBot) - hipY, 0, 0, 0);
  fan(o, cb, tBase, nA, tFlip, true);                          // 裆下封口（在第一圈「下面」）

  // ② 腿：髋 → 膝 → 踝；③ 鞋
  for (const [sd, side] of [['L', 1], ['R', -1]]) {
    const hip = J[`leg_joint_${sd}_1`], knee = J[`leg_joint_${sd}_2`], ank = J[`leg_joint_${sd}_3`], toe = J[`leg_joint_${sd}_5`];
    const bH = bi(`leg_joint_${sd}_1`), bK = bi(`leg_joint_${sd}_2`), bA = bi(`leg_joint_${sd}_3`), bP = bi('Skeleton_torso_joint_1');
    const out = new THREE.Vector3(0, 0, side > 0 ? -1 : 1);
    const legW = s => s < 0.08 ? [[bH, ss(-0.18, 0.08, s)], [bP, 1 - ss(-0.18, 0.08, s)]] : s < 1.12 ? [[bH, 1 - ss(0.88, 1.12, s)], [bK, ss(0.88, 1.12, s)]] : [[bK, 1 - ss(1.86, 2, s)], [bA, ss(1.86, 2, s)]];
    limb(o, [hip.clone().setY(hip.y + 0.0), knee, ank], -0.18, 2, 15, 12, s => prof(LEG, s)[0] + inf(s < 1 ? REG.thigh : REG.shin, s < 1 ? s : s - 1), legW,
      0, side, hipY, X, out, s => s, 0.94);
    // 部位按 s 分：大腿 / 小腿（上面统一写了 0，这里按 t 改）
    const n = 15 * 12, st = o.P.length / 3 - n;
    for (let v = 0; v < n; v++) { const s = o.t[st + v]; o.reg[st + v] = s < 1 ? REG.thigh : REG.shin; o.t[st + v] = s < 1 ? Math.max(0, s) : s - 1; }
    // 鞋：脚跟 → 脚尖沿 +X 放样，截面在 YZ 平面；鞋底贴地
    const fb = o.P.length / 3, nF = 9, nFA = 10, heel = ank.x - 0.055, tip = Math.max(toe.x + 0.06, ank.x + 0.17);
    for (let j = 0; j < nF; j++) {
      const u = j / (nF - 1), x = lerp(heel, tip, u), [hy, hh, hw] = prof([[0, 0.05, 0.048, 0.036], [0.35, 0.05, 0.05, 0.042], [0.7, 0.036, 0.036, 0.044], [1, 0.024, 0.018, 0.03]], u);
      const pad = inf(REG.foot, u), wt = u < 0.55 ? [[bA, 1]] : [[bA, 1 - ss(0.55, 0.8, u)], [bi(`leg_joint_${sd}_5`), ss(0.55, 0.8, u)]];
      for (let i = 0; i < nFA; i++) {
        const a = i / nFA * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const p = new THREE.Vector3(x, Math.max(0.004, hy + sa * (hh + pad)), ank.z + ca * (hw + pad) * (side > 0 ? -1 : 1));
        pushV(o, p, wt, REG.foot, u, p.y - hipY, sa, ca, side);   // 鞋：ang.x = 朝上，ang.y = 往外
      }
    }
    const fFlip = ringsToFaces(o, fb, nF, nFA);
    for (const [ring, dx] of [[0, -0.012], [nF - 1, 0.012]]) {    // 脚跟 / 脚尖封口
      const cIdx = o.P.length / 3, x = lerp(heel, tip, ring / (nF - 1)) + dx;
      pushV(o, new THREE.Vector3(x, ring ? 0.02 : 0.045, ank.z), [[bA, 1]], REG.foot, ring ? 1 : 0, 0, 0, 0, side);
      fan(o, cIdx, fb + ring * nFA, nFA, fFlip, ring === 0);
    }
  }

  // ④ 手臂：肩 → 肘 → 腕
  for (const [sd, side, root, elb, wri] of [['L', 1, 'Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_'], ['R', -1, 'Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_']]) {
    const bS = bi(root), bE = bi(elb), bW = bi(wri), bC = bi('torso_joint_3'), out = new THREE.Vector3(0, 0, side > 0 ? -1 : 1);
    const armW = s => s < 0.1 ? [[bS, ss(-0.22, 0.1, s)], [bC, 1 - ss(-0.22, 0.1, s)]] : s < 1.12 ? [[bS, 1 - ss(0.88, 1.12, s)], [bE, ss(0.88, 1.12, s)]] : [[bE, 1 - ss(1.82, 1.98, s)], [bW, ss(1.82, 1.98, s)]];
    const { base: st, flip: aFlip } = limb(o, [J[root], J[elb], J[wri]], -0.22, 2, 13, 10, s => prof(ARM, s)[0] + inf(s < 1 ? REG.upper : REG.fore, s < 1 ? s : s - 1), armW,
      0, side, hipY, X, out, s => s, 1);
    for (let v = st; v < o.P.length / 3; v++) { const s = o.t[v]; o.reg[v] = s < 1 ? REG.upper : REG.fore; o.t[v] = s < 1 ? Math.max(0, s) : s - 1; }
    const cIdx = o.P.length / 3, n = 10, last = o.P.length / 3 - n;   // 腕口封上（手套 / 手挡住）
    pushV(o, J[wri].clone(), [[bW, 1]], REG.fore, 1, J[wri].y - hipY, 0, 0, side);
    fan(o, cIdx, last, n, aFlip, false);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.P, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(o.sk, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(o.sw, 4));
  g.setAttribute('aReg', new THREE.Float32BufferAttribute(o.reg, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(o.t, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(o.h, 1));
  g.setAttribute('aAng', new THREE.Float32BufferAttribute(o.ang, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(o.side, 1));
  g.setIndex(o.I); g.computeVertexNormals();

  const U = outfit.uniforms || {};
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });   // 双面兜底（封口 / 腋下交叉处）
  const more = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aReg, aT, aH, aSide;\nattribute vec2 aAng;\nvarying float vReg, vT, vH, vSide;\nvarying vec2 vAng;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = aReg; vT = aT; vH = aH; vSide = aSide; vAng = aAng;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vReg, vT, vH, vSide;\nvarying vec2 vAng;\n' +
        Object.keys(U).map(k => `uniform ${U[k].value.isColor ? 'vec3' : 'float'} ${k};`).join('\n') + '\n' + outfit.glsl)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= fit(floor(vReg + 0.5), vT, vH, normalize(vAng + 1e-5), vSide);');
  };
  if (tune) tune(mat, more); else mat.onBeforeCompile = more;
  mat.customProgramCacheKey = () => 'fengge-body-' + outfit.name;
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.name = 'fenggeBody'; mesh.frustumCulled = false;
  outer.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));                          // 按现在的静止姿态绑（skeleton 逆矩阵 = 当前骨骼世界矩阵，bindMatrix = 网格世界矩阵）
  return { mesh, hipY, shY, J, tris: o.I.length / 3 };   // J = 各关节在化身坐标里的静止位置（配件定位用）
}
