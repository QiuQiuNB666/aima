// U 线 · AI 决策卡 + 造山过场（只读 /state.swarm）。
// 卡：蜂群出了新的一轮（教练 → 记忆员 → 安全员 → 生效），大屏右下弹一张卡，一行一个角色按顺序亮出来，停 HOLD 秒；裁剪橙、否决红。
// 造山：看到地形导演「在造…」→ 全屏过场「AI 正在造山…」（大模型可能想 20–90 s，显示已等秒数）。
//   ShellOS 切世界后引擎会 location.reload()：新页面靠 sessionStorage 标记（或 swarm 里 25 s 内的「已切到」）接着演——
//   路线剖面逐段画出来 + 安全员的裁剪，再淡出进新世界。game.html 头部的小脚本在模块加载前就把遮罩挂上，重载不闪。
// 峰哥那一条不上卡（左上头像气泡管）。只读，不调任何接口。
import { RISE, KIND_NAME } from './path.js';
import { SEG } from './hud_force.js';

const STAGGER = 650, HOLD = 4500, FORGE_MAX = 100e3, FLAG = 'u_forge';
const WHO = { '教练': '#7fd1ff', '记忆员': '#ffd54f', '安全员': '#9ff0b8', '地形导演': '#d9b8ff' };
const VC = { '提议': '#7fd1ff', '同意': '#b6c2cf', '裁剪': '#ff9f1a', '否决': '#ff4d4f', '生效': '#3ddc84' };
const PN = { strength: '强度' };
const CSS = `
#aicard{right:1.4rem;bottom:1.4rem;width:min(40rem,46vw);opacity:0;transform:translateY(1.5rem);transition:opacity .4s,transform .4s;border-color:rgba(217,184,255,.45)}
#aicard.show{opacity:1;transform:none}
body.summit #aicard{opacity:0}
#aicard .ah{display:flex;align-items:baseline;gap:.6rem;font-size:1rem;font-weight:800;letter-spacing:.15em;color:#d9b8ff}
#aicard .ah small{margin-left:auto;letter-spacing:0;font-weight:600;color:var(--dim);font-size:.85rem}
#aicard .aq{font-size:2rem;font-weight:900;margin:.15rem 0 .4rem;line-height:1.2}
.airow{display:grid;grid-template-columns:5.2rem 3.4rem 1fr;align-items:center;gap:.5rem;padding:.35rem .5rem;border-radius:.5rem;font-size:1.3rem;line-height:1.3;
  opacity:0;transform:translateX(1.2rem);transition:opacity .35s,transform .35s}
.airow.on{opacity:1;transform:none}
.airow .w{font-weight:900;white-space:nowrap}
.airow .v{font-size:1rem;font-weight:900;text-align:center;padding:.1rem 0;border-radius:.35rem;color:#000}
.airow .m{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.airow.hot{background:rgba(255,159,26,.16);box-shadow:inset .3rem 0 0 #ff9f1a}
.airow.hot .m{color:#ffc46b;font-weight:800}
.airow.no{background:rgba(255,77,79,.18);box-shadow:inset .3rem 0 0 #ff4d4f}
.airow.no .m{color:#ff8a8b;font-weight:800}
.airow.hot.on,.airow.no.on{animation:aiShake .5s .3s}
.airow.ok .m{color:#8ff0b4;font-weight:800}
@keyframes aiShake{20%{transform:translateX(-.35rem)}40%{transform:translateX(.35rem)}60%{transform:translateX(-.2rem)}80%{transform:translateX(.1rem)}}
#forge .fx{width:min(80rem,92vw);display:flex;flex-direction:column;align-items:center;gap:1rem}
#forge .ft{font-size:4rem;font-weight:900;letter-spacing:.12em}
#forge .ft .dots::after{content:"";animation:fxDots 1.2s steps(4) infinite}
@keyframes fxDots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
#forge .fq{font-size:2rem;color:var(--dim);text-align:center}
#forge .fq b{color:#fff}
#forge canvas{width:100%;height:32vh;display:block}
#forge .rows{width:min(56rem,92vw)}
#forge .fs{font-size:1.4rem;color:var(--dim);font-variant-numeric:tabular-nums}`;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 「太陡了」→ 提议 {'strength': -0.5}（规则表：…） → 提议 强度 −0.5（规则表：…）；引号里的评委原话放卡头，这里去掉
export function pretty(msg) {
  return String(msg || '').replace(/^「[^」]*」\s*(→|——)\s*/, '').replace(/（规则表：[^）]*）/, '（规则表）').replace(/\bstrength\b(?=\s*想到)/g, '强度').replace(/#\[([\d, ]+)\]/g, (_, n) => n.split(/,\s*/).map(x => '#' + x).join(' '))
    .replace(/(现在 )?\{([^{}]*)\}/g, (_, now, s) => (now || '') + s.split(',').map(p => {   // 「现在 {…}」是绝对值，其余是差值
      const m = p.match(/['"]?(\w+)['"]?\s*:\s*(-?[\d.]+)/); if (!m) return p.trim();
      const v = +m[2]; return `${PN[m[1]] || m[1]} ${now ? v.toFixed(1) : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`}`;
    }).join('，'));
}
const quoteOf = rows => { for (const e of rows) { const m = /^「([^」]+)」/.exec(e.msg || ''); if (m) return m[1]; } return ''; };
const keyOf = e => `${e.t}|${e.who}|${e.verdict}|${e.msg}`;
const clock = t => { const [h, m, s] = String(t).split(':').map(Number); const d = new Date(); d.setHours(h, m, s, 0); return d.getTime(); };
function rowEl(e) {
  const d = document.createElement('div');
  d.className = 'airow' + (e.verdict === '裁剪' ? ' hot' : e.verdict === '否决' ? ' no' : e.verdict === '生效' ? ' ok' : '');
  d.innerHTML = `<span class="w" style="color:${WHO[e.who] || '#fff'}">${esc(e.who)}</span><span class="v" style="background:${VC[e.verdict] || '#888'}">${esc(e.verdict || '·')}</span><span class="m">${esc(pretty(e.msg))}</span>`;
  return d;
}
const readFlag = () => { try { const f = JSON.parse(sessionStorage.getItem(FLAG) || 'null'); return f && Date.now() - f.t < 150e3 ? f : null; } catch (e) { return null; } };
const setFlag = f => { try { f ? sessionStorage.setItem(FLAG, JSON.stringify(f)) : sessionStorage.removeItem(FLAG); } catch (e) { /* 隐身窗口：没有重载接力，照样演前半段 */ } };

export function makeAi(world) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const card = document.createElement('div'); card.className = 'hud panel'; card.id = 'aicard';
  card.innerHTML = '<div class="ah">AI 蜂群 · 四个角色商量<small>大模型只出主意，安全员说了算</small></div><div class="aq"></div><div class="rows"></div>';
  document.body.append(card);
  const fg = document.getElementById('forge');
  fg.innerHTML = '<div class="fx"><div class="ft"></div><div class="fq"></div><canvas></canvas><div class="rows"></div><div class="fs"></div></div>';
  const $f = s => fg.querySelector(s);
  let prev = null, revealT = 0, hideT = 0;
  let forge = null;   // {q, t0, rows:[], phase:'wait'|'reveal', w?, r0?}

  // ---------- 决策卡 ----------
  function reveal() {                          // 一行一行亮：rows 里还没 .on 的，隔 STAGGER 亮一个
    clearTimeout(revealT);
    const r = card.querySelector('.airow:not(.on)');
    if (r) { r.classList.add('on'); revealT = setTimeout(reveal, STAGGER); return; }
    clearTimeout(hideT); hideT = setTimeout(() => card.classList.remove('show'), HOLD);
  }
  function showCard(rows) {
    const box = card.querySelector('.rows');
    if (!card.classList.contains('show')) { box.innerHTML = ''; card.querySelector('.aq').textContent = ''; }
    const q = quoteOf(rows); if (q) card.querySelector('.aq').textContent = `评委说「${q}」`;
    card.querySelector('.aq').style.display = card.querySelector('.aq').textContent ? '' : 'none';
    for (const e of rows) box.append(rowEl(e));
    while (box.children.length > 6) box.firstChild.remove();
    card.classList.add('show'); clearTimeout(hideT); reveal();
  }

  // ---------- 造山 ----------
  function forgeOn(q, t0) {
    forge = { q, t0, rows: [], phase: 'wait' };
    setFlag({ q, t: t0 });
    document.documentElement.classList.add('u-forging');
    $f('.ft').innerHTML = 'AI 正在造山<span class="dots"></span>';
    $f('.fq').innerHTML = q ? `评委说：<b>「${esc(q)}」</b>` : '';
    $f('.rows').innerHTML = '';
  }
  function forgeRows(rows) { for (const e of rows) { const r = rowEl(e); $f('.rows').append(r); requestAnimationFrame(() => r.classList.add('on')); } }
  function forgeOff() {
    forge = null; setFlag(null);
    fg.style.opacity = '0';
    setTimeout(() => { document.documentElement.classList.remove('u-forging'); fg.style.opacity = ''; }, 800);
  }
  function forgeReveal(rows) {                 // 世界已经是新山：画剖面 + 亮安全员那几行
    forge.phase = 'reveal'; forge.r0 = performance.now();
    $f('.ft').innerHTML = `AI 造好了：「${esc(world.name)}」`;
    $f('.rows').innerHTML = ''; forgeRows(rows.filter(e => e.who === '安全员' || /造好/.test(e.msg)));
  }
  function drawProfile(now) {
    const cv = $f('canvas'), w = cv.clientWidth, h = cv.clientHeight, r = devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
    const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#29e7ff';
    if (forge.phase === 'wait') {              // 大模型在想：一条扫描线来回扫一段起伏的草稿线
      const t = now / 1000;
      g.strokeStyle = acc; g.globalAlpha = 0.35; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = h * 0.62 - (x / w) * h * 0.3 + Math.sin(x / 70 + t * 1.3) * h * 0.06 + Math.sin(x / 23 - t * 2.1) * h * 0.025; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
      const sx = (t * 0.45 % 1) * w; g.fillStyle = acc; g.globalAlpha = 0.18; g.fillRect(sx - 30, 0, 60, h); g.globalAlpha = 1;
      $f('.fs').textContent = `地形导演出草稿 → 安全员裁剪 → 马上能爬 · 已等 ${Math.round((Date.now() - forge.t0) / 1000)} s`;
      return;
    }
    const R = world.route || [], hs = [], ks = [], ls = [];
    let y = 0; for (const s of R) for (let k = 0; k < s.steps; k++) { hs.push(y); ks.push(s.kind); ls.push(s.label); y += RISE[s.kind] || 0; }
    const n = hs.length || 1, lo = Math.min(0, ...hs), hi = Math.max(lo + 0.5, ...hs), bw = w / (n + 1);
    const X = i => i * bw, Y = v => h - 40 - (v - lo) / (hi - lo) * (h - 90);
    const p = Math.min(1, (now - forge.r0) / 2800), m = Math.floor(p * n);
    for (let i = 0; i < m; i++) {
      const c = SEG[ks[i]] || acc;
      g.fillStyle = c + '55'; g.fillRect(X(i), Y(hs[i]), bw + 0.5, h - 30 - Y(hs[i]));
      g.fillStyle = c; g.fillRect(X(i), Y(hs[i]) - 3, bw + 0.5, 5); g.fillRect(X(i) + 1, h - 22, bw - 2, 12);
    }
    g.font = `800 ${Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.05)}px -apple-system,"PingFang SC",sans-serif`;
    g.fillStyle = '#fff'; let lastX = -1e9;
    for (let i = 0; i < m; i++) if (!i || ls[i] !== ls[i - 1]) {
      let j = i; while (j < n && ls[j] === ls[i]) j++;
      if (j <= m && X(i) - lastX > 120) { g.fillText(`${ls[i]}`, X(i) + 4, Math.max(24, Y(Math.max(...hs.slice(i, j))) - 16)); lastX = X(i); }
    }
    if (p >= 1) { const fx = X(n), fy = Y(hs[n - 1] || 0); g.fillStyle = '#fff'; g.fillRect(fx, fy - 46, 3, 46); g.fillStyle = acc; g.beginPath(); g.moveTo(fx + 3, fy - 46); g.lineTo(fx + 30, fy - 37); g.lineTo(fx + 3, fy - 28); g.fill(); }
    const segs = R.map(s => `${KIND_NAME[s.kind] || s.kind} ${s.steps}`).join(' · ');
    $f('.fs').textContent = `${n} 步 · ${segs}`;
    if (p >= 1 && now - forge.r0 > 5200 && document.body.dataset.ready) forgeOff();
  }
  (function loop(now) { requestAnimationFrame(loop); if (forge) { drawProfile(now); if (Date.now() - forge.t0 > FORGE_MAX) forgeOff(); } })(performance.now());

  return {
    update(S) {
      const sw = S.swarm || [], keys = sw.map(keyOf);
      if (prev === null) {                     // 第一次：旧的不重播；但刚造完山、引擎重载过来的，接着演剖面
        prev = keys;
        const f = readFlag(), i = sw.map(e => e.who === '地形导演' && /^已切到/.test(e.msg)).lastIndexOf(true);
        const recent = i >= 0 && sw[i].msg.includes(`「${world.name}」`) && Math.abs(Date.now() - clock(sw[i].t)) < 25e3;
        if (f || recent) {
          let a = i; while (a > 0 && !(sw[a].who === '地形导演' && /在造/.test(sw[a].msg))) a--;
          const round = i >= 0 ? sw.slice(Math.max(0, a), i + 1).filter(e => e.who !== '峰哥') : [];
          forgeOn(f ? f.q : quoteOf(round), f ? f.t : Date.now());
          if (recent) forgeReveal(round);
        }
        return;
      }
      const j = prev.length ? keys.lastIndexOf(prev[prev.length - 1]) : -1;
      const fresh = (j >= 0 ? sw.slice(j + 1) : sw.slice(-8)).filter(e => e.who !== '峰哥');
      prev = keys;
      if (!fresh.length) return;
      const start = fresh.find(e => e.who === '地形导演' && /在造/.test(e.msg));
      if (start) forgeOn(quoteOf([start]), Date.now());
      if (forge && forge.phase === 'wait') {   // 造山中：这几行进全屏过场，不弹卡
        forgeRows(fresh.filter(e => e !== start));
        const done = fresh.find(e => e.who === '地形导演' && /^已切到/.test(e.msg));
        if (done && done.msg.includes(`「${world.name}」`)) forgeReveal(fresh);   // 没换世界（同名）：就地演；换了的话引擎马上重载，新页面接着演
        return;
      }
      if (!forge) showCard(fresh);
    },
    show: rows => { if (!forge) showCard(rows); },
    debug: { forgeOn, showCard },   // 截图 / 调布局：window.__hudAi.forgeOn('一句话', Date.now())

  };
}
