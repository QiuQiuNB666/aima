import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./exoskeleton-controller.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  emit(type, detail) { for (const fn of this.listeners.get(type) || []) fn({type, detail}); }
}
class Element {
  textContent = ''; disabled = false; dataset = {}; children = []; attributes = {}; title = '';
  constructor() { this.classes = new Set(); this.classList = {contains:name => this.classes.has(name)}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  set innerHTML(_) { throw new Error('Upstream data must never be interpreted as HTML.'); }
}
function fixture({page = 'device', hidden = false} = {}) {
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  if (page !== 'device') elements.get('page-device').classes.add('hidden');
  const document = Object.assign(new Events(), {hidden, getElementById:id => {
    assert.ok(elements.has(id), `Controller element exists in the actual markup: ${id}`); return elements.get(id);
  }, createElement:() => new Element()});
  const window = new Events(), navigator = {onLine:true};
  let now = 1700000000000, timerId = 0;
  const intervals = new Map(), timeouts = new Map(), calls = [];
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  vm.runInNewContext(source, {
    document, window, navigator, AbortController, Date:ClockDate,
    setInterval:(fn, delay) => { const id = ++timerId; intervals.set(id, {fn, delay}); return id; }, clearInterval:id => intervals.delete(id),
    setTimeout:(fn, delay) => { const id = ++timerId; timeouts.set(id, {fn, due:now + delay}); return id; }, clearTimeout:id => timeouts.delete(id),
    fetch:(url, options) => new Promise((resolve, reject) => calls.push({url, options, resolve, reject})),
  }, {filename:'exoskeleton-controller.js'});
  const el = id => elements.get(id);
  async function reply(value = sample({}, now), call = calls.at(-1), ok = true) { call.resolve({ok, json:async () => value}); await flush(); }
  async function advance(ms = 1000) {
    now += ms;
    for (const [id, timeout] of [...timeouts]) if (timeout.due <= now) { timeouts.delete(id); timeout.fn(); }
    for (const timer of [...intervals.values()]) timer.fn();
    await flush();
  }
  function visibility(value) { document.hidden = value; document.emit('visibilitychange'); }
  function navigate(value) { window.emit('eye:page', {page:value}); }
  return {el, document, window, navigator, calls, intervals, timeouts, reply, advance, visibility, navigate};
}
function sample(overrides = {}, sampledAt = 1700000000000) {
  return {
    available:true, checkedAt:new Date(sampledAt).toISOString(),
    usb:{supported:true, available:true, devices:[{name:'Silicon Labs CP210x USB to UART Bridge', port:'COM5', status:'OK', problemCode:0}], error:null},
    shellos:{reachable:true, valid:true, mode:'hardware', error:null},
    telemetry:{receivedAt:new Date(sampledAt).toISOString(), sourceTime:sampledAt / 1000, fresh:true, frameAgeMs:20, port:'COM5', enabled:false,
      angles:{left:12.25, right:-8.5}, angularVelocity:{left:4.7, right:2.9}, cadence:85.1, moving:true,
      safety:{state:'DISARMED', reason:null, deadman:0, torqueLeft:0.17, torqueRight:-0.15, softCap:0.8}},
    ...overrides,
  };
}

test('loading and a one-shot USB check never start polling or imply a hardware connection', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.intervals.size, 0);
  const pending = f.el('exo-refresh').onclick();
  assert.equal(f.calls[0].url, '/api/exoskeleton');
  assert.equal(f.calls[0].options.method, 'GET'); assert.equal(f.calls[0].options.cache, 'no-store');
  await f.reply(sample({usb:{supported:true, available:true, devices:[], error:null}, shellos:{reachable:false, valid:false, mode:'unknown'}, telemetry:null}));
  await pending;
  assert.equal(f.intervals.size, 0); assert.equal(f.el('exo-usb-state').textContent, '未发现 CP210x 串口');
  assert.match(f.el('exo-shellos-note').textContent, /127\.0\.0\.1:8765/);
  assert.equal(f.el('exo-badge').dataset.tone, 'quiet'); assert.equal(f.el('exo-angle-left').textContent, '—');
});

test('single hand layout shows disabled leg role as normal and stops leg polling',async()=>{
  const f=fixture();f.el('exo-start').onclick();
  await f.reply({available:false,layout:'single-hands',error:'LEGS_ROLE_DISABLED'});
  assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
  assert.equal(f.el('exo-badge').textContent,'单套双手 · 腿部关闭');
  assert.match(f.el('exo-status').textContent,/这是正常状态/);
  await f.advance();assert.equal(f.calls.length,1);
});

test('visible reading uses one 1-second poll with no overlapping requests', async () => {
  const f = fixture(); f.el('exo-start').onclick(); f.el('exo-start').onclick();
  assert.equal(f.calls.length, 1); assert.equal(f.intervals.size, 1); assert.equal([...f.intervals.values()][0].delay, 1000);
  await f.advance(); await f.advance(); assert.equal(f.calls.length, 1);
  await f.reply();
  assert.equal(f.el('exo-badge').dataset.tone, 'live'); assert.equal(f.el('exo-angle-left').textContent, '12.3°');
  assert.equal(f.el('exo-enabled').textContent, '未使能'); assert.equal(f.el('exo-torque-right').textContent, '-0.15 N·m');
  await f.advance(); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

test('paused, hidden, navigated-away and page-hidden lifecycles abort and clear all timers', async () => {
  for (const ending of ['pause', 'hide', 'navigate', 'pagehide']) {
    const f = fixture(); f.el('exo-start').onclick(); const call = f.calls[0];
    if (ending === 'pause') f.el('exo-pause').onclick();
    if (ending === 'hide') f.visibility(true);
    if (ending === 'navigate') f.navigate('overview');
    if (ending === 'pagehide') f.window.emit('pagehide');
    assert.equal(call.options.signal.aborted, true, ending);
    assert.equal(f.intervals.size, 0, ending); assert.equal(f.timeouts.size, 0, ending);
    await f.reply(sample(), call);
    assert.equal(f.el('exo-badge').dataset.tone, 'quiet', ending);
    assert.equal(f.el('exo-angle-left').textContent, '—', ending);
  }
});

test('a late cancelled response cannot overwrite a newer read after resume', async () => {
  const f = fixture(); f.el('exo-start').onclick(); const old = f.calls[0];
  f.el('exo-pause').onclick(); f.el('exo-start').onclick(); const current = f.calls[1];
  const fresh = sample(); fresh.telemetry.angles.left = 27;
  await f.reply(fresh, current); assert.equal(f.el('exo-angle-left').textContent, '27.0°');
  await f.reply(sample(), old); assert.equal(f.el('exo-angle-left').textContent, '27.0°');
});

test('a stalled request cannot keep old measurements green', async () => {
  const f = fixture(); f.el('exo-start').onclick(); await f.reply();
  await f.advance(); assert.equal(f.calls.length, 2);
  await f.advance(2000);
  assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
  assert.equal(f.el('exo-angle-left').textContent, '—'); assert.match(f.el('exo-data-state').textContent, /过时/);
});

test('backend freshness and the 200-ms frame limit are both required', async () => {
  for (const patch of [{fresh:false}, {frameAgeMs:201}, {frameAgeMs:null}, {frameAgeMs:-1}]) {
    const f = fixture(), value = sample(); Object.assign(value.telemetry, patch);
    f.el('exo-start').onclick(); await f.reply(value);
    assert.equal(f.el('exo-badge').dataset.tone, 'quiet'); assert.equal(f.el('exo-angle-left').textContent, '—');
  }
});

test('a request completing after its deadline cannot revive live status', async () => {
  const f = fixture(); f.el('exo-start').onclick(); const expired = f.calls[0];
  await f.advance(8000); assert.equal(expired.options.signal.aborted, false, 'Initial USB discovery may take over 7 seconds.');
  await f.advance(1000); assert.equal(expired.options.signal.aborted, true);
  await f.reply(sample(), expired);
  assert.equal(f.el('exo-badge').dataset.tone, 'quiet'); assert.equal(f.el('exo-angle-left').textContent, '—');
  assert.equal(f.el('exo-badge').textContent, '本机桥接不可用');
});

test('simulation and replay are named explicitly and never get the green hardware indicator', async () => {
  for (const [mode, label] of [['simulation','模拟'], ['replay','回放'], ['unknown','未确认']]) {
    const f = fixture(), value = sample(); value.shellos.mode = mode;
    f.el('exo-start').onclick(); await f.reply(value);
    assert.equal(f.el('exo-badge').dataset.tone, 'preview'); assert.match(f.el('exo-source').textContent, new RegExp(label));
    assert.match(f.el('exo-data-note').textContent, new RegExp(label));
    assert.doesNotMatch(f.el('exo-data-note').textContent, /设备上报/);
  }
});

test('an 8-second delayed fresh:true snapshot cannot become live on arrival', async () => {
  const f = fixture(), old = sample(); f.el('exo-start').onclick();
  await f.advance(8000); await f.reply(old);
  assert.equal(f.el('exo-badge').dataset.tone, 'quiet'); assert.equal(f.el('exo-angle-left').textContent, '—');
  assert.match(f.el('exo-data-state').textContent, /过时/);
});

test('long initial USB discovery still accepts a newly captured snapshot before the deadline', async () => {
  const f = fixture(); f.el('exo-start').onclick(); await f.advance(8000);
  await f.reply();
  assert.equal(f.el('exo-badge').dataset.tone, 'live'); assert.equal(f.el('exo-angle-left').textContent, '12.3°');
});

test('HTTP transport delay counts toward the 200-ms frame limit at receipt', async () => {
  for (const [delay, expected] of [[180, 'live'], [181, 'quiet'], [1000, 'quiet']]) {
    const f = fixture(), old = sample(); f.el('exo-start').onclick(); await f.advance(delay); await f.reply(old);
    assert.equal(f.el('exo-badge').dataset.tone, expected, `20-ms source frame plus ${delay}-ms delivery`);
    assert.equal(f.el('exo-frame-age').textContent, `采样时帧龄：${20 + delay} ms`);
  }
});

test('missing, malformed, future or stale source timestamps never produce a live indicator', async () => {
  const variants = [
    value => { delete value.checkedAt; }, value => { value.checkedAt = 'invalid'; },
    value => { value.checkedAt = '2023-11-14T22:13:21.000Z'; },
    value => { delete value.telemetry.sourceTime; }, value => { value.telemetry.sourceTime = NaN; },
    value => { value.telemetry.sourceTime = 1700000002; }, value => { value.telemetry.sourceTime = 1699999997; },
    value => { value.telemetry.sourceTime = 1699999999; },
  ];
  for (const mutate of variants) {
    const f = fixture(), value = sample(); mutate(value); f.el('exo-start').onclick(); await f.reply(value);
    assert.equal(f.el('exo-badge').dataset.tone, 'quiet'); assert.equal(f.el('exo-angle-left').textContent, '—');
  }
});

test('visibility and network recovery fetch a fresh response before showing live data again', async () => {
  const f = fixture(); f.el('exo-start').onclick(); await f.reply();
  f.visibility(true); assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
  f.visibility(false); assert.equal(f.calls.length, 2); assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
  await f.reply(); assert.equal(f.el('exo-badge').dataset.tone, 'live');
  f.navigator.onLine = false; f.window.emit('offline');
  assert.equal(f.intervals.size, 0); assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
  assert.equal(f.el('exo-angle-left').textContent, '—');
  f.navigator.onLine = true; f.window.emit('online');
  assert.equal(f.calls.length, 3); assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
  await f.reply(); assert.equal(f.el('exo-badge').dataset.tone, 'live');
});

test('mobile/static bridge failures clear telemetry and do not report a glasses fault', async () => {
  const f = fixture(); f.el('exo-start').onclick(); await f.reply(); await f.advance();
  await f.reply({error:'not found'}, f.calls.at(-1), false);
  assert.equal(f.el('exo-badge').textContent, '本机桥接不可用');
  assert.equal(f.el('exo-angle-left').textContent, '—'); assert.match(f.el('exo-status').textContent, /手机或静态页面/);
  assert.doesNotMatch(f.el('exo-status').textContent, /眼镜.*故障/);
});

test('upstream labels use text nodes and nonfinite or missing numbers remain unknown', async () => {
  const f = fixture(), value = sample();
  value.usb.devices[0].name = 'CP210x <img src=x onerror=alert(1)>';
  value.telemetry.safety.state = '<script>alert(1)</script>';
  value.telemetry.angles.left = null; value.telemetry.angles.right = Infinity; value.telemetry.cadence = '100';
  f.el('exo-start').onclick(); await f.reply(value);
  assert.equal(f.el('exo-guard').textContent, '<script>alert(1)</script>');
  assert.match(f.el('exo-ports').children[0].children[0].textContent, /<img/);
  assert.equal(f.el('exo-angle-left').textContent, '—'); assert.equal(f.el('exo-angle-right').textContent, '—');
  assert.equal(f.el('exo-cadence').textContent, '—');
});

test('reading cannot start on another page and navigation requires deliberate restart', async () => {
  const f = fixture({page:'overview'}); f.el('exo-start').onclick(); assert.equal(f.calls.length, 0);
  f.navigate('device'); f.el('exo-start').onclick(); await f.reply(); f.navigate('lab');
  f.navigate('device'); assert.equal(f.calls.length, 1); assert.equal(f.intervals.size, 0);
  assert.equal(f.el('exo-badge').dataset.tone, 'quiet');
});
