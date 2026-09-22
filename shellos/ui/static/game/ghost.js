// 位置平滑（化身和影子共用）+ 影子登山者的合成步态。
// /state 只给整数步（pos / ghost_pos，10 Hz）；这里把它变成连续的 s：
//   s 追 目标 = 最新整数步 + 这一步已走了多久 / 平均步长时间（<0.92），只进不退；后退（复位/登顶回起点）直接跳。

export function makeStepper(interval0 = 0.55) {
  let last = null, tChange = 0, interval = interval0, s = 0;
  return {
    get s() { return s; }, get last() { return last; }, get tChange() { return tChange; }, get interval() { return interval; },
    set(p, now, snap = false) {
      if (p == null) return;
      if (last === null || p < last || snap) { s = p; last = p; tChange = now; return; }
      if (p > last) {
        const dn = p - last, dt = now - tChange;
        if (dn <= 2 && dt > 0.15 && dt < 4) interval += (dt / dn - interval) * 0.4;   // 学的是「pos 实际多久涨一次」，不是步频：真机只接住约一半的步（A 线）
        last = p; tChange = now;
      }
    },
    // moving=false 时不往下一步蹭（红灯、站住）
    frame(dt, now, moving) {
      if (last === null) return s;
      const frac = moving ? Math.min(0.92, (now - tChange) / interval) : 0;
      const want = last + frac;
      if (want > s) s = Math.min(want, s + Math.min(dt * 5, Math.max(dt * 0.3, (want - s) * (1 - Math.exp(-dt * 7)))));   // 最快 5 步/秒
      return s;
    },
    jump(v) { s = v; },
  };
}

// 影子：位置 = ghost_pos 平滑；腿按自己的速度摆（录下来的只有每步时刻，没有髋角）
export function makeGhost(avatar, hud) {
  const st = makeStepper(0.6);
  let phase = 0, visible = false, rel = '';
  avatar.group.visible = false;
  return {
    stepper: st,
    onState(T, now) {
      visible = !!(T && T.ghost_pos != null);    // 必须是布尔：three.js 只在 visible === false 时跳过渲染
      avatar.group.visible = visible;
      if (!visible) return;
      st.set(Math.min(T.ghost_pos, T.total), now);
      const d = T.ghost_pos - T.pos;
      rel = d > 0 ? `领先 ${d} 步` : d < 0 ? `落后 ${-d} 步` : '并排';
    },
    frame(dt, now, total) {
      if (!visible) return null;
      const moving = st.last < total && now - st.tChange < st.interval * 2.2;
      const s = st.frame(dt, now, moving);
      if (moving) phase += dt * Math.PI / st.interval;
      const amp = moving ? 24 : 0;
      avatar.pose(amp * Math.sin(phase), amp * Math.sin(phase + Math.PI));
      return { s: st.last >= total ? total + 1.4 : s, rel };
    },
    get visible() { return visible; },
  };
}
