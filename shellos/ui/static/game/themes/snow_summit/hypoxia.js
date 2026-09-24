// 缺氧：海拔越高，画面四周越暗（暗角）、颜色越淡（去饱和），暗角随心跳轻轻一跳一跳（只改透明度，画面本身不动、不缩放、不糊）。
//   暗角 = 一层 DOM 盖在 <canvas> 上、HUD 下面（插在 canvas 后面，HUD 面板不受影响）；去饱和 = canvas 自己的 CSS filter: saturate()
//   （合成器里一趟颜色矩阵，比原来的 backdrop-filter 模糊便宜得多；?fx=low 连这个也不要）。和 WebGL 后期互不相干。
//   心跳：节奏跟步频（o.cadence 步/分 → 心率约 = 步频 × 1.05，走得越快跳得越快），没给就固定 1.2 Hz，越高再快一点（上限 1.9 Hz，
//   美术范式：闪烁 ≤ 2 Hz）；波形是「咚-哒」两下（第二下轻），幅度只有暗角的 12%——是脉搏不是闪灯。
//   吸氧（o.oxy > 0.5，或入口写的 window.__fgMapLine.key === 'oxygen'）：立刻松一半，之后 20 s 慢慢回到应有的程度。
export function makeHypoxia({ blur = true } = {}) {
  const cv = document.getElementById('c');
  if (!cv) return { update() {} };
  const mk = css => { const d = document.createElement('div'); d.className = 'hypoxia'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;' + css; cv.insertAdjacentElement('afterend', d); return d; };
  const dark = mk('background:radial-gradient(ellipse 72% 68% at 50% 50%,rgba(4,6,16,0) 40%,rgba(4,6,16,.55) 76%,rgba(2,3,10,.92) 100%);');
  const desat = blur;                                                 // 沿用旧开关名：?fx=low 传 false
  let lastD = -1, lastS = -1, ph = 0, lastT = null, relief = 0, seenLine = 0;
  return {
    // k = 缺氧程度 0..1（入口按海拔算）；t = 秒；o（可选）= { cadence: 步/分, oxy: 0..1 正在吸氧 }
    update(k, t, o = {}) {
      const dt = lastT === null ? 0 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
      const line = typeof window !== 'undefined' && window.__fgMapLine;   // 入口弹「吸氧」台词那一帧 = 面罩戴上了
      let onO2 = (o.oxy || 0) > 0.5;
      if (line && line.key === 'oxygen' && line.t !== seenLine) { seenLine = line.t; onO2 = true; }
      relief = onO2 ? 20 : Math.max(0, relief - dt);                     // 吸氧后 20 s 内明显缓解，慢慢回来
      const eff = k * (1 - 0.5 * Math.min(1, relief / 6));              // 头 14 s 松一半，最后 6 s 线性回来
      const hz = Math.min(1.9, o.cadence > 40 ? o.cadence * 1.05 / 60 : 1.2 + 0.5 * k);
      ph = (ph + dt * hz) % 1;                                           // 相位累加：节奏变了不跳拍
      const beat = Math.pow(Math.max(0, Math.sin(ph * 6.283)), 6) + 0.45 * Math.pow(Math.max(0, Math.sin((ph - 0.32) * 6.283)), 8);   // 咚-哒
      const d = +(eff * (0.82 + 0.12 * beat)).toFixed(3);
      if (Math.abs(d - lastD) > 0.004) { dark.style.opacity = d; lastD = d; }
      if (!desat) return;
      const s = +(1 - 0.38 * eff).toFixed(2);                            // 8849 m：饱和度剩 62%
      if (s !== lastS) { cv.style.filter = s < 0.995 ? `saturate(${s})` : ''; lastS = s; }
    },
  };
}
