// 缺氧：海拔越高，画面四周越暗、越糊，随呼吸轻轻一明一暗（只改透明度，画面本身不动、不缩放，不晕）。
//   用两层 DOM 盖在 <canvas> 上、HUD 下面（插在 canvas 后面，HUD 面板不受影响）：
//   糊 = backdrop-filter 模糊 + 径向遮罩（中间清楚）；暗 = 径向渐变。?fx=low 不要模糊层。和 WebGL 后期互不相干。
export function makeHypoxia({ blur = true } = {}) {
  const cv = document.getElementById('c');
  if (!cv) return { update() {} };
  const mk = css => { const d = document.createElement('div'); d.className = 'hypoxia'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;' + css; cv.insertAdjacentElement('afterend', d); return d; };
  const dark = mk('background:radial-gradient(ellipse 72% 68% at 50% 50%,rgba(4,6,16,0) 42%,rgba(4,6,16,.55) 78%,rgba(2,3,10,.92) 100%);');
  const soft = blur ? mk(['backdrop-filter:blur(5px) saturate(.8)', '-webkit-backdrop-filter:blur(5px) saturate(.8)',
    'mask-image:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 48%,#000 92%)', '-webkit-mask-image:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 48%,#000 92%)'].join(';') + ';') : null;
  let lastD = -1, lastS = -1;
  return {
    // k = 缺氧程度 0..1（入口按海拔算）；t = 秒
    update(k, t) {
      const period = 4.2 - 1.4 * k;                                   // 越高喘得越快：约 14 → 21 次/分
      const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / period);
      const d = +(k * (0.8 + 0.2 * breath)).toFixed(3), s = +(k * (0.7 + 0.3 * breath)).toFixed(3);
      if (Math.abs(d - lastD) > 0.004) { dark.style.opacity = d; lastD = d; }
      if (soft && Math.abs(s - lastS) > 0.004) { soft.style.opacity = s; lastS = s; }
    },
  };
}
