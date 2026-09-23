// G 线 · 峰哥声道仲裁：页面上所有峰哥语音同一时刻只放一段。
//   谁是谁按网址认：/guide/<world>/<i>.wav = 导游，/guide/<xx>_fx/<i>.wav = 地标台词（E 线 lines.js），/voice/last.wav = 峰哥事件（V 线 voice.js）。
//   优先级 导游 > 地标 > 事件：高的来了打断正在放的低的；低的来了排队，等不超过 WAIT_MS，过期就丢（红灯那句过了 6 s 再念就对不上了）。
//   导游开讲时 hold('guide') 占住声道：整段讲解期间（包括句与句之间的停顿）低优先级的一律丢掉，不会插进句缝里。
//   捷风 / 音效不归这里管。
// 做法：再包一层 HTMLMediaElement.prototype.play（settings.js 那层管音量，这层在它外面），voice.js / lines.js 一行不用改。
// 自动播放：浏览器没收到过按键 / 点击之前，峰哥语音一律不放（事件那句直接丢，不让 voice.js 弹按钮）；unlocked() 告诉导游等一等，
//   这时画面下方出一个「按任意键开启峰哥声音」（ask()；有人想出声才出，解锁就收）。
//   第一次按键 / 点击 / 触摸时在同一个事件里放一段静音 wav 解锁，之后整页都能出声。展位 Chrome 带 --autoplay-policy=no-user-gesture-required
//   启动时，开页面探测一下就是解锁的。
// 调试：window.__voiceBus.log（最近 80 条：[毫秒, 动作, 谁, 网址尾巴]）、.state()。
const P = HTMLMediaElement.prototype, inner = P.play;
const PRIO = { event: 1, map: 2, guide: 3 }, WAIT_MS = { event: 6000, map: 4000, guide: 0 };
// 30 ms 静音（8 kHz / 8 bit / 单声道 wav）
const SILENT = 'data:audio/wav;base64,UklGRhQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YfAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=';
export const kindOf = s => /\/guide\/\w+_fx\//.test(s) ? 'map' : /\/guide\//.test(s) ? 'guide' : /\/voice\/last\.wav/.test(s) ? 'event' : null;

let cur = null, held = null, queue = [], unlocked = false;
const wakers = [], log = [], T = () => Math.round(performance.now());
const note = (a, k, el) => { log.push([T(), a, k, el ? (el.currentSrc || el.src || '').split('/').slice(-2).join('/') : '']); if (log.length > 80) log.shift(); };

function release(el) {                          // 这一段放完 / 停了 / 放不了：让出声道，排着的接上
  if (!cur || cur.el !== el) return;
  cur = null; drain();
}
function drain() {
  if (cur) return;
  const now = T();
  queue = queue.filter(q => now - q.t <= WAIT_MS[q.k] && !(held && PRIO[q.k] < PRIO[held]));
  if (!queue.length) return;
  queue.sort((a, b) => PRIO[b.k] - PRIO[a.k] || a.t - b.t);
  const q = queue.shift();
  start(q.el, q.k);
}
function watch(el) {
  if (el.__vb) return; el.__vb = 1;
  for (const e of ['ended', 'pause', 'error', 'emptied']) el.addEventListener(e, () => release(el));
}
function start(el, k, args = []) {
  watch(el); cur = { el, k }; note('play', k, el);
  const p = inner.apply(el, args);
  if (p && p.then) p.then(null, e => { note('fail:' + e.name, k, el); release(el); });
  return p;
}

P.play = function (...args) {
  const k = kindOf(this.currentSrc || this.src || '');
  if (!k) return inner.apply(this, args);
  if (!unlocked) { note('locked', k, this); ask(); return k === 'event' ? Promise.resolve() : Promise.reject(new DOMException('峰哥声音还没解锁', 'NotAllowedError')); }
  if (held && PRIO[k] < PRIO[held]) { note('drop:held', k, this); return Promise.resolve(); }
  if (cur && cur.el !== this) {
    if (PRIO[k] > PRIO[cur.k] || k === cur.k) { note('cut', cur.k, cur.el); const o = cur.el; cur = null; o.pause(); }
    else { note('queue', k, this); queue.push({ el: this, k, t: T() }); return Promise.resolve(); }
  }
  return start(this, k, args);
};

// 预热：Safari / 严格自动播放策略下，只有在手势里 play 过的那个 <audio> 之后才能不靠手势再播。导游 / 地标的片段先登记（bless），
//   每次按键 / 点击时把还没预热的静音 play 一下再停。桌面 Chrome 默认策略用不着，但无害。
const toBless = new Set();
function blessAll() {
  for (const el of toBless) {
    toBless.delete(el);
    if (!el.paused) continue;
    const m = el.muted; el.muted = true;
    inner.call(el).then(() => { el.pause(); el.currentTime = 0; el.muted = m; }, () => { el.muted = m; toBless.add(el); });
  }
}
function tryUnlock(e) {
  if (unlocked) return;
  inner.call(new Audio(SILENT)).then(() => {
    if (unlocked) return;
    unlocked = true; note('unlock', e ? e.type : 'probe'); if (hint) { hint.remove(); hint = null; }
    wakers.splice(0).forEach(f => { try { f(); } catch (err) { console.error(err); } });
  }, () => { if (!e) note('locked-at-load'); });
}
let hint = null;
function ask() {                                // 有人想出声但还没解锁：提示按任意键（点它本身也算）
  if (unlocked || hint || !globalThis.document?.body) return;
  hint = document.createElement('div'); hint.id = 'vbHint'; hint.className = 'hud panel';
  hint.style.cssText = 'left:50%;top:74%;transform:translateX(-50%);padding:.5rem 1.2rem;font-size:1.4rem;font-weight:800;pointer-events:auto;cursor:pointer;z-index:30';
  hint.textContent = '🔈 按任意键开启峰哥声音';
  document.body.append(hint);
}
const onGesture = e => { blessAll(); tryUnlock(e); };
for (const t of ['keydown', 'pointerdown', 'touchstart']) addEventListener(t, onGesture, true);   // 捕获阶段、比菜单先挂：菜单吃掉按键也照样解锁
tryUnlock(null);                                // 浏览器本来就允许自动出声（启动参数 / 以前在这个站点出过声）：开页面就解锁

export const bus = {
  unlocked: () => unlocked,
  onUnlock(f) { if (unlocked) f(); else wakers.push(f); },
  bless(els) { els.forEach(el => toBless.add(el)); },
  ask,
  hold(k) { held = k; queue = queue.filter(q => PRIO[q.k] >= PRIO[k]); note('hold', k); },
  release(k) { if (held === k) { held = null; note('release', k); drain(); } },
  busy: () => held || (cur && cur.k) || null,
  state: () => ({ unlocked, held, cur: cur && cur.k, queue: queue.map(q => q.k) }),
  log,
};
window.__voiceBus = bus;
