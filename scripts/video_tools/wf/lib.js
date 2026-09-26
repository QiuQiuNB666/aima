// 工作流拆解视频的场景框架：每个场景一个文件（s_*.js），往 SCENES 里注册；index.html?scene=<名>&id=<片段号> 加载。
// 约定：
//   SCENES.<名> = (root, D, ctx) => (t => { … })   —— 建好 DOM / SVG，返回 draw(t)：只根据 t（秒）改样式，不用 CSS 过渡、不用 setTimeout、不用随机数。
//   D = window.DATA（data.js，由 workflow_data.py 生成）；ctx = { id, beats, dur }：
//     beats = 这一段每句旁白的起点（秒），如 { sw11: 0.4, sw12: 6.1, … }，动画按旁白对拍；dur = 这一段总长。
//   字幕和顶部 running header 由框架画，场景不用管；场景内容别低于 y = 900（两行字幕的上沿约 910）。
// 录制：rec_seek.mjs 逐帧调 window.seek(t) 再截图。
window.SCENES = {};
const L = (() => {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };   // 三次缓入缓出
  const out = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };                                      // 三次缓出
  const ramp = (t, a, d = .6, f = out) => f(clamp((t - a) / d));                                           // 从 a 秒开始，d 秒内 0→1（自定义缓动也先夹到 0–1）
  const lerp = (a, b, p) => a + (b - a) * p;
  const el = (tag, cls, parent, css, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); if (html != null) e.innerHTML = html; (parent || document.getElementById('root')).appendChild(e); return e; };
  const NS = 'http://www.w3.org/2000/svg';
  const svgRoot = (parent, css) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', 1920); s.setAttribute('height', 1080); s.setAttribute('viewBox', '0 0 1920 1080'); Object.assign(s.style, { position: 'absolute', left: 0, top: 0 }, css || {}); (parent || document.getElementById('root')).appendChild(s); return s; };
  const svg = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  // 文字从下往上「擦出」（遮罩）：p 0→1
  const wipe = (e, p) => { e.style.clipPath = `inset(${(1 - p) * 100}% 0 0 0)`; e.style.transform = `translateY(${(1 - p) * 24}px)`; e.style.opacity = p > 0 ? 1 : 0; };
  // 从左往右擦出（线、条）
  const wipeX = (e, p) => { e.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; };
  // SVG 路径按长度画出来：p 0→1
  const draw = (path, p) => { const n = path.__len || (path.__len = path.getTotalLength()); path.style.strokeDasharray = n; path.style.strokeDashoffset = n * (1 - p); };
  // 数字滚动：fmt 默认千分位
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const count = (e, n, p, f = fmt) => { e.textContent = f(n * p); };
  const hm = ms => { const d = new Date(ms + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const hh = ms => { const d = new Date(ms + 8 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  // 章节标题（挂在 running header 下）：kicker 小字 + 大标题，返回 draw(t)
  const title = (root, text, opts = {}) => {
    const k = opts.kicker ? el('div', 'abs label', root, { left: '96px', top: (opts.top || 104) + 'px', color: 'var(--g1)' }, opts.kicker) : null;   // 朱红只给总指挥，kicker 用灰
    const h = el('div', 'abs ' + (opts.cls || 'h2'), root, { left: '96px', top: (opts.top || 104) + (k ? 40 : 0) + 'px', width: (opts.w || 1728) + 'px' }, text);
    return t => { if (k) wipe(k, ramp(t, (opts.at || 0), .5)); wipe(h, ramp(t, (opts.at || 0) + .12, .7)); };
  };
  return { clamp, ease, out, ramp, lerp, el, svgRoot, svg, wipe, wipeX, draw, fmt, count, hm, hh, title, NS };
})();

// ---------- 运行：字幕、running header、场景 ----------
window.addEventListener('DOMContentLoaded', () => {
  const Q = new URLSearchParams(location.search), name = Q.get('scene'), id = Q.get('id') || name;
  const D = window.DATA, root = document.getElementById('root');
  const seg = (D.segs || {})[id] || {};
  const ctx = { id, beats: seg.beats || {}, dur: seg.dur || +(Q.get('dur') || 20) };
  const run = L.el('div', 'run', root, null, `<span>工作流拆解${seg.chapter ? ' / ' + seg.chapter : ''}</span><span class="r">EvoTavern 深圳站　9/23 10:55 → 9/24 11:36</span>`);
  const drawScene = SCENES[name](root, D, ctx);
  const sub = L.el('div', 'sub', root); sub.style.display = 'none';
  // 字幕超过一行（约 36 字）就在靠近中间的标点处断成两行，没有标点就对半断
  const split = s => {
    if (s.length <= 36) return s;
    const mid = s.length / 2; let best = -1;
    for (let i = 8; i < s.length - 6; i++) if ('，。；：、？！'.includes(s[i]) && (best < 0 || Math.abs(i + 1 - mid) < Math.abs(best - mid))) best = i + 1;
    if (best < 0 || Math.abs(best - mid) > s.length * 0.22) best = Math.ceil(mid);
    return s.slice(0, best) + '\n' + s.slice(best);
  };
  const subs = (seg.subs || []).map(x => ({ ...x, text: split(x.text) }));
  window.seek = t => {
    drawScene(t);
    const s = subs.find(x => t >= x.t0 && t < x.t1);
    if (s) { sub.style.display = ''; sub.textContent = s.text; } else sub.style.display = 'none';
  };
  window.seek(+(Q.get('t') || 0));
});
