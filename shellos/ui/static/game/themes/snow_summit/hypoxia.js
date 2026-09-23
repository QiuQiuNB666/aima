// 缺氧：海拔越高，画面四周越暗、越糊，随呼吸轻轻一明一暗（只改透明度，画面本身不动、不缩放，不晕）。
//   用两层 DOM 盖在 <canvas> 上、HUD 下面（插在 canvas 后面，HUD 面板不受影响）：
//   糊 = backdrop-filter 模糊 + 径向遮罩（中间清楚）；暗 = 径向渐变。?fx=low 不要模糊层。和 WebGL 后期互不相干。
//   模糊层按整屏算，叠在光影线的后期上不便宜（旧 Mac 无头实测 10 → 14.5 fps）：缺氧不到 0.3（约 6700 m 以下，北坳冰壁中段）不开；
//   页面连续 3 s 低于 40 fps 就把模糊层整个拿掉（暗角和呼吸照旧）。
export function makeHypoxia({ blur = true } = {}) {
  const cv = document.getElementById('c');
  if (!cv) return { update() {} };
  const mk = css => { const d = document.createElement('div'); d.className = 'hypoxia'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;' + css; cv.insertAdjacentElement('afterend', d); return d; };
  const dark = mk('background:radial-gradient(ellipse 72% 68% at 50% 50%,rgba(4,6,16,0) 42%,rgba(4,6,16,.55) 78%,rgba(2,3,10,.92) 100%);');
  let soft = blur ? mk(['backdrop-filter:blur(3px) saturate(.8)', '-webkit-backdrop-filter:blur(3px) saturate(.8)', 'display:none',
    'mask-image:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 48%,#000 92%)', '-webkit-mask-image:radial-gradient(ellipse 70% 66% at 50% 50%,transparent 48%,#000 92%)'].join(';') + ';') : null;
  let lastD = -1, lastS = -1, ph = 0, lastT = null, on = false, nextCheck = 0, slow = 0;
  return {
    // k = 缺氧程度 0..1（入口按海拔算）；t = 秒
    update(k, t) {
      const period = 4.2 - 1.4 * k;                                   // 越高喘得越快：约 14 → 21 次/分
      if (lastT !== null) ph = (ph + Math.max(0, Math.min(0.1, t - lastT)) / period) % 1;   // 相位累加：周期随海拔变，不能拿绝对时间除（开久了会越喘越快）
      if (!nextCheck && t > 0) nextCheck = t + 6;                    // 从第一帧真画面起算 6 s（build 里那次 t = 0 不算）：开场在编译着色器、fps 本来就低
      lastT = t;
      const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
      const d = +(k * (0.8 + 0.2 * breath)).toFixed(3), s = +(k * (0.7 + 0.3 * breath)).toFixed(3);
      if (Math.abs(d - lastD) > 0.004) { dark.style.opacity = d; lastD = d; }
      if (!soft) return;
      if (nextCheck && t > nextCheck) {                               // 每秒看一眼引擎的 fps（window.__fps）
        nextCheck = t + 1; slow = window.__fps && window.__fps < 40 ? slow + 1 : 0;
        if (slow >= 3) { soft.remove(); soft = null; return; }
      }
      if (on !== k > 0.3) { on = k > 0.3; soft.style.display = on ? '' : 'none'; }
      if (on && Math.abs(s - lastS) > 0.004) { soft.style.opacity = s; lastS = s; }
    },
  };
}
