// 逐帧录「可定位」的 HTML 动画：页面提供 window.seek(秒)（画出第 t 秒的样子，返回 Promise 或值），这里按 30 fps 一帧帧 seek + 截图。
// 画面是确定的，不依赖机器快慢；软件渲染也能出顺滑的 30 fps。
//   node rec_seek.mjs <url> <出目录> <秒> [fps=30] [width=1920] [height=1080]
// 输出 out/f00000.jpg…；再 ffmpeg -framerate 30 -i f%05d.jpg 编码。开无头 Chrome 前加 scratchpad 的 with_chrome.sh 信号量。
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, out, secs, fpsA, wA, hA] = process.argv.slice(2);
const FPS = +(fpsA || 30), W = +(wA || 1920), H = +(hA || 1080), N = Math.round(+secs * FPS);
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'seek-'));
const ch = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${W},${H}`, '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = c => { try { ch.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(c); }, 300); };
try {
  let port = null, t0 = Date.now();
  while (!port) { if (Date.now() - t0 > 60000) throw new Error('no chrome'); const f = join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; else await sleep(100); }
  let page = null; while (!page) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
  const ws = new WebSocket(page.webSocketDebuggerUrl), wait = new Map(); let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = expr => call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result && r.result.result && r.result.result.value);
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url });
  for (let i = 0; i < 200 && !(await ev('typeof window.seek === "function" && document.fonts.status === "loaded"')); i++) await sleep(100);
  const t1 = Date.now();
  for (let f = 0; f < N; f++) {
    await ev(`Promise.resolve(window.seek(${(f / FPS).toFixed(4)})).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => 1)`);
    const s = await call('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    writeFileSync(join(out, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(s.result.data, 'base64'));
  }
  console.log(`${N} frames in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  done(0);
} catch (e) { console.error('failed', e.message); done(2); }
