// 跑酷的「跑」这一层（调研见 docs/跑酷-动作调研.md）。A2 的 anim.js 是给走路爬山调的；这里包住 av.body.update，
//   在 A2 算好的姿态表 P 套到骨骼之前叠加修正——骨骼轴向 / 父子换算都还是 avatar.js 的，一行不改它。
// 原则：步点对真人，幅度按跑速放大。髋角以真实均值为中心放大摆幅（相位、节奏、停步都跟穿戴者一样），其余按跑步生物力学叠加。
// P 的约定（anim.js）：角度 °，屈曲 / 前倾为正；pelvis/spine/chest/head = [roll, yaw, pitch(+ = 前倾)]；arm = [摆(+ = 左臂往前), 放下角, 肘弯]；bob / sway 米。
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const ease = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));
const mix = (a, b, k) => a + (b - a) * k;

export const RUN = {         // 现场调这里
  V0: 2.5, V1: 8,            // 跑步程度 r：速度 V0 以下 = 0（A2 原样），V1 以上 = 1
  PP: v => clamp(22 + 3.6 * v, 30, 78),   // 目标髋角峰峰值（°）：7.5 m/s ≈ 49，10 ≈ 58，15 ≈ 76（Novacheck 1998：跑步 55–70）
  GMAX: 2.4,                 // 髋摆幅最多放大几倍
  HIP_FWD: 9,                // 跑步时髋整体往前偏（跑步髋角大约 −15…+45，均值偏屈）
  KNEE_ST: 24, KNEE_SW: 82,  // 支撑期缓冲屈膝 / 摆动期再屈多少（脚跟往屁股收）
  LEAN: v => clamp(3 + 0.9 * v, 4, 15),   // 躯干前倾（°）随速度
  LEAN_ACC: 1.4,             // 每 m/s² 加速度多倾几度（Rosen：加速时身体先倾）
  BOB: [0.05, 0.075],        // 骨盆起伏：支撑中期往下 0.05、腾空往上到 +0.025（米）
  ARM_GAIN: 0.9, ELBOW: 82,  // 摆臂加大、肘弯
  // 第 2 轮：起跳 / 落地 / 滑铲
  PRE: 0.6,                  // 预判下沉的最大比例（前方就要跳时；真正起跳那 2 帧是 1）
  CROUCH: 0.11,              // 蓄力下沉（米）
  PLANT: [0.035, 0.07],      // 起跳后脚先钉在地上多久、再用多久追上物理位置（秒）——看起来是「蹬出去」
  LAND_W: 2.1, LAND_Z: 0.45, LAND_K: 20,   // 落地压缩弹簧：频率 Hz、阻尼比、每单位冲击的初速度（峰值 ≈ −0.9 在 0.1 s，0.38 s 回弹过冲 ≈ +0.18）
  CAM_DIP: 0.08,             // 落地镜头跟着沉（米 / 单位压缩）
};

export function makeRunner(av) {
  const body = av.body, orig = body.update;
  const env = [{ hi: 0, lo: 0, init: false }, { hi: 0, lo: 0, init: false }], wpk = [60, 60];
  let r = 0, g = 1, mean = null, v = 0, vPrev = 0, acc = 0, dpk = 20;
  // 第 2 轮：动作阶段。ts / tl = 起跳 / 落地后多久；comp = 落地压缩弹簧（负 = 压下去）；w* = 各阶段权重（平滑过）
  let wasAir = false, ts = 9, tl = 9, lastVy = 0, lead = 0, comp = 0, compV = 0, rootDy = 0;
  const W = { crouch: 0, push: 0, tuck: 0, reach: 0, slide: 0 };
  const info = { v: 0, air: false, vy: 0, h: 0, pre: 0, slide: false };
  body.update = (dt, t, d) => {
    dt = clamp(dt, 0, 0.1);
    // ---- 跑步程度、加速度 ----
    v = info.v; acc = ease(acc, clamp((v - vPrev) / Math.max(dt, 1e-3), -8, 8), dt, 0.15); vPrev = v;
    r = ease(r, clamp((v - RUN.V0) / (RUN.V1 - RUN.V0), 0, 1), dt, 0.25);
    // ---- 髋：以均值为中心放大（均值不变 → A2 学零点、跑酷认高抬腿都不受影响） ----
    const m = (d.fl + d.fr) / 2;
    mean = mean === null ? m : ease(mean, m, dt, 2);
    let pp = 0;
    const h = [d.fl, d.fr];
    for (let k = 0; k < 2; k++) {
      const E = env[k];
      if (!E.init) { E.hi = E.lo = h[k]; E.init = true; }
      E.hi = Math.max(h[k], ease(E.hi, h[k], dt, 1)); E.lo = Math.min(h[k], ease(E.lo, h[k], dt, 1));
      pp += (E.hi - E.lo) / 2;
    }
    g = ease(g, 1 + (clamp(RUN.PP(v) / Math.max(pp, 8), 1, RUN.GMAX) - 1) * r, dt, 0.3);
    const dd = { ...d, fl: mean + g * (d.fl - mean), fr: mean + g * (d.fr - mean), wl: (d.wl || 0) * g, wr: (d.wr || 0) * g };
    const P = orig(dt, t, dd);
    phases(dt, P);
    if (r >= 0.01) runLayer(P, dt, dd);
    actionLayer(P);
    return P;
  };
  function runLayer(P, dt, dd) {
    // ---- 腿：摆动期大屈膝、支撑期缓冲 ----
    const w = [dd.wl, dd.wr], sw = [0, 0];
    for (let k = 0; k < 2; k++) { wpk[k] = Math.max(60, Math.abs(w[k]), wpk[k] * Math.exp(-dt / 1.5)); sw[k] = clamp(w[k] / wpk[k] * 1.4, 0, 1); }
    P.hipL += RUN.HIP_FWD * r; P.hipR += RUN.HIP_FWD * r;
    P.kneeL = mix(P.kneeL, RUN.KNEE_ST + RUN.KNEE_SW * sw[0], r);
    P.kneeR = mix(P.kneeR, RUN.KNEE_ST + RUN.KNEE_SW * sw[1], r);
    P.ankL += 10 * sw[0] * r; P.ankR += 10 * sw[1] * r;          // 摆动期勾脚
    // ---- 骨盆：两腿交叉 = 支撑中期（最低），分得最开 = 腾空（最高）；一步一次 ----
    const dh = Math.abs(dd.fl - dd.fr);
    dpk = Math.max(10, dh, dpk * Math.exp(-dt / 1.5));
    const u = clamp(dh / dpk, 0, 1);
    P.bob += r * (-RUN.BOB[0] + RUN.BOB[1] * u * u);
    P.sway *= 1 - 0.5 * r;                                       // 跑步脚落在中线附近，左右晃比走路小
    // ---- 躯干前倾（速度 + 加速度），头抵掉，视线水平 ----
    const lean = r * (RUN.LEAN(v) + clamp(RUN.LEAN_ACC * acc, -5, 6)) - r * 3;   // A2 平地已经有 3°
    P.spine[2] += lean * 0.45; P.chest[2] += lean * 0.55; P.head[2] -= lean * 0.9;
    // ---- 手臂：大摆 + 肘弯 ~80°，往前摆时再多弯一点 ----
    for (const [a, s] of [[P.armL, 1], [P.armR, -1]]) {
      a[0] *= 1 + RUN.ARM_GAIN * r;
      a[2] = mix(a[2], RUN.ELBOW + 15 * clamp(s * a[0] / 30, 0, 1), r);
    }
  }
  // ---- 第 2 轮：阶段判定（起跳 / 腾空 / 落地弹簧 / 滑铲），权重都平滑过，不硬切 ----
  function phases(dt, P) {
    const air = info.air;
    if (air && !wasAir) { ts = 0; lead = P.hipL >= P.hipR ? 0 : 1; }             // 起跳：往前那条腿领跳
    if (!air && wasAir) { tl = 0; compV -= RUN.LAND_K * clamp(Math.abs(lastVy) / 7.2, 0.4, 1.3); }   // 落地：给弹簧一个往下的冲量
    wasAir = air; if (air) lastVy = info.vy;
    ts += dt; tl += dt;
    const w = 2 * Math.PI * RUN.LAND_W;                                            // 半隐式欧拉，dt 大时切小步（fx=low / 掉帧不炸）
    for (let n = Math.ceil(dt / 0.008), i = 0; i < n; i++) { compV += (-w * w * comp - 2 * RUN.LAND_Z * w * compV) * dt / n; comp += compV * dt / n; }
    const T = {
      crouch: air ? (ts < RUN.PLANT[0] ? 1 : 0) : info.slide ? 0 : info.pre * RUN.PRE,   // 预判下沉 → 起跳那 2 帧蹲到底
      push: air && ts < 0.2 ? 1 : 0,                                                  // 蹬伸：领跳腿高抬、后腿蹬直、双臂前甩
      tuck: air && ts >= 0.16 && info.vy > -2.5 ? 1 : 0,                              // 腾空团身
      reach: air && info.vy <= -2.5 ? 1 : 0,                                         // 下落：腿往下伸去找地
      slide: info.slide ? 1 : 0,
    };
    for (const k in W) W[k] = ease(W[k], T[k], dt, k === 'crouch' ? 0.03 : 0.06);
    // 脚先钉在地上 PLANT[0] 秒，再用 PLANT[1] 秒追上物理位置：蹬地的感觉（物理不动，只挪画面）
    const k = ts < RUN.PLANT[0] ? 1 : clamp(1 - (ts - RUN.PLANT[0]) / RUN.PLANT[1], 0, 1);
    rootDy = air ? -Math.max(0, info.h) * k : 0;
  }
  // 姿态目标：混进 P（pose = 覆盖，按权重插值；crouch / comp = 叠加）
  const legTo = (P, k, hip, knee, w) => { if (k === 0) { P.hipL = mix(P.hipL, hip, w); P.kneeL = mix(P.kneeL, knee, w); } else { P.hipR = mix(P.hipR, hip, w); P.kneeR = mix(P.kneeR, knee, w); } };
  const armTo = (a, swing, down, elbow, w) => { a[0] = mix(a[0], swing, w); a[1] = mix(a[1], down, w); a[2] = mix(a[2], elbow, w); };
  const leanBy = (P, deg) => { P.spine[2] += deg * 0.45; P.chest[2] += deg * 0.55; P.head[2] -= deg * 0.9; };
  function actionLayer(P) {
    // 蓄力下沉：骨盆降、屈髋屈膝、上身前压、双臂往后拉
    const c = W.crouch;
    if (c > 0.001) { P.bob -= RUN.CROUCH * c; P.hipL += 28 * c; P.hipR += 28 * c; P.kneeL += 55 * c; P.kneeR += 55 * c; P.ankL -= 12 * c; P.ankR -= 12 * c; leanBy(P, 14 * c);
      armTo(P.armL, -35, 55, 30, c * 0.8); armTo(P.armR, 35, 55, 30, c * 0.8); }
    // 蹬伸：领跳腿膝盖顶到胸前，后腿蹬直；双臂往前上甩（左 + = 前，右 − = 前）
    if (W.push > 0.001) { const p = W.push; legTo(P, lead, 78, 100, p); legTo(P, 1 - lead, -18, 12, p); leanBy(P, 6 * p);
      armTo(P.armL, 45, 50, 60, p); armTo(P.armR, -45, 50, 60, p); }
    // 腾空团身：双膝收、手臂往两边张开保持平衡
    if (W.tuck > 0.001) { const u = W.tuck; legTo(P, 0, 62, 112, u); legTo(P, 1, 58, 118, u); leanBy(P, 4 * u);
      armTo(P.armL, 20, 32, 45, u); armTo(P.armR, -20, 32, 45, u); }
    // 下落找地：腿往下前方伸，膝微屈；手臂前举
    if (W.reach > 0.001) { const u = W.reach; legTo(P, lead, 34, 22, u); legTo(P, 1 - lead, 18, 38, u);
      armTo(P.armL, 30, 45, 35, u); armTo(P.armR, -30, 45, 35, u); }
    // 落地压缩 → 回弹（comp 负 = 压下去）
    if (Math.abs(comp) > 0.001) { const x = comp; P.bob += 0.13 * x; P.hipL -= 30 * x; P.hipR -= 30 * x; P.kneeL -= 58 * x; P.kneeR -= 58 * x; P.ankL += 10 * x; P.ankR += 10 * x; leanBy(P, -12 * x);
      P.armL[2] -= 20 * x; P.armR[2] -= 20 * x; }
    // 滑铲：前腿伸直往前、后腿折在身下；上身卷起来抬头看前面；右手往后撑地、左手前举（整个人后仰在 main.js 转根节点）
    if (W.slide > 0.001) { const u = W.slide; legTo(P, 0, 48, 4, u); legTo(P, 1, -4, 112, u);   // 身子后仰 34°：前腿 48° = 贴着地往前，后腿折在身下
      P.spine[2] = mix(P.spine[2], 24, u); P.chest[2] = mix(P.chest[2], 20, u); P.head[2] = mix(P.head[2], 16, u);
      armTo(P.armL, 35, 45, 25, u); armTo(P.armR, 55, 50, 15, u); }
  }
  return {
    info, RUN,
    get r() { return r; }, get g() { return g; }, get comp() { return comp; }, get rootDy() { return rootDy; }, W,
    // 每帧 av.animate 之前调：v = 跑速 m/s，air / vy / h（离地高度）/ pre（0..1，前方马上要跳）/ slide
    set(o) { Object.assign(info, o); },
  };
}
