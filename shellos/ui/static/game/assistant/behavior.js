// J 线 · 助理的行为（第 5 轮起）：只读引擎给的 me.s（峰哥的连续步数）和 /state.terrain，不发任何请求，不碰腿上的力。
//   平时：跑在峰哥前面半步、右边（LAT −0.75：离跟拍镜头远的那侧，不进「镜头 → 峰哥」的视锥）；峰哥停，她也停（目标就是 me.s + 半步）。
//   地标：路线上换了名字的路段（不含红灯 / 等待段，那几个是第 6 轮的互动）快到时，她先跑到地标那里停下、举右手往前指 2.6 s，
//     气泡「前面就是 xx」；峰哥走过地标或者等了 3 s 就接着走。两次指路至少隔 10 s，新一圈重来。
//   互动（第 6 轮，触发规则和 E 线 snow_summit.js 的 zonesOf 一样，只看路线 + me.s + /state，不依赖主题代码）：
//     北坳吸氧 = 80% 之前第一个等待段，站定 0.3 s → 她站到峰哥右边、转身递氧气瓶（左手）；
//     排队 = 80% 以后最后一个等待段，红灯时她站到峰哥正前方半步、两臂微张挡着；绿灯那一下让到右边「到你了」；
//     登顶 = /state.terrain.laps 加一 → 6 s 内站到峰哥右边、举左手击掌。
//   台词（第 7 轮，key 见 lines.js）：起步 start；地标 mark（地名带「风」的念 wind）；进台阶 stairs、进下坡 down；普通红灯 red / rest 轮着说、
//     放行 green；排队 queue、轮到 go；北坳 oxygen；登顶 summit；连续走 45 s 没说话 pace / follow 轮着说；峰哥在路上停了 8 s 以上 wait（一次）。除了互动那几句，两句之间至少 6 s。
//   返回 { s（她的连续步数）, lat（横向）, face（转身，弧度，+ = 向左转向峰哥）, point（指路 0..1）, act: { oxygen, guard, five }（0..1）,
//     say（{key, text} 或 null）, dash }
export const ASSIST = { LEAD: 0.5, LAT: -0.75, VMAX: 5, POINT_S: 2.6, GAP_S: 10, AHEAD: 2.2 };

export function landmarks(route) {
  const g = route.segs;
  return g.filter((x, i) => i > 0 && x.kind !== 'wait' && x.steps >= 2 && x.label && x.label !== g[i - 1].label).map(x => ({ s: x.start, label: x.label }));
}

export function zones(route) {                             // 同 E 线 snow_summit.js zonesOf：按类型找，不写死步号
  const { segs, N } = route, waits = segs.filter(g => g.kind === 'wait');
  const col = waits.find(w => w.start < N * 0.8) || null;
  const queue = [...waits].reverse().find(w => w.start >= N * 0.8 && w !== col) || null;
  return { col, queue };
}

const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export function makeAssist(route) {
  const marks = landmarks(route), done = new Set(), Z = zones(route);
  let s = null, hold = null, lastSay = -99, lastLaps = null, lastPs = null, oxyT = 0, oxySaid = false, inQueue = false, summitT = -1;
  let started = false, stillT = 0, waitSaid = false, inQueueSaid = false, prevSeg = -1, prevWait = false, redN = 0, walkT = 0, paceN = 0, anySay = -99;
  const segAt = x => { const g = route.segs; let i = 0; while (i < g.length - 1 && x >= g[i].start + g[i].steps) i++; return i; };
  return {
    marks,
    step(t, dt, { T, me, preview }) {
      const ps = me.s;
      let say = null;
      if ((T && lastLaps !== null && T.laps !== lastLaps) || (lastPs !== null && ps < lastPs - 3)) { done.clear(); hold = null; started = false; prevSeg = -1; }   // 新一圈 / 按 R 复位
      const moved = lastPs !== null && ps > lastPs + 1e-4;
      if (T && lastLaps !== null && T.laps > lastLaps) { summitT = 0; say = { key: 'summit' }; }
      if (T) lastLaps = T.laps; lastPs = ps;
      let target = ps + ASSIST.LEAD, point = 0, lat = ASSIST.LAT, face = 0;
      const act = { oxygen: 0, guard: 0, five: 0 }, wait = !!T && T.segment === 'wait';
      if (summitT >= 0) {                                             // 登顶：站到峰哥右边，0.8 s 起举左手击掌
        summitT += dt;
        target = ps; lat = -0.45; face = 0.9; act.five = ramp(summitT, 0.6, 1.0) * (1 - ramp(summitT, 2.6, 3.0));
        if (summitT > 6) summitT = -1;
      }
      const atCol = !preview && Z.col && wait && ps > Z.col.start - 0.6 && ps < Z.col.start + 1;
      oxyT = atCol ? oxyT + dt : 0;
      if (oxyT > 0.3) {                                               // 北坳吸氧：站到右边、转身递氧气瓶
        target = ps + 0.12; lat = -0.3; face = 0.9; act.oxygen = ramp(oxyT, 0.3, 0.8);
        if (!oxySaid) { oxySaid = true; say = { key: 'oxygen' }; }
      } else if (!atCol) oxySaid = false;
      const atQ = !preview && Z.queue && ps > Z.queue.start - 0.6 && ps < Z.queue.start + 1.2;
      if (atQ && wait) {                                              // 排队：站到正前方半步挡着
        inQueue = true; target = ps + 0.75; lat = 0.25; act.guard = 1;
      } else if (inQueue) { inQueue = false; say = { key: 'go' }; }
      if (atQ && wait && !inQueueSaid) { inQueueSaid = true; say = say || { key: 'queue' }; } else if (!atQ) inQueueSaid = false;
      // 普通台词：起步 / 进台阶 / 进下坡 / 普通红灯 / 放行 / 走久了（互动那几句优先，两句至少隔 6 s）
      const si = segAt(ps), g = route.segs[si], free = !preview && !say && summitT < 0 && t - anySay > 6;
      if (!started && moved) { started = true; if (free) say = { key: 'start' }; }
      else if (free && si !== prevSeg && prevSeg >= 0 && g && !atCol && !atQ) {
        if (g.kind === 'stairs_up') say = { key: 'stairs' };
        else if (g.kind === 'down' || g.kind === 'stairs_down') say = { key: 'down' };
      }
      if (!say && free && wait && !prevWait && !atCol && !atQ) say = { key: redN++ % 2 ? 'rest' : 'red' };
      if (!say && !preview && !wait && prevWait && !inQueue && summitT < 0) say = { key: 'green' };
      walkT = moved && !wait ? walkT + dt : 0;
      stillT = !moved && started && !wait && summitT < 0 ? stillT + dt : 0;          // 峰哥在路上站着不走（不是红灯）
      if (!say && free && stillT > 8 && !waitSaid) { waitSaid = true; say = { key: 'wait' }; } else if (moved) waitSaid = false;
      if (!say && free && walkT > 45) { say = { key: paceN++ % 2 ? 'follow' : 'pace' }; walkT = 0; }
      prevSeg = si; prevWait = wait;
      if (!preview && !hold && !say && !wait && summitT < 0 && t - lastSay > ASSIST.GAP_S) {
        const m = marks.find(x => !done.has(x.s) && ps > x.s - ASSIST.AHEAD - 1 && ps < x.s - 0.5);
        if (m) { hold = { ...m, t0: t }; done.add(m.s); lastSay = t; say = /风/.test(m.label) ? { key: 'wind', text: `${m.label}到了，风大，拉好拉链。` } : { key: 'mark', text: `前面就是${m.label}` }; }
      }
      if (hold && (wait || summitT >= 0)) hold = null;
      if (hold) {
        const el = t - hold.t0;
        target = Math.max(target, hold.s + 0.4);
        point = Math.min(1, el / 0.4) * (el < ASSIST.POINT_S ? 1 : Math.max(0, 1 - (el - ASSIST.POINT_S) / 0.4));
        if (ps > hold.s - 0.2 || el > ASSIST.POINT_S + 3) hold = null;
      }
      // 影子（上一位）也走右路沿（珠峰在 −0.85）：离她 1.5 步以内时，她往路中间让到 −0.15（还是在峰哥右前方，不进镜头视锥）
      if (lat === ASSIST.LAT && T && T.ghost_pos != null && s !== null && Math.abs(T.ghost_pos - s) < 1.5) lat = -0.15;
      if (s === null || target < s - 2 || target > s + 3) s = target;   // 开场 / 复位 / 落下太远：直接到位，不倒着跑、不长距离追
      else s += Math.sign(target - s) * Math.min(Math.abs(target - s), dt * ASSIST.VMAX);
      if (say) anySay = t;
      return { s, lat, face, point, act, say, dash: 0 };
    },
  };
}
