// 地图互动（华山 / 珠峰共用）：音效 + 化身头顶的图标。只动画面和声音，不碰任何控制接口。
//   音效约定和 M2 的 kit.sfx 对齐：sfx(name, vol)，WebAudio 现合成（不下文件、不联网），?sfx=0 静音，
//   浏览器没解锁声音（页面没按过键 / 点过）就安静跳过，第一次按键 / 点击再恢复。离线预览（?preview=）不出声（选山页一排预览不会一起响）。
import * as THREE from 'three';
import { UI } from '../../style.js';

const Q = new URLSearchParams(location.search);
const ON = Q.get('sfx') !== '0' && !Q.has('preview');
let AC = null;
function audio() {
  if (!ON) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const wake = () => AC.state === 'suspended' && AC.resume();
    for (const e of ['keydown', 'pointerdown']) addEventListener(e, wake);
  }
  return AC.state === 'running' ? AC : (AC.resume(), null);
}
export function sfx(name, vol = 1) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, out = ac.createGain(); out.gain.value = 0.22 * vol; out.connect(ac.destination);
  const tone = (f, dur, g = 1, type = 'sine', t0 = 0) => {
    const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.value = f;
    e.gain.setValueAtTime(0, t + t0); e.gain.linearRampToValueAtTime(g, t + t0 + 0.004); e.gain.exponentialRampToValueAtTime(0.0001, t + t0 + dur);
    o.connect(e); e.connect(out); o.start(t + t0); o.stop(t + t0 + dur + 0.05); return o;
  };
  const noise = (dur, f, q, g = 1, t0 = 0, type = 'bandpass', shape = 2) => {
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (shape ? (1 - i / d.length) ** shape : Math.sin(Math.PI * i / d.length));
    const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), e = ac.createGain(); src.buffer = b; bp.type = type; bp.frequency.value = f; bp.Q.value = q; e.gain.value = g;
    src.connect(bp); bp.connect(e); e.connect(out); src.start(t + t0); return bp;
  };
  if (name === 'click') { noise(0.025, 3800, 6, 1.2); tone(2600, 0.07, 0.5, 'triangle'); noise(0.03, 2900, 6, 1.4, 0.08); tone(1900, 0.1, 0.6, 'triangle', 0.08); }   // 咔嗒：锁舌弹开、合上两下
  else if (name === 'clink') [1870, 2630, 3710].forEach((f, k) => tone(f * (0.97 + Math.random() * 0.06), 0.28 - k * 0.06, 0.35 / (k + 1), 'sine', k * 0.012));   // 铁链碰一下
  else if (name === 'creak') {                                                           // 木板吱一声 + 闷一下
    const o = tone(150 + Math.random() * 40, 0.32, 0.5, 'sawtooth'); o.frequency.exponentialRampToValueAtTime(105, t + 0.3);
    noise(0.05, 420, 1, 0.8, 0, 'lowpass');
  }
  else if (name === 'wind') { const bp = noise(3.2, 420, 0.8, 1.6, 0, 'bandpass', 0); bp.frequency.linearRampToValueAtTime(950, t + 1.4); bp.frequency.linearRampToValueAtTime(380, t + 3.2); }   // 起风：一阵涌上来再落下去
  else if (name === 'hiss') noise(0.9, 2600, 0.6, 0.7, 0, 'highpass', 0);               // 吸一口氧：嘶——
  else if (name === 'flutter') for (let k = 0; k < 7; k++) noise(0.05, 2400 + k * 180, 2, 0.4, k * 0.045);   // 旗子被风抽得啪啪响（同 M2）
}

// 化身头顶的图标：一块圆角深底牌（同 HUD 面板色）+ 图 + 一行字。on(true) 弹出（先放大一点再回），on(false) 淡掉。
//   draw(g, w, h) 在 256×256 的画布上画图（上半），text 写在下面。始终在绘制列表里（透明度 0），不会第一次出现时卡一下
export function popIcon(scene, draw, text, { size = 0.95, color = '#ffffff' } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = UI.panel; g.beginPath(); g.roundRect(8, 8, 240, 240, 44); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 4; g.stroke();
  g.save(); draw(g, 256, 256); g.restore();
  g.font = `800 50px ${UI.font}`; const fs = Math.min(50, 50 * 222 / g.measureText(text).width);   // 字多就缩，写满一行
  g.fillStyle = color; g.font = `800 ${fs}px ${UI.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 206);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  sp.renderOrder = 30; sp.name = 'popIcon'; sp.scale.setScalar(size); scene.add(sp);
  let want = false, k = 0, pop = 0;
  return {
    sprite: sp,
    on(v) { if (v && !want) pop = 0; want = !!v; },
    update(dt, at) {                                                       // at = 图标中心（世界坐标）
      k = want ? Math.min(1, k + dt * 5) : Math.max(0, k - dt * 2.5);
      pop = Math.min(1, pop + dt * 3.2);
      const s = size * (want ? 1 + 0.25 * Math.sin(Math.PI * pop) * (1 - pop) * 2 : 1);
      sp.material.opacity = k; sp.scale.setScalar(s * (0.6 + 0.4 * k));
      if (at) sp.position.copy(at);
    },
  };
}
