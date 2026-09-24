// Angle-to-screen input only. Calibration numbers are NOT motor limits.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = value => Math.max(-1, Math.min(1, value));
const MAX_AGE = 200;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function parseHandSample(report, wallNow, clockNow) {
  const t = report?.telemetry, source = report?.shellos;
  const checked = Date.parse(report?.checkedAt);
  if (!finite(wallNow) || !finite(clockNow) || report?.available !== true
    || source?.reachable !== true || source.valid !== true
    || !['hardware', 'simulation', 'replay'].includes(source.mode)
    || t?.fresh !== true || !finite(t.sourceTime) || t.sourceTime <= 0
    || !finite(checked) || checked > wallNow || t.sourceTime * 1000 > wallNow
    || !finite(t.frameAgeMs) || t.frameAgeMs < 0
    || !['left', 'right'].every(side => finite(t.angles?.[side]) && finite(t.angularVelocity?.[side]))) {
    throw new Error('未收到有效角度数据');
  }
  if (source.mode === 'hardware' && (typeof t.port !== 'string' || !t.port || t.port.length > 128)) {
    throw new Error('设备来源未确认');
  }
  const age = Math.max(t.frameAgeMs + wallNow - checked, wallNow - t.sourceTime * 1000);
  if (age > MAX_AGE) throw new Error('角度数据已过期');
  return {
    source: { mode: source.mode, port: t.port || null }, stamp: t.sourceTime,
    at: clockNow, age, left: t.angles.left, right: t.angles.right,
    leftSpeed: t.angularVelocity.left, rightSpeed: t.angularVelocity.right,
  };
}

export function createHandAngleInput() {
  let sample = null, history = [], poses = {}, sourceKey = null, lastStamp = null;
  let filtered = { left: 0, right: 0 };
  const copy = value => JSON.parse(JSON.stringify(value));
  function reset() {
    sample = null; history = []; poses = {}; sourceKey = null; lastStamp = null;
    filtered = { left: 0, right: 0 };
  }
  function live(clockNow) {
    return sample && finite(clockNow) && clockNow >= sample.at && sample.age + clockNow - sample.at <= MAX_AGE;
  }
  function ingest(report, wallNow, clockNow) {
    let next;
    try { next = parseHandSample(report, wallNow, clockNow); }
    catch (error) { reset(); return { ok: false, reason: error.message }; }
    const key = `${next.source.mode}:${next.source.port || ''}`;
    const changed = sourceKey !== null && (sourceKey !== key || next.stamp < lastStamp);
    if (changed) reset();
    sourceKey = key;
    if (sample && clockNow - sample.at > 1000) { history = []; poses = {}; }
    // Duplicate HTTP snapshots must not count as independent calibration samples.
    if (next.stamp !== lastStamp) {
      history.push(next); history = history.filter(item => clockNow - item.at <= 650).slice(-12);
    }
    sample = next; lastStamp = next.stamp;
    return { ok: true, changed };
  }
  function validCalibration() {
    if (!poses.center || !poses.back || !poses.forward) return false;
    return ['left', 'right'].every(side => {
      const a = poses.back[side] - poses.center[side], b = poses.forward[side] - poses.center[side];
      return a * b < 0 && Math.abs(a) >= 3 && Math.abs(b) >= 3;
    });
  }
  function stable(clockNow) {
    const recent = history.filter(item => clockNow - item.at <= 650);
    return live(clockNow) && recent.length >= 5 && recent.at(-1).at - recent[0].at >= 400
      && recent.every(item => Math.abs(item.leftSpeed) <= 5 && Math.abs(item.rightSpeed) <= 5)
      && ['left', 'right'].every(side => Math.max(...recent.map(item => item[side])) - Math.min(...recent.map(item => item[side])) <= 2);
  }
  function capture(name, clockNow) {
    if (!['center', 'back', 'forward'].includes(name)) return { ok: false, reason: '未知记录位置' };
    if (!stable(clockNow)) return { ok: false, reason: '请双手稳住约一秒，等待连续有效采样' };
    const recent = history.filter(item => clockNow - item.at <= 650);
    poses[name] = {
      left: median(recent.map(item => item.left)), right: median(recent.map(item => item.right)),
      samples: recent.length, sourceTime: sample.stamp,
    };
    filtered = { left: 0, right: 0 };
    return { ok: true, complete: validCalibration(), reason: Object.keys(poses).length === 3 && !validCalibration()
      ? '中位需要位于前推和后拉之间，每侧留出至少 3° 观测跨度；请重记相应位置' : '' };
  }
  function rawAxes(clockNow) {
    if (!live(clockNow) || !validCalibration()) return null;
    const result = {};
    for (const side of ['left', 'right']) {
      const center = poses.center[side], direction = Math.sign(poses.forward[side] - center);
      const delta = (sample[side] - center) * direction;
      const span = Math.abs((delta >= 0 ? poses.forward : poses.back)[side] - center);
      const value = clamp(delta / span);
      result[side] = Math.abs(value) <= 0.08 ? 0 : Math.sign(value) * (Math.abs(value) - 0.08) / 0.92;
    }
    return result;
  }
  function axes(clockNow, dt) {
    const raw = rawAxes(clockNow);
    if (!raw || !finite(dt) || dt < 0 || dt > 0.25) { filtered = { left: 0, right: 0 }; return null; }
    const alpha = 1 - Math.exp(-Math.min(dt, 0.05) / 0.07);
    for (const side of ['left', 'right']) filtered[side] += (raw[side] - filtered[side]) * alpha;
    return { ...filtered };
  }
  function status(clockNow) {
    const raw = rawAxes(clockNow);
    return {
      live: Boolean(live(clockNow)), source: sample ? { ...sample.source } : null,
      angles: live(clockNow) ? { left: sample.left, right: sample.right } : null,
      stable: Boolean(stable(clockNow)), calibrated: validCalibration(), poses: copy(poses),
      centered: Boolean(raw && Math.abs(raw.left) <= 0.15 && Math.abs(raw.right) <= 0.15),
    };
  }
  function exportCalibration(clockNow) {
    if (!live(clockNow) || !validCalibration()) return null;
    return { schema: 'aima.hand.screen-calibration.v1', hardwareOutput: false, motorLimits: false,
      source: { ...sample.source }, poses: copy(poses), deadzone: 0.08,
      note: '舒适动作观测点，仅映射游戏画面；不是机械限位。右侧已由 ShellOS 归一化。' };
  }
  return { reset, ingest, capture, axes, status, exportCalibration };
}
