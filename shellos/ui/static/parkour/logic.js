// 跑酷（R 线）的纯逻辑：关卡生成、物理、腿 → 跳 / 滑铲、腿上的力该是什么。不依赖 three，tests/test_parkour.py 用 node 直接跑。
// 坐标：前进 = +x（米），车道 = z（右 = +z），高度 = y。三条道 z = −LANE, 0, +LANE。
// 一局：无尽城市屋顶，撞 3 次结束（障碍 / 掉楼缝 / 被机甲追上都算一次）。跑速只看步频。

export const LANE = 1.6;
export const TUNE = {                  // 现场调这里（也可以 URL 覆盖：?jump=45&slide=35&vjump=80）
  JUMP_FLEX: 45,   // 高抬腿：一条腿屈髋超过这个角（°，减掉 anim.js 学出的零点）……
  JUMP_VEL: 80,    // ……且还在往上抬（°/s）或者比上一拍多抬了 8°
  JUMP_OTHER: 30,  // 另一条腿得低于这个（两条腿都高 = 下蹲，不是跳）
  SLIDE_FLEX: 35,  // 下蹲：两条腿同时屈髋超过这个
  REARM: 25,       // 两条腿都回到这以下才能再跳一次
  JUMP_LEAD: 0.06, // 第 5 轮：识别用 A2 跟踪后的髋角（60 fps），再按角速度往前看这么多秒——起跳帧往前挪，贴近 lift 在摆动期 68% 出力的那一拍
  TURN_EVERY: 3,   // 第 6 轮：每 3 栋楼一个 90° 转弯（楼尾就是路口）
  TURN_ZONE: 10,   // 路口前多少米内按转弯才算（提前按也记着，到路口再转 = 输入缓冲）
  WALL_D: 3.6,     // 过了路口还能补按多远；再往前就撞上路口尽头的墙（扣一次，自动转过去接着跑）
  HOLD_S: 0.3,     // 免手换道（?lane=knee）：一条腿抬到高抬腿阈值并保持这么久 = 往那边换一道
  PEAK_DROP: 8,    // 免手模式里「膝盖开始往下落」= 从这次抬腿的最高点落下 8°（没保持够就落 = 跳）；不用角速度：抬到顶一停，滤波后的角速度会短暂过冲成负的
  LIFT_LIT: 0.68,  // lift 脉冲中心在文献相位 68%（摆动早期，terrain.py pulse('lift')）；估计器相位 = (hs_phase + 0.68) % 1，自动驾驶把起跳对到这一拍
  CAD_V: 0.075, CAD_RUN: 120, CAD_V2: 0.1,   // 步频 → 跑速：120 步/分以下 0.075（100 = 7.5 m/s、120 = 9 m/s），以上按更陡的 0.1 涨（160 = 13、180 = 15、200 = 17 m/s）
  V_MIN: 4, V_MAX: 17,                       //   9/24 球球「没有奔跑的感觉」：真机 150–180 步/分要跑得起来
  G: 20,           // 自由落体（从楼沿走下去、弧线走完还没着地）
  JUMP_H: 1.3, JUMP_STEPS: 2, SLIDE_STEPS: 2,   // 第 8 轮：跳高 1.3 m、跳 / 滑都占 2 步的路程（= 一个步态周期）
  ARC_VMIN: 3, JUMP_MIN: 3,   // 弧线路程至少按 3 m/s 走、最短 3 m（站着跳）
  LOW_H: 0.85,     // 低障碍（空调外机 / 矮墙）高度：脚离地要超过它
  HIGH_Y: 1.0,     // 高障碍（晾衣杆）下沿：滑铲时身高 0.8 能钻过去
  LIVES: 3, INVULN: 1.5,
  JF_GAP0: 1.5, JF_WAIT: 3, JF_RESET: 7, JF_V0: 6.3, JF_ACC: 0.004, JF_VMAX: 13.5, JF_GAPMAX: 16,   // 追兵：开局在你身边，3 s 后才追；速度随跑的距离涨（1000 m 时 10.3 m/s ≈ 步频 137）
};

// ---------- 随机数（固定种子：同一局路一样，测试可复现） ----------
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// ---------- 路线（第 6 轮：90° 转弯） ----------
// 物理全在「沿路距离 s + 横向 lat」里算（和以前的 x / z 一样）；路线 = 一串直腿（leg），腿和腿之间是 90° 路口。
// 朝向 dir 0..3 的前进方向 H4[dir]（世界 x, z），右手边 = H4[(dir + 1) % 4]（面朝 +X 时右手边是 +Z）；右转 dir + 1，左转 dir − 1。
// leg = { s0, dir, ox, oz }：从路程 s0 开始、起点在世界 (ox, oz)。某条腿上的 (s, lat) → 世界 = 起点 + 前进·(s − s0) + 右·lat。
export const H4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const yawOf = dir => -dir * Math.PI / 2;                 // three.js 的 rotation.y（模型面朝 +X）
export function atLeg(leg, s, lat = 0, out = {}) {
  const h = H4[leg.dir], r = H4[(leg.dir + 1) % 4], a = s - leg.s0;
  out.x = leg.ox + h[0] * a + r[0] * lat; out.z = leg.oz + h[1] * a + r[1] * lat; out.dir = leg.dir;
  return out;
}

// ---------- 障碍模式表 + 难度分级（第 7 轮） ----------
// 模式：照 cave-runner（MIT）的思路——{左, 中, 右} × {跳, 滑} + 三种「两道水箱留一条道」，共 9 种；难度高了再加整排矮墙 / 整排晾衣杆。
//   抽的时候不和前两个重复（cave-runner 的做法），免得同一个动作连着来。数据是自己写的，没抄代码。
// 分级：照 Boxy-Run（Apache-2.0）的「难度只随距离分级」思路——速度交给步频，难度只管障碍间距、楼缝宽、斜板多少、能出哪些模式。
export const PATTERNS = {
  jumpL: { type: 'low', lanes: [0] }, jumpC: { type: 'low', lanes: [1] }, jumpR: { type: 'low', lanes: [2] },
  slideL: { type: 'high', lanes: [0] }, slideC: { type: 'high', lanes: [1] }, slideR: { type: 'high', lanes: [2] },
  blockLC: { type: 'block', lanes: [0, 1] }, blockCR: { type: 'block', lanes: [1, 2] }, blockLR: { type: 'block', lanes: [0, 2] },
  jumpAll: { type: 'low', lanes: [0, 1, 2] }, slideAll: { type: 'high', lanes: [0, 1, 2] },
};
const BASE9 = ['jumpL', 'jumpC', 'jumpR', 'slideL', 'slideC', 'slideR', 'blockLC', 'blockCR', 'blockLR'];
// from = 从沿路多少米起；roof = 楼长；space = 障碍间距（米，穿外骨骼的人 2–4 s 才能再来一次高抬腿）；gap = 楼缝宽；ramp = 楼后接斜板的概率；pats = 能出的模式
export const TIERS = [
  { from: 0, name: '热身', roof: [26, 44], space: [30, 40], gap: [2.4, 3.0], ramp: 0.35, pats: BASE9 },
  { from: 250, name: '上楼顶', roof: [28, 50], space: [24, 34], gap: [2.6, 3.4], ramp: 0.3, pats: [...BASE9, 'jumpAll'] },
  { from: 600, name: '夜奔', roof: [34, 62], space: [18, 26], gap: [2.8, 3.8], ramp: 0.28, pats: [...BASE9, 'jumpAll', 'slideAll'] },
  { from: 1000, name: '亡命', roof: [40, 70], space: [14, 20], gap: [3.0, 4.2], ramp: 0.25, pats: [...BASE9, 'jumpAll', 'slideAll', 'jumpAll', 'slideAll'] },
];
export const tierAt = s => { let t = TIERS[0]; for (const q of TIERS) if (s >= q.from) t = q; return t; };
// 碰撞盒（沿路 ±len/2、横向 ±w/2、离地 y0..y1），和 three 的 Box3.intersectsBox 一样是 6 个比较；logic.js 不依赖 three 所以自己写
export const OBS_BOX = { low: { len: 0.9, w: 1.3, y0: 0, y1: TUNE.LOW_H }, high: { len: 0.9, w: 1.6, y0: 1.05, y1: 2.0 }, block: { len: 1.6, w: 1.4, y0: 0, y1: 2.6 } };
export const PLAYER_BOX = { len: 0.6, w: 0.7, h: 1.7, hSlide: 0.8 };
export function boxHit(o, x, z, foot, sliding) {
  const B = OBS_BOX[o.type], top = foot + (sliding ? PLAYER_BOX.hSlide : PLAYER_BOX.h);
  if (Math.abs(o.x - x) > (B.len + PLAYER_BOX.len) / 2) return false;
  if (top <= B.y0 || foot >= B.y1) return false;
  return o.lanes.some(l => Math.abs((l - 1) * LANE - z) < (B.w + PLAYER_BOX.w) / 2);
}

// ---------- 关卡 ----------
// segs: [{kind:'roof'|'gap'|'ramp', x0, x1, h0, h1, leg, turnIn?, turnOut?}]；obs: [{x, len, lanes:[0,1,2], type:'low'|'high'|'block', hit, leg}]
// turns: [{s, d(−1 左 / +1 右), from, to(腿), done}]——路口在 s，这栋楼（turnOut）的尾巴；下一栋（turnIn）同高、从同一个 s 接着往新方向走
export function makeLevel(seed = 7, T = TUNE) {
  const R = rng(seed), segs = [], obs = [], legs = [{ s0: -30, dir: 0, ox: -30, oz: 0 }], turns = [];
  let x = -30, h = 4, roofs = 0, turnIn = 0;
  const recent = [];
  const L = {
    segs, obs, legs, turns, get end() { return x; },
    roof(x0, x1, hh, extra) { segs.push({ kind: 'roof', x0, x1, h0: hh, h1: hh, leg: legs[legs.length - 1], ...extra }); },
    legAt(s) { for (let i = legs.length - 1; i > 0; i--) if (legs[i].s0 <= s) return legs[i]; return legs[0]; },
    at(s, lat, out) { return atLeg(L.legAt(s), s, lat, out); },
    extend(to) {
      while (x < to) {
        const tier = tierAt(x);                                     // 第 7 轮：难度只看沿路距离
        const len = segs.length ? tier.roof[0] + R() * (tier.roof[1] - tier.roof[0]) : 60;   // 第一栋长一点，开局先适应
        const x0 = x, x1 = x + len, turnHere = roofs >= 2 && roofs % T.TURN_EVERY === 2;   // 第 3、6、9… 栋楼尾是路口
        roofs++;
        L.roof(x0, x1, h, { ...(turnIn ? { turnIn } : {}), ...(turnHere ? { turnOut: true } : {}) });
        if (segs.length > 1) {                                      // 屋顶上的障碍：离两头各留一段；路口前的转弯区不放
          const prev = segs[segs.length - 2];                       // 刚转过路口（镜头还在甩 ~0.4 s）/ 刚跳过楼缝（一跳 ~9 m、跳下矮楼落得更远）：第一个障碍放远一点，别落地就撞
          let ox = x0 + (turnIn || (prev && prev.kind === 'gap') ? 18 : 9);
          while (ox < x1 - (turnHere ? T.TURN_ZONE + 5 : 7)) {
            let name, tries = 0;                                     // 抽一个模式，不和前两个重复
            do name = tier.pats[Math.floor(R() * tier.pats.length)]; while (recent.includes(name) && ++tries < 20);
            recent.push(name); if (recent.length > 2) recent.shift();
            const P = PATTERNS[name];
            obs.push({ x: ox, len: OBS_BOX[P.type].len, lanes: P.lanes, type: P.type, pat: name, hit: false, leg: legs[legs.length - 1] });
            ox += tier.space[0] + R() * (tier.space[1] - tier.space[0]);
          }
        }
        x = x1; turnIn = 0;
        if (turnHere) {                                             // 路口：下一栋同高、从这里往左 / 右接着走（中间没有楼缝 / 斜板）
          const d = R() < 0.5 ? -1 : 1, prev = legs[legs.length - 1], C = atLeg(prev, x1, 0);
          legs.push({ s0: x1, dir: (prev.dir + d + 4) % 4, ox: C.x, oz: C.z });
          turns.push({ s: x1, d, from: prev, to: legs[legs.length - 1], done: false });
          turnIn = d;
          continue;
        }
        const r = R();
        if ((r < tier.ramp && h < 9) || h < 2) {                    // 上坡：一块斜板搭到更高的楼
          segs.push({ kind: 'ramp', x0: x, x1: x + 9, h0: h, h1: h + 1.8, leg: legs[legs.length - 1] }); x += 9; h += 1.8;
        } else {                                                    // 楼缝：同高或跳下去
          const w = tier.gap[0] + R() * (tier.gap[1] - tier.gap[0]);
          segs.push({ kind: 'gap', x0: x, x1: x + w, h0: h, h1: h, leg: legs[legs.length - 1] }); x += w;
          if (r > 0.75 || h > 9) h -= 1.6 + R() * 0.8;
        }
      }
    },
    prune(before) {                                                 // 丢掉身后的（腿留到它后面那条腿也在身后为止：镜头在身后 4 m 还要用）
      while (segs.length && segs[0].x1 < before) segs.shift();
      while (obs.length && obs[0].x + 2 < before) obs.shift();
      while (legs.length > 1 && legs[1].s0 < before) legs.shift();
      while (turns.length && turns[0].done && turns[0].s < before) turns.shift();
    },
    seg(px) { for (const s of segs) if (px >= s.x0 && px < s.x1) return s; return null; },
    // 地面高度；楼缝 = null
    ground(px) { const s = L.seg(px); if (!s || s.kind === 'gap') return null; return s.h0 + (s.h1 - s.h0) * (px - s.x0) / (s.x1 - s.x0); },
  };
  L.extend(200);
  return L;
}

// ---------- 腿 → 动作 ----------
// push(flL, flR, vL, vR)：屈曲角（°，已减零点）和屈曲角速度（°/s）。返回 {jump, slide}（jump = 这一拍刚触发）
export function makeLegs(T = TUNE) {
  let armed = true, prev = [0, 0];
  return {
    push(fl, fr, vl, vr) {
      const f = [fl, fr], v = [vl || 0, vr || 0];
      let jump = false;
      const slide = fl > T.SLIDE_FLEX && fr > T.SLIDE_FLEX;
      for (let k = 0; k < 2 && armed && !slide; k++) {
        if (f[k] > T.JUMP_FLEX && f[1 - k] < T.JUMP_OTHER && (v[k] > T.JUMP_VEL || f[k] - prev[k] > 8)) { jump = true; armed = false; }
      }
      if (!armed && fl < T.REARM && fr < T.REARM) armed = true;
      prev = f;
      return { jump, slide };
    },
  };
}

// 一步走多远（米）：速度 × 60 / 步频；没有步频（键盘 / 刚起步）按 150 步/分算
export const stepLen = (v, cad, T = TUNE) => v * 60 / (cad > 30 ? cad : 150);
export const jumpLen = (v, cad, T = TUNE) => Math.max(T.JUMP_MIN, T.JUMP_STEPS * stepLen(v, cad, T));
// 免手模式（?lane=knee）：同一路信号（A2 跟踪后的髋角）先判「保持」再判「跳」，互斥。
//   一条腿抬过 JUMP_FLEX（另一条腿在 JUMP_OTHER 以下）→ 开始计时：0.3 s 内从最高点落下 PEAK_DROP = 跳；还抬着到 0.3 s = 往那条腿那边换一道。
//   跳在最高点就触发（不等放下），比缺省模式晚大约抬腿到最高点那一段。两条腿都放回 REARM 以下才能再来。两条腿都高 = 下蹲滑铲，和缺省一样。
//   push(往前看过的屈曲角 ×2, 角速度 ×2, dt) → {jump, slide, lane: −1 左 / +1 右 / 0}；过阈值用往前看的角（早），最高点 / 落下用没往前看的角；hold[k] = 0..1 保持进度、up[k] = 这条腿过没过阈值（HUD 膝盖图标用）
export function makeKneeLegs(T = TUNE) {
  let armed = true, cand = null;
  const hold = [0, 0], up = [false, false];
  return {
    hold, up,
    push(fl, fr, vl, vr, dt) {
      const f = [fl, fr], v = [vl || 0, vr || 0], slide = fl > T.SLIDE_FLEX && fr > T.SLIDE_FLEX;
      let jump = false, lane = 0;
      up[0] = fl > T.JUMP_FLEX; up[1] = fr > T.JUMP_FLEX;
      if (slide) cand = null;
      const raw = [fl - v[0] * T.JUMP_LEAD, fr - v[1] * T.JUMP_LEAD];     // 去掉往前看的那部分：抬到顶一停，往前看的量会一下子缩回去，看起来像「落下来」
      if (!cand && armed && !slide) for (let k = 0; k < 2; k++) if (f[k] > T.JUMP_FLEX && f[1 - k] < T.JUMP_OTHER) { cand = { k, t: 0, pk: raw[k] }; break; }
      if (cand) {
        const k = cand.k; cand.t += dt; cand.pk = Math.max(cand.pk, raw[k]);
        if (raw[k] < cand.pk - T.PEAK_DROP) { jump = true; cand = null; armed = false; }   // 没保持够就从最高点往下落 = 跳
        else if (cand.t >= T.HOLD_S) { lane = k === 0 ? -1 : 1; cand = null; armed = false; }                 // 保持够了 = 换道
      }
      hold[0] = cand && cand.k === 0 ? Math.min(1, cand.t / T.HOLD_S) : 0; hold[1] = cand && cand.k === 1 ? Math.min(1, cand.t / T.HOLD_S) : 0;
      if (!armed && fl < T.REARM && fr < T.REARM) armed = true;
      return { jump, slide, lane };
    },
  };
}

export const speedFor = (cadence, moving, T = TUNE) => {
  if (!moving || !(cadence > 0)) return 0;
  const v = cadence <= T.CAD_RUN ? cadence * T.CAD_V : T.CAD_RUN * T.CAD_V + (cadence - T.CAD_RUN) * T.CAD_V2;
  return Math.max(T.V_MIN, Math.min(T.V_MAX, v));
};

// ---------- 一局 ----------
export function makeRun(level, T = TUNE) {
  const S = {
    x: 0, z: 0, lane: 1, y: level.ground(0), vy: 0, air: false, slideT: 0, speed: 0, lives: T.LIVES, invuln: 0,
    dist: 0, jfGap: T.JF_GAP0, jfV: 0, started: false, startT: 0, over: false, t: 0, landT: -9, fell: false, events: [],
    leg: level.legs[0], turnPend: 0, arc: 0, jump: null, slide: null,
  };
  const laneZ = l => (l - 1) * LANE;
  const hit = why => {
    if (S.invuln > 0 || S.over) return;
    S.lives--; S.invuln = T.INVULN; S.speed *= 0.4; S.events.push(why);
    if (S.lives <= 0) { S.over = true; S.events.push('over'); }
  };
  S.laneZ = laneZ;
  // 转弯：把玩家此刻的世界位置换算到新腿上（s' = 新腿 s0 + (P − 起点)·前进，lat' = (P − 起点)·右），位置连续、不跳
  const doTurn = (tn, missed) => {
    const P = atLeg(S.leg, S.x, S.z), nl = tn.to, h = H4[nl.dir], r = H4[(nl.dir + 1) % 4], dx = P.x - nl.ox, dz = P.z - nl.oz;
    S.x = nl.s0 + dx * h[0] + dz * h[1]; S.z = dx * r[0] + dz * r[1];
    S.lane = Math.max(0, Math.min(2, Math.round(S.z / LANE) + 1));
    S.leg = nl; tn.done = true; S.turnPend = 0; S.events.push(missed ? 'turnMiss' : 'turn');
  };
  // inp = {v: 目标速度, cad: 步频（跳 / 滑的长度按步算）, jump, slide, lane: −1/0/+1, turn: −1 左 / +1 右 / 0}
  S.step = (dt, inp) => {
    S.t += dt;
    if (S.over) { S.speed = Math.max(0, S.speed - dt * 12); S.x += S.speed * dt; return; }
    if (!S.started && (inp.v > 0 || inp.jump)) { S.started = true; S.startT = S.t; S.events.push('start'); }
    S.speed += (inp.v - S.speed) * (1 - Math.exp(-dt / 0.4));
    S.x += S.speed * dt; if (S.started) S.dist += S.speed * dt;
    // 路口：转弯区内按对方向就记下（提前按也算），到路口再转；过了路口 WALL_D 还没转 = 撞墙（扣一次）并自动转过去
    const tn = level.turns.find(q => !q.done);
    if (tn) {
      const dx = tn.s - S.x;
      if (inp.turn === tn.d && dx < T.TURN_ZONE && dx > -T.WALL_D) S.turnPend = tn.d;
      if (S.x >= tn.s && S.turnPend === tn.d) doTurn(tn, false);
      else if (S.x >= tn.s + T.WALL_D) { hit('corner'); doTurn(tn, true); }
    }
    if (inp.lane) S.lane = Math.max(0, Math.min(2, S.lane + inp.lane));
    S.z += (laneZ(S.lane) - S.z) * (1 - Math.exp(-dt * 12));
    S.invuln = Math.max(0, S.invuln - dt);
    // 竖直（第 8 轮）：跳 / 滑按「路程」参数化（Trash Dash 的思路，公式自己写）：r = (弧线路程 − 起跳时) / 跳长，y = 起跳高度 + sin(π·r)·JUMP_H。
    //   跳长 = JUMP_STEPS 步的路程（步长 = 速度 × 60 / 步频）→ 滞空正好 JUMP_STEPS 步 = 一个步态周期：起跳在 lift 那一拍，落地就是同一条腿的下一拍；
    //   速度跟步频成正比，所以跳长基本恒定 ~9 m，变的是滞空时间（100 步/分 1.2 s、150 → 0.8 s、200 → 0.6 s）。空中步频变了，弧线照样在同一个路程落地。
    //   弧线路程至少按 ARC_VMIN 走：站着不动按跳也会落下来。走完弧线脚下更低（跳下矮楼 / 楼缝）就按收尾的下落速度接重力。
    const g = level.ground(S.x), arcV = Math.max(S.speed, T.ARC_VMIN), step = stepLen(S.speed, inp.cad, T);
    S.arc += arcV * dt;
    if (inp.jump && !S.air) { S.air = true; S.jump = { a0: S.arc, len: Math.max(T.JUMP_MIN, T.JUMP_STEPS * step), y0: S.y }; S.slide = null; S.events.push('jump'); }
    if (inp.slide && S.air && (S.jump || S.vy > -8)) { S.jump = null; S.vy = -12; }   // 空中下蹲 = 快速落地
    if (inp.slide && !S.air && !S.slide) { S.slide = { end: S.arc + Math.max(T.JUMP_MIN, T.SLIDE_STEPS * step) }; S.events.push('slide'); }
    if (S.slide) { if (inp.slide) S.slide.end = Math.max(S.slide.end, S.arc + 0.2 * arcV); if (S.arc >= S.slide.end || S.air) S.slide = null; }   // 蹲着不起来 = 一直滑
    S.slideT = S.slide ? (S.slide.end - S.arc) / arcV : 0;                        // 还剩几秒（> 0 = 在滑；画面 / 碰撞 / HUD 用）
    if (!S.air) {
      if (g === null) { S.air = true; S.vy = 0; } else S.y = g;
    }
    if (S.air) {
      const py = S.y;
      if (S.jump) {
        const J = S.jump, r = (S.arc - J.a0) / J.len, k = T.JUMP_H * Math.PI / J.len * arcV;
        if (r < 1) { S.y = J.y0 + Math.sin(Math.PI * r) * T.JUMP_H; S.vy = k * Math.cos(Math.PI * r); }
        else { S.y = J.y0; S.vy = -k; S.jump = null; }                             // 弧线走完：接着按这个下落速度 + 重力
      } else { S.vy -= T.G * dt; S.y += S.vy * dt; }
      if (g !== null && S.y <= g && py >= g - 0.35 && S.vy <= 0) { S.y = g; S.air = false; S.vy = 0; S.jump = null; S.landT = S.t; S.events.push('land'); }   // 只在往下落时着地（起跳那一帧 y 还等于地面）
      else if (g !== null && S.y < g - 0.35) { hit('wall'); S.y = g; S.air = false; S.vy = 0; S.jump = null; }   // 撞到更高的楼沿：爬上去
      else if (g === null && S.vy < 0) {
        const s = level.seg(S.x);
        if (s && S.y < s.h0 - 3) {                                            // 掉下去了：扣一次，放到下一栋楼头上
          hit('fall');
          const nx = level.segs.find(q => q.x0 >= s.x1 && q.kind !== 'gap');
          if (nx) { S.x = nx.x0 + 0.5; S.y = nx.h0; S.air = false; S.vy = 0; S.jump = null; S.landT = S.t; }
        }
      }
    }
    // 障碍
    const foot = S.y - (g ?? S.y);
    for (const o of level.obs) if (!o.hit && S.invuln <= 0 && boxHit(o, S.x, S.z, foot, S.slideT > 0)) { o.hit = true; hit(o.type); }   // 第 7 轮：盒子相交
    // 追兵（9/24 起是四脚机甲，mech.js）：速度随距离涨；你比它快就拉开，慢就被追上
    if (S.started) {
      S.jfV = S.t - S.startT < T.JF_WAIT ? 0 : Math.min(T.JF_VMAX, T.JF_V0 + S.dist * T.JF_ACC);
      S.jfGap = Math.min(T.JF_GAPMAX, S.jfGap + (S.speed - S.jfV) * dt);
      if (S.jfGap <= 0.6 && S.jfV > 0) { hit('caught'); S.jfGap = T.JF_RESET; }
    }
    level.prune(S.x - 40); level.extend(S.x + 260);
  };
  return S;
}

// ---------- 腿上的力 ----------
// 只返回 /terrain/force 的 kind（null = 不强制，Terrain 自己的路段 / 平地 = 0）。大小仍由 Guard + R2 管。
//   上斜板 = 'up'（后面推一把）；刚落地 0.5 s = 'down'（制动 = 落地的顿挫）；前方 0.9 s 内要跳（矮障碍 / 楼缝）= 'lift'（只在摆动期帮着抬腿）。
//   别用 stairs_up：9/23 球球真机反馈后它改成了支撑期阻力
export function forceKind(S, level, T = TUNE) {
  if (!S.started || S.over || S.air || S.speed < 0.5) return null;
  if (S.t - S.landT < 0.5) return 'down';
  const s = level.seg(S.x);
  if (s && s.kind === 'ramp') return 'up';
  const ahead = S.x + S.speed * 0.9;
  for (const q of level.segs) if (q.kind === 'gap' && q.x0 > S.x && q.x0 < ahead) return 'lift';
  for (const o of level.obs) if (!o.hit && o.type === 'low' && o.x > S.x && o.x < ahead && o.lanes.includes(S.lane)) return 'lift';
  return null;
}

// 前方最近要应对的东西（HUD 提示 + 自动驾驶）：{what:'jump'|'slide'|'lane', dx, o}
export function nextThreat(S, level, within = 14) {
  let best = null;
  const take = (what, dx, o) => { if (dx > 0 && dx < within && (!best || dx < best.dx)) best = { what, dx, o }; };
  for (const q of level.segs) if (q.kind === 'gap') take('jump', q.x0 - S.x, q);
  for (const t of level.turns) if (!t.done) take('turn', t.s - S.x, t);          // 路口：o.d = −1 左 / +1 右
  for (const o of level.obs) if (!o.hit && o.lanes.includes(S.lane)) take(o.type === 'low' ? 'jump' : o.type === 'high' ? 'slide' : 'lane', o.x - o.len / 2 - S.x, o);
  return best;
}
