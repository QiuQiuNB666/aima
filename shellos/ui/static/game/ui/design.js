// D 线 · 操作台（index.html）和选山页（worlds.html）共用的设计系统：变量、面板、按钮、kbd、大数字、状态点、迷你曲线。
//   颜色全部从 /game/style.js 来（路段色 SEG、强调紫 UI.acc、人物色 WHO），这里不再定义第二套。
//   为什么是 .js 不是 .css：server.py 的静态白名单只放行 /game/ /vendor/ /models/（所以放在 game/ui/ 下，不是 static/ui/），且没有 .css 的 MIME（会按 octet-stream 发，Chrome 拒绝当样式表），
//   而且游戏页的 hud_*.js 也是同样的「模块里注入 <style>」写法——三块屏一个办法。
import { SEG, UI, WHO, MOTION, applyCssVars } from '../style.js';
export { SEG, UI, WHO, MOTION };

// 蜂群角色色：五个角色两两分得开，且不撞路段色（绿 = 上坡、黄 = 台阶、蓝 = 下坡、红 = 红灯）。峰哥 = 琥珀（全作品唯一）
export const ROLE = { '峰哥': WHO.fengge.tag, '教练': '#5fd3ff', '地形导演': UI.acc, '记忆员': '#f29cc0', '安全员': '#ff6b57' };
// 裁决标签色：生效 / 同意 = 绿、否决 = 红、裁剪 = 橙、提议 / 解说 = 中性
export const VERDICT = { '解说': UI.dim, '否决': UI.danger, '裁剪': UI.warn, '生效': UI.ok, '同意': UI.ok, '提议': UI.acc };
export const KIND = { flat: '平地', up: '上坡', down: '下坡', stairs_up: '上台阶', stairs_down: '下台阶', wait: '红灯停' };

export const CSS = `
:root{--bg:#070911;--panel:#0b0d14;--panel2:#10141d;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.18);
  --fg:#e8ecf3;--dim:#98a3b3;--mute:#5c6875;--acc:${UI.acc};--acc-dim:rgba(180,140,255,.16);--ok:${UI.ok};--warn:${UI.warn};--bad:${UI.danger};
  --font:${UI.font};--mono:"SF Mono",Menlo,Consolas,"PingFang SC",monospace;--r:.8rem;--r2:.5rem;--gap:.7rem;
  --seg-flat:${SEG.flat};--seg-up:${SEG.up};--seg-down:${SEG.down};--seg-stairs:${SEG.stairs_up};--seg-wait:${SEG.wait};--who-fengge:${WHO.fengge.tag};--who-ghost:${WHO.ghost.tag}}
html{font-size:clamp(12px,1.04vw,44px)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font);line-height:1.4;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:.35rem;height:.35rem}::-webkit-scrollbar-thumb{background:var(--line2);border-radius:1rem}
/* 面板：深底 + 1px 细线，不用 backdrop-filter（美术范式 §7） */
.dp{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:.7rem .9rem;display:flex;flex-direction:column;min-height:0;min-width:0;position:relative}
.dp>.pt{display:flex;align-items:center;gap:.5rem;font-size:.85rem;font-weight:800;letter-spacing:.14em;color:var(--dim);text-transform:uppercase;margin:0 0 .5rem;flex:none}
.dp>.pt .x{margin-left:auto;font-weight:600;letter-spacing:0;text-transform:none;color:var(--mute);font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp>.pt .x.ok{color:var(--ok)}.dp>.pt .x.bad{color:var(--bad)}.dp>.pt .x.warn{color:var(--warn)}
.dp.acc{border-color:rgba(180,140,255,.45)}
.dp.hot{border-color:var(--seg-stairs);box-shadow:0 0 0 1px rgba(255,213,79,.25) inset}
/* 空态 / 错误态：面板里一块居中的说明 */
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem;color:var(--mute);text-align:center;font-size:1rem;padding:1rem}
.empty b{color:var(--dim);font-size:1.15rem;font-weight:800}
.empty.bad b{color:var(--bad)}.empty.warn b{color:var(--warn)}
/* 数字：等宽 tabular，紧字距 */
.num{font-variant-numeric:tabular-nums;font-weight:900;letter-spacing:-.02em;line-height:1}
.num small{font-size:.4em;font-weight:700;color:var(--dim);letter-spacing:0;margin-left:.15em}
/* 状态点 */
.dot{display:inline-flex;align-items:center;gap:.45rem;font-size:.95rem;font-weight:700;white-space:nowrap;color:var(--dim)}
.dot i{width:.6rem;height:.6rem;border-radius:50%;background:var(--mute);flex:none;transition:background .3s,box-shadow .3s}
.dot.ok i{background:var(--ok);box-shadow:0 0 .5rem var(--ok)}.dot.warn i{background:var(--warn);box-shadow:0 0 .5rem var(--warn)}.dot.bad i{background:var(--bad);box-shadow:0 0 .5rem var(--bad)}
.dot.ok,.dot.warn,.dot.bad{color:var(--fg)}
@keyframes dpulse{50%{opacity:.35}}
.dot.bad i{animation:dpulse 1s ease-in-out infinite}   /* 1 Hz ≤ 2 Hz 上限 */
/* kbd 胶囊 */
kbd,.kbd{display:inline-block;font:inherit;font-size:.8em;font-weight:800;line-height:1.35;padding:0 .45em;border-radius:.35em;border:1px solid var(--line2);background:rgba(255,255,255,.06);color:var(--fg);vertical-align:.1em;white-space:nowrap}
kbd.acc,.kbd.acc{background:var(--acc);border-color:var(--acc);color:#000}
/* 按钮 */
.btn,button{font:inherit;font-weight:800;border:1px solid var(--line2);border-radius:var(--r2);padding:.5rem .9rem;background:var(--panel2);color:var(--fg);cursor:pointer;transition:background ${MOTION.fast}s,border-color ${MOTION.fast}s,transform ${MOTION.fast}s,box-shadow ${MOTION.fast}s;user-select:none;-webkit-user-select:none}
button:hover{border-color:rgba(255,255,255,.3)}button:active{transform:translateY(1px)}
button:disabled{opacity:.45;cursor:default}
button .k{float:right;margin-left:.5rem;font-size:.75em;font-weight:800;padding:0 .4em;border-radius:.3em;border:1px solid currentColor;opacity:.75;line-height:1.5}
.btn-acc{background:var(--acc);border-color:var(--acc);color:#000}
.btn-ok{background:rgba(61,220,132,.12);border-color:rgba(61,220,132,.5);color:var(--ok)}
.btn-warn{background:rgba(255,159,26,.14);border-color:rgba(255,159,26,.6);color:var(--warn)}
.btn-danger{background:#e5202c;border-color:#ff5560;color:#fff}
.btn-ghost{background:transparent}
/* 输入框 */
input,select,textarea{font:inherit;background:var(--panel2);color:var(--fg);border:1px solid var(--line2);border-radius:var(--r2);padding:.5rem .7rem;min-width:0}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 .15rem var(--acc-dim)}
input::placeholder{color:var(--mute)}
input[type=range]{-webkit-appearance:none;appearance:none;height:.3rem;background:var(--line2);border:0;padding:0;border-radius:1rem}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:1rem;height:1rem;border-radius:50%;background:var(--acc);border:2px solid #000;box-shadow:0 0 0 1px var(--acc)}
/* 路段标签 */
.chip{display:inline-block;font-size:.8rem;font-weight:800;padding:.05rem .5rem;border-radius:.35rem;color:#000;vertical-align:middle;letter-spacing:.02em;background:var(--seg-flat)}
.chip.up{background:var(--seg-up)}.chip.down{background:var(--seg-down)}.chip.stairs_up,.chip.stairs_down{background:var(--seg-stairs)}.chip.wait{background:var(--seg-wait)}.chip.flat{background:var(--seg-flat)}
/* 图例小方块 */
.lg{font-size:.8rem;color:var(--dim)}.lg i{display:inline-block;width:.6rem;height:.6rem;border-radius:.15rem;margin:0 .3rem 0 .6rem;vertical-align:-.02rem}
/* 角色标（蜂群时间线） */
.role{display:inline-block;font-size:.8rem;font-weight:800;padding:0 .45rem;border-radius:.3rem;color:#000;letter-spacing:.04em;white-space:nowrap}
.vd{display:inline-block;font-size:.72rem;font-weight:800;padding:0 .35rem;border-radius:.25rem;border:1px solid currentColor;margin:0 .35rem;line-height:1.5;vertical-align:.05em}
/* 时间线：左侧竖线 + 角色色点 */
.tl{display:flex;flex-direction:column;gap:0;overflow:auto;min-height:0;flex:1;scrollbar-gutter:stable}
.tl>div{position:relative;padding:.3rem 0 .3rem 1.2rem;font-size:.95rem;line-height:1.4;border-left:1px solid var(--line)}
.tl>div::before{content:"";position:absolute;left:-.28rem;top:.62rem;width:.5rem;height:.5rem;border-radius:50%;background:var(--c,var(--mute));box-shadow:0 0 0 .15rem var(--panel)}
.tl>div .t{color:var(--mute);font-size:.75rem;font-variant-numeric:tabular-nums;margin-right:.4rem}
.tl>div:first-child{animation:tlin ${MOTION.base}s ease-out}
@keyframes tlin{0%{opacity:0;transform:translateY(-.3rem)}100%{opacity:1;transform:none}}
/* 迷你曲线画布 */
canvas.spark{display:block;width:100%;height:100%}
`;

let injected = false;
export function inject() {
  if (injected) return; injected = true;
  applyCssVars();
  const st = document.createElement('style'); st.id = 'dsys'; st.textContent = CSS;
  document.head.prepend(st);          // 放最前：页面自己的 <style> 可以覆盖
}

// 画布尺寸跟 CSS 尺寸走（DPR 感知），返回 [ctx, w, h]；尺寸没变就不重设（重设会清空且慢）
export function fit(cv) {
  const r = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
  const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  return [g, w, h];
}

// 迷你曲线：一条线 + 淡填充 + 末端点。lo/hi 不给就自适应（留 10% 边）
export function spark(cv, arr, { color = UI.acc, lo, hi, base } = {}) {
  const [g, w, h] = fit(cv); if (!w || arr.length < 2) return;
  let mn = lo, mx = hi;
  if (mn == null || mx == null) { mn = Infinity; mx = -Infinity; for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; } const pad = (mx - mn || 1) * 0.15; mn -= pad; mx += pad; }
  const X = i => i / (arr.length - 1) * w, Y = v => h - 2 - (Math.max(mn, Math.min(mx, v)) - mn) / (mx - mn) * (h - 4);
  if (base != null && base >= mn && base <= mx) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, Math.round(Y(base)), w, 1); }
  g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fill();
  g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  const v = arr[arr.length - 1]; g.fillStyle = color; g.beginPath(); g.arc(w - 1, Y(v), 3, 0, 7); g.fill();
}

// 腿上的力：和游戏 HUD hud_force 同一种画法——最近 win 秒的力矩波形，颜色 = 出力那一刻的路段，每 1 Nm 一条刻度线，0 线最亮
export function lane(cv, hist, { cap = 3, win = 6, now }) {
  const [g, w, h] = fit(cv); if (!w) return;
  const fs = Math.max(10, Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75));
  const y0 = h / 2, sy = (h / 2 - 4) / cap, X = t => w - (now - t) / win * w, Y = v => y0 - Math.max(-cap, Math.min(cap, v)) * sy;
  g.font = `700 ${fs}px ${UI.font}`; g.textBaseline = 'middle';
  for (let n = -Math.floor(cap); n <= cap; n++) { g.fillStyle = n ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.3)'; g.fillRect(0, Math.round(Y(n)), w, 1); }
  g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText(`+${cap}`, 4, Y(cap) + fs * 0.5); g.fillText(`−${cap}`, 4, Y(-cap) - fs * 0.5);
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1], b = hist[i], xa = X(a.t), xb = X(b.t); if (xb < 0) continue;
    g.fillStyle = b.c + '40'; g.beginPath(); g.moveTo(xa, y0); g.lineTo(xa, Y(a.v)); g.lineTo(xb, Y(b.v)); g.lineTo(xb, y0); g.fill();
    g.strokeStyle = b.c; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath(); g.moveTo(xa, Y(a.v)); g.lineTo(xb, Y(b.v)); g.stroke();
  }
  if (hist.length) { const b = hist[hist.length - 1]; g.fillStyle = b.c; g.beginPath(); g.arc(X(b.t), Y(b.v), 4, 0, 7); g.fill(); }
}

export const fmtTime = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
