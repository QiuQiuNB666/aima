// 峰哥导游压测：无头 Chrome 反复跑「进 /game → Enter 关标题屏 → 等导游 → 走路打断 / 听完 → 复位 → 再来」，自动给每一轮分类。
//   node scripts/guide_stress.mjs <base=http://127.0.0.1:8857> <轮数=20> [--policy=user|none] [--worlds=a,b] [--mix]
//   只发 /sim、/demo/reset、/terrain、/hold（模拟器自己的端口）；别对着接了真外骨骼的 ShellOS 跑。
//   --policy=doc（缺省）= 桌面 Chrome 默认：页面收到过一次按键 / 点击之后才能出声；strict = 每次 play 都要紧跟着手势（Safari / 手机那种）；
//     none = 展位 Chrome 带 --autoplay-policy=no-user-gesture-required。Enter 用 CDP 的真实按键发（算手势）。
//   --mix：轮流换场景：enter-listen（听完）/ enter-walk（半路走开）/ r2（按住 R2 直接开走 = 跳过）/ reload（不出标题屏直接进，没手势）/
//     idle（听一半 → 待机回标题屏 → 再 Enter，第二位应该重新讲）/ estop（讲到一半急停 → 上膛）/
//     inject（讲到一半插进峰哥事件 + 地标台词，不许叠着念）/ nowav（第 3 句的 wav 404，不许卡 8 s）/ summit（走到山顶 → 回山脚站住：下一位应该重新讲）。
//   --scen=a,b 只跑这几种。
//   输出：每轮一行 JSON（场景、结果、失败类型、句子数、句间最大空档、打断延迟、重叠），最后汇总。页面里的记录：window.__guide.log + 探针 __probe。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const [BASE = 'http://127.0.0.1:8857', N = '20'] = args.filter(a => !a.startsWith('--'));
const POLICY = flag('policy', 'doc'), WORLDS = flag('worlds', 'tokyo_night').split(','), MIX = args.includes('--mix');
const OUT = flag('out', '');
const SCEN = MIX ? ['enter-listen', 'enter-walk', 'r2', 'reload', 'inject', 'idle', 'estop', 'nowav', 'summit', 'enter-walk'] : (flag('scen', '') ? flag('scen').split(',') : ['enter-walk']);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'gstress-'));
const ch = spawn(CHROME, ['--headless=new', '--window-size=1280,720', '--mute-audio', `--autoplay-policy=${{ none: 'no-user-gesture-required', strict: 'user-gesture-required' }[POLICY] || 'document-user-activation-required'}`,
  '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quit = code => { try { ch.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
let port = null;
for (const t0 = Date.now(); !port; await sleep(100)) { if (Date.now() - t0 > 20000) quit(2); const f = join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
let page = null;
while (!page) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
const ws = new WebSocket(page.webSocketDebuggerUrl), wait = new Map(); let id = 0;
await new Promise(r => { ws.onopen = r; });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const call = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => (await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const post = (p, b = {}) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json()).catch(() => null);
const state = () => fetch(BASE + '/state').then(r => r.json()).catch(() => ({}));
const key = async (code, k) => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 }); };
// 探针：记下每个 <audio> 的 play / playing / ended / pause / 被拒，判断有没有两段峰哥语音叠着放
await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const P = HTMLMediaElement.prototype, orig = P.play, ev = window.__probe = [], T = () => Math.round(performance.now());
  P.play = function () { const s = this.currentSrc || this.src || ''; ev.push([T(), 'play', s]);
    if (!this.__pr) { this.__pr = 1; for (const k of ['playing', 'ended', 'pause', 'error']) this.addEventListener(k, () => ev.push([T(), k + (this.muted ? ':muted' : ''), this.currentSrc || this.src || ''])); }
    const p = orig.apply(this, arguments); if (p && p.then) p.then(null, e => ev.push([T(), 'reject:' + e.name, s])); return p; };
})();` });
await call('Page.enable'); await call('Runtime.enable');
// 拦截请求：nowav 让第 3 句 404；inject 用第 1 句导游 wav 顶替 /voice/last.wav（模拟 voice.js 念一句事件）
let intercept = null;
ws.addEventListener('message', async m => {
  const d = JSON.parse(m.data); if (d.method !== 'Fetch.requestPaused') return;
  const u = d.params.request.url, rid = d.params.requestId;
  if (intercept === 'nowav' && /\/guide\/[a-z_]+\/3\.wav/.test(u)) return call('Fetch.fulfillRequest', { requestId: rid, responseCode: 404, body: '' });
  if (/\/voice\/last\.wav/.test(u)) {
    const w = await fetch(u.replace(/\/voice\/last\.wav.*/, '/guide/tokyo_night/1.wav')).then(r => r.arrayBuffer());
    return call('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'audio/wav' }], body: Buffer.from(w).toString('base64') });
  }
  call('Fetch.continueRequest', { requestId: rid });
});
await call('Fetch.enable', { patterns: [{ urlPattern: '*/guide/*.wav*' }, { urlPattern: '*/voice/last.wav*' }] });

const G = `(() => { const g = window.__guide; return JSON.stringify({ cls: document.body.className, hold: window.__camHold, st: g && g.state ? g.state() : null,
  log: g ? g.log.map(x => x.join(':')) : null, probe: window.__probe || [], err: (document.getElementById('errlog') || {}).textContent || '' }); })()`;
const snap = async () => JSON.parse((await ev(G)) || '{}');
const until = async (fn, ms, step = 100) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return Date.now() - t0; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const guiding = async () => (await ev("document.body.classList.contains('g-guide')")) === true;

// 峰哥语音：/guide/（导游 + 地标）和 /voice/last.wav（事件）。算重叠：playing → ended/pause 的区间两两相交
function overlaps(probe) {
  const fg = s => /\/guide\/|\/voice\/last\.wav/.test(s), on = new Map(), iv = [];
  for (const [t, k, s] of probe) { if (!fg(s)) continue; if (k === 'playing') on.set(s, t); else if ((k === 'ended' || k === 'pause') && on.has(s)) { iv.push([on.get(s), t, s]); on.delete(s); } }
  for (const [s, t] of on) iv.push([t, 1e12, s]);
  let n = 0; for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) if (iv[i][0] < iv[j][1] - 50 && iv[j][0] < iv[i][1] - 50) n++;
  return n;
}
function judge(g, scen) {             // 这一轮哪里不对：返回失败类型列表（空 = 正常）
  const f = [], log = g.log || [], probe = g.probe || [];
  if (g.err) f.push('页面报错');
  const says = log.filter(x => /:say$/.test(x)).map(x => +x.split(':')[1]);
  const guideSrc = probe.filter(p => /\/guide\/(?!\w+_fx\/)/.test(p[2]));
  if (probe.some(p => /^reject:NotAllowed/.test(p[1]) && /\/guide\//.test(p[2]))) f.push('①自动播放被拦');
  if (scen !== 'nowav' && log.some(x => /:nowav$|:NotSupportedError$/.test(x))) f.push('②缺 wav');
  if (log.some(x => /:stuck$/.test(x))) f.push('②卡住等兜底');
  if (overlaps(probe)) f.push('③叠着念');
  const played = guideSrc.filter(p => p[1] === 'playing').length;   // 同一句重讲会再 playing 一次，按次数数，不按网址去重
  if (says.length && played < says.length - (scen === 'nowav' ? 1 : 0) && !f.includes('①自动播放被拦')) f.push('①有句没声音');
  return { f, says: says.length, played };
}

let fails = 0; const rows = [];
for (let k = 0; k < +N; k++) {
  const scen = SCEN[k % SCEN.length], world = WORLDS[k % WORLDS.length], t0 = Date.now(), row = { k, scen, world };
  await post('/sim', { walk: false }); await post('/rearm');
  const S0 = await state();
  if (!S0.terrain || S0.terrain.preset !== world) { await post('/terrain', { preset: world }); await sleep(500); }
  await post('/demo/reset'); await sleep(300);
  intercept = scen;
  await call('Page.navigate', { url: `${BASE}/game?npc=0&fx=off&title=${scen === 'reload' ? 0 : 1}${scen === 'idle' ? '&idle=8' : ''}` });
  row.readyMs = await until(async () => (await ev("document.body && document.body.dataset.ready === '1' && !!window.__guide")) === true, 90000, 200);
  if (row.readyMs == null) { row.f = ['加载失败 / 没有 __guide']; rows.push(row); fails++; console.log(JSON.stringify(row)); continue; }
  const f = [];
  if (scen === 'r2') {                // 按住 R2 关标题屏 → 这一位跳过导游
    const hb = setInterval(() => post('/hold', { v: 1 }), 100);
    await sleep(2500); const g1 = await guiding(); await post('/sim', { walk: true }); await sleep(2500);
    clearInterval(hb); await post('/sim', { walk: false }); await sleep(1500);   // 松手 → 回「准备」，人还在半山：不该开讲
    if (g1 || await guiding()) f.push('④R2 开走的还开讲了');
  } else {
    if (scen !== 'reload') await key('Enter', 'Enter');
    else if (POLICY !== 'none') {       // 没按过键：不该哑着开讲，要出「按任意键开启峰哥声音」；按个不相干的键（Shift）之后带声音开讲
      await sleep(4000);
      row.hint = await ev("!!document.getElementById('vbHint')");
      if (await guiding()) f.push('①没解锁就开讲');
      if (!row.hint) f.push('①没出「按任意键」提示');
      await key('ShiftLeft', 'Shift');
    }
    row.startMs = await until(guiding, 20000);
    if (row.startMs == null) f.push('④没开讲');
    else if (scen === 'enter-listen') {
      row.doneMs = await until(async () => !(await guiding()), 90000, 200);
      if (row.doneMs == null) f.push('②讲不完（>90 s）');
    } else if (scen === 'idle') {       // 听一半没人动 → 待机回标题屏（地址栏 ?idle=8）→ 下一位按 Enter：应该重新讲一遍
      row.idleMs = await until(async () => (await ev("document.body.classList.contains('u-idle') || document.body.classList.contains('u-title')")) === true, 30000, 200);
      if (row.idleMs == null) f.push('（没进待机）');
      await sleep(1500); await key('Enter', 'Enter');
      row.restartMs = await until(guiding, 15000);
      if (row.restartMs == null) f.push('⑥待机后回来没重讲');
      else { await sleep(1500); await post('/sim', { walk: true }); await until(async () => !(await guiding()), 5000, 50); await sleep(500); await post('/sim', { walk: false }); }
    } else if (scen === 'inject') {     // 讲到第 2 句：插一句峰哥事件（voice.js 的做法）+ 一句地标台词 + 一个事件气泡
      await sleep(5000);
      await ev(`(() => { const a = new Audio('/voice/last.wav?_=' + Date.now()); a.play().catch(() => {}); window.__fenggeHud && window.__fenggeHud.say('red', '（压测插的一句事件）');
        return import('/game/themes/snow_summit/lines.js').then(m => m.fgSay('yak')).catch(() => 0); })()`);
      await sleep(1500);
      row.bubble = await ev("(document.querySelector('#fg small') || {}).textContent");
      if (!/导游|解说/.test(row.bubble || '')) f.push('③气泡被抢');
      await sleep(3000); await post('/sim', { walk: true }); await until(async () => !(await guiding()), 5000, 50); await sleep(500); await post('/sim', { walk: false });
    } else if (scen === 'summit') {     // 打断 → 一路走到山顶（红灯站 2.5 s）→ 回山脚站住：下一位应该重新讲
      await sleep(2000); await post('/sim', { cadence: 200 }); await post('/sim', { walk: true });
      const laps0 = (await state()).terrain.laps; let T = null;
      for (const t1 = Date.now(); Date.now() - t1 < 150000; await sleep(200)) {
        T = (await state()).terrain; if (T.laps > laps0) break;
        if (T.segment === 'wait') { await post('/sim', { walk: false }); await sleep(2800); await post('/sim', { walk: true }); }
      }
      await post('/sim', { walk: false }); await post('/sim', { cadence: 100 });
      if (!T || T.laps <= laps0) f.push('（没走到山顶）');
      else { row.again = await until(guiding, 45000, 200); if (row.again == null) f.push('⑥登顶回山脚没重讲'); else { await sleep(1000); await post('/sim', { walk: true }); await until(async () => !(await guiding()), 5000, 50); await sleep(500); await post('/sim', { walk: false }); } }
    } else if (scen === 'nowav') {      // 第 3 句 404：只出气泡、按字数估时长，不许在这一句卡 8 s
      row.doneMs = await until(async () => !(await guiding()), 90000, 200);
      const lg = (await snap()).log || [], t3 = lg.find(x => /^\d+:3:say$/.test(x)), t4 = lg.find(x => /^\d+:4:say$/.test(x));
      row.gap3 = t3 && t4 ? +t4.split(':')[0] - +t3.split(':')[0] : null;
      if (row.gap3 == null || row.gap3 > 9000) f.push('②缺 wav 那句卡住');
    } else if (scen === 'estop') {
      await sleep(4000); await post('/estop'); row.estopStopMs = await until(async () => !(await guiding()), 3000);
      if (row.estopStopMs == null) f.push('④急停没打断');
      await sleep(1000); await post('/rearm'); await sleep(2500);
      if (await guiding()) f.push('④急停恢复后又从头讲');
    } else {
      await sleep(3000 + Math.random() * 6000);
      const tw = Date.now(); await post('/sim', { walk: true });
      row.stopMs = await until(async () => !(await guiding()), 5000, 50);
      if (row.stopMs == null) f.push('④走路没打断'); else if (row.stopMs > 800) f.push('④打断慢');
      await sleep(500); await post('/sim', { walk: false });
      await sleep(1500); if (await guiding()) f.push('④打断后又开讲');
    }
  }
  await sleep(300);
  const g = await snap(), j = judge(g, scen);
  row.f = [...f, ...j.f]; row.says = j.says; row.played = j.played; row.hold = g.hold; row.ms = Date.now() - t0;
  if (g.hold && !/u-title|u-idle/.test(g.cls) && !(await guiding())) row.f.push('④镜头没交还');
  if (row.f.length) { fails++; row.log = g.log; row.probe = g.probe.filter(p => /guide|voice/.test(p[2])).map(p => `${p[0]}:${p[1]}:${p[2].split('/').slice(-2).join('/')}`); }
  rows.push(row); console.log(JSON.stringify(row));
  if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
}
await post('/sim', { walk: false });
const by = {}; rows.forEach(r => (r.f || []).forEach(x => { by[x] = (by[x] || 0) + 1; }));
console.log(`== ${rows.length - fails}/${rows.length} 轮正常；失败类型：${JSON.stringify(by)}`);
quit(0);
