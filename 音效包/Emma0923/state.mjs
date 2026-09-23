// Read-only state adapter. No cadence extrapolation and no replay after reconnect.
export const profiles = {
  dawn_mountain: { name: '泰山 · 十八盘', file: 'taishan.wav', material: 'stone', color: '#e7ba76', detail: '山风 · 鸟鸣 · 石阶' },
  night_to_dawn: { name: '富士山 · 吉田线夜登', file: 'fuji.wav', material: 'gravel', color: '#adb9ff', detail: '高山阵风 · 火山碎石' },
  cyber_night: { name: '赛博东京 · 夜行', file: 'tokyo.wav', material: 'stone', color: '#9be1f0', detail: '细雨 · 远处车流 · 街巷脚步' },
  subtropical: { name: '梧桐山 · 好汉坡', file: 'wutong.wav', material: 'leaves', color: '#a9d3a5', detail: '林间鸟鸣 · 叶声 · 山脊风' },
  grid: { name: '训练场', file: 'training.wav', material: 'stone', color: '#c4cbd5', detail: '默认静音 · 可选轻室内底音' }
};

export function sceneFor(terrain) {
  const style = terrain?.world?.theme?.style;
  return Object.hasOwn(profiles, style) ? style : 'grid';
}

export class ProgressGate {
  constructor() { this.reset(); }
  reset() { this.prev = null; this.lastReceived = -Infinity; }
  accept(state, now) {
    const T = state?.terrain;
    if (!T || !Number.isFinite(state.t) || !Number.isInteger(T.pos) || T.pos < 0 ||
        !Number.isInteger(T.total) || T.total < 1 || T.pos >= T.total ||
        !Number.isInteger(T.laps) || T.laps < 0 || typeof T.preset !== 'string') {
      this.reset(); return { valid: false, step: false, arrive: false };
    }
    const style = sceneFor(T), key = T.preset + '|' + style;
    const cur = { stamp: state.t, key, pos: T.pos, total: T.total, laps: T.laps };
    const prev = this.prev;
    if (prev && state.t <= prev.stamp) return { valid: false, duplicate: true, step: false, arrive: false };
    const baseline = !prev || now-this.lastReceived > 1500 || key !== prev.key || T.total !== prev.total;
    this.prev = cur; this.lastReceived = now;
    const delta = baseline ? 0 : (T.laps-prev.laps)*T.total + T.pos-prev.pos;
    const moving = state.gait?.moving === true && T.segment !== 'wait';
    return { valid: true, style, terrain: T, moving, baseline,
      step: !baseline && delta === 1 && moving,
      arrive: !baseline && T.laps === prev.laps+1 && delta === 1,
      material: T.segment?.startsWith('stairs') ? 'stone' : profiles[style].material };
  }
}
