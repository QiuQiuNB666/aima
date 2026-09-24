// rec.mjs 的加长版：同样的连拍，多写一份 events.jsonl（每帧时刻的 峰哥气泡文字 / 地形 pos / segment / 影子 / 登顶），
// 剪辑时按事件掐点（气泡出现 → 同期声 wav 摆在同一毫秒）。参数同 rec.mjs，另加 js=<表达式> 每帧额外记录一个值。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, out, secs, ...kv] = process.argv.slice(2);
const O = Object.fromEntries(kv.map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const base = O.base || 'http://127.0.0.1:8965', W = +(O.width || 1920), H = +(O.height || 1080);
mkdirSync(out, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'rec-'));
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--window-size=${W},${H}`, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json()).catch(() => null);
const done = c => { try { ch.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(c); }, 300); };
let walking = false;
const setWalk = async w => { if (walking === w) return; walking = w; await post('/sim', { walk: w, cadence: +(O.cadence || 110) }); };
const EVJS = `(()=>{const f=document.getElementById('fg');const t=f&&f.classList.contains('talk')?f.querySelector('span').textContent:'';
  return JSON.stringify({bub:t,summit:document.body.classList.contains('summit'),ready:document.body.dataset.ready||''${O.js ? ',x:(' + O.js + ')' : ''}})})()`;
try {
  let port = null, t0 = Date.now();
  while (!port) { if (Date.now() - t0 > 60000) throw new Error('no chrome'); const f = join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; else await sleep(100); }
  let page = null; while (!page) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl), wait = new Map(); let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = (expression, awaitPromise = false) => call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }).then(r => r.result && r.result.result && r.result.result.value);
  console.error('page found, port', port);
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url }); console.error('navigated');
  const lim = +(O.ready || 120000), tr = Date.now(); let ok = false;
  while (Date.now() - tr < lim) { await sleep(500); const v = await ev('document.body&&document.body.dataset.ready'); if (v === '1') { ok = true; break; } if (((Date.now() - tr) / 500 | 0) % 20 === 0) console.error('waiting', ((Date.now() - tr) / 1000 | 0) + 's ready=' + v); }
  console.error(ok ? `ready in ${((Date.now() - tr) / 1000).toFixed(1)} s` : 'NOT READY (拍了再说)');
  if (O.hud === '0') await ev(`document.head.insertAdjacentHTML('beforeend','<style>.hud:not(#fg){display:none!important}</style>');1`);
  if (O.pre) await ev(O.pre, true);
  if (O.click) await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: H - 5, button: 'left', clickCount: 1 }).then(() => call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: H - 5, button: 'left', clickCount: 1 }));
  if (O.walk === '1' && !O.walkat) await setWalk(true);
  await sleep(+(O.warm || 2500));
  const T0 = Date.now(), times = []; let n = 0, want = O.walk === '1' || !!O.walkat;
  const aw = O.autowait !== '0';
  let T = null;
  const poll = setInterval(async () => {
    const t = Date.now() - T0;
    if (O.walkat && t >= +O.walkat) want = true;
    if (O.stopat && t >= +O.stopat) want = false;
    if (O.at) for (const a of O.at.split(';')) { const [ms, js] = a.split(':'); if (!poll[ms] && t >= +ms) { poll[ms] = 1; ev(js.replace(/__base__/g, base), true).catch(() => {}); } }
    const st = await fetch(base + '/state').then(r => r.json()).catch(() => null); T = st && st.terrain;
    if (!want && !walking) return;
    if (!want) return setWalk(false);
    if (aw) await setWalk(!(T && T.segment === 'wait')); else await setWalk(true);
  }, 250);
  if (O.walkat) want = false;
  const evf = join(out, 'events.jsonl'); writeFileSync(evf, '');
  while (Date.now() - T0 < +secs * 1000) {
    const s = await call('Page.captureScreenshot', O.jpg === '0' ? { format: 'png' } : { format: 'jpeg', quality: 92 });
    if (!s.result) { await sleep(100); continue; }
    const t = Date.now() - T0;
    writeFileSync(join(out, `f${String(n).padStart(4, '0')}.${O.jpg === '0' ? 'png' : 'jpg'}`), Buffer.from(s.result.data, 'base64'));
    let e = {}; try { e = JSON.parse(await ev(EVJS) || '{}'); } catch {}
    appendFileSync(evf, JSON.stringify({ i: n, t, pos: T && T.pos, seg: T && T.segment, kind: T && T.kind, laps: T && T.laps, ...e }) + '\n');
    times.push(t); n++;
  }
  clearInterval(poll);
  await setWalk(false);
  writeFileSync(join(out, 'times.txt'), times.join('\n') + '\n');
  console.log(`fps=${(n / (+secs)).toFixed(2)} frames=${n}`);
  done(0);
} catch (e) { console.error('failed', e.message); await setWalk(false); done(2); }
