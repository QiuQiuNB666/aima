// 速度感（9/24 球球「没有奔跑的感觉」）：两侧速度线 + 风声；机甲逼近的低鸣也在这里（WebAudio 现合成，不下载音频）。
import * as THREE from 'three';
import { sfxLoop } from '/game/themes/kit.js';

// 速度线：镜头周围一圈细长的亮条（避开画面正中和下半截的人），按跑速往后流；k = 0..1 速度感强度（慢跑时 0，看不见）。1 个网格 1 次绘制
export function makeSpeedLines(scene, { n = 64 } = {}) {
  const pos = new Float32Array(n * 4 * 3), col = new Float32Array(n * 4 * 3), idx = [];
  for (let i = 0; i < n; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
  // 每条线在镜头坐标里：角度 a（绕视线）、半径 r、前后 z（镜头前 2..26 m）；右半 / 左半各一半，上方少、下方（人站的地方）不放
  const L = Array.from({ length: n }, (_, i) => ({ a: 0, r: 0, z: 0, i }));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spawn = (l, z) => { const side = l.i % 2 ? 1 : -1; l.a = side * (0.15 + rnd() * 1.1) * Math.PI / 2; l.r = 1.6 + rnd() * 2.6; l.z = z; };
  for (const l of L) spawn(l, 2 + rnd() * 24);
  const f = new THREE.Vector3(), rt = new THREE.Vector3(), up = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3();
  const tint = new THREE.Color('#bfe8ff');
  return {
    update(dt, camera, speed, k) {
      mesh.visible = k > 0.01;
      if (!mesh.visible) return;
      camera.getWorldDirection(f); rt.crossVectors(f, camera.up).normalize(); up.crossVectors(rt, f).normalize();
      const len = 0.6 + speed * 0.12;                            // 线越快越长
      for (const l of L) {
        l.z -= speed * 1.6 * dt;                                 // 比真实速度流得快一点，夸张
        if (l.z < 1) spawn(l, 22 + rnd() * 6);
        const x = Math.sin(l.a) * l.r, y = Math.cos(l.a) * l.r * 0.55 + 0.4;   // 椭圆一圈，偏上（下面是路和人）
        c.copy(camera.position).addScaledVector(rt, x).addScaledVector(up, y).addScaledVector(f, l.z);
        tmp.copy(up).multiplyScalar(0.012 + 0.006 * (l.i % 3));  // 线宽
        const o = l.i * 12, b = k * 0.55 * Math.min(1, (l.z - 1) / 4) * (0.5 + 0.5 * ((l.i * 7) % 5) / 4);   // 近处淡出，亮度错落
        for (let v = 0; v < 4; v++) {                            // 头两个点在前（亮），后两个点在后面 len 米（黑 = 加色看不见，渐隐）
          const s = v & 1 ? -1 : 1, back = v < 2 ? 0 : len, q = o + v * 3, bb = v < 2 ? b : 0;
          pos[q] = c.x + f.x * back + tmp.x * s; pos[q + 1] = c.y + f.y * back + tmp.y * s; pos[q + 2] = c.z + f.z * back + tmp.z * s;
          col[q] = tint.r * bb; col[q + 1] = tint.g * bb; col[q + 2] = tint.b * bb;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}

// 声音：风声复用 kit.sfxLoop('wind')（登山大风口那套，音量 / 尖啸随速度感走），机甲低鸣（锯齿波 52→40 Hz 过低通，一声 1.2 s）自己合成。
//   kit 那边自己处理「要人按过键才出声」和 ?sfx=0；enabled = false（?voice=0 / 预览 / 自动驾驶待机）时全部不出声
export function makeAudio(enabled) {
  const wind = enabled ? sfxLoop('wind') : null;
  let ctx = null;
  return {
    wind(k) { if (wind) wind.set(0.5 * k * k, k); },
    hum() {
      if (!enabled) return;
      try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      if (ctx.state !== 'running') return;                   // 还没交互过：浏览器不让响，跳过这一声
      const t = ctx.currentTime, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.2);
      lp.type = 'lowpass'; lp.frequency.value = 220;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      o.connect(lp).connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1.3);
    },
  };
}
