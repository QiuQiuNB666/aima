import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createConsoleServer } from './server.mjs';
import { createExoskeletonReader, normalizeExoskeletonUsb, normalizeShellOSState, readShellOSState, resolveShellOSPort } from './exoskeleton-core.mjs';

// Every native probe is injected; no test opens serial ports, sends commands, or plays audio.
const NOW = Date.parse('2026-09-24T06:00:00.000Z');
const report = (overrides = {}) => ({
  t: NOW / 1000, sim: { on: false }, link: { port: 'COM7', age_ms: 15, enabled: true },
  frame: { l: -2.5, r: 4.2, ldps: 12, rdps: -3 }, gait: { cadence: 0.8, moving: true },
  safety: { state: 'ACTIVE', reason: 'OK', deadman: 1, sent: [0.1, 0.2], cap: 0.8 },
  ...overrides,
});
const native = () => ({ Available: true, Devices: [{ Name: 'private serial', Port: 'COM7', Status: 'OK', ProblemCode: 0 }] });
const normalized = (value, now = NOW) => normalizeShellOSState({ reachable: true, error: null, receivedAt: NOW, report: value }, { now: () => now });

async function listen(t, listener) {
  const server = http.createServer(listener);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { server, port: server.address().port };
}
const send = (res, value = report()) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };

async function appFixture(t, overrides = {}) {
  const { handsSource = false, ...serverOverrides } = overrides;
  const requests = [];
  const upstream = await listen(t, (req, res) => { requests.push({ method: req.method, url: req.url, host: req.headers.host }); send(res); });
  let probes = 0;
  let audioCalls = 0;
  const app = createConsoleServer({
    platform: 'win32', now: () => NOW, shellosPort: handsSource ? (upstream.port === 65535 ? 65534 : upstream.port+1) : upstream.port,
    handsPort: handsSource ? upstream.port : '',
    queryExoskeletonUsb: async () => { probes++; return native(); },
    queryDevice: async () => { throw new Error('Unexpected audio probe'); },
    queryDisplays: async () => { throw new Error('Unexpected display probe'); },
    testAudio: async () => { audioCalls++; }, ...serverOverrides,
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const port = app.address().port;
  const request = (route = '/api/exoskeleton', { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject); req.end();
  });
  return { request, requests, upstreamPort: upstream.port, origin: `http://127.0.0.1:${port}`, get probes() { return probes; }, get audioCalls() { return audioCalls; } };
}

test('hands telemetry bypasses USB discovery and old status caches using only fixed upstream GETs', async t => {
  const app = await appFixture(t, {handsSource:true});
  const first = await app.request('/api/hands-telemetry');
  assert.equal(first.status,200); assert.equal(first.json.hardwareOutput,false);
  assert.equal(first.json.shellos.mode,'hardware'); assert.equal(app.probes,0);
  assert.equal(Object.hasOwn(first.json,'usb'),false);
  await app.request('/api/hands-telemetry'); assert.equal(app.requests.length,2);
  assert.ok(app.requests.every(item=>item.method==='GET' && item.url==='/state'));
  assert.equal((await app.request('/api/hands-telemetry',{method:'POST'})).status,405);
  assert.equal((await app.request('/api/hands-telemetry?port=22')).status,400);
  assert.equal((await app.request('/api/hands-telemetry',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal(app.requests.length,2); assert.equal(app.audioCalls,0);
});

test('hand source is opt-in and cannot silently use the leg service',async t=>{
  const app=await appFixture(t);const value=await app.request('/api/hands-telemetry');
  assert.equal(value.json.error,'HANDS_SOURCE_NOT_CONFIGURED');assert.equal(app.requests.length,0);
  assert.throws(()=>createConsoleServer({shellosPort:18765,handsPort:18765}),/must differ/);
});

test('reports hardware, simulation and replay as distinct sources without leaking raw state', () => {
  const value = report({ wearer: { name: 'private wearer' }, events: ['private events'], shots: 'private shots', raw: 'private data' });
  value.link.instanceId = 'private instance'; value.safety.raw = 'private safety';
  const hardware = normalized(value);
  assert.deepEqual(hardware.shellos, { reachable: true, valid: true, mode: 'hardware', error: null });
  assert.equal(hardware.telemetry.fresh, true);
  assert.deepEqual(hardware.telemetry.angles, { left: -2.5, right: 4.2 });
  assert.deepEqual(hardware.telemetry.angularVelocity, { left: 12, right: -3 });
  assert.equal(hardware.telemetry.safety.torqueRight, 0.2);
  assert.doesNotMatch(JSON.stringify(hardware), /private|wearer|events|shots|instanceId|"raw"/);
  assert.equal(normalized(report({ sim: { on: true }, link: { port: 'sim', age_ms: 0 } })).shellos.mode, 'simulation');
  assert.equal(normalized(report({ link: { port: 'replay', age_ms: 0 } })).shellos.mode, 'replay');
  assert.equal(normalized(report({ link: { port: '(未连接)', age_ms: 0 } })).shellos.mode, 'unknown');
  assert.equal(normalized(report({ sim: { on: true } })).shellos.mode, 'unknown', 'Conflicting source markers cannot claim hardware.');
  assert.equal(normalized(report({ link: { port: 'replay', age_ms: 0 } })).telemetry.port, null);
  for (const port of ['/dev/cu.usbserial-0001', '/dev/cu.usbmodem1101', '/dev/cu.SLAB_USBtoUART', '/dev/tty.usbserial-0001', '/dev/ttyUSB0']) {
    const result = normalized(report({ link: { port, age_ms: 0 } }));
    assert.equal(result.shellos.mode, 'hardware', port); assert.equal(result.telemetry.port, port);
  }
  for (const port of ['/dev/cu.usbserial-a/../../private', `/dev/cu.usbserial-${'x'.repeat(200)}`, 'http://127.0.0.1:8765']) {
    assert.equal(normalized(report({ link: { port, age_ms: 0 } })).shellos.mode, 'unknown');
  }
  const reason = '串口未连接：请检查 COM7（已停止）';
  assert.equal(normalized(report({ safety: { reason } })).telemetry.safety.reason, reason);
  for (const invalid of ['Traceback:\n  private native stack', 'x'.repeat(201), 'Error\u0000private']) {
    assert.equal(normalized(report({ safety: { reason: invalid } })).telemetry.safety.reason, null);
  }
});

test('freshness requires a real frame, age <= 200ms and a recent plausible source time', () => {
  assert.equal(normalized(report({ link: { port: 'COM7', age_ms: 200 } })).telemetry.fresh, true);
  assert.equal(normalized(report({ link: { port: 'COM7', age_ms: 201 } })).telemetry.fresh, false);
  assert.equal(normalized(report(), NOW + 186).telemetry.fresh, false, 'Cached snapshots must age.');
  const delayed = normalizeShellOSState({ reachable: true, error: null, report: report(), receivedAt: NOW + 400 }, { now: () => NOW + 400 });
  assert.equal(delayed.telemetry.fresh, false, 'HTTP transit time must not rejuvenate an old frame.');
  assert.equal(delayed.telemetry.frameAgeMs, 415);
  for (const age_ms of [null, undefined, -1, '0', Infinity]) {
    assert.equal(normalized(report({ link: { port: 'COM7', age_ms } })).telemetry.fresh, false);
  }
  assert.equal(normalized(report({ frame: null })).telemetry.fresh, false);
  assert.deepEqual(normalized(report({ frame: null })).telemetry.angles, { left: null, right: null });
  assert.equal(normalized(report({ t: (NOW - 2001) / 1000 })).telemetry.fresh, false);
  assert.equal(normalized(report({ t: (NOW + 1001) / 1000 })).telemetry.fresh, false);
  assert.equal(normalized(report({ link: { port: 'COM7', enabled: false, age_ms: 9000 } })).telemetry.fresh, false);
  const absent = normalized(report({ gait: {}, safety: {}, frame: { l: 0, r: 0 } })).telemetry;
  assert.equal(absent.angularVelocity.left, null); assert.equal(absent.moving, null); assert.equal(absent.safety.deadman, null);
});

test('malformed state or malformed non-null frames never produce telemetry', () => {
  for (const invalid of [null, [], {}, { ok: true }, report({ t: '0' }), report({ sim: {} }),
    report({ frame: {} }), report({ frame: { l: '1', r: 2 } }), report({ frame: { l: NaN, r: 2 } }), report({ frame: undefined })]) {
    const result = normalized(invalid);
    assert.equal(result.shellos.valid, false); assert.equal(result.shellos.mode, 'unknown'); assert.equal(result.telemetry, null);
  }
});

test('USB success, empty enumeration, failure and unsupported platforms remain distinct', () => {
  const usb = normalizeExoskeletonUsb(native(), { platform: 'win32' });
  assert.equal(usb.available, true); assert.equal(usb.devices.length, 1); assert.equal(usb.devices[0].port, 'COM7');
  assert.doesNotMatch(JSON.stringify(usb), /private|serial|instanceId|MAC/);
  assert.deepEqual(normalizeExoskeletonUsb({ Available: true, Devices: [] }, { platform: 'win32' }), { supported: true, available: true, devices: [], error: null });
  for (const malformed of [undefined, {}, { Available: false, Devices: [] }, { Available: true, Devices: [null] }]) {
    assert.deepEqual(normalizeExoskeletonUsb(malformed, { platform: 'win32' }), { supported: true, available: false, devices: [], error: 'USB_STATE_UNAVAILABLE' });
  }
  assert.deepEqual(normalizeExoskeletonUsb(native(), { platform: 'linux' }), { supported: false, available: false, devices: [], error: 'UNSUPPORTED_PLATFORM' });
});

test('fixed upstream request is GET /state on literal loopback and returns only the public contract', async t => {
  const app = await appFixture(t);
  const result = await app.request();
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(result.json).sort(), ['available', 'checkedAt', 'shellos', 'telemetry', 'usb']);
  assert.equal(result.json.available, true); assert.equal(result.json.shellos.mode, 'hardware');
  assert.deepEqual(app.requests, [{ method: 'GET', url: '/state', host: `127.0.0.1:${app.upstreamPort}` }]);
  assert.equal(app.audioCalls, 0);
});

test('API keeps host, origin, cross-site and static isolation and rejects caller destination overrides', async t => {
  const app = await appFixture(t);
  for (const options of [{ headers: { Host: 'evil.example' } }, { headers: { Origin: 'https://evil.example' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]) {
    assert.equal((await app.request('/api/exoskeleton', options)).status, 403);
  }
  assert.equal((await app.request('/api/exoskeleton', { method: 'POST' })).status, 405);
  for (const query of ['?url=http://example.com/state', '?host=localhost&port=80', '?force=true']) assert.equal((await app.request(`/api/exoskeleton${query}`)).status, 400);
  assert.equal(app.requests.length, 0); assert.equal(app.probes, 0); assert.equal(app.audioCalls, 0);
  for (const route of ['/exoskeleton-core.mjs', '/exoskeleton.test.mjs', '/bridge/Get-ExoskeletonState.ps1']) assert.equal((await app.request(route)).status, 404);
  assert.equal((await app.request('/api/exoskeleton', { headers: { Origin: app.origin } })).status, 200);
});

test('USB and upstream use independent 5s / 500ms caches with concurrent request sharing', async t => {
  let now = NOW;
  const app = await appFixture(t, { now: () => now });
  const result = await Promise.all(Array.from({ length: 8 }, () => app.request()));
  assert.ok(result.every(value => value.json.telemetry.fresh));
  assert.equal(app.probes, 1); assert.equal(app.requests.length, 1);
  now += 499;
  assert.equal((await app.request()).json.telemetry.fresh, false);
  assert.equal(app.probes, 1); assert.equal(app.requests.length, 1);
  now++;
  await Promise.all([app.request(), app.request()]);
  assert.equal(app.probes, 1); assert.equal(app.requests.length, 2);
  now = NOW + 5000;
  await Promise.all([app.request(), app.request()]);
  assert.equal(app.probes, 2); assert.equal(app.requests.length, 3);
});

test('slow USB probes cannot age the initial telemetry or block later telemetry polls', async t => {
  let now = NOW;
  let upstreamCalls = 0;
  const upstream = await listen(t, (_req, res) => { upstreamCalls++; send(res, report({ t: now / 1000 })); });
  let releaseFirst;
  let releaseSecond;
  let announceSecond;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const secondStarted = new Promise(resolve => { announceSecond = resolve; });
  let probes = 0;
  const read = createExoskeletonReader({ platform: 'win32', shellosPort: upstream.port, now: () => now,
    queryUsb: async () => {
      probes++;
      if (probes === 1) await firstGate;
      else { announceSecond(); await secondGate; }
      return { Available: true, Devices: [{ Port: probes === 1 ? 'COM7' : 'COM8', Status: 'OK' }] };
    },
  });
  const first = read();
  assert.equal(upstreamCalls, 0, 'Initial telemetry is not fetched before the slow USB probe.');
  now += 3000; releaseFirst();
  const initial = await first;
  assert.equal(initial.telemetry.fresh, true); assert.equal(initial.usb.devices[0].port, 'COM7');
  now += 5000;
  const refresh = read();
  await secondStarted;
  const current = await refresh;
  assert.equal(current.telemetry.fresh, true); assert.equal(current.usb.devices[0].port, 'COM7');
  assert.equal(upstreamCalls, 2); assert.equal(probes, 2, 'Concurrent USB refresh is shared.');
  await read(); assert.equal(probes, 2);
  releaseSecond();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await read()).usb.devices[0].port, 'COM8');
});

test('native failures reveal no private errors and non-Windows never invokes the bridge', async t => {
  const failed = await appFixture(t, { queryExoskeletonUsb: async () => { throw new Error('private hardware serial'); } });
  const result = await failed.request();
  assert.equal(result.json.usb.available, false); assert.equal(result.json.usb.error, 'USB_STATE_UNAVAILABLE');
  assert.doesNotMatch(result.text, /private hardware/);
  const other = await appFixture(t, { platform: 'linux', queryExoskeletonUsb: async () => assert.fail('Do not probe Windows hardware') });
  const unsupported = (await other.request()).json;
  assert.equal(unsupported.usb.supported, false); assert.equal(unsupported.usb.available, false);
  assert.equal(unsupported.shellos.reachable, true, 'A separate local ShellOS process can still run on another platform.');
});

test('offline upstream never becomes connected just because a USB adapter was enumerated', async t => {
  const unused = http.createServer();
  await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve));
  const port = unused.address().port;
  await new Promise(resolve => unused.close(resolve));
  const read = createExoskeletonReader({ shellosPort: port, platform: 'win32', queryUsb: async () => native() });
  const value = await read();
  assert.equal(value.usb.devices.length, 1); assert.equal(value.shellos.reachable, false);
  assert.equal(value.shellos.valid, false); assert.equal(value.shellos.mode, 'unknown'); assert.equal(value.telemetry, null);
  assert.equal(value.shellos.error, 'UPSTREAM_UNAVAILABLE');
});

test('rejects HTML, invalid JSON, wrong state, HTTP errors, compression and oversized upstream responses', async t => {
  const cases = [
    ['JSON_REQUIRED', res => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Welcome</h1>'); }],
    ['INVALID_JSON', res => { res.setHeader('Content-Type', 'application/json'); res.end('{oops'); }],
    ['INVALID_STATE', res => send(res, { ok: true })],
    ['UPSTREAM_HTTP_ERROR', res => { res.statusCode = 500; res.end('private exception'); }],
    ['ENCODING_UNSUPPORTED', res => { res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Encoding', 'gzip'); res.end('bytes'); }],
    ['RESPONSE_TOO_LARGE', res => { res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Length', 70000); res.end('x'.repeat(70000)); }],
    ['RESPONSE_TOO_LARGE', res => { res.setHeader('Content-Type', 'application/json'); res.write('x'.repeat(40000)); res.end('x'.repeat(40000)); }],
  ];
  for (const [expected, handler] of cases) {
    const upstream = await listen(t, (_req, res) => handler(res));
    const snapshot = await readShellOSState({ port: upstream.port });
    assert.equal(snapshot.error, expected); assert.equal(snapshot.reachable, true);
    assert.equal(normalizeShellOSState(snapshot).telemetry, null);
    assert.doesNotMatch(JSON.stringify(snapshot), /private exception|Welcome|oops/);
  }
});

test('never follows redirects, and bounds total response time including slowly arriving bodies', async t => {
  let targetCalls = 0;
  const target = await listen(t, (_req, res) => { targetCalls++; send(res); });
  const redirect = await listen(t, (_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/state` }); res.end(); });
  assert.equal((await readShellOSState({ port: redirect.port })).error, 'REDIRECT_REJECTED');
  assert.equal(targetCalls, 0);
  const silent = await listen(t, () => {});
  const missing = await readShellOSState({ port: silent.port, timeoutMs: 40 });
  assert.equal(missing.error, 'UPSTREAM_TIMEOUT'); assert.equal(missing.reachable, false);
  const slow = await listen(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.write('{'); });
  const partial = await readShellOSState({ port: slow.port, timeoutMs: 40 });
  assert.equal(partial.error, 'UPSTREAM_TIMEOUT'); assert.equal(partial.reachable, true);
});

test('startup port validation accepts only a local port number and native script contains only read enumeration', async () => {
  assert.equal(resolveShellOSPort('8765'), 8765);
  for (const invalid of ['http://localhost:8765', '127.0.0.1:8765', 0, 80, 65536, '8765/state', ' 8765', '1e4', 1234.5]) assert.throws(() => resolveShellOSPort(invalid));
  const script = await readFile(new URL('./bridge/Get-ExoskeletonState.ps1', import.meta.url), 'utf8');
  assert.match(script, /Get-PnpDevice -PresentOnly/);
  assert.match(script, /VID_10C4&PID_EA60/);
  assert.match(script, /\$_.Present -eq \$true/);
  assert.doesNotMatch(script, /SerialPort|Write-Output.*InstanceId|Set-PnpDevice|Enable-PnpDevice|Disable-PnpDevice|Invoke-WebRequest|Start-Process/);
});
