// 峰哥的手 + 伸手扣锁（reach）。只依赖 three。
//   const hands = makeHands(av);                     // loadAvatar()（+ dressFengge）之后、第一次 pose()/animate() 之前调：按绑定姿态量小臂方向
//   每帧：av.animate(...)（A2）之后 hands.apply(dt)  // IK + 抓握 + 手指平滑；A2 每帧从静止姿态重算上臂 / 肘，所以这里改完不会逐帧累积
// 手 = 每只 1 个 SkinnedMesh（自己的 16 根骨：手根 + 4 指 × 3 节 + 拇指 3 节），刚性蒙皮，只有关节那一圈顶点两根骨各一半 → 手指弯了也连着；
//   挂在 CesiumMan 的腕骨上（bone.attach，保持世界变换），不依赖 CesiumMan 的手（P 会把身体换掉）。每只手 258 三角、1 次绘制。
// 坐标：手自己的规范坐标 = +X 顺着小臂往指尖、+Y 手背、+Z 拇指一侧（写的是左手）；右手 = 镜像 z → −z（顶点 / 骨骼位置翻 z，
//   四元数 (x, y, z, w) → (−x, −y, z, w)，三角形绕序反过来）。化身坐标 outer = av.group：+X 前、+Y 上、+Z 右。
import * as THREE from 'three';

const d2r = Math.PI / 180;
// 尺寸（米，化身身高约 1.49）：手长 = 中指掌指关节 0.084 + 中指 0.075 ≈ 0.159，掌宽 0.077
const PALM = [[-0.018, 0.050, 0.030], [0.000, 0.058, 0.031], [0.042, 0.074, 0.032], [0.082, 0.077, 0.025]];   // [x, 宽, 厚]：手腕往里多伸 1.8 cm 插进袖口，腕处不留缝
const FING = [                  // 食指 / 中指 / 无名指 / 小指：[掌指关节 x, z, [三节长], 宽, 厚]
  [0.082, 0.027, [0.030, 0.021, 0.017], 0.0175, 0.016],
  [0.084, 0.009, [0.033, 0.023, 0.019], 0.0180, 0.017],
  [0.081, -0.009, [0.031, 0.022, 0.018], 0.0170, 0.016],
  [0.075, -0.026, [0.025, 0.018, 0.016], 0.0150, 0.014],
];
const THUMB = { at: [0.012, -0.007, 0.020], len: [0.040, 0.030, 0.025], w: [0.030, 0.021, 0.019, 0.016], t: [0.024, 0.018, 0.016, 0.013] };   // 根（腕掌关节，藏在掌里 = 大鱼际）
// 手势：f = 四指 [掌指屈, 近节屈, 远节屈, 张开（+ = 往拇指侧）]（°）；th = 拇指 [掌骨方向, 指甲朝向, 掌指屈, 指间屈]（方向在手的规范坐标里）
const POSES = {
  relax: { f: [[14, 20, 10, 3], [17, 24, 12, 0], [20, 28, 14, -3], [24, 32, 16, -7]], th: [[0.86, -0.3, 0.42], [0, 0.45, 0.9], 8, 12] },
  grip: { f: [[82, 96, 55, 1], [86, 100, 56, 0], [88, 100, 56, -1], [90, 98, 55, -3]], th: [[0.767, -0.535, 0.349], [-0.33, 0.146, 0.93], 34, 48] },   // 拇指压在食指 / 中指中节前面
  thumbsUp: { f: [[84, 98, 56, 1], [88, 102, 56, 0], [90, 102, 56, -1], [92, 100, 55, -3]], th: [[0.65, 0, 0.76], [0.76, 0, -0.65], 35, -8] },   // 掌骨顺着掌侧往前，掌指关节翻 35° 让两节指骨朝拇指侧竖起来
  open: { f: [[-4, 4, 2, 9], [-4, 3, 2, 1], [-4, 3, 2, -7], [-4, 4, 2, -15]], th: [[0.55, -0.15, 0.82], [-0.1, 0.55, 0.8], 0, 0] },
};
const GRIP_AT = [0.072, -0.028, 0.004];   // 攥住的东西的中心（握拳时手心那个洞）；reach 把这个点送到目标
const TAU = 0.15, REACH_T = 0.4, GRAB_D = 0.03, SLIP_D = 0.06;
// 肘的极向量（化身坐标，z 乘侧向符号）：外侧、偏后、偏下 → 肘不会翻到身体里面
const POLE = [-0.45, -0.55, 1];
// 伸手时掌心想朝的方向（化身坐标，z 乘侧向符号）：往下、偏里 → 往前够是掌心朝下抓，往上 / 往下够自动变成掌心朝里
const PALM_WANT = [0, -1, -0.5];
const ROLL_MAX = 100;                     // 小臂最多拧这么多度（旋前 / 旋后）

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const mirrorQ = (q, s) => (s < 0 ? q.set(-q.x, -q.y, q.z, q.w) : q);
function basisQ(x, yHint) {               // X 轴 = x，Y 轴尽量靠 yHint
  const a = V().fromArray(x).normalize(), h = V().fromArray(yHint), b = h.addScaledVector(a, -h.dot(a)).normalize();
  return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, b, V().crossVectors(a, b)));
}
const X = V().set(1, 0, 0), qZ = V().set(0, 0, 1), qY = V().set(0, 1, 0);
const flexQ = deg => Q().setFromAxisAngle(qZ, -deg * d2r);   // 往手心弯（+X 转向 −Y）

// 手势 → 每根骨的局部四元数（15 根：4 指 × 3 + 拇指 3），s = 侧向符号（左 +1、右 −1，镜像）
function poseQs(p, s) {
  const out = [];
  for (const [a, b, c, sp] of p.f) out.push(Q().setFromAxisAngle(qY, -sp * d2r).multiply(flexQ(a)), flexQ(b), flexQ(c));
  out.push(basisQ(p.th[0], p.th[1]), flexQ(p.th[2]), flexQ(p.th[3]));
  return out.map(q => mirrorQ(q, s));
}

// 一只手：几何 + 骨骼，建在原点（绑定），返回 { anchor, bones, grip }
function buildHand(s, mat) {
  const anchor = new THREE.Object3D(), root = new THREE.Bone(), bones = [root];
  anchor.add(root);
  const bone = (parent, p, q) => { const b = new THREE.Bone(); b.position.set(p[0], p[1], p[2] * s); if (q) b.quaternion.copy(q); parent.add(b); bones.push(b); return b; };
  const rest = poseQs(POSES.relax, s);
  const fb = FING.map(([x, z, L]) => { const b1 = bone(root, [x, 0, z]), b2 = bone(b1, [L[0], 0, 0]), b3 = bone(b2, [L[1], 0, 0]); return [b1, b2, b3]; });
  const t0 = bone(root, THUMB.at, rest[12]), t1 = bone(t0, [THUMB.len[0], 0, 0]), t2 = bone(t1, [THUMB.len[1], 0, 0]);
  anchor.updateMatrixWorld(true);

  const pos = [], si = [], sw = [], idx = [], bi = b => bones.indexOf(b), v = V();
  // 一圈 6 个点（从手背往拇指侧转：+Y → +Z → −Y → −Z）：f = 上下两条棱的宽度比例（1 = 方块、0.5 = 六棱铅笔）
  const ring = (b, x, w, t, f, sk) => {
    const at = pos.length / 3, P = [[t / 2, f * w / 2], [0, w / 2], [-t / 2, f * w / 2], [-t / 2, -f * w / 2], [0, -w / 2], [t / 2, -f * w / 2]];
    for (const [y, z] of P) { v.set(x, y, z * s).applyMatrix4(b.matrixWorld); pos.push(v.x, v.y, v.z); si.push(bi(sk[0]), bi(sk[1] || sk[0]), 0, 0); sw.push(sk[1] ? 0.5 : 1, sk[1] ? 0.5 : 0, 0, 0); }
    return at;
  };
  const point = (b, x, y, sk) => { v.set(x, y, 0).applyMatrix4(b.matrixWorld); pos.push(v.x, v.y, v.z); si.push(bi(sk), 0, 0, 0); sw.push(1, 0, 0, 0); return pos.length / 3 - 1; };
  const tri = (a, b, c) => (s > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  const tube = (r0, r1) => { for (let j = 0; j < 6; j++) { const a = r0 + j, b = r0 + (j + 1) % 6, c = r1 + (j + 1) % 6, d = r1 + j; tri(a, b, c); tri(a, c, d); } };
  const fan = (r, p, flip) => { for (let j = 0; j < 6; j++) flip ? tri(r + (j + 1) % 6, r + j, p) : tri(r + j, r + (j + 1) % 6, p); };
  // 手掌：4 圈 + 两头封口
  const pr = PALM.map(([x, w, t]) => ring(root, x, w, t, 0.66, [root]));
  for (let i = 0; i < pr.length - 1; i++) tube(pr[i], pr[i + 1]);
  fan(pr[0], point(root, PALM[0][0] - 0.004, 0, root), true);
  fan(pr[3], point(root, PALM[3][0] + 0.002, 0, root), false);
  // 四指：掌指关节 / 近节 / 远节关节各一圈（两根骨各一半），指尖前一圈 + 尖
  FING.forEach(([, , L, w, t], i) => {
    const [b1, b2, b3] = fb[i], k = 1.06;                     // 关节那圈略粗 = 指节
    const r0 = ring(b1, 0, w * k, t * k, 0.55, [root, b1]), r1 = ring(b2, 0, w * 0.95 * k, t * 0.95 * k, 0.55, [b1, b2]);
    const r2 = ring(b3, 0, w * 0.88 * k, t * 0.88 * k, 0.55, [b2, b3]), r3 = ring(b3, L[2] * 0.78, w * 0.8, t * 0.78, 0.55, [b3]);
    tube(r0, r1); tube(r1, r2); tube(r2, r3); fan(r3, point(b3, L[2], -0.002, b3));
  });
  // 拇指：根（大鱼际，六成跟手掌走）→ 掌指关节 → 指间关节 → 指尖
  const T = THUMB, q0 = ring(t0, 0, T.w[0], T.t[0], 0.7, [root, t0]);
  const q1 = ring(t1, 0, T.w[1], T.t[1], 0.55, [t0, t1]), q2 = ring(t2, 0, T.w[2], T.t[2], 0.55, [t1, t2]), q3 = ring(t2, T.len[2] * 0.78, T.w[3], T.t[3], 0.55, [t2]);
  tube(q0, q1); tube(q1, q2); tube(q2, q3); fan(q3, point(t2, T.len[2], -0.002, t2));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.name = 'fenggeHand'; mesh.frustumCulled = false;
  anchor.add(mesh); mesh.bind(new THREE.Skeleton(bones));
  const grip = new THREE.Object3D(); grip.position.set(GRIP_AT[0], GRIP_AT[1], GRIP_AT[2] * s); root.add(grip);
  return { anchor, joints: [...fb.flat(), t0, t1, t2], grip, tris: idx.length / 3 };
}

// shift：手根沿小臂往外挪多少米。CesiumMan 的腕关节比看上去的手腕靠里约 3–4.5 cm（它的袖口在腕骨外 4.5 cm、小臂骨长才 0.19 m），
//   挪 3 cm 后小臂 + 手的比例对上身高 1.49 m 的人；新身体的袖口如果正好收在腕骨上，传 0
export function makeHands(av, { skin = '#c48c76', shift = 0.03, tune } = {}) {
  const outer = av.group, B = av.bones;
  const mat = new THREE.MeshLambertMaterial({ color: skin, flatShading: true });
  if (tune) tune(mat);                                       // fengge.js 传进来：和身体一样的轮廓光 / 自发光 / 点光折减
  const CH = { L: ['Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_', 1], R: ['Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_', -1] };
  const loc = (o, out) => outer.worldToLocal(o.getWorldPosition(out));
  outer.updateMatrixWorld(true);
  const H = {};
  for (const side of ['L', 'R']) {
    const [an, en, wn, s] = CH[side], arm = B[an], elb = B[en], wri = B[wn];
    if (!arm || !elb || !wri) continue;
    const h = buildHand(s, mat);
    // 手根 = 腕骨，+X 顺着绑定姿态的小臂，手背朝上（绑定姿态掌心朝下，A2 把手臂放下后掌心朝大腿）
    const w = loc(wri, V()), fx = w.clone().sub(loc(elb, V())).normalize();
    h.anchor.position.copy(w).addScaledVector(fx, shift); h.anchor.quaternion.copy(basisQ(fx.toArray(), [0, 1, 0]));
    outer.add(h.anchor); wri.attach(h.anchor); h.bindQ = h.anchor.quaternion.clone();
    const P = {}; for (const n in POSES) P[n] = poseQs(POSES[n], s);
    H[side] = { ...h, arm, elb, s, P, cur: P.relax.map(q => q.clone()), tgt: P.relax.map(q => q.clone()), manual: ['relax', 1],
      target: null, last: V(), k: 0, grab: true, gripped: false, dist: Infinity, used: false };
  }
  const tris = Object.values(H).reduce((n, h) => n + h.tris, 0);

  const qP = Q(), qT = Q(), qa0 = Q(), qe0 = Q(), a = V(), b = V(), c = V(), e = V(), t = V(), n = V(), pp = V(), m4 = new THREE.Matrix4();
  const parentQ = bone => { qP.identity(); for (let p = bone.parent; p && p !== outer; p = p.parent) qP.premultiply(p.quaternion); return qP; };
  const inBody = (bone, q) => { parentQ(bone); bone.quaternion.premultiply(qT.copy(qP).invert().multiply(q).multiply(qP)); bone.updateMatrixWorld(true); };   // q = 化身坐标里的转动
  const setTgt = (h, name, k) => { const A = h.P.relax, Bq = h.P[name] || A; for (let i = 0; i < A.length; i++) h.tgt[i].slerpQuaternions(A[i], Bq[i], k); };
  const toward = (h, name, k) => { const Bq = h.P[name]; for (let i = 0; i < Bq.length; i++) h.tgt[i].slerp(Bq[i], k); };

  const api = {
    tris,
    // 手心抓握点（Object3D，挂在手根上跟着手走）：读世界坐标 / 把锁扣 attach 上去都行
    grip: Object.fromEntries(Object.entries(H).map(([k, h]) => [k, h.grip])),
    // 固定手势：name = 'relax' | 'grip' | 'thumbsUp' | 'open'，k = 和 relax 的混合量（0..1）。只设目标，update/apply 按 τ ≈ 0.15 s 平滑过去
    pose(side, name, k = 1) { const h = H[side]; if (!h) return; h.manual = [name, k]; setTgt(h, name, k); },
    // 两节骨 IK：把该侧「手心抓握点」送到 target（世界坐标），k = 和 A2 当前姿态的混合量（0..1）。必须在 A2 的 animate 之后调。
    //   够不着：手臂软性伸直指向目标（越靠近伸直越慢，不抽）；肘朝外侧后下方；小臂拧到掌心朝下偏里（往前够 = 掌心朝下抓）
    //   palm = 掌心想朝的方向（化身坐标，z 乘侧向符号），缺省 PALM_WANT；登顶竖大拇指传 [0, 0, −1]（掌心朝里 → 拇指朝上）
    reach(side, target, k = 1, palm = PALM_WANT) {
      const h = H[side]; if (!h || !target || k <= 0) return;
      const { arm, elb, grip, anchor, s } = h;
      h.used = true; anchor.quaternion.copy(h.bindQ);
      outer.updateWorldMatrix(true, false);                 // 骨骼矩阵由下面的 getWorldPosition / updateMatrixWorld 按需更新，不用刷整个化身
      qa0.copy(arm.quaternion); qe0.copy(elb.quaternion);
      outer.worldToLocal(t.copy(target));
      const S0 = loc(arm, a), E0 = loc(elb, b), C0 = loc(grip, c);
      const L1 = S0.distanceTo(E0), L2 = E0.distanceTo(C0), hi = L1 + L2, soft = 0.96 * hi;
      let d = n.subVectors(t, S0).length(); n.divideScalar(d || 1);
      if (d > soft) d = soft + (hi - soft) * (1 - Math.exp(-(d - soft) / (hi - soft)));   // 够不着：软性伸直，越靠近伸直越慢，不会一下弹直 / 抽
      d = Math.max(d, Math.abs(L1 - L2) + 0.01);
      pp.set(POLE[0], POLE[1], POLE[2] * -s).normalize().addScaledVector(n, -pp.dot(n));   // s：左 +1 → 化身 −Z；右 −1 → +Z
      if (pp.lengthSq() < 1e-6) pp.set(-1, 0, 0).addScaledVector(n, -n.x);
      pp.normalize();
      const ca = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
      e.copy(S0).addScaledVector(n, L1 * ca).addScaledVector(pp, L1 * sa);               // 新的肘
      inBody(arm, qT.setFromUnitVectors(E0.sub(S0).normalize(), e.sub(S0).normalize()).clone());
      t.copy(S0).addScaledVector(n, d);                                                   // 够不着时 = 伸直方向上最远那点
      const fore = () => { loc(elb, E0); loc(grip, C0); inBody(elb, qT.setFromUnitVectors(C0.sub(E0).normalize(), e.subVectors(t, E0).normalize()).clone()); };
      fore();
      // 手腕拧（旋前 / 旋后）：手绕自己的 X（= 小臂轴）转，让掌心（手的 −Y）尽量朝 PALM_WANT。拧的是手不是小臂 → 肘那里不会扭成麻花。
      //   抓握点离小臂轴 2.7 cm，拧完再对一次小臂
      m4.copy(outer.matrixWorld).invert().multiply(anchor.matrixWorld);
      const ax = a.set(1, 0, 0).transformDirection(m4), cur = b.set(0, -1, 0).transformDirection(m4), want = c.set(palm[0], palm[1], palm[2] * -s).normalize();
      cur.addScaledVector(ax, -cur.dot(ax)); want.addScaledVector(ax, -want.dot(ax));
      if (cur.lengthSq() > 0.04 && want.lengthSq() > 0.04) {
        cur.normalize(); want.normalize();
        const ang = THREE.MathUtils.clamp(Math.atan2(e.crossVectors(cur, want).dot(ax), cur.dot(want)), -ROLL_MAX * d2r, ROLL_MAX * d2r);
        anchor.quaternion.multiply(qT.setFromAxisAngle(X, ang)); anchor.updateMatrixWorld(true);
        fore();
      }
      if (k < 1) {
        arm.quaternion.slerpQuaternions(qa0, arm.quaternion.clone(), k); elb.quaternion.slerpQuaternions(qe0, elb.quaternion.clone(), k);
        anchor.quaternion.slerpQuaternions(h.bindQ, anchor.quaternion.clone(), k); arm.updateMatrixWorld(true);
      }
    },
    // 伸手扣锁（给 fengge.js 的 reach() 包）：target = 世界坐标 Vector3（会拷一份）/ null = 松手收回；grip = 到位（< 3 cm）后自动攥住
    setReach(side, target, { grip = true } = {}) {
      const h = H[side]; if (!h) return;
      h.target = target ? (h.target || V()).copy(target) : null; h.grab = grip;
      if (!target) h.gripped = false;
    },
    status(side) { const h = H[side]; return h ? { k: h.k, gripped: h.gripped, dist: h.dist } : null; },
    // 手指平滑（τ ≈ 0.15 s）；apply 里已经调了
    update(dt) {
      const f = 1 - Math.exp(-Math.min(dt, 0.1) / TAU);
      for (const h of Object.values(H)) h.joints.forEach((j, i) => { h.cur[i].slerp(h.tgt[i], f); j.quaternion.copy(h.cur[i]); });
    },
    // 每帧（A2 的 animate 之后）：reach 权重 0.4 s 渐变、IK、到位自动攥住、手指平滑
    apply(dt) {
      for (const side in H) {
        const h = H[side], on = !!h.target;
        if (on) h.last.copy(h.target);
        h.k = THREE.MathUtils.clamp(h.k + (on ? dt : -dt) / REACH_T, 0, 1);
        const kk = h.k * h.k * (3 - 2 * h.k);
        if (kk > 0) api.reach(side, h.last, kk); else if (!h.used) h.anchor.quaternion.copy(h.bindQ);   // 手腕拧转归零（这帧外面直接调过 reach 的不动）
        h.used = false;
        if (on) {
          h.dist = h.grip.getWorldPosition(c).distanceTo(h.target);
          if (h.grab && h.k >= 1 && h.dist < GRAB_D) h.gripped = true; else if (h.dist > SLIP_D) h.gripped = false;
        } else h.dist = Infinity;
        setTgt(h, h.manual[0], h.manual[1]);
        if (kk > 0) toward(h, h.gripped ? 'grip' : 'open', kk);    // 伸过去时手张开，到位攥住；松手 = 先张开再随手臂收回变回原手势
      }
      api.update(dt);
    },
  };
  return api;
}
