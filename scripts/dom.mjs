// dom.sh 的实现：无头 Chrome + DevTools 协议，按真实时间轮询页面，等 <body data-ready="1"> 或报错（不靠虚拟时间，不会"没等到就绪"）。
// node scripts/dom.mjs <url> [超时毫秒=60000]；输出与退出码见 dom.sh
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, tmo = '60000'] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'shellos-dom-'));
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1920,1080', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = code => { try { ch.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
const t0 = Date.now();
try {
  let port = null;
  while (!port) { if (Date.now() - t0 > 15000) throw new Error('Chrome 没起来'); const f = join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; else await sleep(100); }
  let page = null;
  while (!page) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl), wait = new Map(); let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await call('Page.navigate', { url });
  const EXPR = `JSON.stringify({ d: document.body ? { ...document.body.dataset } : {}, err: (document.getElementById('errlog') || {}).textContent || '' })`;
  let st = { d: {}, err: '' }, errAt = 0;
  while (Date.now() - t0 < +tmo) {
    await sleep(300);
    const r = await call('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    try { st = JSON.parse(r.result.result.value); } catch { continue; }
    if (st.d.ready === '1') break;
    if (st.err && !errAt) errAt = Date.now();
    if (errAt && Date.now() - errAt > 3000) break;       // 报错了还等 3 s：多数报错不影响就绪，没就绪就不再傻等
  }
  const d = st.d;
  console.log(`ready=${d.ready || 0}  calls=${d.calls ?? '?'}  tris=${d.tris ?? '?'}  scene-tris=${d.sceneTris ?? '?'}  scene-objs=${d.sceneObjs ?? '?'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log('errlog:', st.err.trim() || '(空)');
  done(d.ready === '1' && !st.err.trim() ? 0 : 1);
} catch (e) { console.error('dom failed:', e.message); done(2); }
