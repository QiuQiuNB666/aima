import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chooseScreen, screenKey, placementFeatures, normalizeScene, safeInset, viewportLayout } from './display-core.js';

// Browser lifecycle tests use the actual controller with only its import replaced.
// No display, camera, microphone, capture chooser or network is opened by this suite.
const controllerSource = (await readFile(new URL('./display-controller.js', import.meta.url), 'utf8'))
  .replace(/^import\s+[^\n]+from\s+'\.\/display-core\.js';\s*/u, '');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, ...data }); }
}
function screen(overrides = {}) {
  return Object.assign(new Events(), {
    width: 1920, height: 1080, left: 0, top: 0, availLeft: 0, availTop: 0,
    availWidth: 1920, availHeight: 1040, isPrimary: false, isInternal: false, label: 'XR display', ...overrides,
  });
}
function media() {
  const track = Object.assign(new Events(), { readyState: 'live', stopped: 0,
    stop() { this.stopped++; this.readyState = 'ended'; },
  });
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
async function fixture({ screens = [screen({ isInternal: true, isPrimary: true }), screen({ left: -1920, availLeft: -1920 })], blocked = false } = {}) {
  const elements = new Map();
  const document = Object.assign(new Events(), { hidden: false, getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, value: '', options: [],
      replaceChildren() { this.options = []; }, add(option) { this.options.push(option); },
    });
    return elements.get(id);
  } });
  const details = Object.assign(new Events(), { screens });
  const permission = { state: 'prompt', onchange: null };
  const calls = { capture: [], windows: [], intervals: [] };
  const window = Object.assign(new Events(), {
    getScreenDetails: async () => details,
    open(url, name, features) {
      if (blocked) return null;
      const popup = { url, name, features, closed: false, messages: [], streams: [], receivedStream: null, positions: [], sizes: [], focused: 0,
        document: { fullscreenElement: null },
        close() { this.closed = true; }, focus() { this.focused++; },
        postMessage(message, origin) {
          this.messages.push({ message, origin });
          // postMessage is asynchronous, unlike the same-origin setStream call.
          // Reproduce that ordering so a queued old stop cannot erase a new video.
          Promise.resolve().then(() => { if (message.type === 'stop') this.eyeDisplayReceiver.clearStream(); });
        },
        moveTo(x, y) { this.positions.push([x, y]); }, resizeTo(w, h) { this.sizes.push([w, h]); },
      };
      popup.eyeDisplayReceiver = {
        clearStream: () => { popup.receivedStream = null; },
        setStream: async value => { popup.streams.push(value); popup.receivedStream = value; },
      };
      calls.windows.push(popup); return popup;
    },
  });
  const navigator = { permissions: { query: async () => permission }, mediaDevices: {
    getDisplayMedia(options) { const pending = deferred(); calls.capture.push({ ...pending, options }); return pending.promise; },
  } };
  const origin = 'http://127.0.0.1:4177';
  vm.runInNewContext(controllerSource, {
    window, document, navigator, location: { origin }, crypto: { randomUUID: () => 'fixture' },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    fetch: async () => ({ ok: true, json: async () => ({ available: false }) }),
    AbortSignal: { timeout: () => undefined }, setInterval: fn => { calls.intervals.push(fn); return calls.intervals.length; },
    chooseScreen, screenKey, placementFeatures, normalizeScene, safeInset,
  }, { filename: 'display-controller.js' });
  await flush();
  const el = id => document.getElementById(id);
  async function authorize() { permission.state = 'granted'; await el('display-authorize').onclick(); }
  function message(type, data = {}, extra = {}) { window.emit('message', { source: calls.windows.at(-1), origin, data: { protocol: 'eye-display-v1', type, ...data }, ...extra }); }
  function open() { el('display-open').onclick(); const popup = calls.windows.at(-1); if (popup) message('ready'); return popup; }
  async function capture(value = media()) { const pending = el('display-share').onclick(); calls.capture.at(-1).resolve(value); await pending; return value; }
  return { el, window, details, permission, calls, authorize, open, capture, message };
}

test('auto selection identifies an external primary screen without confusing a non-primary internal screen', () => {
  const internal = screen({ isInternal: true, isPrimary: false });
  const external = screen({ isInternal: false, isPrimary: true });
  assert.equal(chooseScreen([internal, external]).target, external);
  assert.equal(chooseScreen([internal]).target, null);
  assert.equal(chooseScreen([screen({ isInternal: undefined })]).reason, 'no-external');
});

test('ambiguous or missing displays require selection, even when labels and dimensions match', () => {
  const a = screen(), b = screen();
  assert.equal(chooseScreen([a, b]).reason, 'ambiguous');
  assert.notEqual(screenKey(a), screenKey(b));
  assert.equal(chooseScreen([a, b], screenKey(b)).target, b);
  assert.equal(chooseScreen([a], screenKey(b)).reason, 'selection-lost');
  assert.equal(chooseScreen([a], screenKey(b)).target, null, 'Do not silently reroute to the remaining screen.');
});

test('live screen resize and negative CSS coordinates preserve screen identity and placement', () => {
  const a = screen({ availLeft: -1920, availTop: -1080 });
  const id = screenKey(a);
  assert.match(placementFeatures(a), /left=-1920,top=-1080/);
  Object.assign(a, { width: 3840, height: 2160, label: 'Renamed', availLeft: -3840 });
  assert.equal(screenKey(a), id);
  assert.equal(chooseScreen([a], id).target, a);
  assert.match(placementFeatures(a), /left=-3840/);
  assert.equal(chooseScreen([screen({ width: NaN }), screen({ height: 0 })]).target, null);
});

test('scene input cannot activate stereo and invalid optical/layout inputs fall back safely', () => {
  const value = normalizeScene({ title: 'x'.repeat(150), subtitle: {}, theme: 'unknown', mode: 'stereo', ipd: 63 });
  assert.equal(value.title.length, 100);
  assert.equal(value.mode, 'mono');
  assert.equal(value.theme, 'kyoto');
  assert.equal(typeof value.subtitle, 'string');
  assert.doesNotThrow(() => normalizeScene(null));
  assert.equal(safeInset(-10), 0);
  assert.equal(safeInset(90), 12);
  assert.equal(safeInset('bad'), 4);
  assert.equal(safeInset(Infinity), 4);
  assert.equal(viewportLayout(1080, 1920, 2).orientation, 'portrait');
  assert.equal(viewportLayout(1080, 1920, 2).pixelWidth, 2160);
  assert.ok(Number.isFinite(viewportLayout(Infinity, NaN).pixelWidth));
});

test('popup blocking leaves capture unavailable and does not open a chooser', async () => {
  const f = await fixture({ blocked: true });
  await f.authorize(); f.open();
  assert.equal(f.window.EyeDisplay.getState().windowReady, false);
  assert.equal(f.el('display-share').disabled, true);
  await f.el('display-share').onclick();
  assert.equal(f.calls.capture.length, 0);
  assert.match(f.el('display-status').textContent, /拦截/);
});

test('only the same-origin output can make the receiver ready', async () => {
  const f = await fixture(); await f.authorize(); f.el('display-open').onclick();
  f.message('ready', {}, { origin: 'https://other.example' });
  f.message('ready', {}, { source: {} });
  assert.equal(f.window.EyeDisplay.getState().windowReady, false);
  f.message('ready');
  assert.equal(f.window.EyeDisplay.getState().windowReady, true);
});

for (const ending of ['stop', 'unplug', 'close', 'revoke']) {
  test(`a capture chooser completing after ${ending} cannot resume sharing`, async () => {
    const f = await fixture(); await f.authorize(); const popup = f.open();
    const pending = f.el('display-share').onclick();
    assert.equal(f.el('display-stop').disabled, false, 'A pending chooser must be cancellable.');
    if (ending === 'stop') f.el('display-stop').onclick();
    if (ending === 'unplug') { f.details.screens = f.details.screens.filter(s => s.isInternal); f.details.emit('screenschange'); }
    if (ending === 'close') f.el('display-close').onclick();
    if (ending === 'revoke') { f.permission.state = 'denied'; f.permission.onchange(); }
    const late = media(); f.calls.capture[0].resolve(late); await pending;
    assert.equal(late.track.stopped, 1, 'Late capture tracks must be released.');
    assert.equal(popup.streams.length, 0);
    assert.equal(f.window.EyeDisplay.getState().sharing, false);
    assert.equal(f.el('display-stop').disabled, true);
  });
}

test('replacing a capture releases the old stream and its stale ended event cannot stop the new stream', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open();
  const first = await f.capture(); const second = await f.capture();
  assert.equal(first.track.stopped, 1);
  assert.equal(second.track.stopped, 0);
  assert.equal(popup.receivedStream, second, 'A previously queued stop must not clear the new receiver video.');
  first.track.emit('ended');
  assert.equal(f.window.EyeDisplay.getState().sharing, true);
  assert.equal(second.track.stopped, 0);
  assert.deepEqual(popup.streams, [first, second]);
  second.track.emit('ended');
  assert.equal(f.window.EyeDisplay.getState().sharing, false);
});

test('denying a replacement chooser preserves the current shared game', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open(); const first = await f.capture();
  const pending = f.el('display-share').onclick();
  await f.el('display-share').onclick();
  assert.equal(f.calls.capture.length, 2, 'Do not open duplicate chooser requests.');
  f.calls.capture.at(-1).reject(Object.assign(new Error('Cancelled'), { name: 'NotAllowedError' }));
  await pending;
  assert.equal(first.track.stopped, 0);
  assert.equal(popup.receivedStream, first);
  assert.equal(f.window.EyeDisplay.getState().sharing, true);
  assert.equal(f.el('display-share').disabled, false);
});

test('a stale receiver playback rejection cannot stop a newer stream', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open();
  const first = media(), second = media(), firstPlayback = deferred();
  popup.eyeDisplayReceiver.setStream = async value => {
    popup.receivedStream = value;
    if (value === first) await firstPlayback.promise;
  };
  const firstResult = f.window.EyeDisplay.presentStream(first);
  const rejected = assert.rejects(firstResult, /Playback aborted/);
  await f.window.EyeDisplay.presentStream(second);
  firstPlayback.reject(new Error('Playback aborted'));
  await rejected;
  assert.equal(first.track.stopped, 1);
  assert.equal(second.track.stopped, 0);
  assert.equal(popup.receivedStream, second);
  assert.equal(f.window.EyeDisplay.getState().sharing, true);
});

test('rechecking display authorization preserves an explicitly selected target', async () => {
  const a = screen(), b = screen();
  const f = await fixture({ screens: [a, b] }); await f.authorize();
  f.el('display-target').value = screenKey(b); f.el('display-target').onchange();
  const popup = f.open(); const active = await f.capture();
  await f.authorize();
  assert.equal(f.el('display-target').value, screenKey(b));
  assert.equal(popup.closed, false);
  assert.equal(active.track.stopped, 0);
});

test('unplugging an actively shared screen stops capture and never reroutes to another display', async () => {
  const a = screen(), b = screen({ label: 'Second XR display' });
  const f = await fixture({ screens: [a, b] }); await f.authorize();
  assert.equal(f.el('display-open').disabled, true);
  f.el('display-target').value = screenKey(a); f.el('display-target').onchange();
  const popup = f.open(); const stream = await f.capture();
  f.details.screens = [b]; f.details.emit('screenschange');
  assert.equal(stream.track.stopped, 1);
  assert.equal(popup.closed, true);
  assert.equal(f.el('display-open').disabled, true);
  assert.equal(f.window.EyeDisplay.getState().sharing, false);
});

test('a live screen property change adapts the existing output without interrupting capture', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open(); const stream = await f.capture();
  const chosen = f.details.screens.find(s => !s.isInternal);
  Object.assign(chosen, { width: 2560, height: 1440, availLeft: -2560, availTop: -200, availWidth: 2560, availHeight: 1400 });
  chosen.emit('change');
  assert.equal(popup.closed, false);
  assert.equal(stream.track.stopped, 0);
  assert.deepEqual(popup.positions.at(-1), [-2560, -200]);
  assert.deepEqual(popup.sizes.at(-1), [2560, 1400]);
  assert.equal(f.calls.windows.length, 1);
});

test('permission revocation releases an active stream, output and display listeners', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open(); const stream = await f.capture();
  const priorScreens = [...f.details.screens];
  f.permission.state = 'denied'; f.permission.onchange();
  assert.equal(stream.track.stopped, 1);
  assert.equal(popup.closed, true);
  assert.equal(f.window.EyeDisplay.getState().displayPermission, false);
  for (const s of priorScreens) assert.equal(s.listeners.get('change')?.size, 0);
  assert.equal(f.details.listeners.get('screenschange')?.size, 0);
});

test('a late screen-details promise cannot restore authorization revoked while it was pending', async () => {
  const f = await fixture(); const request = deferred();
  f.window.getScreenDetails = () => request.promise;
  const pending = f.authorize();
  f.permission.state = 'denied'; f.permission.onchange();
  request.resolve(f.details); await pending;
  assert.equal(f.window.EyeDisplay.getState().displayPermission, false);
  assert.equal(f.el('display-target').disabled, true);
  assert.equal(f.details.listeners.get('screenschange')?.size || 0, 0);
});

test('manually closing the popup is detected and releases an active stream', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open(); const stream = await f.capture();
  popup.closed = true;
  f.calls.intervals.forEach(fn => fn());
  assert.equal(stream.track.stopped, 1);
  assert.equal(f.window.EyeDisplay.getState().windowReady, false);
  assert.equal(f.window.EyeDisplay.getState().sharing, false);
});

test('page exit releases capture and removes screen-change listeners', async () => {
  const f = await fixture(); await f.authorize(); const popup = f.open(); const stream = await f.capture();
  f.window.emit('pagehide');
  assert.equal(stream.track.stopped, 1);
  assert.equal(popup.closed, true);
  assert.equal(f.details.listeners.get('screenschange')?.size, 0);
});
