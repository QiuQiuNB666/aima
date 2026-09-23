import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createConsoleServer, normalizeDeviceState, normalizeDisplayState } from './server.mjs';

// Every audio test injects a fake player. This suite never invokes a native audio API.
const connected = () => ({
  CapturedAtUtc: '2026-09-23T06:00:00.000Z', Errors: [],
  MatchingEndpoints: [
    { Name: '耳机 (E06-003B)', Flow: 'Render', StateMask: 1, Muted: false, MasterVolumePercent: 90 },
    { Name: '耳机 (E06-003B)', Flow: 'Capture', StateMask: 1, Muted: false, MasterVolumePercent: 100 },
  ],
});

const desktop = () => ({
  CapturedAtUtc: '2026-09-23T06:00:00.000Z',
  Displays: [{ Primary: true, X: 0, Y: 0, Width: 2560, Height: 1600 }],
});

async function fixture(t, overrides = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'eyevue-backend-'));
  const root = path.join(base, 'public');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<h1>EYEVUE</h1>');
  await writeFile(path.join(root, 'app.js'), 'export const ready = true;');
  await mkdir(path.join(root, 'bridge'));
  await writeFile(path.join(root, 'bridge', 'private.js'), 'private native bridge');
  let audioCalls = 0;
  const server = createConsoleServer({
    staticRoot: root, platform: 'win32', queryDevice: async () => connected(),
    queryDisplays: async () => desktop(),
    testAudio: async () => { audioCalls++; }, ...overrides,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(base), path.resolve(os.tmpdir()), 'Cleanup must stay within the temp directory.');
    assert.ok(path.basename(base).startsWith('eyevue-backend-'));
    await rm(base, { recursive: true, force: true });
  });
  function request(route, { method = 'GET', headers = {}, body, chunked = false } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { /* Static content. */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (chunked) { req.write(body.slice(0, 700)); req.end(body.slice(700)); }
      else req.end(body);
    });
  }
  const post = (overrides = {}) => request('/api/audio/test', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}', ...overrides,
  });
  return { base, root, port, origin, server, request, post, get audioCalls() { return audioCalls; } };
}

test('serves the console and health without exposing native source files', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/')).text, '<h1>EYEVUE</h1>');
  assert.match((await app.request('/app.js')).headers['content-type'], /javascript/);
  assert.equal((await app.request('/api/health')).json.bridgeSupported, true);
  assert.equal((await app.request('/api/device')).json.audibility, 'unverified');
  for (const route of ['/bridge/private.js', '/work/test.js', '/.git/config', '/server.mjs', '/backend.test.mjs', '/api/unknown']) {
    assert.equal((await app.request(route)).status, 404, route);
  }
  assert.equal((await app.request('/app.js', { method: 'HEAD' })).text, '');
  assert.equal((await app.request('/api/audio/test')).status, 405);
  assert.equal(app.audioCalls, 0);
});

test('rejects encoded traversal, backslashes, malformed paths and escaping junctions', async t => {
  const app = await fixture(t);
  for (const route of ['/../outside.js', '/%2e%2e/outside.js', '/%5c..%5coutside.js', '/%00app.js', '/%oops', '//elsewhere/app.js']) {
    assert.equal((await app.request(route)).status, 400, route);
  }
  const outside = path.join(app.base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.js'), 'not public');
  await symlink(outside, path.join(app.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(path.join(app.root, 'bridge'), path.join(app.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await app.request('/escape/secret.js')).status, 404);
  assert.equal((await app.request('/alias/private.js')).status, 404);
});

test('requires exact same origin, trusted host and JSON before any audio action', async t => {
  const app = await fixture(t);
  const checks = [
    [{ headers: { 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: 'http://evil.example', Host: 'evil.example', 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: app.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ headers: { Origin: app.origin, 'Content-Type': 'text/plain' } }, 415],
    [{ body: 'invalid' }, 400], [{ body: '[]' }, 400], [{ body: '{"volume":100}' }, 400],
    [{ body: 'x'.repeat(1100) }, 413], [{ body: 'x'.repeat(1100), chunked: true }, 413],
  ];
  for (const [options, expected] of checks) assert.equal((await app.post(options)).status, expected, JSON.stringify(options));
  assert.equal(app.audioCalls, 0);
});

test('caches device snapshots for 15 seconds and shares concurrent probes', async t => {
  let now = 1000;
  let queries = 0;
  const app = await fixture(t, { now: () => now, queryDevice: async () => { queries++; return connected(); } });
  await Promise.all([app.request('/api/device'), app.request('/api/device'), app.request('/api/device')]);
  assert.equal(queries, 1);
  now += 14999;
  await app.request('/api/device');
  assert.equal(queries, 1);
  now += 1;
  await app.request('/api/device');
  assert.equal(queries, 2);
});

test('an audio test refreshes state and never falls back to an unrelated or disconnected device', async t => {
  let report = connected();
  const app = await fixture(t, { queryDevice: async () => report });
  assert.equal((await app.request('/api/device')).json.playback.active, true);
  report = { ...connected(), MatchingEndpoints: [{ Name: 'E06-0055', Flow: 'Render', StateMask: 1 }] };
  const result = await app.post();
  assert.equal(result.status, 409);
  assert.equal(result.json.error, 'DEVICE_UNAVAILABLE');
  report = connected(); report.MatchingEndpoints[0].StateMask = 8;
  assert.equal((await app.post()).json.error, 'DEVICE_UNAVAILABLE');
  report = connected(); report.MatchingEndpoints[0].Muted = true;
  assert.equal((await app.post()).json.error, 'DEVICE_MUTED');
  report = connected(); report.MatchingEndpoints[0].MasterVolumePercent = 0;
  assert.equal((await app.post()).json.error, 'DEVICE_MUTED');
  assert.equal(app.audioCalls, 0);
});

test('serializes tests and asks for human confirmation after driver completion', async t => {
  let release;
  let announce;
  let calls = 0;
  const begun = new Promise(resolve => { announce = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { testAudio: async () => { calls++; announce(); await pending; } });
  const first = app.post();
  await begun;
  const second = await app.post();
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'TEST_BUSY');
  release();
  const result = await first;
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.requiresConfirmation, true);
  assert.equal(calls, 1);
  assert.equal((await app.request('/api/device')).json.audibility, 'unverified');
});

test('reports probe and playback failures honestly and releases the test lock', async t => {
  let failedProbe = true;
  let failedPlayback = true;
  const app = await fixture(t, {
    queryDevice: async () => { if (failedProbe) throw new Error('native failure'); return connected(); },
    testAudio: async () => { if (failedPlayback) throw new Error('driver failure'); },
  });
  const unavailable = (await app.request('/api/device')).json;
  assert.equal(unavailable.error, 'STATE_UNAVAILABLE');
  assert.equal(unavailable.playback.active, false);
  assert.equal((await app.post()).status, 503);
  failedProbe = false;
  assert.equal((await app.post()).json.error, 'PLAYBACK_FAILED');
  failedPlayback = false;
  assert.equal((await app.post()).status, 200);
});

test('non-Windows platforms never call native bridge or invent device support', async t => {
  const unexpected = async () => { assert.fail('Native bridge must not be called.'); };
  const app = await fixture(t, { platform: 'linux', queryDevice: unexpected, testAudio: unexpected });
  const result = (await app.request('/api/device')).json;
  assert.equal(result.bridge, false);
  assert.equal(result.error, 'UNSUPPORTED_PLATFORM');
  assert.equal(result.playback.detected, false);
  assert.equal(result.capabilities.audioInput, false);
  assert.equal((await app.post()).status, 501);
});

test('normalization preserves unknown values and excludes lookalike device names', () => {
  const report = connected();
  report.MatchingEndpoints[0].MasterVolumePercent = null;
  report.MatchingEndpoints[0].Muted = null;
  report.MatchingEndpoints[1].StateMask = 4;
  const value = normalizeDeviceState(report, { platform: 'win32' });
  assert.equal(value.playback.volume, null);
  assert.equal(value.playback.muted, null);
  assert.equal(value.microphone.detected, true);
  assert.equal(value.microphone.active, false);
  assert.equal(value.capabilities.camera, false);
  report.MatchingEndpoints = [{ Name: 'E06-003BX', StateMask: 1, Flow: 'Render' }];
  assert.equal(normalizeDeviceState(report, { platform: 'win32' }).playback.detected, false);
});

test('display normalization exposes only safe geometry, preserving negative coordinates', () => {
  const report = desktop();
  report.SerialNumber = 'private-report-serial';
  report.Displays.push({ Primary: false, X: -1920, Y: 120, Width: 1920, Height: 1080,
    DeviceId: 'private-native-device-path', SerialNumber: 'private-monitor-serial', Label: 'untrusted hardware label' });
  const result = normalizeDisplayState(report, { platform: 'win32' });
  assert.equal(result.available, true);
  assert.equal(result.checkedAt, report.CapturedAtUtc);
  assert.deepEqual(result.displays, [
    { id: 'display-1', label: '显示器 1', primary: true, x: 0, y: 0, width: 2560, height: 1600 },
    { id: 'display-2', label: '显示器 2', primary: false, x: -1920, y: 120, width: 1920, height: 1080 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private-|untrusted|DeviceId|SerialNumber/);
  for (const invalid of [null, {}, { Displays: [{}] }, { Displays: [{ ...report.Displays[0], Width: 0 }] },
    { Displays: [{ ...report.Displays[0], X: Infinity }] }, { Displays: [{ ...report.Displays[0], Primary: 'yes' }] }]) {
    const unavailable = normalizeDisplayState(invalid, { platform: 'win32', now: () => 0 });
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.error, 'STATE_UNAVAILABLE');
    assert.deepEqual(unavailable.displays, []);
    assert.equal(unavailable.checkedAt, '1970-01-01T00:00:00.000Z');
  }
});

test('display API refreshes a hot-plug snapshot on its own short cache and shares concurrent probes', async t => {
  let now = 1000;
  let displayQueries = 0;
  let audioQueries = 0;
  let report = desktop();
  const app = await fixture(t, {
    now: () => now,
    queryDevice: async () => { audioQueries++; return connected(); },
    queryDisplays: async () => { displayQueries++; return report; },
  });
  const results = await Promise.all([app.request('/api/displays'), app.request('/api/displays'), app.request('/api/displays')]);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal(result.json.available, true);
    assert.equal(result.json.displays.length, 1);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal(displayQueries, 1);
  assert.equal(audioQueries, 0);
  await app.request('/api/device');
  report = desktop();
  report.Displays.push({ Primary: false, X: 2560, Y: 0, Width: 1920, Height: 1080 });
  now += 2999;
  assert.equal((await app.request('/api/displays')).json.displays.length, 1);
  now++;
  assert.equal((await app.request('/api/displays')).json.displays.length, 2);
  assert.equal(displayQueries, 2);
  await app.request('/api/device');
  assert.equal(audioQueries, 1, 'Display refresh must not invalidate the audio cache.');
  assert.equal((await app.request('/api/displays', { method: 'POST' })).status, 405);
  assert.equal((await app.request('/api/displays', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await app.request('/api/displays', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('display failures expose no native error details and recover on refresh', async t => {
  let now = 0;
  let report;
  const app = await fixture(t, {
    now: () => now,
    queryDisplays: async () => { if (!report) throw new Error('private native device serial'); return report; },
  });
  const failed = await app.request('/api/displays');
  assert.equal(failed.json.available, false);
  assert.equal(failed.json.error, 'STATE_UNAVAILABLE');
  assert.deepEqual(failed.json.displays, []);
  assert.doesNotMatch(failed.text, /private native/);
  now += 3000;
  report = { Displays: [{ Primary: true, X: 0, Y: 0, Width: '1920', Height: 1080 }] };
  assert.equal((await app.request('/api/displays')).json.error, 'STATE_UNAVAILABLE');
  now += 3000;
  report = desktop();
  assert.equal((await app.request('/api/displays')).json.displays.length, 1);
  now += 3000;
  report = { Displays: [] };
  assert.equal((await app.request('/api/displays')).json.available, true);
  assert.deepEqual((await app.request('/api/displays')).json.displays, []);
});

test('non-Windows display API is unavailable without invoking a native probe', async t => {
  const app = await fixture(t, {
    platform: 'darwin', queryDisplays: async () => { assert.fail('Do not invoke the Windows display probe.'); },
  });
  const result = (await app.request('/api/displays')).json;
  assert.equal(result.available, false);
  assert.equal(result.platform, 'darwin');
  assert.equal(result.error, 'UNSUPPORTED_PLATFORM');
  assert.deepEqual(result.displays, []);
});
