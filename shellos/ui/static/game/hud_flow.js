// U 线 · 大屏状态流（只读 /state）：body 上挂 u-idle / u-ready / u-play / u-summit 之一，CSS 按状态藏面板。
//   标题 title：标签页第一次打开时的开始界面（hud_menu.js 画、管按键和航拍镜头）。
//   待机 idle：IDLE_S 秒没人动（没走、没按 R2、没换人、蜂群没新消息）→ 回到标题屏当吸引画面（hud_menu.js，峰哥头像旁边轮换说几句）。
//   准备 ready：没按 R2（safety 不是 ACTIVE）→ 大字「按住 R2 开始」；急停时换成红字。
//   游戏中 play：只留峰哥、路况、力、进度（+ 安全灯、AI 卡、影子标签）。
//   登顶 summit：成绩卡（用时 / 和影子比 / 经验卡 #n / 二维码）。引擎走 3 步就收登顶画面（最多 6 s），成绩卡至少留 MIN_S 秒，
//     之后接着走 3 步、进红灯或满 LINGER_S 秒才收。
// 地址参数：?ui=title|idle|ready|play|summit 固定一个状态（截图用；离线预览默认 play）；?idle=秒 改待机门槛；
//   ?qr=网址 改二维码（缺省 = S 线的微信群码 wx_qr.jpg，9/30 前有效）。
import { qrSvg } from './hud_qr.js';

const Q = new URLSearchParams(globalThis.location ? location.search : '');   // node 跑单测时没有 location
const IDLE_S = +(Q.get('idle') || 45), MIN_S = 8, LINGER_S = 25, LEAVE_PLAY_S = 1.2;
// 二维码：缺省用微信群码图（和海报同一个）；?qr=网址 时现场编码（hud_qr.js，不连外部服务）
export function qrHtml() {
  const fg = Q.get('fengge') !== '0';
  if (!Q.get('qr')) return `<div class="qr"><img src="/game/wx_qr.jpg" alt="微信群二维码"></div><div class="qrc">扫码进群${fg ? ' · 峰哥亡命天涯' : ''}<small>群码 9/30 前有效</small></div>`;
  try { return `<div class="qr">${qrSvg(Q.get('qr'))}</div><div class="qrc">扫码看看</div>`; } catch (e) { return ''; }
}
const CSS = `
body.u-idle #tc,body.u-idle #tr,body.u-idle #force,body.u-idle #wait,body.u-idle #hint,body.u-idle #ghostTag,body.u-idle #puppet,body.u-idle #aicard{display:none!important}
body.u-play #tl .panel,body.u-play #hint,body.u-summit #tl .panel,body.u-summit #hint{display:none!important}   /* 换一座山按钮始终留着（9/23 球球：切地图的按键没了） */
body.u-summit #force,body.u-summit #aicard{opacity:0!important}
#uready{display:none}
body.u-ready #uready{display:block}
#uready.stop{z-index:45}   /* 急停：压在暂停 / 设置菜单上面 */
.qr{width:9rem;height:9rem;border-radius:.4rem;overflow:hidden;background:#fff}
.qr svg,.qr img{width:100%;height:100%;display:block}
.qrc{font-size:1rem;font-weight:700;margin-top:.35rem;color:var(--fg);line-height:1.35}
.qrc small{display:block;font-size:.85rem;color:var(--dim);font-weight:600}
#uready{left:50%;top:58%;transform:translate(-50%,-50%);text-align:center;padding:1.2rem 2.6rem;border-color:var(--acc)}
#uready .rt{font-size:4.4rem;font-weight:900;letter-spacing:.1em;line-height:1.15;white-space:nowrap}
#uready .rt kbd{display:inline-block;font:inherit;font-size:.8em;padding:0 .45em;margin:0 .15em;border-radius:.3em;background:var(--acc);color:#000;vertical-align:.05em}
#uready .rs{font-size:1.5rem;color:var(--dim);margin-top:.4rem}
#uready .rb{height:.6rem;border-radius:.3rem;background:rgba(255,255,255,.15);margin-top:.8rem;overflow:hidden}
#uready .rb i{display:block;height:100%;width:0;background:var(--acc);transition:width .1s}
#uready.stop{border-color:#ff4d4f}#uready.stop .rt{color:#ff4d4f}
@keyframes uPulse{50%{transform:translate(-50%,-50%) scale(1.04)}}
#uready:not(.stop){animation:uPulse 1.6s ease-in-out infinite}
#summit .sg{display:flex;gap:1.6rem;align-items:center;text-align:left}
#summit .sbig{font-size:1.3rem;color:var(--dim);margin-top:.3rem}
#summit .sbig b{font-size:3.6rem;font-weight:900;color:#fff;margin:0 .4rem;font-variant-numeric:tabular-nums;vertical-align:-.3rem}
#summit .sbig em{font-style:normal;font-size:1.3rem;font-weight:900;color:#000;background:var(--acc);border-radius:.4rem;padding:.05rem .5rem}
#summit .sgh{font-size:1.6rem;font-weight:800;margin-top:.3rem}
#summit .salt{font-size:1.7rem;font-weight:900;margin-left:.6rem;white-space:nowrap;letter-spacing:0;font-variant-numeric:tabular-nums}
#summit .sck{font-size:1.35rem;margin-top:.35rem;color:var(--acc);font-weight:700}
#summit .sfg{font-size:1.3rem;font-weight:700;margin-top:.45rem;padding:.35rem .7rem;border-radius:.6rem;border-left:.3rem solid var(--who-fengge);background:rgba(255,176,58,.08)}
#summit .sfg:empty{display:none}
#summit .sfg small{display:block;font-size:.85rem;color:var(--who-fengge);font-weight:800;letter-spacing:.15em}
#summit .sbtn{display:flex;gap:.6rem;margin-top:.6rem;pointer-events:auto}
#summit .sbtn button{font:inherit;font-size:1rem;font-weight:800;padding:.4rem .9rem;border-radius:.6rem;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--fg);cursor:pointer}
#summit .sbtn button:first-child{background:var(--acc);color:#000;border-color:var(--acc)}
#summit .sbtn kbd{font:inherit;font-weight:900;margin-right:.35rem}`;
const RECS = 'fg_records';   // 每座山的最佳成绩（选择地图页读）：{ 世界 id: { best, who, at } }；ShellOS 内存里只有当前世界的，这里给选山页攒一份

// 下一个状态（纯函数，tests/test_hud_flow.py 用 node 跑）。只有「离开游戏中」带迟滞：LEAVE_PLAY_S 秒里一直不是 ACTIVE 才切回「按住 R2」——
//   评委扳机轻搭在门槛上、ACTIVE / ARMED 10 Hz 来回跳时，大字和面板不跟着闪。进游戏中、急停都不等（急停一帧都不能晚）。
export function pickMode(prev, { forced, state, title, summit, idleFor, notActiveFor, idleS = IDLE_S }) {
  if (forced) return forced;
  if (state === 'DISARMED') return 'ready';
  if (title) return 'title';
  if (summit) return 'summit';
  if (idleFor > idleS) return 'idle';
  if (state === 'ACTIVE') return 'play';
  return prev === 'play' && notActiveFor < LEAVE_PLAY_S ? 'play' : 'ready';
}

const fmt = s => s == null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function makeFlow(world, preview) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const add = (id, cls, html) => { const d = document.createElement('div'); d.id = id; d.className = cls; d.innerHTML = html; document.body.append(d); return d; };
  const ready = add('uready', 'hud panel', '<div class="rt"></div><div class="rs"></div><div class="rb"><i></i></div>');
  // 登顶卡：game.html 里的 #summit，右边加二维码
  const sm = document.getElementById('summit');
  sm.innerHTML = `<div class="sg"><div><div class="t2" id="sName"></div><div class="t3" id="sText"></div>
    <div class="sbig">用时<b id="sTime"></b><em id="sRec">新纪录</em><span id="sSteps"></span></div><div class="sgh" id="sGhost"></div><div class="sck" id="sCard"></div>
    <div class="sfg" id="sFg"></div>
    <div class="t5">✓ 已写入山的记忆 —— 下一位会看到你的影子</div>
    <div class="sbtn"><button id="sAgain"><kbd>Enter</kbd>再来一次</button><button id="sMaps"><kbd>M</kbd>换地图</button></div></div><div>${qrHtml()}</div></div>`;
  // 结算卡上的两个按钮：「再来一次」= 收起卡片（ShellOS 登顶后已经自动从山脚开下一圈，不用发任何请求）；「换地图」= 去选山页
  const again = () => { linger = false; sm.classList.remove('show'); };
  document.getElementById('sAgain').onclick = again;
  document.getElementById('sMaps').onclick = () => { location.href = '/worlds'; };
  addEventListener('keydown', e => {
    if (e.code !== 'Enter' || !sm.classList.contains('show') || document.querySelector('#umenu.on')) return;
    e.preventDefault(); again();
  });

  const now = () => performance.now() / 1000;
  let fgSig0 = null, fgWant = false;          // 登顶那一刻的峰哥解说签名：之后来的新一句（event = summit）就是给这次登顶的评语
  let mode = '', lastAct = now(), lastActive = -1e9, sig = null, lastS = null, lastT = null, ghostDone = null, shownAt = 0, linger = false;
  let menu = null;

  function setMode(m) {
    if (m === mode) return;
    if (menu) menu.onMode(m);                   // 先让菜单交还 / 接管镜头，再换 class（导游看 u-ready 接手镜头）
    for (const k of ['title', 'idle', 'ready', 'play', 'summit']) document.body.classList.toggle('u-' + k, k === m);
    mode = m;
  }

  return {
    attachMenu(m) { menu = m; },
    poke() { lastAct = now(); },               // 菜单里点了「开始爬山」：算有人来了，退出待机
    update(S) {
      const f = S.fengge || {}, fs = `${f.t}|${f.event}|${f.text}`;
      if (fgWant && fs !== fgSig0 && f.event === 'summit' && f.text) { fgWant = false; document.getElementById('sFg').innerHTML = `<small>${Q.get('fengge') === '0' ? '解说' : '峰哥'}</small>「${esc(f.text)}」`; }
      lastS = S;
      const T = S.terrain, t = now();
      const act = [T && T.pos, T && T.laps, T && T.preset, S.wearer, (S.swarm || []).map(e => e.t + e.msg).slice(-1)[0]].join('|');
      if (sig === null || act !== sig || (S.gait && S.gait.moving) || (S.pad && S.pad.r2 > 0.05) || (S.sim && S.sim.walk)) { sig = act; lastAct = t; }
      if (T) {
        if (T.ghost_pos != null && T.ghost_pos >= T.total && ghostDone == null) ghostDone = T.elapsed;
        if (lastT && (T.pos < lastT.pos || T.preset !== lastT.preset)) ghostDone = null;
        lastT = T;
      }
      if (linger && (t - shownAt > LINGER_S || (t - shownAt > MIN_S && (!T || T.pos >= 3 || T.segment === 'wait')))) { linger = false; sm.classList.remove('show'); }
      const sf = S.safety || {};
      const r2 = S.pad && S.pad.connected ? S.pad.r2 : null;
      ready.classList.toggle('stop', sf.state === 'DISARMED');
      ready.querySelector('.rt').innerHTML = sf.state === 'DISARMED' ? '急停中' : '按住 <kbd>R2</kbd> 开始';
      if (sf.state === 'ACTIVE') lastActive = t;
      ready.querySelector('.rs').textContent = sf.state === 'DISARMED' ? '已经断开，等操作员重新上膛' : sf.state === 'DISCONNECTED' ? '外骨骼还没连上，等操作员' : `按住扳机才有力，松手立刻没力${S.wearer && S.wearer !== 'anon' ? ` · 穿戴者：${S.wearer}` : ''}`;
      ready.querySelector('.rb').style.display = r2 == null ? 'none' : '';
      ready.querySelector('.rb i').style.width = `${(r2 || 0) * 100}%`;
      const forced = Q.get('ui') || (preview ? (sm.classList.contains('show') ? 'summit' : 'play') : '');
      if (sf.state === 'DISARMED' && !forced) { linger = false; sm.classList.remove('show'); }   // 急停压过一切：收成绩卡，大字「急停中」
      setMode(pickMode(mode, { forced, state: sf.state, title: !!(menu && menu.titleOpen()), summit: sm.classList.contains('show'), idleFor: t - lastAct, notActiveFor: t - lastActive }));
    },
    // 引擎登顶 / 收起：成绩卡。T = 登顶后的新状态（laps 已 +1），lastT = 登顶前最后一帧（影子还在第几步）
    summit(show, T, prevBest) {
      if (!show) { if (sm.classList.contains('show')) linger = true; return; }
      if (!T) return;
      linger = false; shownAt = now();
      document.getElementById('sName').textContent = world.summit ? world.summit.name : '终点';
      document.getElementById('sText').textContent = world.summit ? world.summit.text : '';
      const lap = T.last_lap;
      document.getElementById('sTime').textContent = fmt(lap);
      document.getElementById('sSteps').textContent = ` · ${T.total} 步`;
      if (world.alt && world.alt[1] !== world.alt[0]) document.getElementById('sName').insertAdjacentHTML('beforeend', `<small class="salt">${esc(world.alt[1])} ${esc(world.unit || 'm')}</small>`);   // 珠峰 = 8848.86 m
      const f = (lastS && lastS.fengge) || {};
      fgSig0 = `${f.t}|${f.event}|${f.text}`; fgWant = true; document.getElementById('sFg').innerHTML = '';
      if (lap != null && !preview) try {         // 攒给选山页的最佳成绩（只存在这台大屏的浏览器里）
        const R = JSON.parse(localStorage.getItem(RECS) || '{}') || {}, r = R[world.id] || {};
        if (r.best == null || lap < r.best) R[world.id] = { best: lap, who: (lastS && lastS.wearer) || '', at: Date.now() };
        localStorage.setItem(RECS, JSON.stringify(R));
      } catch (e) { /* 隐身窗口 */ }
      document.getElementById('sRec').style.display = lap != null && (prevBest == null || lap < prevBest - 1e-6) ? '' : 'none';
      const P = lastT || T, who = P.ghost_who || '上一位';
      document.getElementById('sGhost').textContent = lap == null ? '' : ghostDone != null ? (lap - ghostDone <= 0.05 ? `和影子（${who}）同时登顶` : `比影子（${who}）慢 ${(lap - ghostDone).toFixed(1)} s`)
        : P.ghost_pos != null ? `甩开影子（${who}）${Math.max(1, P.total - P.ghost_pos)} 步` : '你是第一个爬上这座山的人';
      const m = lastS && lastS.memory, mine = m && m.cards ? m.cards.filter(c => c.enabled !== false && c.wearer === lastS.wearer) : [];
      const c = mine[mine.length - 1];
      document.getElementById('sCard').textContent = c ? `你的手感已存为经验卡 #${c.id}「${c.quote}」` : '说一句「太陡了 / 没感觉」，手感就能存成经验卡';
      ghostDone = null;
      sm.classList.add('show');
    },
  };
}
