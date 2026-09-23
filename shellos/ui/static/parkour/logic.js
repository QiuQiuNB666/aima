// 跑酷（R 线）的纯逻辑：关卡生成、物理、腿 → 跳 / 滑铲、腿上的力该是什么。不依赖 three，tests/test_parkour.py 用 node 直接跑。
// 坐标：前进 = +x（米），车道 = z（右 = +z），高度 = y。三条道 z = −LANE, 0, +LANE。
// 一局：无尽城市屋顶，撞 3 次结束（障碍 / 掉楼缝 / 被捷风追上都算一次）。跑速只看步频。

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
  LIFT_LIT: 0.68,  // lift 脉冲中心在文献相位 68%（摆动早期，terrain.py pulse('lift')）；估计器相位 = (hs_phase + 0.68) % 1，自动驾驶把起跳对到这一拍
  CAD_V: 0.075,    // 步频 → 跑速：100 步/分 = 7.5 m/s，200 = 15 m/s（夸张一点才有跑酷感）
  V_MIN: 4, V_MAX: 15,
  G: 20, V0: 7.2,  // 跳：顶点 1.3 m，滞空 0.72 s
  SLIDE_T: 0.75,
  LOW_H: 0.85,     // 低障碍（空调外机 / 矮墙）高度：脚离地要超过它
  HIGH_Y: 1.0,     // 高障碍（晾衣杆）下沿：滑铲时身高 0.8 能钻过去
  LIVES: 3, INVULN: 1.5,
  JF_GAP0: 1.5, JF_WAIT: 3, JF_RESET: 7, JF_V0: 6.3, JF_ACC: 0.004, JF_VMAX: 13.5, JF_GAPMAX: 16,   // 捷风：开局站你身边，「你先跑三秒」后才追；速度随跑的距离涨（1000 m 时 10.3 m/s ≈ 步频 137）
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

// ---------- 关卡 ----------
// segs: [{kind:'roof'|'gap'|'ramp', x0, x1, h0, h1, leg, turnIn?, turnOut?}]；obs: [{x, len, lanes:[0,1,2], type:'low'|'high'|'block', hit, leg}]
// turns: [{s, d(−1 左 / +1 右), from, to(腿), done}]——路口在 s，这栋楼（turnOut）的尾巴；下一栋（turnIn）同高、从同一个 s 接着往新方向走
export function makeLevel(seed = 7, T = TUNE) {
  const R = rng(seed), segs = [], obs = [], legs = [{ s0: -30, dir: 0, ox: -30, oz: 0 }], turns = [];
  let x = -30, h = 4, roofs = 0, turnIn = 0;
  const L = {
    segs, obs, legs, turns, get end() { return x; },
    roof(x0, x1, hh, extra) { segs.push({ kind: 'roof', x0, x1, h0: hh, h1: hh, leg: legs[legs.length - 1], ...extra }); },
    legAt(s) { for (let i = legs.length - 1; i > 0; i--) if (legs[i].s0 <= s) return legs[i]; return legs[0]; },
    at(s, lat, out) { return atLeg(L.legAt(s), s, lat, out); },
    extend(to) {
      while (x < to) {
        const d = Math.min(1, Math.max(0, x / 1500));               // 难度 0..1
        const len = segs.length ? 26 + R() * 26 : 60;               // 第一栋长一点，开局先适应
        const x0 = x, x1 = x + len, turnHere = roofs >= 2 && roofs % T.TURN_EVERY === 2;   // 第 3、6、9… 栋楼尾是路口
        roofs++;
        L.roof(x0, x1, h, { ...(turnIn ? { turnIn } : {}), ...(turnHere ? { turnOut: true } : {}) });
        turnIn = 0;
        if (segs.length > 1) {                                      // 屋顶上的障碍：离两头各留一段；路口前的转弯区不放
          let ox = x0 + 9;
          while (ox < x1 - (turnHere ? T.TURN_ZONE + 5 : 7)) {
            const r = R(), type = r < 0.35 ? 'low' : r < 0.55 ? 'high' : 'block';   // 跳和蹲都累腿：换道（键盘）的多放一些
            const all = type !== 'block' && R() < 0.3;
            let lanes = all ? [0, 1, 2] : [Math.floor(R() * 3)];
            if (type === 'block' && R() < 0.45) { const free = Math.floor(R() * 3); lanes = [0, 1, 2].filter(l => l !== free); }
            obs.push({ x: ox, len: type === 'block' ? 1.6 : 0.9, lanes, type, hit: false, leg: legs[legs.length - 1] });
            ox += (18 + R() * 12) * (1 - 0.4 * d);                     // 穿外骨骼的人 2–4 s 才能再来一次高抬腿
          }
        }
        x = x1;
        if (turnHere) {                                             // 路口：下一栋同高、从这里往左 / 右接着走（中间没有楼缝 / 斜板）
          const d = R() < 0.5 ? -1 : 1, prev = legs[legs.length - 1], C = atLeg(prev, x1, 0);
          legs.push({ s0: x1, dir: (prev.dir + d + 4) % 4, ox: C.x, oz: C.z });
          turns.push({ s: x1, d, from: prev, to: legs[legs.length - 1], done: false });
          turnIn = d;
          continue;
        }
        const r = R();
        if ((r < 0.3 && h < 9) || h < 2) {                          // 上坡：一块斜板搭到更高的楼
          segs.push({ kind: 'ramp', x0: x, x1: x + 9, h0: h, h1: h + 1.8, leg: legs[legs.length - 1] }); x += 9; h += 1.8;
        } else {                                                    // 楼缝：同高或跳下去
          const w = 2.4 + R() * (1.2 + 1.2 * d);
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

export const speedFor = (cadence, moving, T = TUNE) => moving && cadence > 0 ? Math.max(T.V_MIN, Math.min(T.V_MAX, cadence * T.CAD_V)) : 0;

// ---------- 一局 ----------
export function makeRun(level, T = TUNE) {
  const S = {
    x: 0, z: 0, lane: 1, y: level.ground(0), vy: 0, air: false, slideT: 0, speed: 0, lives: T.LIVES, invuln: 0,
    dist: 0, jfGap: T.JF_GAP0, jfV: 0, started: false, startT: 0, over: false, t: 0, landT: -9, fell: false, events: [],
    leg: level.legs[0], turnPend: 0,
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
  // inp = {v: 目标速度, jump, slide, lane: −1/0/+1, turn: −1 左 / +1 右 / 0}
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
    // 竖直
    const g = level.ground(S.x);
    if (inp.jump && !S.air) { S.vy = T.V0; S.air = true; S.slideT = 0; S.events.push('jump'); }
    if (inp.slide && S.air && S.vy > -8) S.vy = -12;                          // 空中下蹲 = 快速落地
    if (inp.slide && !S.air && S.slideT <= 0) { S.slideT = T.SLIDE_T; S.events.push('slide'); }
    if (inp.slide && S.slideT > 0) S.slideT = Math.max(S.slideT, 0.2);          // 蹲着不起来 = 一直滑
    S.slideT = Math.max(0, S.slideT - dt);
    if (!S.air) {
      if (g === null) { S.air = true; S.vy = 0; } else S.y = g;
    }
    if (S.air) {
      S.vy -= T.G * dt; const py = S.y; S.y += S.vy * dt;
      if (g !== null && S.y <= g && py >= g - 0.35) { S.y = g; S.air = false; S.vy = 0; S.landT = S.t; S.events.push('land'); }
      else if (g !== null && S.y < g - 0.35) { hit('wall'); S.y = g; S.air = false; S.vy = 0; }   // 撞到更高的楼沿：爬上去
      else if (g === null && S.vy < 0) {
        const s = level.seg(S.x);
        if (s && S.y < s.h0 - 3) {                                            // 掉下去了：扣一次，放到下一栋楼头上
          hit('fall');
          const nx = level.segs.find(q => q.x0 >= s.x1 && q.kind !== 'gap');
          if (nx) { S.x = nx.x0 + 0.5; S.y = nx.h0; S.air = false; S.vy = 0; S.landT = S.t; }
        }
      }
    }
    // 障碍
    const foot = S.y - (g ?? S.y);
    for (const o of level.obs) {
      if (o.hit || Math.abs(o.x - S.x) > o.len / 2 + 0.3) continue;
      if (!o.lanes.some(l => Math.abs(laneZ(l) - S.z) < 0.9)) continue;
      const bad = o.type === 'block' || (o.type === 'low' && foot < T.LOW_H) || (o.type === 'high' && S.slideT <= 0 && foot < 1.2);
      if (bad && S.invuln <= 0) { o.hit = true; hit(o.type); }
    }
    // 捷风：速度随距离涨；你比她快就拉开，慢就被追上
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
