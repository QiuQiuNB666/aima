// 峰哥画中画：屏幕左侧一个圆形峰哥头像（2D，models/fengge_face.jpg）+ 解说气泡。跟拍镜头在身后看不到 3D 脸，靠这个露脸。
// 数据：轮询 /state.fengge = {t, event, text, source}（shellos/agent/fengge.py，登顶 / 红灯 / 造山时来一句），出了新的一句弹气泡、停 6 s。
//   打开页面前那句不弹（和 V 线的 voice.js 同一套判断：t|event|text 变了才算新的）。声音归 voice.js，这里只管画面。
// 登顶时头像放大：看 hud.js 给 body 加的 .summit（登顶卡显示期间）。
// 布局：左侧、世界名面板（#tl）下面，气泡在头像右边、宽 ≤ min(20rem, 半屏 − 16rem)（小窗口也碰不到正中的红灯面板）——不压左下力矩条（#bl）、正中红灯（#wait）、顶上路段（#tc）、
//   底部登顶卡（#summit）、右侧经验卡（#cards）。
// 开关：?fengge=0 不显示。离线预览（?preview=…）不轮询；&say=一句话[&sayev=red|summit|world|ghost] 摆一个常驻气泡（截图 / 调布局用）。
// 调试：window.__fenggeHud.say(event, text)。
const Q = new URLSearchParams(location.search);
const HOLD_MS = 6000, POLL_MS = 1000;
const EV = { summit: '登顶', red: '红灯', world: '造山', ghost: '影子' };
const CSS = `
#fg{left:1.4rem;top:10rem;display:flex;align-items:flex-start;gap:.8rem}
#fg .av{flex:none;width:6rem;height:6rem;border-radius:50%;background:#1a1d24 url(/models/fengge_face.jpg) center 42%/cover;
  border:.22rem solid var(--acc);box-shadow:0 0 0 .2rem rgba(0,0,0,.55),0 .3rem 1.2rem rgba(0,0,0,.6);position:relative;
  transition:width .5s,height .5s}
#fg .av::after{content:"峰哥";position:absolute;left:50%;bottom:-.55rem;transform:translateX(-50%);font-size:.8rem;font-weight:800;
  letter-spacing:.15em;padding:.05rem .5rem;border-radius:.4rem;background:var(--acc);color:#000;text-shadow:none;white-space:nowrap}
#fg.talk .av{animation:fgPulse 1.2s ease-in-out infinite}
@keyframes fgPulse{50%{box-shadow:0 0 0 .2rem rgba(0,0,0,.55),0 0 1.6rem var(--acc)}}
body.summit #fg .av{width:9.5rem;height:9.5rem;border-color:#ffd54f}
body.summit #fg .av::after{background:#ffd54f}
#fg .bub{position:relative;max-width:min(20rem,calc(50vw - 16rem));margin-top:.8rem;padding:.6rem .95rem;font-size:1.3rem;line-height:1.4;font-weight:700;
  opacity:0;transform:translateX(-.6rem);transition:opacity .35s,transform .35s;border-color:var(--acc)}
#fg .bub::before{content:"";position:absolute;left:-.55rem;top:1rem;border:.5rem solid transparent;border-left:0;border-right:.55rem solid var(--acc)}
#fg.talk .bub{opacity:1;transform:none}
#fg .bub small{display:block;font-size:.8rem;font-weight:700;letter-spacing:.2em;color:var(--acc);margin-bottom:.15rem}
#fg.ev-red .bub{border-color:#ff4d6d}#fg.ev-red .bub::before{border-right-color:#ff4d6d}#fg.ev-red .bub small{color:#ff4d6d}
#fg.ev-summit .bub{border-color:#ffd54f}#fg.ev-summit .bub::before{border-right-color:#ffd54f}#fg.ev-summit .bub small{color:#ffd54f}`;

export function initFenggeHud() {
  if (Q.get('fengge') === '0') return null;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const el = document.createElement('div'); el.className = 'hud'; el.id = 'fg';
  el.innerHTML = '<div class="av"></div><div class="bub panel"><small></small><span></span></div>';
  document.body.append(el);
  const tl = document.getElementById('tl');
  const place = () => { if (tl) el.style.top = `${tl.getBoundingClientRect().bottom + 16}px`; };   // 世界名副标题可能折行：跟着 #tl 的实际底边
  place(); addEventListener('resize', place);
  let timer = 0;
  const say = (event, text, hold = HOLD_MS) => {
    el.querySelector('small').textContent = `峰哥 · ${EV[event] || '解说'}`;
    el.querySelector('span').textContent = text;
    el.className = `hud talk ev-${event}`; place();
    clearTimeout(timer); if (hold) timer = setTimeout(() => { el.className = 'hud'; }, hold);
  };
  window.__fenggeHud = { say };
  if (Q.has('preview')) { if (Q.get('say')) say(Q.get('sayev') || 'summit', Q.get('say'), 0); return el; }
  let seen = null;
  const poll = async () => {
    try {
      const f = (await (await fetch('/state', { cache: 'no-store' })).json()).fengge || {};
      const sig = `${f.t}|${f.event}|${f.text}`;
      if (seen !== null && sig !== seen && f.text) say(f.event, f.text);
      seen = sig;
    } catch (e) { /* 服务重启中，下一轮再说 */ }
    setTimeout(poll, POLL_MS);
  };
  poll();
  return el;
}
