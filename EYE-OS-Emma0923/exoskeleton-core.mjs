import http from 'node:http';

const USB_CACHE_MS = 5000;
const SHELLOS_CACHE_MS = 500;
const FRAME_FRESH_MS = 200;
const SOURCE_FRESH_MS = 2000;
const MAX_FUTURE_MS = 1000;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const safeToken = value => typeof value === 'string' && /^[A-Za-z0-9_. -]{1,80}$/.test(value) ? value : null;
const safeReason = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value) ? value : null;
const windowsPort = value => typeof value === 'string' && /^COM[1-9][0-9]{0,4}$/i.test(value) ? value : null;
const serialPort = value => typeof value === 'string'
  && value.length <= 128
  && /^(?:COM[1-9][0-9]{0,4}|\/dev\/tty(?:USB|ACM|S)[0-9]{1,4}|\/dev\/(?:cu|tty)\.(?:usbserial|usbmodem|SLAB_USBtoUART)[A-Za-z0-9_.-]{0,64})$/i.test(value) ? value : null;

export function resolveShellOSPort(value = process.env.SHELLOS_PORT ?? '8765') {
  const text = String(value);
  const port = /^[0-9]{1,5}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('SHELLOS_PORT must be an integer from 1024 through 65535.');
  }
  return port;
}

// Native probes return a small whitelist; IDs, serials and friendly-name suffixes
// never leave the bridge. An empty successful enumeration is distinct from failure.
export function normalizeExoskeletonUsb(report, { platform = process.platform } = {}) {
  if (platform !== 'win32') return { supported: false, available: false, devices: [], error: 'UNSUPPORTED_PLATFORM' };
  if (!plain(report) || report.Available !== true || !Array.isArray(report.Devices)
    || report.Devices.length > 32 || report.Devices.some(device => !plain(device))) {
    return { supported: true, available: false, devices: [], error: 'USB_STATE_UNAVAILABLE' };
  }
  return {
    supported: true, available: true,
    devices: report.Devices.map(device => ({
      name: 'Silicon Labs CP210x USB to UART Bridge',
      port: windowsPort(device.Port),
      status: /^(?:OK|Error|Unknown|Degraded|Disabled)$/i.test(device.Status || '') ? device.Status : 'Unknown',
      problemCode: Number.isInteger(device.ProblemCode) && device.ProblemCode >= 0 && device.ProblemCode <= 65535
        ? device.ProblemCode : null,
    })),
    error: null,
  };
}

function modeOf(report) {
  const port = report.link.port;
  if (port === 'replay' && report.sim.on === false) return 'replay';
  if (report.sim.on === true && (port === 'sim' || port === null || port === undefined)) return 'simulation';
  if (report.sim.on === false && serialPort(port)) return 'hardware';
  return 'unknown';
}

// Validate the identifying state envelope before treating any JSON as ShellOS.
// Missing optional measurements remain null; a malformed frame cannot become live.
function validState(report) {
  return plain(report) && finite(report.t) !== null && report.t > 0 && report.t < 8640000000000
    && plain(report.sim) && typeof report.sim.on === 'boolean' && plain(report.link)
    && Object.hasOwn(report, 'frame')
    && (report.frame === null || (plain(report.frame) && finite(report.frame.l) !== null && finite(report.frame.r) !== null));
}

export function normalizeShellOSState(snapshot, { now = Date.now } = {}) {
  const empty = { reachable: Boolean(snapshot?.reachable), valid: false, mode: 'unknown', error: snapshot?.error || 'INVALID_STATE' };
  if (snapshot?.error || !validState(snapshot?.report)) return { shellos: empty, telemetry: null };
  const report = snapshot.report;
  const current = now();
  const receivedAt = finite(snapshot.receivedAt) ?? current;
  const elapsed = Math.max(0, current - receivedAt);
  const age = finite(report.link.age_ms);
  const sourceAgeMs = current - report.t * 1000;
  // Count local transport time as well as cache time; a slow HTTP body cannot
  // make a frame captured hundreds of milliseconds ago appear new on arrival.
  const frameAgeMs = age !== null && age >= 0 ? age + Math.max(elapsed, sourceAgeMs, 0) : null;
  const fresh = report.frame !== null && frameAgeMs !== null && frameAgeMs <= FRAME_FRESH_MS
    && sourceAgeMs >= -MAX_FUTURE_MS && sourceAgeMs <= SOURCE_FRESH_MS;
  const safety = plain(report.safety) ? report.safety : {};
  const gait = plain(report.gait) ? report.gait : {};
  return {
    shellos: { reachable: true, valid: true, mode: modeOf(report), error: null },
    telemetry: {
      receivedAt: new Date(receivedAt).toISOString(), sourceTime: report.t, fresh, frameAgeMs,
      port: serialPort(report.link.port), enabled: boolean(report.link.enabled),
      angles: { left: finite(report.frame?.l), right: finite(report.frame?.r) },
      angularVelocity: { left: finite(report.frame?.ldps), right: finite(report.frame?.rdps) },
      cadence: finite(gait.cadence), moving: boolean(gait.moving),
      safety: {
        state: safeToken(safety.state), reason: safeReason(safety.reason), deadman: finite(safety.deadman),
        torqueLeft: finite(safety.sent?.[0]), torqueRight: finite(safety.sent?.[1]), softCap: finite(safety.cap),
      },
    },
  };
}

// The only upstream destination is a literal IPv4 loopback address. Configuration
// supplies a port at startup; no URL, hostname, path or method comes from a request.
// Node http does not follow redirects; every non-200 response is rejected here.
export function readShellOSState({ port = resolveShellOSPort(), timeoutMs = 1200, maxBytes = 64 * 1024, now = Date.now } = {}) {
  port = resolveShellOSPort(port);
  return new Promise(resolve => {
    let completed = false;
    let reachable = false;
    let timer;
    const finish = (error, report) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      resolve({ reachable, error, ...(report ? { report } : {}), receivedAt: now() });
    };
    const request = http.request({
      hostname: '127.0.0.1', family: 4, port, path: '/state', method: 'GET', agent: false,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
    }, response => {
      reachable = true;
      const reject = code => { finish(code); response.destroy(); request.destroy(); };
      if (response.statusCode >= 300 && response.statusCode <= 399) return reject('REDIRECT_REJECTED');
      if (response.statusCode !== 200) return reject('UPSTREAM_HTTP_ERROR');
      if (response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return reject('JSON_REQUIRED');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return reject('ENCODING_UNSUPPORTED');
      if (Number(response.headers['content-length']) > maxBytes) return reject('RESPONSE_TOO_LARGE');
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxBytes) return reject('RESPONSE_TOO_LARGE');
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (completed) return;
        let report;
        try { report = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return finish('INVALID_JSON'); }
        if (!validState(report)) return finish('INVALID_STATE');
        finish(null, report);
      });
      response.on('error', () => finish('UPSTREAM_UNAVAILABLE'));
      response.on('aborted', () => finish('UPSTREAM_UNAVAILABLE'));
    });
    request.on('error', () => finish('UPSTREAM_UNAVAILABLE'));
    timer = setTimeout(() => { finish('UPSTREAM_TIMEOUT'); request.destroy(); }, timeoutMs);
    request.end();
  });
}

export function createExoskeletonReader({
  platform = process.platform, queryUsb, now = Date.now, shellosPort = resolveShellOSPort(),
  usbCacheMs = USB_CACHE_MS, shellosCacheMs = SHELLOS_CACHE_MS, shellosTimeoutMs = 1200,
} = {}) {
  const port = resolveShellOSPort(shellosPort);
  let usbCache;
  let usbCachedAt = 0;
  let usbPending;
  let shellosCache;
  let shellosCachedAt = 0;
  let shellosPending;
  async function usbState() {
    if (usbCache && now() - usbCachedAt < usbCacheMs) return usbCache;
    if (!usbPending) {
      usbPending = (async () => {
        let report;
        if (platform === 'win32') {
          try { report = await queryUsb(); } catch { /* Never expose native errors or identifiers. */ }
        }
        usbCache = normalizeExoskeletonUsb(report, { platform });
        usbCachedAt = now();
        return usbCache;
      })().finally(() => { usbPending = undefined; });
    }
    // PnP may take seconds. Refresh an existing presence snapshot in the
    // background so it never holds up the much faster telemetry poll.
    return usbCache || usbPending;
  }
  async function shellosState() {
    if (shellosCache && now() - shellosCachedAt < shellosCacheMs) return shellosCache;
    if (shellosPending) return shellosPending;
    shellosPending = (async () => {
      shellosCache = await readShellOSState({ port, now, timeoutMs: shellosTimeoutMs });
      shellosCachedAt = now();
      return shellosCache;
    })().finally(() => { shellosPending = undefined; });
    return shellosPending;
  }
  return async function exoskeletonState() {
    const usb = await usbState();
    // On the first call, obtain telemetry after the initial USB probe; otherwise
    // that slow probe would make a freshly requested ShellOS frame stale.
    const snapshot = await shellosState();
    return { available: true, checkedAt: new Date(now()).toISOString(), usb, ...normalizeShellOSState(snapshot, { now }) };
  };
}
