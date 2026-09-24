// Read-only observer. Device connection and all motor commands remain in ShellOS.
const $ = id => document.getElementById(id);
const POLL_MS = 1000, RESPONSE_MAX_AGE_MS = 2500, FRAME_MAX_AGE_MS = 200;
let reading = false, interval = null, request = null, generation = 0;
let snapshot = null, receivedAt = null, arrivalFrameAgeMs = null, error = '', note = '';
let pageActive = !$('page-device').classList.contains('hidden'), pageGone = false;
const number = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : '—';
const quantity = (value, unit, precision = 1) => number(value) ? `${value.toFixed(precision)}${unit}` : '—';
const online = () => navigator.onLine !== false;
const visible = () => pageActive && !document.hidden && !pageGone;
const polling = () => reading && visible() && online();
const set = (id, value) => { $(id).textContent = value; };

function validSnapshot(value) {
  return value?.available === true && typeof value.usb?.supported === 'boolean'
    && typeof value.usb?.available === 'boolean' && Array.isArray(value.usb.devices)
    && typeof value.shellos?.reachable === 'boolean' && typeof value.shellos?.valid === 'boolean';
}
function frameAgeOnArrival(value, arrivedAt) {
  const telemetry = value.telemetry;
  const checkedAt = typeof value.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN;
  if (!Number.isFinite(checkedAt) || !number(telemetry?.sourceTime) || telemetry.sourceTime <= 0
    || !number(telemetry.frameAgeMs) || telemetry.frameAgeMs < 0) return null;
  const transportMs = arrivedAt - checkedAt, sourceAgeMs = arrivedAt - telemetry.sourceTime * 1000;
  if (transportMs < 0 || !Number.isFinite(sourceAgeMs) || sourceAgeMs < -1000 || sourceAgeMs > 2000) return null;
  // The server frame age already includes its own cache/upstream delay. Add the
  // remaining HTTP/body delay once; source time provides an independent lower bound.
  return Math.max(telemetry.frameAgeMs + transportMs, sourceAgeMs, 0);
}
function liveTelemetry() {
  const telemetry = snapshot?.telemetry;
  return polling() && !error && snapshot?.shellos.reachable === true && snapshot.shellos.valid === true
    && telemetry?.fresh === true && number(arrivalFrameAgeMs) && arrivalFrameAgeMs <= FRAME_MAX_AGE_MS
    && receivedAt !== null && Date.now() >= receivedAt && Date.now() - receivedAt <= RESPONSE_MAX_AGE_MS;
}
function renderPorts() {
  const list = $('exo-ports'); list.replaceChildren();
  for (const device of (snapshot?.usb.devices || []).slice(0, 20)) {
    if (!device || typeof device !== 'object') continue;
    const row = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span');
    title.textContent = `${text(device.port)} · ${text(device.name)}`;
    const problem = number(device.problemCode) && device.problemCode !== 0 ? ` · 问题码 ${device.problemCode}` : '';
    detail.textContent = `系统状态：${text(device.status)}${problem}`;
    row.append(title, detail); list.append(row);
  }
}
function render() {
  const live = liveTelemetry(), data = snapshot, telemetry = live ? data.telemetry : null;
  const mode = data?.shellos.mode, source = ({hardware:'真机', simulation:'模拟', replay:'回放', unknown:'未确认'})[mode] || '未确认';
  const badge = $('exo-badge'); badge.dataset.tone = live && mode === 'hardware' ? 'live' : live ? 'preview' : 'quiet';
  badge.textContent = !online() ? '当前离线' : error ? '本机桥接不可用'
    : reading && !visible() ? '读取已挂起' : !reading ? (data ? '已暂停 · 检查快照' : '尚未读取')
    : live ? `正在读取 · ${source}` : request && !data ? '正在检查' : '等待有效数据';
  $('exo-start').disabled = reading || !!request;
  $('exo-pause').disabled = !reading;
  $('exo-refresh').disabled = !!request || !visible() || !online();
  $('exo-refresh').setAttribute('aria-busy', String(!!request));
  $('exo-telemetry').dataset.live = String(live);

  if (!data) {
    set('exo-usb-state', error ? '本机桥接不可用' : '尚未检查');
    set('exo-usb-note', error ? '请在连接设备的电脑上启动并打开本机控制台。' : '检查本机是否枚举到 CP210x 串口。');
    set('exo-shellos-state', error ? '暂不可检查' : '尚未检查');
    set('exo-shellos-note', '默认本机 127.0.0.1:8765，设备连接由 ShellOS 完成。');
  } else {
    const usb = data.usb, devices = usb.devices.filter(device => device && typeof device === 'object');
    const hasCP210 = devices.some(device => /CP210/i.test(String(device.name || '')));
    set('exo-usb-state', !usb.supported ? '当前平台不支持 USB 检查' : !usb.available ? 'USB 状态暂不可读' : hasCP210 ? '已发现 CP210x 串口' : '未发现 CP210x 串口');
    set('exo-usb-note', !usb.supported ? '请在连接外骨骼的 Windows 电脑上打开本机版本。'
      : !usb.available ? '请确认本机连接服务正常，再刷新 USB 状态。'
      : hasCP210 ? '系统已枚举端口，USB 状态约每 5 秒刷新；真机连接以有效遥测为准。'
      : '检查 USB 线、供电与 CP210x 驱动。USB 状态约每 5 秒刷新。');
    set('exo-shellos-state', !data.shellos.reachable ? '服务未响应' : !data.shellos.valid ? '服务已响应 · 数据不兼容' : '服务可达');
    set('exo-shellos-note', !data.shellos.reachable ? '请在这台电脑启动 ShellOS（默认 127.0.0.1:8765），并由它连接设备。'
      : !data.shellos.valid ? 'ShellOS 未返回可识别的状态，请检查服务版本与连接。'
      : '状态来自本机 ShellOS；设备连接仍由 ShellOS 管理。');
  }
  set('exo-source', `数据来源：${data ? source : '—'}${data?.telemetry?.port ? ` · ${text(data.telemetry.port)}` : ''}`);
  const frameAge = arrivalFrameAgeMs;
  set('exo-frame-age', `采样时帧龄：${number(frameAge) && frameAge >= 0 ? `${Math.round(frameAge)} ms` : '—'}`);
  const expired = !!data?.telemetry && (!live || !polling());
  set('exo-data-state', !online() ? '已离线 · 数据不可用' : error ? '数据不可用' : !reading ? (data ? '检查快照 · 非实时' : '等待读取')
    : !visible() ? '读取已挂起' : live ? `${source}数据 · 持续读取` : expired ? '数据已过时 / 无效' : '尚无有效帧');
  const sampleSource = ({hardware:'真机上报的采样值', simulation:'模拟器的采样数据', replay:'回放中的采样数据'})[mode] || '来源未确认的采样数据';
  set('exo-data-note', live ? `每秒读取一次。下方为${sampleSource}。`
    : !reading && data ? '点击「开始读取」后，显示新鲜的遥测值。'
    : expired ? '等待下一帧有效数据；过时数值已隐藏。'
    : '找到 COM 端口后，仍需有效且新鲜的设备帧。');

  set('exo-angle-left', quantity(telemetry?.angles?.left, '°'));
  set('exo-angle-right', quantity(telemetry?.angles?.right, '°'));
  set('exo-velocity-left', `角速度 ${quantity(telemetry?.angularVelocity?.left, '°/s')}`);
  set('exo-velocity-right', `角速度 ${quantity(telemetry?.angularVelocity?.right, '°/s')}`);
  set('exo-cadence', quantity(telemetry?.cadence, ' 步/分', 0));
  set('exo-moving', typeof telemetry?.moving === 'boolean' ? telemetry.moving ? '运动中' : '静止' : '—');
  set('exo-enabled', typeof telemetry?.enabled === 'boolean' ? telemetry.enabled ? '已使能' : '未使能' : '—');
  set('exo-guard', text(telemetry?.safety?.state));
  $('exo-guard').title = text(telemetry?.safety?.reason);
  set('exo-torque-left', quantity(telemetry?.safety?.torqueLeft, ' N·m', 2));
  set('exo-torque-right', quantity(telemetry?.safety?.torqueRight, ' N·m', 2));
  const time = typeof data?.checkedAt === 'string' ? new Date(data.checkedAt) : null;
  set('exo-checked', `最近检查：${time && Number.isFinite(time.getTime()) ? time.toLocaleTimeString('zh-CN') : '—'}`);
  set('exo-status', !online() ? '当前离线，读取已挂起。联网后可继续读取本机状态。'
    : error ? '本机桥接不可用。手机或静态页面请回到连接设备的电脑，启动本机版本后重试。'
    : reading && !visible() ? '页面不可见，读取已挂起；返回后继续。'
    : note || (reading ? '每秒读取一次；暂停读取不会改变外骨骼运行状态。' : '点击「开始读取」，每秒检查一次本机状态。'));
  if (error === 'LEGS_ROLE_DISABLED') {
    badge.textContent = '单套双手 · 腿部关闭';
    set('exo-shellos-state','当前配置未启用腿部');
    set('exo-usb-state','未请求 USB 检查');
    set('exo-usb-note','此配置只使用手部外骨骼。');
    set('exo-shellos-note','腿部服务未读取；请在双手模式页读取已绑定的设备。');
    set('exo-data-state','腿部未启用');
    set('exo-status','本机服务选择了单套双手配置。这是正常状态，可进入双手模式试玩。');
  }
}
function cancelRequest() {
  ++generation;
  if (request) { clearTimeout(request.timeout); request.controller.abort(); request = null; }
}
function stopTimer() { if (interval !== null) { clearInterval(interval); interval = null; } }
function stopWork() { stopTimer(); cancelRequest(); receivedAt = null; }
async function refresh() {
  if (request || !visible() || !online()) return;
  const id = ++generation, controller = new AbortController();
  const pending = {controller, timeout: setTimeout(() => controller.abort(), 9000)};
  request = pending; render();
  try {
    const response = await fetch('/api/exoskeleton', {method:'GET', cache:'no-store', signal:controller.signal});
    if (!response.ok) throw new Error('bridge unavailable');
    const value = await response.json();
    if (controller.signal.aborted) throw new Error('request expired');
    if (id !== generation || !visible() || !online()) return;
    if (value?.error === 'LEGS_ROLE_DISABLED' && value?.layout === 'single-hands') {
      reading = false; stopTimer(); snapshot = null; receivedAt = null; arrivalFrameAgeMs = null;
      error = 'LEGS_ROLE_DISABLED'; renderPorts(); return;
    }
    if (!validSnapshot(value)) throw new Error('invalid bridge response');
    if (id !== generation || !visible() || !online()) return;
    snapshot = value; receivedAt = Date.now(); arrivalFrameAgeMs = frameAgeOnArrival(value, receivedAt); error = '';
    renderPorts();
  } catch {
    if (id !== generation) return;
    snapshot = null; receivedAt = null; arrivalFrameAgeMs = null; error = 'bridge'; renderPorts();
  } finally {
    clearTimeout(pending.timeout);
    if (id === generation) { request = null; render(); }
  }
}
function resumeWork() {
  if (!polling()) { render(); return; }
  if (interval === null) interval = setInterval(() => { render(); void refresh(); }, POLL_MS);
  void refresh();
}
$('exo-start').onclick = () => {
  if (!visible() || reading || request) return;
  reading = true; note = ''; resumeWork();
};
$('exo-pause').onclick = () => {
  reading = false; note = '已暂停页面读取。外骨骼运行状态保持由 ShellOS 管理。'; stopWork(); render();
};
$('exo-refresh').onclick = () => {
  note = reading ? '' : '仅检查 USB 与服务状态；开始读取后显示实时遥测。';
  return refresh();
};
window.addEventListener('eye:page', event => {
  pageActive = event.detail?.page === 'device';
  if (!pageActive) { reading = false; note = '离开设备页后，读取已暂停。'; stopWork(); }
  render();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopWork(); render(); } else resumeWork(); });
window.addEventListener('offline', () => { stopWork(); render(); });
window.addEventListener('online', resumeWork);
window.addEventListener('pagehide', () => { pageGone = true; stopWork(); render(); });
window.addEventListener('pageshow', () => { pageGone = false; resumeWork(); });
render();
