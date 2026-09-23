// 珠峰的持续音 + 牦牛铃：WebAudio 现合成，不下文件。约定同 cliff_path/interact.js（和 M2 的 kit.sfx 对齐）：
//   ?sfx=0 静音；离线预览不出声；页面没按过键 / 点过就先不响，第一次 keydown / pointerdown 再恢复；音量乘 U 设置页的「捷风 / 音效音量」。
const Q = new URLSearchParams(location.search);
const ON = Q.get('sfx') !== '0' && !Q.has('preview');
let AC = null, NB = null;
function audio() {
  if (!ON) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const wake = () => AC.state === 'suspended' && AC.resume();
    for (const e of ['keydown', 'pointerdown']) addEventListener(e, wake);
  }
  return AC.state === 'running' ? AC : (AC.resume(), null);
}
const vs = () => (window.__settings ? window.__settings.get('vSfx') / 100 : 1);
function noiseBuf(ac) {
  if (!NB) { const n = ac.sampleRate * 2; NB = ac.createBuffer(1, n, ac.sampleRate); const d = NB.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  return NB;
}

// 直升机旋翼：低通噪声 × 桨叶拍频（「突突突」），rate 0..1 = 转速（落地后慢慢降下来，拍频跟着变慢）。set(vol, rate) 每帧调
export function rotorLoop() {
  let g = null, lfo = null;
  return {
    set(vol, rate = 1) {
      const ac = audio(); if (!ac) return;
      const v = Math.max(0, Math.min(1, vol)) * 0.32 * vs();
      if (!g) {
        if (v < 0.002) return;                                           // 第一次真要响才搭线路
        const src = ac.createBufferSource(); src.buffer = noiseBuf(ac); src.loop = true;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.8;
        const am = ac.createGain(); am.gain.value = 0.5;
        lfo = ac.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 11;
        const lg = ac.createGain(); lg.gain.value = 0.48; lfo.connect(lg); lg.connect(am.gain);
        g = ac.createGain(); g.gain.value = 0;
        src.connect(lp); lp.connect(am); am.connect(g); g.connect(ac.destination);
        src.start(); lfo.start();
      }
      g.gain.setTargetAtTime(v, ac.currentTime, 0.15);
      lfo.frequency.setTargetAtTime(4 + 8 * Math.max(0, Math.min(1, rate)), ac.currentTime, 0.4);
    },
  };
}

// 牦牛铃：铜铃「当」一下（两个不和谐泛音、快衰减），每只音高略不同
export function yakBell(vol = 1, pitch = 1) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, out = ac.createGain(); out.gain.value = 0.2 * Math.max(0, Math.min(1, vol)) * vs(); out.connect(ac.destination);
  for (const [f, g, d] of [[1250, 1, 0.45], [1250 * 2.63, 0.4, 0.22], [1250 * 4.1, 0.18, 0.12]]) {
    const o = ac.createOscillator(), e = ac.createGain(); o.type = 'triangle'; o.frequency.value = f * pitch;
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.004); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(e); e.connect(out); o.start(t); o.stop(t + d + 0.05);
  }
}
