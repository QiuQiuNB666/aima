// Read-only state adapter. No cadence extrapolation and no replay after reconnect.
export const profiles = {
  dawn_mountain: { name: '泰山 · 十八盘', file: 'taishan.wav', material: 'stone', color: '#e7ba76', detail: '山风 · 鸟鸣 · 石阶' },
  night_to_dawn: { name: '富士山 · 吉田线夜登', file: 'fuji.wav', material: 'gravel', color: '#adb9ff', detail: '高山阵风 · 火山碎石' },
  cyber_night: { name: '赛博东京 · 夜行', file: 'tokyo.wav', material: 'stone', color: '#9be1f0', detail: '细雨 · 远处车流 · 街巷脚步' },
  subtropical: { name: '梧桐山 · 好汉坡', file: 'wutong.wav', material: 'leaves', color: '#a9d3a5', detail: '林间鸟鸣 · 叶声 · 山脊风' },
  grid: { name: '训练场', file: 'training.wav', material: 'stone', color: '#c4cbd5', detail: '默认静音 · 可选轻室内底音' },
  snow_summit: { name: '珠峰 · 北坡', file: 'everest_glacier.wav', material: 'snow', color: '#b3d8f5', detail: '营地 · 冰川 · 横梯 · 刀脊风' },
  cliff_path: { name: '华山 · 长空栈道', file: 'huashan_cliff.wav', material: 'stone', color: '#d9bc88', detail: '松风 · 木板 · 铁索与扣锁' },
  parkour_rooftop: { name: '屋顶跑酷', file: 'parkour_rooftop.wav', material: 'stone', color: '#a8c2ff', detail: '屋顶风 · 车流 · 跳跃落地 · 机甲' }
};

export function sceneFor(terrain) {
  const style = terrain?.world?.theme?.style;
  return Object.hasOwn(profiles, style) ? style : 'grid';
}

// Single source for both the listening lab and the machine-readable scene map.
// Labels are from the 9832875 world snapshots. No force/safety/device semantics.
export function mixFor(terrain, style = sceneFor(terrain)) {
  const p = profiles[style] || profiles.grid;
  const label = terrain?.label || '', kind = terrain?.segment || terrain?.kind || 'flat';
  const progress = Math.max(0, Math.min(1, (terrain?.pos || 0)/(terrain?.total || 1)));
  let file = p.file, gain = 1, material = kind.startsWith('stairs') ? 'stone' : p.material;
  if (style === 'snow_summit') {
    file = /大本营|前进营地|营地/.test(label) ? 'everest_camp.wav' :
      /山脊|风口|刀脊|横切/.test(label) ? 'everest_ridge.wav' : 'everest_glacier.wav';
    material = /梯/.test(label) ? 'metal' : /冰壁/.test(label) ? 'ice' :
      /台阶|横切|栈道/.test(label) ? 'stone' : 'snow';
    gain = /顶峰/.test(label) ? 0.55 : /风口|刀脊/.test(label) ? 1 : .8;
  } else if (style === 'cliff_path') {
    material = /长空栈道/.test(label) ? 'wood' : /鹞子翻身/.test(label) ? 'metal' : 'stone';
    gain = /玉泉院/.test(label) ? .5 : /长空栈道|苍龙岭|鹞子/.test(label) ? 1 : .75;
  } else if (style === 'night_to_dawn') gain = .65+.35*progress;
  else if (style === 'cyber_night' && /神社/.test(label)) gain = .4;
  return { file, gain, material, stepAllowed: kind !== 'wait' };
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
      material: mixFor(T, style).material };
  }
}
