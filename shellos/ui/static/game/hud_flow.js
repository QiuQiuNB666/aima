// U 线 · 大屏状态流（只读 /state）：body 上挂 u-idle / u-ready / u-play / u-summit 之一，CSS 按状态藏面板。
//   待机 idle：IDLE_S 秒没人动（没走、没按 R2、没换人、蜂群没新消息）→ 标题 + 玩法四步轮播 + 角落二维码；镜头在正面 / 侧面 / 跟拍之间轮换，峰哥偶尔说一句。
//   准备 ready：没按 R2（safety 不是 ACTIVE）→ 大字「按住 R2 开始」；急停时换成红字。
//   游戏中 play：只留峰哥、路况、力、进度（+ 安全灯、AI 卡、影子标签）。
//   登顶 summit：成绩卡（用时 / 和影子比 / 经验卡 #n / 二维码）。引擎走 3 步就收登顶画面（最多 6 s），成绩卡至少留 MIN_S 秒，
//     之后接着走 3 步、进红灯或满 LINGER_S 秒才收。
// 地址参数：?ui=idle|ready|play|summit 固定一个状态（截图用；离线预览默认 play）；?idle=秒 改待机门槛；?qr=网址 改二维码内容。
import { qrSvg } from './hud_qr.js';

const Q = new URLSearchParams(globalThis.location ? location.search : '');   // node 跑单测时没有 location
const IDLE_S = +(Q.get('idle') || 45), MIN_S = 8, LINGER_S = 25, LEAVE_PLAY_S = 1.2, CAMS = ['front', 'side', 'follow'], CAM_S = 7, SAY_S = 25;
// ponytail: 仓库现在是私有的（公网 404），二维码先指向 GitHub 上的一页纸；有公开网址了用 ?qr= 换，或改这里
export const QR_URL = 'https://github.com/QiuQiuNB666/aima/blob/main/docs/%E6%8F%90%E4%BA%A4/onepager.html';
const STEPS = [['按住手柄 R2', '腿上才有力，松手立刻没力'], ['原地踏步', '屏幕里在爬山，坡和台阶打在腿上'], ['说一句「太陡了」', 'AI 蜂群改手感，存成经验卡'], ['说一句话', 'AI 现场造一座山']];
const LINES = ['来都来了，穿上试试，这是个好事儿啊。', '站着看有什么用，腿是自己的。', '按住扳机，原地踏步，山就归你了。', '上一个人的影子还在山上等你。', '说一句话就能造一座山，恰恰相反，爬上去才难。'];
const CSS = `
body.u-idle #tc,body.u-idle #tr,body.u-idle #force,body.u-idle #wait,body.u-idle #hint,body.u-idle #ghostTag,body.u-idle #puppet{display:none!important}
body.u-play #tl,body.u-play #hint,body.u-summit #tl,body.u-summit #hint{display:none!important}
body.u-summit #force,body.u-summit #aicard{opacity:0!important}
#uidle,#uready,#uqr{display:none}
body.u-idle #uidle,body.u-idle #uqr,body.u-ready #uready{display:block}
#uidle{inset:0;text-align:center}
#uidle .ih{position:absolute;left:50%;top:1.6rem;transform:translateX(-50%);width:min(60rem,60vw)}
#uidle .it{font-size:5rem;font-weight:900;letter-spacing:.18em;line-height:1.1;color:#fff;text-shadow:0 0 2rem var(--acc),0 .2rem .6rem #000}
#uidle .is{font-size:1.6rem;font-weight:700;margin-top:.4rem;color:#e6edf5}
#uidle .st{position:absolute;left:1.4rem;right:13.5rem;bottom:1.4rem;display:flex;gap:.8rem;text-align:left}
#uidle .st div{flex:1;padding:.8rem 1rem;border-radius:1rem;background:var(--panel);border:1px solid var(--line);opacity:.55;transition:opacity .4s,border-color .4s,transform .4s}
#uidle .st div.on{opacity:1;border-color:var(--acc);transform:translateY(-.4rem)}
#uidle .st b{display:block;font-size:1.6rem;font-weight:900}
#uidle .st i{font-style:normal;font-size:1.05rem;color:var(--dim)}
#uidle .st em{font-style:normal;color:var(--acc);font-weight:900;margin-right:.4rem}
#uqr{right:1.4rem;bottom:1.4rem;text-align:center;padding:.7rem}
.qr{width:9rem;height:9rem;border-radius:.4rem;overflow:hidden}
.qr svg{width:100%;height:100%;display:block}
.qrc{font-size:1rem;font-weight:700;margin-top:.35rem;color:var(--fg)}
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
#summit .sbig em{font-style:normal;font-size:1.3rem;font-weight:900;color:#000;background:#ffd54f;border-radius:.4rem;padding:.05rem .5rem}
#summit .sgh{font-size:1.6rem;font-weight:800;margin-top:.3rem}
#summit .sck{font-size:1.35rem;margin-top:.35rem;color:var(--acc);font-weight:700}`;

// 下一个状态（纯函数，tests/test_hud_flow.py 用 node 跑）。只有「离开游戏中」带迟滞：LEAVE_PLAY_S 秒里一直不是 ACTIVE 才切回「按住 R2」——
//   评委扳机轻搭在门槛上、ACTIVE / ARMED 10 Hz 来回跳时，大字和面板不跟着闪。进游戏中、急停都不等（急停一帧都不能晚）。
export function pickMode(prev, { forced, state, summit, idleFor, notActiveFor, idleS = IDLE_S }) {
  if (forced) return forced;
  if (state === 'DISARMED') return 'ready';
  if (summit) return 'summit';
  if (idleFor > idleS) return 'idle';
  if (state === 'ACTIVE') return 'play';
  return prev === 'play' && notActiveFor < LEAVE_PLAY_S ? 'play' : 'ready';
}

const fmt = s => s == null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function makeFlow(world, preview) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  let qr = ''; try { qr = qrSvg(Q.get('qr') || QR_URL); } catch (e) { if (window.__err) window.__err('二维码生成失败：' + e.message); }
  const add = (id, cls, html) => { const d = document.createElement('div'); d.id = id; d.className = cls; d.innerHTML = html; document.body.append(d); return d; };
  const idle = add('uidle', 'hud', `<div class="ih"><div class="it">峰哥亡命天涯</div><div class="is">${esc(world.name)} · 穿上外骨骼，原地踏步爬一座山</div></div>
    <div class="st">${STEPS.map(([a, b], i) => `<div><b><em>${i + 1}</em>${a}</b><i>${b}</i></div>`).join('')}</div>`);
  add('uqr', 'hud panel', `<div class="qr">${qr}</div><div class="qrc">扫码看一页纸</div>`);
  const ready = add('uready', 'hud panel', '<div class="rt"></div><div class="rs"></div><div class="rb"><i></i></div>');
  // 登顶卡：game.html 里的 #summit，右边加二维码
  const sm = document.getElementById('summit');
  sm.innerHTML = `<div class="sg"><div><div class="t2" id="sName"></div><div class="t3" id="sText"></div>
    <div class="sbig">用时<b id="sTime"></b><em id="sRec">新纪录</em></div><div class="sgh" id="sGhost"></div><div class="sck" id="sCard"></div>
    <div class="t5">✓ 已写入山的记忆 —— 下一位会看到你的影子</div></div><div><div class="qr">${qr}</div><div class="qrc">扫码看一页纸</div></div></div>`;

  const now = () => performance.now() / 1000;
  let mode = '', lastAct = now(), lastActive = -1e9, sig = null, lastS = null, lastT = null, ghostDone = null, shownAt = 0, linger = false;
  let camPrev = null, camT = 0, camI = 0, sayT = 0, sayI = Math.floor(Math.random() * LINES.length), stepI = 0, stepT = 0;

  function setMode(m) {
    if (m === mode) return;
    if (mode === 'idle' && camPrev !== null) { window.__camMode = camPrev; camPrev = null; }
    if (m === 'idle') { camPrev = window.__camMode || 'follow'; camT = now(); camI = 0; window.__camMode = CAMS[0]; sayT = now() - SAY_S + 3; }
    for (const k of ['idle', 'ready', 'play', 'summit']) document.body.classList.toggle('u-' + k, k === m);
    mode = m;
  }
  function tick() {                            // 待机轮播：镜头、玩法四步、峰哥一句
    const t = now();
    if (mode === 'idle') {
      if (t - camT > CAM_S) { camT = t; camI = (camI + 1) % CAMS.length; window.__camMode = CAMS[camI]; }
      if (t - stepT > 3) { stepT = t; stepI = (stepI + 1) % STEPS.length; idle.querySelectorAll('.st div').forEach((d, i) => d.classList.toggle('on', i === stepI)); }
      if (t - sayT > SAY_S && window.__fenggeHud) { sayT = t; window.__fenggeHud.say('idle', LINES[sayI++ % LINES.length], 7000); }
    }
  }
  setInterval(tick, 250);

  return {
    update(S) {
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
      setMode(pickMode(mode, { forced, state: sf.state, summit: sm.classList.contains('show'), idleFor: t - lastAct, notActiveFor: t - lastActive }));
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
