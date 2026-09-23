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
};

export function makeRunner(av) {
  const body = av.body, orig = body.update;
  const env = [{ hi: 0, lo: 0, init: false }, { hi: 0, lo: 0, init: false }], wpk = [60, 60];
  let r = 0, g = 1, mean = null, v = 0, vPrev = 0, acc = 0, dpk = 20;
  const info = { v: 0 };
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
    if (r < 0.01) return P;
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
    return P;
  };
  return {
    info, RUN,
    get r() { return r; }, get g() { return g; },
    // 每帧 av.animate 之前调：v = 跑速 m/s
    set(o) { Object.assign(info, o); },
  };
}
