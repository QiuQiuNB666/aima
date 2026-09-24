// Fixed GET-only route; no serial or motor-command path.
export function createHandReader(options = {}) {
  return createReadonlyReader('/api/hands-telemetry',100,options);
}
export function createWearReader(options = {}) {
  return createReadonlyReader('/api/wear-check',500,options);
}
function createReadonlyReader(route, interval, {
  fetcher = (...args) => fetch(...args), onSample, onError,
  schedule = setTimeout, cancel = clearTimeout, clock = () => performance.now(),
} = {}) {
  let generation = 0, running = false, request = null, next = null, deadline = null;
  function stop() {
    running = false; generation++;
    if (next !== null) cancel(next);
    if (deadline !== null) cancel(deadline);
    next = deadline = null; request?.abort(); request = null;
  }
  async function poll(id) {
    if (!running || id !== generation) return;
    next = null;
    const started = clock(), controller = new AbortController(); request = controller;
    deadline = schedule(() => {
      if (running && generation === id) { stop(); onError('读取超时，请检查本机 ShellOS 后重新开始'); }
    }, 1800);
    try {
      const response = await fetcher(route, { method: 'GET', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('unavailable');
      const report = await response.json();
      if (!running || generation !== id) return;
      onSample(report);
    } catch {
      if (running && generation === id) { stop(); onError('无法读取设备状态，请确认本机服务正在运行'); }
    } finally {
      if (running && generation === id) {
        cancel(deadline); deadline = null; request = null;
        next = schedule(() => poll(id), Math.max(0, interval - (clock() - started)));
      }
    }
  }
  function start() { stop(); running = true; void poll(generation); }
  return { start, stop, get running() { return running; } };
}
