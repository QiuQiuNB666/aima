// 蜂群拆解用连拍（scripts/cut_swarm.sh 的素材）：无头 Chrome 截仪表盘，按时间表从 Node 直接 POST 触发教练 / 造山 / 删卡 / 急停。
// node rec_swarm.mjs <plan.json>        开无头 Chrome 前加 scratchpad 的 with_chrome.sh 信号量；展位 8765 不要拿来拍
//   plan: {base, url, out, secs, width, height, dsf, gpu:"off", clip:{x,y,width,height,scale}, walk, cadence, ready, warm, pre:{path,body},
//          actions:[{t:秒, path:"/feedback", body:{...}} | {t, delete_last:true}]}
//   gpu:"off" = --disable-gpu：仪表盘是纯 DOM，这台机器上 1× ≈ 4–8 fps、2×（dsf 2）≈ 1.6–2.4 fps；缺省 swiftshader 反而 0.2 fps
// 输出：out/f0000.jpg…、times.txt（毫秒）、t0.txt（第 0 帧的 epoch 毫秒，两路对时用）、actions.jsonl（动作实际毫秒 + 返回）、swarm.jsonl
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const P = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const base = P.base, W = P.width || 1920, H = P.height || 1080, out = P.out;
mkdirSync(out, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'recsw-'));
const GPU = P.gpu === 'off' ? ['--disable-gpu'] : ['--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const ch = spawn(CHROME, ['--headless=new', ...GPU, '--hide-scrollbars',
  `--window-size=${W},${H}`, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b || {}) }).then(r => r.json()).catch(e => ({ err: String(e) }));
const done = c => { try { ch.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(c); }, 300); };
try {
  let port = null, t0 = Date.now();
  while (!port) { if (Date.now() - t0 > 60000) throw new Error('no chrome'); const f = join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; else await sleep(100); }
  let page = null; while (!page) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl), wait = new Map(); let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: P.dsf || 1, mobile: false });
  await call('Page.navigate', { url: P.url });
  await sleep(P.ready || 4000);
  if (P.pre) await post(P.pre.path, P.pre.body);
  if (P.walk) await post('/sim', { walk: true, cadence: P.cadence || 90 });
  await sleep(P.warm || 4000);
  const T0 = Date.now(), times = []; let n = 0;
  const todo = (P.actions || []).slice().sort((a, b) => a.t - b.t);
  const af = join(out, 'actions.jsonl'), sf = join(out, 'swarm.jsonl'); writeFileSync(af, ''); writeFileSync(sf, ''); writeFileSync(join(out, 't0.txt'), String(T0));
  const fire = async a => {
    const t = Date.now() - T0; let r;
    if (a.delete_last) {
      const st = await fetch(base + '/state').then(r => r.json());
      const ids = st.memory.applied; r = await post('/memory/delete', { id: ids[ids.length - 1] });
    } else r = await post(a.path, a.body);
    appendFileSync(af, JSON.stringify({ t, want: a.t, path: a.path || 'delete_last', body: a.body, r }) + '\n');
  };
  const timer = setInterval(() => { const t = (Date.now() - T0) / 1000; while (todo.length && todo[0].t <= t) fire(todo.shift()); }, 50);
  while (Date.now() - T0 < P.secs * 1000) {
    const s = await call('Page.captureScreenshot', P.clip ? { format: 'jpeg', quality: 92, clip: P.clip, captureBeyondViewport: false } : { format: 'jpeg', quality: 90, optimizeForSpeed: true });
    if (!s.result) { await sleep(50); continue; }
    const t = Date.now() - T0;
    writeFileSync(join(out, `f${String(n).padStart(4, '0')}.jpg`), Buffer.from(s.result.data, 'base64'));
    times.push(t); n++;
    if (n % 5 === 0) fetch(base + '/state').then(r => r.json()).then(st => appendFileSync(sf, JSON.stringify({ t, swarm: st.swarm.slice(-1), params: st.ctl.params }) + '\n')).catch(() => {});
  }
  clearInterval(timer);
  if (P.walk) await post('/sim', { walk: false });
  writeFileSync(join(out, 'times.txt'), times.join('\n') + '\n');
  console.log(`fps=${(n / P.secs).toFixed(2)} frames=${n}`);
  done(0);
} catch (e) { console.error('failed', e.message); done(2); }
