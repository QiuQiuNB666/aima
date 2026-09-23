// 位置平滑（化身和影子共用）+ 影子登山者的合成步态（人走路的髋角曲线，全身动作和化身同一套 anim.js）。
import { synthHip } from './anim.js';
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
const GH_AMP = { stairs_up: 1.3, up: 1.1, down: 0.9, stairs_down: 1.0 };   // 合成步幅（相对平地）
export function makeGhost(avatar, hud) {
  const st = makeStepper(0.6);
  let g = 0, go = 0, rate = 0, visible = false, rel = '';   // g = 步态周期相位 0..1（一个周期 = 两步），go = 走动程度（起步 / 停下 0.3 s 过渡）
  const drv = { fl: 0, fr: 0, wl: 0, wr: 0, kind: 'flat', summit: false };
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
      go += ((moving ? 1 : 0) - go) * (1 - Math.exp(-dt / 0.3));
      rate = 1 / (2 * st.interval);
      g = (g + dt * rate * Math.min(1, go * 2)) % 1;
      return { s: st.last >= total ? total + 1.4 : s, rel };
    },
    // 每帧在 frame() 之后调（要路段 kind）；preview = 离线预览（frame() 不跑）：原地一直迈步
    pose(dt, now, kind, summit, preview) {
      if (preview) { go = 1; rate = 0.8; g = (g + dt * rate) % 1; }
      const a = (GH_AMP[kind] || 1) * go;
      const [l, wl] = synthHip(g, a, 8 * a), [rr, wr] = synthHip((g + 0.5) % 1, a, 8 * a);
      drv.fl = l; drv.fr = rr; drv.wl = wl * rate; drv.wr = wr * rate; drv.kind = kind; drv.summit = summit;
      avatar.animate(dt, now, drv);
    },
    get visible() { return visible; },
  };
}
