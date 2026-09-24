import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createExoskeletonReader, readShellOSState, normalizeShellOSState, resolveShellOSPort } from './exoskeleton-core.mjs';

const execute = promisify(execFile);
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEVICE_NAME = 'E06-003B';
const DEVICE_MATCH = /E06-003B(?![A-Z0-9])/i;
const JSON_LIMIT = 1024;
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'],
]);

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

function blankEndpoint() { return { detected: false, active: false, muted: null, volume: null }; }

// Only expose desktop geometry. Native monitor paths, serials, and EDID data stay private.
// These local IDs may change after a display is added/removed; they are not device identities.
export function normalizeDisplayState(report, { platform = process.platform, now = Date.now } = {}) {
  const windows = platform === 'win32';
  const valid = windows && Array.isArray(report?.Displays) && report.Displays.length <= 32
    && report.Displays.every(display => typeof display?.Primary === 'boolean'
      && ['X', 'Y', 'Width', 'Height'].every(key => Number.isInteger(display[key]))
      && Math.abs(display.X) <= 131072 && Math.abs(display.Y) <= 131072
      && display.Width > 0 && display.Width <= 65536 && display.Height > 0 && display.Height <= 65536);
  const capturedAt = Date.parse(report?.CapturedAtUtc);
  return {
    available: Boolean(valid), platform: windows ? 'windows' : platform,
    checkedAt: Number.isFinite(capturedAt) ? new Date(capturedAt).toISOString() : new Date(now()).toISOString(),
    displays: valid ? report.Displays.map((display, index) => ({
      id: `display-${index + 1}`, label: `显示器 ${index + 1}`, primary: display.Primary,
      x: display.X, y: display.Y, width: display.Width, height: display.Height,
    })) : [],
    ...(!windows ? { error: 'UNSUPPORTED_PLATFORM' } : !valid ? { error: 'STATE_UNAVAILABLE' } : {}),
  };
}

export function normalizeDeviceState(report, { platform = process.platform, now = Date.now } = {}) {
  const windows = platform === 'win32';
  const matching = Array.isArray(report?.MatchingEndpoints)
    ? report.MatchingEndpoints.filter(item => DEVICE_MATCH.test(item?.Name || '')) : [];
  function endpoint(flow) {
    const endpoints = matching.filter(item => item.Flow === flow);
    // Prefer an active stereo output. Do not infer a disconnected endpoint's volume.
    endpoints.sort((a, b) => Number(Boolean(b.StateMask & 1)) - Number(Boolean(a.StateMask & 1))
      || Number(/Hands-Free/i.test(a.Name)) - Number(/Hands-Free/i.test(b.Name)));
    const selected = endpoints[0];
    if (!selected || !windows) return blankEndpoint();
    const active = Boolean(selected.StateMask & 1);
    return {
      detected: true, active,
      muted: active && typeof selected.Muted === 'boolean' ? selected.Muted : null,
      volume: active && Number.isFinite(selected.MasterVolumePercent)
        ? Math.max(0, Math.min(100, selected.MasterVolumePercent)) : null,
    };
  }
  const playback = endpoint('Render');
  const microphone = endpoint('Capture');
  const notes = windows
    ? ['active 表示 Windows 音频端点可用；不代表正在播放或已经听见。', '实际声音需要本人确认；麦克风端点可用不代表拾音已验证。']
    : ['本地设备桥接仅支持 Windows；当前设备状态未检测。'];
  if (windows && !playback.detected) notes.push('未检测到 E06-003B 播放端点，请先在 Windows 中连接眼镜。');
  else if (playback.detected && !playback.active) notes.push('Windows 记得这副眼镜，但播放端点当前不可用。');
  if (playback.muted) notes.push('眼镜播放端点当前静音。');
  if (Array.isArray(report?.Errors) && report.Errors.length) notes.push('部分 Windows 音频信息读取失败。');
  const capturedAt = Date.parse(report?.CapturedAtUtc);
  return {
    bridge: windows, deviceName: DEVICE_NAME, platform: windows ? 'windows' : platform,
    checkedAt: Number.isFinite(capturedAt) ? new Date(capturedAt).toISOString() : new Date(now()).toISOString(),
    playback, microphone, audibility: 'unverified',
    capabilities: {
      audioOutput: playback.active, audioInput: microphone.active,
      battery: false, camera: false, video: false, mediaSync: false, buttons: false, firmware: false,
    },
    notes,
    ...(!windows ? { error: 'UNSUPPORTED_PLATFORM' } : {}),
  };
}

async function powershellExecutable() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    process.env.EYEVUE_POWERSHELL,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', 'pwsh.exe'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* Try the next installed runtime. */ }
  }
  throw new Error('PowerShell runtime unavailable.');
}

async function runBridgeScript(name, args = [], options = {}) {
  const executable = await powershellExecutable();
  return execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(APP_ROOT, 'bridge', name), ...args], {
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 35000, maxBuffer: 512 * 1024, ...options,
  });
}

async function queryNativeDevice() {
  const { stdout } = await runBridgeScript('Get-GlassesAudioState.ps1', ['-NameContains', DEVICE_NAME]);
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

async function queryNativeDisplays() {
  const { stdout } = await runBridgeScript('Get-DisplayState.ps1');
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

async function queryNativeExoskeletonUsb() {
  const { stdout } = await runBridgeScript('Get-ExoskeletonState.ps1', [], { timeout: 6000, maxBuffer: 32 * 1024 });
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

async function playNativeAudio() {
  const { stdout } = await runBridgeScript('Test-GlassesAudio.ps1', ['-Play', '-Extended']);
  if (!stdout.includes('PLAYBACK_BUFFER_COMPLETED:')) throw new Error('Playback completion was not reported.');
}

async function readJson(req) {
  const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new RequestError(415, 'JSON_REQUIRED', '请求必须使用 application/json。');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    throw new RequestError(415, 'ENCODING_UNSUPPORTED', '不支持压缩请求。');
  }
  if (Number(req.headers['content-length']) > JSON_LIMIT) throw new RequestError(413, 'BODY_TOO_LARGE', '请求内容过大。');
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > JSON_LIMIT) throw new RequestError(413, 'BODY_TOO_LARGE', '请求内容过大。');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'INVALID_JSON', '请求内容不是有效 JSON。'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) {
    throw new RequestError(400, 'INVALID_REQUEST', '测试接口仅接受空 JSON 对象 {}。');
  }
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isPublicPath(requested) {
  const segments = requested.replaceAll('\\', '/').replace(/^\//, '').split('/');
  return !segments.some(segment => !segment || segment.startsWith('.') || ['bridge', 'work', 'node_modules'].includes(segment.toLowerCase()))
    && MIME.has(path.extname(requested).toLowerCase())
    && !/(?:^|\/)(?:server|backend\.test)\./i.test(requested);
}

async function serveStatic(req, res, root, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  if (!isPublicPath(requested)) {
    throw new RequestError(404, 'NOT_FOUND', '未找到资源。');
  }
  const type = MIME.get(path.extname(requested).toLowerCase());
  const candidate = path.resolve(root, `.${requested}`);
  if (!contained(root, candidate)) throw new RequestError(404, 'NOT_FOUND', '未找到资源。');
  let resolved;
  let info;
  try { resolved = await realpath(candidate); info = await stat(resolved); }
  catch { throw new RequestError(404, 'NOT_FOUND', '未找到资源。'); }
  if (!contained(root, resolved) || !isPublicPath(path.relative(root, resolved)) || !info.isFile() || info.size > 8 * 1024 * 1024) {
    throw new RequestError(404, 'NOT_FOUND', '未找到资源。');
  }
  const content = req.method === 'HEAD' ? null : await readFile(resolved);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size });
  res.end(content);
}

export function createConsoleServer({
  staticRoot = APP_ROOT, platform = process.platform, queryDevice = queryNativeDevice,
  queryDisplays = queryNativeDisplays, testAudio = playNativeAudio, now = Date.now,
  cacheMs = 15000, displayCacheMs = 3000,
  queryExoskeletonUsb = queryNativeExoskeletonUsb, shellosPort, handsPort = process.env.SHELLOS_HANDS_PORT,
  exoskeletonMode = process.env.EXOSKELETON_MODE,
  exoskeletonUsbCacheMs = 5000, shellosCacheMs = 500, shellosTimeoutMs = 1200,
} = {}) {
  const rootPromise = realpath(staticRoot);
  const legPort = resolveShellOSPort(shellosPort);
  const handPort = handsPort === undefined || handsPort === '' ? null : resolveShellOSPort(handsPort);
  const layout = exoskeletonMode || (handPort === null ? 'single-legs' : 'dual');
  if (!['single-legs','single-hands','dual'].includes(layout)) throw new Error('EXOSKELETON_MODE must be single-legs, single-hands or dual.');
  if (layout === 'dual' && handPort === legPort) throw new Error('In dual mode SHELLOS_HANDS_PORT must differ from SHELLOS_PORT.');
  const handUnavailable = error => ({available:false, hardwareOutput:false, layout, error, role:'hands'});
  let handPending = null;
  function handTelemetry() {
    if (layout === 'single-legs') return Promise.resolve(handUnavailable('HANDS_ROLE_DISABLED'));
    if (handPort === null) return Promise.resolve(handUnavailable('HANDS_SOURCE_NOT_CONFIGURED'));
    // No USB enumeration and no 500ms status cache in the interactive input path.
    // Concurrent callers share a single bounded, read-only upstream request.
    if (!handPending) handPending = (async () => {
      const [value, legs] = await Promise.all([
        readShellOSState({ port:handPort, timeoutMs:shellosTimeoutMs, now }),
        layout === 'dual' ? readShellOSState({ port:legPort, timeoutMs:shellosTimeoutMs, now }) : null,
      ]);
      const hand = normalizeShellOSState(value, {now});
      // A service port alone is not evidence that its device has the hand role.
      if (hand.shellos.valid && value.report.link.role !== 'hands') return handUnavailable('HANDS_ROLE_MISMATCH');
      if (layout === 'dual' && hand.shellos.mode === 'hardware') {
        const leg = normalizeShellOSState(legs, {now});
        if (!leg.telemetry?.fresh || leg.shellos.mode !== 'hardware' || legs.report.link.role !== 'legs') return handUnavailable('DUAL_BINDING_UNVERIFIED');
        if (leg.telemetry.port.toLowerCase() === hand.telemetry.port.toLowerCase()) return handUnavailable('DEVICE_ROLE_CONFLICT');
      }
      return { available:true, checkedAt:new Date(now()).toISOString(), hardwareOutput:false, role:'hands', layout, ...hand };
    })()
      .finally(() => { handPending = null; });
    return handPending;
  }
  const readLegState = createExoskeletonReader({
    platform, queryUsb: queryExoskeletonUsb, now, shellosPort,
    usbCacheMs: exoskeletonUsbCacheMs, shellosCacheMs, shellosTimeoutMs,
  });
  const exoskeletonState = () => layout === 'single-hands'
    ? Promise.resolve({available:false, hardwareOutput:false, role:'legs', layout, error:'LEGS_ROLE_DISABLED'})
    : readLegState();
  let cached;
  let cachedAt = 0;
  let pending;
  let testing = false;
  let cachedDisplays;
  let cachedDisplaysAt = 0;
  let pendingDisplays;
  async function displayState() {
    if (cachedDisplays && now() - cachedDisplaysAt < displayCacheMs) return cachedDisplays;
    if (pendingDisplays) return pendingDisplays;
    pendingDisplays = (async () => {
      let report;
      if (platform === 'win32') {
        try { report = await queryDisplays(); } catch { /* Report unavailable without leaking native errors. */ }
      }
      const result = normalizeDisplayState(report, { platform, now });
      cachedDisplays = result; cachedDisplaysAt = now();
      return result;
    })().finally(() => { pendingDisplays = undefined; });
    return pendingDisplays;
  }
  async function state(force = false) {
    if (!force && cached && now() - cachedAt < cacheMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      let result;
      if (platform !== 'win32') result = normalizeDeviceState(null, { platform, now });
      else {
        try {
          const report = await queryDevice();
          if (!report || !Array.isArray(report.MatchingEndpoints)) throw new Error('Malformed bridge response.');
          result = normalizeDeviceState(report, { platform, now });
          if (report.Errors?.length && !report.MatchingEndpoints.length) result.error = 'STATE_UNAVAILABLE';
        } catch {
          result = normalizeDeviceState(null, { platform, now });
          result.error = 'STATE_UNAVAILABLE';
          result.notes = ['无法读取 Windows 音频状态。请确认本地服务可以运行 PowerShell，并稍后重试。'];
        }
      }
      cached = result; cachedAt = now();
      return result;
    })().finally(() => { pending = undefined; });
    return pending;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const remote = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw new RequestError(403, 'LOOPBACK_ONLY', '服务仅接受本机连接。');
      const port = server.address()?.port;
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new RequestError(403, 'HOST_REJECTED', '请使用本机控制台地址访问。');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'CROSS_SITE_REJECTED', '不接受跨站请求。');
      const rawPath = (req.url || '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); }
      catch { throw new RequestError(400, 'INVALID_PATH', '路径编码无效。'); }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f]/.test(pathname) || pathname.split('/').some(segment => segment === '..')) {
        throw new RequestError(400, 'INVALID_PATH', '路径无效。');
      }
      if (pathname === '/api/audio/test') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new RequestError(405, 'METHOD_NOT_ALLOWED', '请使用 POST。'); }
        if (req.headers.origin !== `http://${host}`) throw new RequestError(403, 'ORIGIN_REJECTED', '音频测试必须从本机控制台页面发起。');
        await readJson(req);
        if (testing) throw new RequestError(409, 'TEST_BUSY', '测试正在进行，请等待当前提示音结束。');
        testing = true;
        try {
          if (platform !== 'win32') throw new RequestError(501, 'UNSUPPORTED_PLATFORM', '音频设备桥接仅支持 Windows。');
          const current = await state(true);
          if (current.error) throw new RequestError(503, 'STATE_UNAVAILABLE', '无法确认眼镜状态，未播放测试音。');
          if (!current.playback.active) throw new RequestError(409, 'DEVICE_UNAVAILABLE', 'E06-003B 播放端点未连接，未向其他设备播放。');
          if (current.playback.muted || current.playback.volume === 0) throw new RequestError(409, 'DEVICE_MUTED', '眼镜处于静音或零音量，请在系统中检查后重试。');
          try { await testAudio(); }
          catch { throw new RequestError(502, 'PLAYBACK_FAILED', 'Windows 未完成眼镜音频测试。请检查蓝牙连接后重试。'); }
          json(res, 200, { ok: true, message: '已向 E06-003B 发送两组轻柔提示音，Windows 报告播放缓冲已完成。请确认是否在眼镜里听见。', requiresConfirmation: true });
        } finally { testing = false; cached = undefined; }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); throw new RequestError(405, 'METHOD_NOT_ALLOWED', '此资源只支持读取。'); }
      if (pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'eyevue-console', platform: platform === 'win32' ? 'windows' : platform, bridgeSupported: platform === 'win32' }); return;
      }
      if (pathname === '/api/device') { json(res, 200, await state()); return; }
      if (pathname === '/api/displays') { json(res, 200, await displayState()); return; }
      if (['/api/exoskeleton','/api/hands-telemetry','/api/exoskeleton-layout'].includes(pathname)) {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new RequestError(403, 'ORIGIN_REJECTED', '外骨骼状态必须从本机控制台页面读取。');
        if ((req.url || '').includes('?')) throw new RequestError(400, 'INVALID_REQUEST', '外骨骼状态接口不接受目标地址或其他查询参数。');
        if (pathname === '/api/exoskeleton-layout') {
          json(res,200,{layout, hardwareOutput:false, roles:{legs:layout !== 'single-hands', hands:layout !== 'single-legs'}}); return;
        }
        json(res, 200, await (pathname === '/api/hands-telemetry' ? handTelemetry() : exoskeletonState())); return;
      }
      if (pathname.startsWith('/api/')) throw new RequestError(404, 'NOT_FOUND', '未找到接口。');
      await serveStatic(req, res, await rootPromise, pathname);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, error instanceof RequestError ? error.status : 500, {
        ok: false, error: error instanceof RequestError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof RequestError ? error.message : '本地服务暂时无法处理请求。', requiresConfirmation: false,
      });
      req.resume();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4177);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 through 65535.');
  const server = createConsoleServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭旧服务或设置 PORT。` : '本地服务启动失败。');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`EYEVUE Console: http://127.0.0.1:${port}\n仅接受本机连接。播放测试仅指向 E06-003B。`));
}
