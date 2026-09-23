// 化身动作（A2）：真实髋角 → 全身姿态。纯数学，不依赖 three（tests/test_game_anim.py 用 node 直接跑）；avatar.js 把结果套到骨骼上。
// 腿忠实于髋角：髋 = 真实屈曲角（只减一个慢慢学出来的零点，见 calib）；膝 / 踝 / 骨盆 / 躯干 / 手臂 / 头全部由髋角和它的角速度推出来，
//   不播预制动画——人停下，全身跟着停。
// 角度单位 °，屈曲 / 前倾为正；长度单位 = 化身局部（米）。
//
// 1) makeHipTrack：/state 10 Hz 的髋角 → 60 fps 连续值。按服务器时间戳 S.t 对齐（去网络抖动），拿设备自己的角速度往前外推
//    （最多 horizon 秒），再过 one-euro 滤波（慢时稳、快时跟得紧）。原来是落后 130 ms 线性插值。
// 2) makeBody：姿态解算。步态相位不另外估计——用髋角速度直接当相位信号：
//    髋在前屈（ω > 0）= 摆动期 → 屈膝、勾脚、同侧骨盆下沉、重心移到另一条腿；ω ≤ 0 = 支撑期 → 膝伸直、脚放平。
//    骨盆起伏按两条腿的几何算（撑地那条腿的竖直长度），不是正弦。
//    按路段（kind）调前倾 / 屈膝 / 摆臂，站住时放松（呼吸 + 重心转移 + 张望），登顶举手庆祝。
//    步频（自己从髋角速度量）145 → 165 步/分平滑切成跑：更前倾、屈肘大幅摆臂、抬膝更高、两脚都离地时身体腾空。
//    落脚（髋角速度由正转负）：下台阶膝盖缓冲一下、上台阶撑地腿弯着慢慢蹬直 + 躯干一耸；
//    外骨骼真给了屈曲方向的力（/state.safety.sent < 0：上台阶阻力、下台阶落阶冲击、红灯拉住）→ 撑地膝跟着被压弯，和腿上的感觉同步。

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const ease = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));
const D2R = Math.PI / 180;

// one-euro（Casiez 2012）：截止频率随速度升高，慢动作去抖、快动作少延迟
function oneEuro(minCut, beta, dCut = 1) {
  let x = null, raw = 0, dx = 0;
  const a = (dt, fc) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  return (v, dt) => {
    if (x === null || !(dt > 0)) { x = raw = v; return x; }
    dx += ((v - raw) / dt - dx) * a(dt, dCut); raw = v;
    x += (v - x) * a(dt, minCut + beta * Math.abs(dx));
    return x;
  };
}

// 髋角跟踪。push(now, ts, fl, fr, vl, vr)：新样本（ts = 服务器秒，可 null；v = 屈曲角速度 °/s，可 null → 用差分）
// sample(now, dt) → { fl, fr, wl, wr }（滤波后的角度和角速度）
// 参数用 9/22 真机录制（181327 走路段 132 s）按 10 Hz + 5–40 ms 网络抖动离线调的：延迟 155 → 85 ms（旧 = 落后 130 ms 线性插值），
//   波形误差（扣掉延迟后）0.86° vs 旧 0.83°。用设备自己的角速度外推比差分好（差分 2.65°）
export function makeHipTrack({ horizon = 0.1, minCut = 2, beta = 0.02 } = {}) {
  let s = null, off = null, lastNow = 0;
  const f = [oneEuro(minCut, beta), oneEuro(minCut, beta)], prev = [null, null], w = [0, 0], out = { fl: 0, fr: 0, wl: 0, wr: 0 };
  return {
    push(now, ts, fl, fr, vl, vr) {
      let t = now;
      if (ts != null) {                        // 本机时钟 − 服务器时钟：取最小值（= 最快那次网络），每秒最多上浮 1% 跟时钟漂移
        const o = now - ts;
        off = off === null ? o : Math.min(o, off + (now - lastNow) * 0.01);
        t = ts + off;
      }
      lastNow = now;
      const fd = (a, b) => s && t - s.t > 0.02 ? (a - b) / (t - s.t) : 0;
      const v = [vl != null ? vl : fd(fl, s && s.f[0]), vr != null ? vr : fd(fr, s && s.f[1])];
      s = { t, f: [fl, fr], v };
    },
    sample(now, dt) {
      if (!s) return out;
      const age = clamp(now - s.t, 0, horizon);
      for (let k = 0; k < 2; k++) {
        const x = f[k](s.f[k] + s.v[k] * age, dt);
        if (prev[k] !== null && dt > 0) w[k] = ease(w[k], (x - prev[k]) / dt, dt, 0.03);
        prev[k] = x;
      }
      out.fl = prev[0]; out.fr = prev[1]; out.wl = w[0]; out.wr = w[1];
      return out;
    },
  };
}

// 路段 → 姿态参数（都会平滑过渡）。lean 躯干前倾；k0 膝常弯；kSw 摆动期屈膝；climb 屈髋带膝（台阶上踩高一级时膝是弯的）；
// lift 摆动期额外抬腿（按真实髋角速度门控：人不动就不加。展位上人在平地走、画面在爬台阶，靠这个把腿抬高）；
// slope 路面坡度（脚放平用）；arm 摆臂系数；elb 肘额外弯；land / landT 落脚后撑地膝多弯多少°、多久回直（下台阶快 = 缓冲，上台阶慢 = 吃力地蹬）；
// heave 落脚后躯干往前一耸°
export const KIND = {
  flat:        { lean: 3,  k0: 5,  kSw: 55, climb: 0.15, lift: 0,  slope: 0,  arm: 0.9, elb: 0,  land: 0,  landT: 0.12, heave: 0 },
  up:          { lean: 10, k0: 9,  kSw: 60, climb: 0.4,  lift: 5,  slope: 7,  arm: 0.7, elb: 8,  land: 5,  landT: 0.25, heave: 2 },
  stairs_up:   { lean: 12, k0: 10, kSw: 45, climb: 0.9,  lift: 18, slope: 0,  arm: 0.55, elb: 12, land: 18, landT: 0.45, heave: 6 },
  down:        { lean: -5, k0: 11, kSw: 48, climb: 0.3,  lift: 0,  slope: -7, arm: 0.75, elb: 4,  land: 10, landT: 0.15, heave: 0 },
  stairs_down: { lean: -3, k0: 12, kSw: 42, climb: 0.45, lift: 4,  slope: 0,  arm: 0.6, elb: 8,  land: 24, landT: 0.14, heave: 2 },
  wait:        { lean: 1,  k0: 5,  kSw: 55, climb: 0.15, lift: 0,  slope: 0,  arm: 0.9, elb: 0,  land: 0,  landT: 0.12, heave: 0 },
};
const RUN = [145, 165];      // 步频（步/分）在这之间从走渐变成跑
const YIELD = 6;             // 外骨骼每 1 Nm 屈曲方向的力，撑地膝多弯几度（最多 15°）
const HIP_MEAN = 5;          // 走路时髋角均值对到 +5°（人走路大约 −10…+25）。真机穿戴零点偏在屈曲 15–20°（支撑期平台就在 +10°），不减就像半蹲着走
const OFF_RANGE = [-5, 25];  // 零点最多学到这个范围
// 站着也学零点：两腿都静、左右差 < 10°、均值在 −10…30° 才算站着（坐着约 70° 不学），把均值对到 0°。
//   新外骨骼零点偏多少不知道（9/23 下午只读看 /state，髋角字段一直是 0.0，编码器没出数），站 3 秒化身就直起来，不会半蹲

// L1 / L2 = 大腿 / 小腿长（avatar.js 从骨骼量）。calib=false 不学零点（影子的合成步态本来就对好了）
export function makeBody({ L1 = 0.26, L2 = 0.27, calib = true } = {}) {
  const K = { ...KIND.flat };
  const leg = () => ({ hi: 0, lo: 0, wpk: 60, init: false, up: false, tUp: null, pk: 0, land: 0, yld: 0 });
  const lg = [leg(), leg()];
  let off = 0, mean = null, act = 0, idle = 1, sm = 0, sway = 0, tIdle = 0, cad = 0, run = 0, tLand = -9;
  const P = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, ankL: 0, ankR: 0, bob: 0, sway: 0, cheer: 0,
    pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],   // [roll 绕前后轴, yaw 绕竖直轴(+ = 左转), pitch(+ = 前倾/低头)]
    armL: [0, 60, 4], armR: [0, 60, 4] };                                  // [前后摆, 放下角, 肘弯]；摆 + = 左臂往前 / 右臂往后（avatar.js 的约定）
  return {
    P,
    get act() { return act; }, get off() { return off; }, get cad() { return cad; }, get run() { return run; },
    // d = { fl, fr, wl, wr, kind, summit, tq: [左, 右] 外骨骼实际给的力 Nm（+ = 伸展），可省 }
    update(dt, t, d) {
      dt = clamp(dt, 0, 0.1);
      const T = KIND[d.kind] || KIND.flat;
      for (const k in K) K[k] = ease(K[k], T[k], dt, 0.45);
      // 零点：走动时慢慢把均值对到 HIP_MEAN（τ≈4 s），站住不学
      const m = (d.fl + d.fr) / 2;
      mean = mean === null ? m : ease(mean, m, dt, 3);
      const w = [d.wl || 0, d.wr || 0];
      const standing = act < 0.2 && Math.abs(w[0]) + Math.abs(w[1]) < 20 && Math.abs(d.fl - d.fr) < 10 && m > -10 && m < 30;
      if (calib && act > 0.6) off = clamp(ease(off, mean - HIP_MEAN, dt, 4), OFF_RANGE[0], OFF_RANGE[1]);
      else if (calib && standing) off = clamp(ease(off, mean, dt, 3), OFF_RANGE[0], OFF_RANGE[1]);
      const h = [d.fl - off, d.fr - off];
      // 活动度：髋角包络（两腿峰峰值的平均，τ 1 s 回落）。真人走路 20–40°，站着 < 3°
      let rom = 0;
      for (let k = 0; k < 2; k++) {
        const L = lg[k];
        if (!L.init) { L.hi = L.lo = h[k]; L.init = true; }
        L.hi = Math.max(h[k], ease(L.hi, h[k], dt, 1)); L.lo = Math.min(h[k], ease(L.lo, h[k], dt, 1));
        L.wpk = Math.max(60, Math.abs(w[k]), L.wpk * Math.exp(-dt / 1.5));
        rom += (L.hi - L.lo) / 2;
      }
      act = ease(act, clamp((rom - 5) / 10, 0, 1), dt, 0.25);
      idle = ease(idle, 1 - act, dt, 0.6);
      sm = ease(sm, d.summit ? 1 : 0, dt, 0.35);
      const ampK = clamp(rom / 32, 0.4, 1);     // 小步子小屈膝（rom = 髋角峰峰值，真人平地 25–40°）
      // 每条腿：swing = 摆动程度 0..1（髋前屈角速度 / 最近峰值）
      const sw = [0, 0], wn = [0, 0], tq = d.tq || [0, 0];
      for (let k = 0; k < 2; k++) {
        const L = lg[k];
        wn[k] = w[k] / L.wpk;
        // 步频：摆动起点（wn 上穿 0.35）的间隔 = 一个周期（两步）
        const up = wn[k] > 0.35;
        if (up && !L.up && act > 0.5) { const p = L.tUp === null ? 0 : t - L.tUp; if (p > 0.45 && p < 2.5) cad = cad ? cad + (120 / p - cad) * 0.5 : 120 / p; L.tUp = t; }
        L.up = up;
        // 落脚：摆过一次（wn 峰 > 0.5）后髋角速度掉到 0 附近 = 脚跟着地
        L.pk = Math.max(L.pk, wn[k]);
        if (L.pk > 0.5 && wn[k] < 0.02) { L.pk = 0; L.land = act; tLand = t; }
        L.land *= Math.exp(-dt / K.landT);
        L.yld = Math.max(Math.max(0, -tq[k]), L.yld * Math.exp(-dt / 0.2));   // 屈曲方向的力：峰值保持 0.2 s（/state 只有 10 Hz，脉冲才 0.1 s 宽）
      }
      if (act < 0.3) cad = ease(cad, 0, dt, 1);
      run = ease(run, act > 0.6 ? clamp((cad - RUN[0]) / (RUN[1] - RUN[0]), 0, 1) : 0, dt, 0.4);
      for (let k = 0; k < 2; k++) {
        const L = lg[k];
        sw[k] = clamp(wn[k] * 1.4, 0, 1) * act;
        const hip = h[k] + (K.lift + 15 * run) * sw[k];
        // 蹬地：髋在后（低于包络中点）且刚开始前屈
        const push = clamp(wn[k] * 3, 0, 1) * clamp(((L.hi + L.lo) / 2 - h[k]) / ((L.hi - L.lo) / 2 + 1), 0, 1) * act;
        const stance = 1 - sw[k];
        const knee = Math.max(2, K.k0 + 6 * run + (K.kSw + 45 * run) * ampK * sw[k] + 25 * push + K.climb * Math.max(0, hip)
          + ((K.land + 15 * run) * L.land + Math.min(15, YIELD * L.yld)) * stance);
        const flat = clamp(knee - hip + K.slope, -15, 20);   // 脚底平贴路面：小腿前倾多少，踝就背屈多少（只在支撑期；离地后回到勾脚）
        const st = (1 - sw[k]) * (1 - push);
        const ank = clamp(flat * st * st + 8 * sw[k] - 14 * push, -25, 25);
        if (k === 0) { P.hipL = hip; P.kneeL = knee; P.ankL = ank; } else { P.hipR = hip; P.kneeR = knee; P.ankR = ank; }
      }
      // 站住：呼吸（3.6 s 一次）+ 重心左右换（约 6 s 一个来回，过渡慢、停留长）+ 慢慢张望
      tIdle = idle > 0.05 ? tIdle + dt : 0;
      const br = Math.sin(t * 2 * Math.PI / 3.6), ws = Math.tanh(2.2 * Math.sin(tIdle * 2 * Math.PI / 6 + 0.8)) * idle;
      P.kneeL += 15 * Math.max(0, ws); P.kneeR += 15 * Math.max(0, -ws);   // 重心在右（ws>0）→ 左腿放松屈膝
      // 骨盆：前摆那侧往前转（yaw），摆动侧下沉（roll），重心移向支撑腿（sway）
      const dh = (h[0] - h[1]) * act;
      const roll = -(sw[0] - sw[1]) * 4 - 4 * ws;
      P.pelvis[0] = roll; P.pelvis[1] = -dh * 0.2; P.pelvis[2] = 0;
      sway = ease(sway, (sw[0] - sw[1]) * 0.022 + 0.04 * ws, dt, 0.12); P.sway = sway;
      // 躯干：反向扭转（肩和骨盆反着转）、反向侧倾抵掉骨盆、按路段前倾；呼吸时胸口微起伏；登顶后仰
      const lean = K.lean + 2 * act + 8 * run + K.heave * Math.max(lg[0].land, lg[1].land) - 7 * sm;
      P.spine[0] = -roll * 0.5; P.spine[1] = dh * 0.22; P.spine[2] = lean * 0.5 + 0.6 * br * idle;
      P.chest[0] = -roll * 0.3; P.chest[1] = dh * 0.18; P.chest[2] = lean * 0.5 - 1.0 * br * idle;
      // 头稳定：抵掉上面三节的转动，视线保持水平朝前；站着时慢慢张望；登顶抬头
      const look = idle * (14 * Math.sin(tIdle * 0.45) * Math.sin(tIdle * 0.17 + 1));
      P.head[0] = -(P.pelvis[0] + P.spine[0] + P.chest[0]) * 0.9;
      P.head[1] = -(P.pelvis[1] + P.spine[1] + P.chest[1]) * 0.9 + look;
      P.head[2] = -lean * 0.75 - 10 * sm;
      // 手臂：跟对侧腿同向摆（真实髋角差 → 步频自然一致），往前摆时肘多弯
      const pump = Math.sin(t * 2 * Math.PI * 1.5);
      const arm = clamp((h[1] - h[0]) / 2 * K.arm * (1 + 0.9 * run), -50, 50) * (1 - sm) + idle * 2 * Math.sin(t * 0.9);
      const down = 60 + 4 * idle + 1.5 * br * idle;
      const up = -85 + 14 * pump;                 // 登顶：双臂举成 V 字，一下一下挥
      const lc = 0.4 * lean * (1 - sm) * (1 - run); P.armL[0] = arm - lc; P.armR[0] = arm + lc;   // 躯干前倾时手臂仍大致竖直垂着（跑步时手臂本来就跟着躯干）
      P.cheer = sm;
      P.armL[1] = P.armR[1] = down + (up - down) * sm;
      P.armL[2] = 4 + K.elb + Math.max(0, arm) * 0.5 + run * (75 - K.elb);   // 绑定姿态的肘本来就弯着一点；跑步屈肘约 90°
      P.armR[2] = 4 + K.elb + Math.max(0, -arm) * 0.5 + run * (75 - K.elb);
      if (sm > 0.01) { const e = 25 + 35 * (1 + pump) / 2; P.armL[2] += (e - P.armL[2]) * sm; P.armR[2] += (e - P.armR[2]) * sm;
        const b = 8 * sm * (1 - pump) / 2; P.kneeL += b; P.kneeR += b; }   // 跟着挥手屈膝弹两下
      // 起伏：撑地那条腿（竖直更长的）决定骨盆高度；伸直 = 0。真机髋角支撑期是平台（撑地腿一直直着，几何上几乎不起伏），
      //   再加一点按摆动算的：另一条腿摆到中间（单腿支撑中段）最高、两脚都着地时最低，±6 mm
      const vert = (hip, knee) => L1 * Math.cos(hip * D2R) + L2 * Math.cos((hip - knee) * D2R);
      //   跑步：落脚后这一步的前 30% 压着（膝缓冲），后 70% 腾空、身体抛起再落下 ≤4.5 cm（落脚时刻来自真实髋角，节奏用量到的步频）
      const u = cad > 0 ? (t - tLand) * cad / 60 : 9;
      const fly = run * (u < 1 ? Math.sin(Math.PI * clamp((u - 0.3) / 0.7, 0, 1)) : 0);
      P.bob = Math.max(vert(P.hipL, P.kneeL), vert(P.hipR, P.kneeR)) - (L1 + L2) + 0.012 * (Math.max(sw[0], sw[1]) - 0.5 * act) + 0.045 * fly + 0.004 * br * idle;
      return P;
    },
  };
}

// 影子的合成髋角：人走路的髋角曲线（g = 步态周期 0..1，0 = 脚跟着地；+25° 屈 → 50% 时 −10° 伸 → 85% 最屈）
// 用两项傅里叶近似；返回 [角, 角速度 °/周期]
export function synthHip(g, amp = 1, mean = 8) {
  const a = 2 * Math.PI * (g - 0.9);
  return [mean + amp * (17 * Math.cos(a) + 3 * Math.cos(2 * a)), -amp * 2 * Math.PI * (17 * Math.sin(a) + 6 * Math.sin(2 * a))];
}
