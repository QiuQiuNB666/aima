// J 线 · 助理的行为（第 5 轮起）：只读引擎给的 me.s（峰哥的连续步数）和 /state.terrain，不发任何请求，不碰腿上的力。
//   平时：跑在峰哥前面半步、右边（LAT −0.75：离跟拍镜头远的那侧，不进「镜头 → 峰哥」的视锥）；峰哥停，她也停（目标就是 me.s + 半步）。
//   地标：路线上换了名字的路段（不含红灯 / 等待段，那几个是第 6 轮的互动）快到时，她先跑到地标那里停下、举右手往前指 2.6 s，
//     气泡「前面就是 xx」；峰哥走过地标或者等了 3 s 就接着走。两次指路至少隔 10 s，新一圈重来。
//   返回 { s（她的连续步数）, lat（横向）, point（指路权重 0..1）, say（{key, text} 或 null）, dash }
export const ASSIST = { LEAD: 0.5, LAT: -0.75, VMAX: 5, POINT_S: 2.6, GAP_S: 10, AHEAD: 2.2 };

export function landmarks(route) {
  const g = route.segs;
  return g.filter((x, i) => i > 0 && x.kind !== 'wait' && x.steps >= 2 && x.label && x.label !== g[i - 1].label).map(x => ({ s: x.start, label: x.label }));
}

export function makeAssist(route) {
  const marks = landmarks(route), done = new Set();
  let s = null, hold = null, lastSay = -99, lastLaps = null, lastPs = null;
  return {
    marks,
    step(t, dt, { T, me, preview }) {
      const ps = me.s;
      if ((T && lastLaps !== null && T.laps !== lastLaps) || (lastPs !== null && ps < lastPs - 3)) { done.clear(); hold = null; }   // 新一圈 / 按 R 复位
      if (T) lastLaps = T.laps; lastPs = ps;
      let target = ps + ASSIST.LEAD, say = null, point = 0;
      if (!preview && !hold && t - lastSay > ASSIST.GAP_S) {
        const m = marks.find(x => !done.has(x.s) && ps > x.s - ASSIST.AHEAD - 1 && ps < x.s - 0.5);
        if (m) { hold = { ...m, t0: t }; done.add(m.s); lastSay = t; say = { key: 'mark', text: `前面就是${m.label}` }; }
      }
      if (hold) {
        const el = t - hold.t0;
        target = Math.max(target, hold.s + 0.4);
        point = Math.min(1, el / 0.4) * (el < ASSIST.POINT_S ? 1 : Math.max(0, 1 - (el - ASSIST.POINT_S) / 0.4));
        if (ps > hold.s - 0.2 || el > ASSIST.POINT_S + 3) hold = null;
      }
      if (s === null || target < s - 2) s = target;                   // 开场 / 复位：直接到位，不倒着跑
      else s += Math.sign(target - s) * Math.min(Math.abs(target - s), dt * ASSIST.VMAX);
      return { s, lat: ASSIST.LAT, point, say, dash: 0 };
    },
  };
}
