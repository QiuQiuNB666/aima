// U 线 · 游戏菜单：开始界面（标题屏）/ 暂停 / 设置 / 玩法说明 / 制作团队。只改画面，不调任何 ShellOS 控制接口。
// 标题屏：这个标签页第一次打开 /game 时出现（切世界的重载不再出；?title=0 不出、?title=1 强制出），待机（u-idle）时也是它当吸引画面。
//   背景 = 当前世界沿路慢慢航拍（借引擎的 window.__camHold 自己摆镜头，离开标题屏立刻交还，交还前 hud.cut 黑场 0.35 s 遮一下跳变）。
//   关掉的方式：菜单「开始爬山」、按住 R2（safety 变成 ACTIVE 那一下）、开始走、步数变了。
// 暂停：Esc。只盖住屏幕——腿上的力照旧由 R2 和 Guard 管，暂停期间不发任何请求。「重新开始」= 替用户按一下 R（input.js 原来的回山脚，
//   这里不自己发 /demo/reset）。
// 按键：菜单开着时在捕获阶段吃掉所有按键（空格走路、R 复位、1/2/3 都不会漏给 input.js）。手柄不用来点菜单：ShellOS 已经把手柄每个键都占了
//   （↑↓ 调参数、× 急停、○ 上膛、Options 复位），网页再用会连带改参数；手柄只有「按住 R2 = 开始」。鼠标也能点。
// 设置的存取 / 生效在 settings.js（window.__settings）。
import { qrHtml } from './hud_flow.js';

const Q = new URLSearchParams(location.search);
const FG = Q.get('fengge') !== '0';           // 备用版（峰哥改主意时）：不出峰哥的名字和照片
const TITLE = FG ? '峰哥亡命天涯' : '原地迈步，腿上爬山';
const CSS = `
#umenu{inset:0;z-index:40;display:none;pointer-events:auto}
#umenu.on{display:block}
#umenu .dim{position:absolute;inset:0;background:rgba(3,4,8,.62)}
#umenu.title .dim{background:linear-gradient(90deg,rgba(3,4,8,.82) 0,rgba(3,4,8,.45) 46%,rgba(3,4,8,.05) 70%)}
#umenu .box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(40rem,90vw);max-width:min(64rem,94vw);max-height:92vh;overflow:auto}
#umenu h1{margin:0 0 .8rem;font-size:2.5rem;font-weight:900;letter-spacing:.12em}
#umenu .sub{font-size:1rem;color:var(--dim);margin-top:.8rem;line-height:1.5}
.mi{display:flex;align-items:center;gap:.8rem;padding:.55rem 1rem;margin:.2rem 0;border-radius:.7rem;font-size:1.7rem;font-weight:800;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s}
.mi::before{content:"";width:.35rem;height:1.5rem;border-radius:.2rem;background:transparent}
.mi.sel{background:rgba(180,140,255,.16);border-color:var(--acc)}
.mi.sel::before{background:var(--acc)}
.mi small{margin-left:auto;font-size:1rem;font-weight:700;color:var(--dim)}
.mi.lock{opacity:.5}
.mi .val{margin-left:auto;display:flex;align-items:center;gap:.5rem;font-size:1.3rem;font-weight:800;font-variant-numeric:tabular-nums}
.mi .val i{font-style:normal;color:var(--acc);font-size:1rem}
.mi .vb{display:flex;gap:.15rem}.mi .vb b{width:.55rem;height:1.2rem;border-radius:.15rem;background:rgba(255,255,255,.15)}.mi .vb b.on{background:var(--acc)}
.keys{display:grid;grid-template-columns:auto 1fr 1fr;gap:.35rem 1.4rem;font-size:1.3rem;align-items:center}
.keys .h{font-size:1rem;font-weight:800;color:var(--dim);letter-spacing:.1em}
.keys kbd{display:inline-block;font:inherit;font-size:1rem;font-weight:800;padding:.1rem .5rem;margin:0 .15rem;border-radius:.35rem;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.06)}
.keys .pad{color:var(--who-fengge)}
.cred{font-size:1.3rem;line-height:1.7}.cred b{font-weight:900}.cred small{display:block;font-size:1rem;color:var(--dim);line-height:1.5;margin-top:.6rem}
/* 标题屏 */
#umenu .tt{position:absolute;left:4vw;top:7vh;width:min(46rem,50vw)}
#umenu .logo{font-size:5rem;font-weight:900;letter-spacing:.14em;line-height:1.1;color:#fff;text-shadow:0 0 2.2rem var(--acc),0 .25rem .8rem #000}
#umenu .logo.alt{font-size:3.6rem;white-space:nowrap}   /* 备用版标题 9 个字 */
#umenu .tag{font-size:1.7rem;font-weight:700;margin:.5rem 0 1.6rem;color:#e6edf5}
#umenu .world{font-size:1.3rem;color:var(--dim);margin-bottom:1.2rem}
#umenu .world b{color:#fff}
#umenu .world .feat{font-size:.85rem;font-weight:900;padding:.05rem .45rem;border-radius:.35rem;background:var(--who-fengge);color:#000;vertical-align:.1rem}
#umenu .go{margin-top:1.4rem;font-size:1.3rem;font-weight:800}
#umenu .go kbd{display:inline-block;font:inherit;padding:0 .5rem;border-radius:.35rem;background:var(--acc);color:#000;margin:0 .2rem}
@keyframes uBreath{50%{opacity:.55}}
#umenu .go{animation:uBreath 1.8s ease-in-out infinite}
#umenu .pt{position:absolute;right:8vw;top:14vh;text-align:center}
#umenu .pt .face{width:18rem;height:18rem;border-radius:50%;background:#1a1d24 url(/models/fengge_face.jpg) center 42%/cover;border:.35rem solid var(--who-fengge);box-shadow:0 0 0 .3rem rgba(0,0,0,.5),0 0 3rem rgba(255,176,58,.35)}
#umenu .pt .nm{display:inline-block;margin-top:-1.2rem;position:relative;font-size:1.3rem;font-weight:900;letter-spacing:.2em;padding:.15rem 1rem;border-radius:.5rem;background:var(--who-fengge);color:#000}
#umenu .pt .say{margin-top:.8rem;font-size:1.3rem;font-weight:700;max-width:22rem}
#umenu .qrb{position:absolute;right:1.4rem;bottom:1.4rem;text-align:center;padding:.7rem}
#umenu .steps{position:absolute;left:4vw;right:14rem;bottom:1.4rem;display:flex;gap:.8rem}
#umenu .steps div{flex:1;padding:.7rem 1rem;border-radius:1rem;background:var(--panel);border:1px solid var(--line)}
#umenu .steps b{display:block;font-size:1.3rem;font-weight:900}#umenu .steps b em{font-style:normal;color:var(--acc);margin-right:.4rem}
#umenu .steps i{font-style:normal;font-size:1rem;color:var(--dim)}
body.u-title #tc,body.u-title #tr,body.u-title #force,body.u-title #wait,body.u-title #hint,body.u-title #ghostTag,body.u-title #puppet,body.u-title #tl,body.u-title #aicard,
body.u-idle #tl,body.u-title #fg,body.u-idle #fg,body.u-title #npcTag,body.u-idle #npcTag{display:none!important}   /* 标题屏有自己的大头像；捷风标签不露 */
html.nosub #fg .bub{display:none!important}
html.fg-low #fg.ev-seg,html.fg-low #fg.ev-fast,html.fg-low #fg.ev-idle,html.fg-low #fg.ev-ghost{visibility:hidden}`;

const LINES = ['来都来了，穿上试试，这是个好事儿啊。', '站着看有什么用，腿是自己的。', '按住扳机，原地踏步，山就归你了。', '上一个人的影子还在山上等你。', '说一句话就能造一座山，恰恰相反，爬上去才难。'];
const MAIN = [['start', '开始爬山'], ['maps', '选择地图'], ['parkour', '跑酷闯关'], ['settings', '设置'], ['help', '玩法说明'], ['credits', '制作团队']];
const PAUSE = [['resume', '继续'], ['restart', '重新开始（回山脚）'], ['maps', '换地图'], ['parkour', '跑酷闯关'], ['settings', '设置'], ['title', '退出到标题']];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function makeMenu(world, { preview, cut, poke }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const el = document.createElement('div'); el.id = 'umenu'; el.className = 'hud'; document.body.append(el);
  const SET = window.__settings;
  let started = false; try { started = sessionStorage.getItem('u_started') === '1'; } catch (e) { /* 隐身窗口 */ }
  let titleOpen = Q.get('title') === '1' || (Q.get('title') !== '0' && !preview && !started);
  let stack = [], sel = 0, mode = '', needReload = false, sels = [], sayI = 0;
  setInterval(() => { const b = el.querySelector('.pt .say'); if (b) b.textContent = `「${LINES[++sayI % LINES.length]}」`; }, 8000);   // 标题屏上峰哥轮换说几句   // sels：上一层停在哪一项，返回时还原   // stack：['pause'] / ['settings'] …；mode = 状态流当前状态
  // 标题屏只在状态流是 title / idle 时显示：急停（状态流切到 ready）时让位，红字「急停中」不能被盖住
  const top = () => stack[stack.length - 1] || (mode === 'title' || mode === 'idle' ? 'title' : null);
  const markStarted = () => { try { sessionStorage.setItem('u_started', '1'); } catch (e) { /* 同上 */ } };

  function items() {
    const s = top();
    if (s === 'title') return MAIN;
    if (s === 'pause') return PAUSE;
    if (s === 'settings') return [...SET.defs.map(d => [d.k, d.name]), ['reset', '恢复默认'], ['back', '返回']];
    return [['back', '返回']];
  }
  function valHtml(d) {
    const v = SET.get(d.k), lock = SET.fixed(d.k);
    if (d.vol) return `<span class="val"><span class="vb">${Array.from({ length: 10 }, (_, i) => `<b class="${i < Math.round(v / 10) ? 'on' : ''}"></b>`).join('')}</span>${v}${lock ? '' : ' <i>◀ ▶</i>'}</span>`;
    const o = d.opts.find(x => x[0] === v) || d.opts[0];
    return `<span class="val">${lock ? '<small>地址栏固定</small> ' : '<i>◀</i>'}${esc(o[1])}${lock ? '' : '<i>▶</i>'}</span>`;
  }
  function render() {
    const s = top();
    el.className = `hud${s ? ' on ' + s : ''}`;
    if (!s) { el.innerHTML = ''; return; }
    const its = items(); sel = Math.max(0, Math.min(its.length - 1, sel));
    const list = its.map(([k, name], i) => {
      const d = s === 'settings' && SET.defs.find(x => x.k === k);
      return `<div class="mi${i === sel ? ' sel' : ''}${d && SET.fixed(k) ? ' lock' : ''}" data-i="${i}">${esc(name)}${d ? valHtml(d) : ''}</div>`;
    }).join('');
    if (s === 'title') {
      el.innerHTML = `<div class="dim"></div><div class="tt"><div class="logo${FG ? '' : ' alt'}">${TITLE}</div><div class="tag">穿上外骨骼 · 原地踏步 · 腿上爬山</div>
        <div class="world">当前地图：<b>${esc(world.name)}</b>${world.id === 'everest_north' ? ' <span class="feat">主打</span>' : ''}${world.subtitle ? ` · ${esc(world.subtitle)}` : ''}</div>${list}
        <div class="go">按 <kbd>Enter</kbd> 开始 · 或直接按住手柄 <kbd>R2</kbd></div></div>
        ${FG ? `<div class="pt"><div class="face"></div><div class="nm">峰哥</div><div class="say panel">「${LINES[sayI % LINES.length]}」</div></div>` : ''}
        <div class="steps">${[['按住 R2', '腿上才有力，松手立刻没力'], ['原地踏步', '屏幕里在爬山，坡和台阶打在腿上'], ['说一句「太陡了」', 'AI 蜂群改手感'], ['说一句话', 'AI 现场造一座山']]
          .map(([a, b], i) => `<div><b><em>${i + 1}</em>${a}</b><i>${b}</i></div>`).join('')}</div>
        <div class="qrb panel">${qrHtml()}</div>`;
    } else {
      const head = { pause: '暂停', settings: '设置', help: '玩法说明', credits: '制作团队' }[s];
      const body = s === 'help' ? HELP : s === 'credits' ? CREDITS : '';
      const note = s === 'pause' ? '<div class="sub">暂停只盖住画面：腿上的力照旧由 R2 和安全层管，松开 R2 立刻没力。</div>'
        : s === 'settings' ? `<div class="sub">↑↓ 选 · ←→ 改 · Esc 返回。存在这台电脑上；地址栏写了的以地址栏为准。${needReload ? '<br><b style="color:var(--acc)">画质 / 捷风 / 导游改了：返回时重新载入画面（不影响 ShellOS）。</b>' : ''}</div>` : '';
      el.innerHTML = `<div class="dim"></div><div class="box panel"><h1>${head}</h1>${body}${list}${note}</div>`;
    }
    el.querySelectorAll('.mi').forEach(m => {
      m.onmouseenter = () => { if (sel !== +m.dataset.i) { sel = +m.dataset.i; render(); } };
      m.onclick = e => { sel = +m.dataset.i; act(0, e.offsetX > m.offsetWidth * 0.6 ? 1 : 0); };
    });
  }
  function open(s) { stack.push(s); sels.push(sel); sel = 0; render(); }
  function back() {
    const s = stack.pop(); sel = sels.pop() || 0;
    if (s === 'settings' && needReload) { needReload = false; render(); setTimeout(() => location.reload(), 300); return; }
    render();
  }
  function closeTitle() { titleOpen = false; stack = []; sels = []; sel = 0; markStarted(); poke(); render(); }
  // dir：0 = Enter / 点击，±1 = ←→（只对设置行有用）
  function act(dir, clickDir) {
    const s = top(), [k] = items()[sel] || [];
    if (!k) return;
    if (s === 'settings') {
      const d = SET.defs.find(x => x.k === k);
      if (d) {
        if (SET.fixed(k)) return;
        const step = dir || clickDir || 1;
        if (d.vol) SET.set(k, Math.max(0, Math.min(100, SET.get(k) + step * 10)));
        else { const i = d.opts.findIndex(o => o[0] === SET.get(k)); SET.set(k, d.opts[(i + step + d.opts.length) % d.opts.length][0]); }
        if (d.k === 'cam') window.__camMode = SET.get('cam');
        if (d.reload) needReload = true;
        render(); return;
      }
      if (dir) return;
      if (k === 'reset') { const re = SET.defs.some(d => d.reload && !SET.fixed(d.k) && SET.get(d.k) !== d.def); SET.reset(); if (re) needReload = true; window.__camMode = SET.get('cam'); render(); return; }
    }
    if (dir) return;
    if (k === 'back' || k === 'resume') return back();
    if (k === 'start') return closeTitle();
    if (k === 'maps') { location.href = '/worlds'; return; }
    if (k === 'parkour') { location.href = '/parkour'; return; }
    if (k === 'settings' || k === 'help' || k === 'credits') return open(k);
    if (k === 'title') { stack = []; sels = []; titleOpen = true; sel = 0; render(); return; }
    if (k === 'restart') {                        // 替用户按一下 R：回山脚走的还是 input.js 原来那条路
      stack = []; sels = []; render();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r' }));
    }
  }
  addEventListener('keydown', e => {
    const s = top();
    if (!s) {
      if (e.code === 'Escape' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); sel = 0; open('pause'); }
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();          // 菜单开着：一个键都不漏给 input.js
    if (e.repeat && !/Arrow|Key[WASD]/.test(e.code)) return;
    const n = items().length;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { sel = (sel - 1 + n) % n; render(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { sel = (sel + 1) % n; render(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') act(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') act(1);
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') act(0);
    else if (e.code === 'Escape') { if (stack.length) back(); }
  }, true);

  // ---------- 标题屏背景：沿路慢慢航拍 ----------
  let air = false, airT = 0, prevS = 1e9;
  const lerp = (a, b, k) => a + (b - a) * k;
  const cp = { x: 0, y: 0, z: 0 }, lk = { x: 0, y: 0, z: 0 };
  function aerial(on) {
    if (on === air) return;
    air = on; window.__camHold = on; airT = performance.now() / 1000; prevS = 1e9;
    if (!on) cut();                             // 交还引擎镜头：黑场遮住跳变
  }
  (function loop() {
    requestAnimationFrame(loop);
    const G = window.__game;
    if (!air || !G) return;
    const t = performance.now() / 1000 - airT, N = G.route.N, span = N + 8;
    const s = (t * 0.45) % span - 3, snap = s < prevS;   // 刚开始 / 飞到头绕回山脚：直接跳过去
    if (snap && prevS < 1e9) cut();
    prevS = s;
    const a = G.route.at(s), b = G.route.at(Math.min(N + 3, s + 9));
    const k = snap ? 1 : 0.04;
    cp.x = lerp(cp.x, a.pos.x + a.left.x * 7 - a.dir.x * 5, k); cp.y = lerp(cp.y, a.pos.y + 6.5, k); cp.z = lerp(cp.z, a.pos.z + a.left.z * 7 - a.dir.z * 5, k);
    lk.x = lerp(lk.x, b.pos.x, k); lk.y = lerp(lk.y, b.pos.y + 1.2, k); lk.z = lerp(lk.z, b.pos.z, k);
    G.camera.position.set(cp.x, cp.y, cp.z); G.camera.lookAt(lk.x, lk.y, lk.z);
  })();

  let wasActive = null, lastPos = null;
  render();
  return {
    titleOpen: () => titleOpen,
    // flow 每次换状态前调：离开标题 / 待机先交还镜头（导游在「准备」里要接手镜头，不能两边一起摆）
    onMode(m) { mode = m; aerial(m === 'title' || m === 'idle'); render(); },
    update(S) {
      const act = (S.safety || {}).state === 'ACTIVE', T = S.terrain;
      if (titleOpen && ((wasActive === false && act) || (S.gait && S.gait.moving) || (S.pad && S.pad.r2 > 0.3) || (T && lastPos !== null && T.pos !== lastPos))) closeTitle();
      wasActive = act; lastPos = T ? T.pos : null;
    },
    open,
  };
}

const HELP = `<div class="keys">
<span class="h">做什么</span><span class="h">键盘（大屏这台电脑）</span><span class="h">手柄（ShellOS 读）</span>
<span>出力</span><span>操作台「按住 → 助力」</span><span class="pad">按住 R2（越深越大，松开即零）</span>
<span>走路 / 爬山</span><span>按住 <kbd>空格</kbd>（模拟外骨骼时）</span><span class="pad">穿着原地踏步</span>
<span>步频 慢 / 中 / 快</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>（模拟时）</span><span class="pad">—</span>
<span>换视角</span><span><kbd>V</kbd> 跟拍 → 正面 → 侧面</span><span class="pad">—</span>
<span>换一座山</span><span><kbd>M</kbd></span><span class="pad">—</span>
<span>回山脚</span><span><kbd>R</kbd></span><span class="pad">Options（演示复位）</span>
<span>急停</span><span>操作台「急停」</span><span class="pad">×</span>
<span>重新上膛</span><span>操作台「重新上膛」</span><span class="pad">○</span>
<span>暂停 / 菜单</span><span><kbd>Esc</kbd> · <kbd>↑</kbd><kbd>↓</kbd> 选 · <kbd>Enter</kbd> 确定</span><span class="pad">—（手柄的键 ShellOS 都占了）</span>
</div><div class="sub">评委说一句「太陡了 / 没感觉」，操作员敲进仪表盘「评委说」框：AI 蜂群改手感、存成经验卡，下一位接着用。说一句话还能现场造一座山。</div>`;

const CREDITS = `<div class="cred">
<b>球球</b> · 负责人：控制栈、步态、登山游戏、Agent 蜂群、真机调试与展位演示<br>
<b>anni</b> · 队友<br>
${FG ? '<b>峰哥</b> · 肖像、口吻、AI 复刻声音（9/23 本人当面同意）<br>' : ''}
<small>硬件：Hypershell X MaxS（黑客松固件，没改一个螺丝）<br>
素材：CesiumMan（Khronos glTF Sample，CC BY 4.0）· three.js（MIT）${FG ? ' · 峰哥照片 talk-to-fengge-live（MIT）· 口吻 feng-ge-skill（MIT）· 参考音频 talk-to-fengge（Apache-2.0）' : ''}<br>
MechQuadruped · 3Donimus · CC BY 3.0<br>
Vita · VRoid β3 · CC0<br>
详见 docs/提交/素材授权.md<br>
EvoTavern 深圳站 · 2026-09-24</small></div>`;
