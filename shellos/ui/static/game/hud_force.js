// U 线 · 让腿上的力看得见（只读 /state.safety.sent，10 Hz）：
//   ① 屏幕底部左右腿两条实时力矩波形（像心电图，最近 WIN 秒；线的颜色 = 出力那一刻的路段），右边大字 = 近 PEAK_S 秒峰值；
//   ② 化身大腿闪光：|sent| > 0 就亮，颜色按路段（上坡绿、台阶黄、下坡蓝、红灯红），亮度 ∝ |sent| / 软限，松开后 ~0.2 s 暗掉。
// 大腿光壳在绑定姿态下按髋→膝骨段摆好，再 bone.attach，跟着腿动（和 avatar.js 的 dressExo 同一个办法），不改 avatar.js。
import * as THREE from 'three';
import { KIND_NAME } from './path.js';

import { SEG } from './style.js';             // 路段色全作品一份（ART 美术范式 §3）；平地 = 灰
export { SEG };
// 路段类型名。wait 只有城市图（路段名里带「红灯」，东京）才叫「红灯」；珠峰「北坳营地·吸氧」、「第二台阶·排队上梯」这种叫「站定」
export const kindName = (kind, label) => kind === 'wait' ? (/红灯/.test(label || '') ? '红灯' : '站定') : KIND_NAME[kind] || kind;
const WIN = 6, PEAK_S = 1.5, ON = 0.05;      // 波形窗口 s、峰值保持 s、算「在出力」的门槛 Nm
const CSS = `
#force{left:1.4rem;bottom:1.4rem;width:min(40rem,46vw);padding:.7rem 1rem .8rem}
#force .fh{display:flex;align-items:baseline;gap:.6rem;font-size:1.15rem;font-weight:800;letter-spacing:.08em;margin-bottom:.35rem}
#force .fh .chip{margin-left:0;vertical-align:0}
#force .fh small{margin-left:auto;font-size:.85rem;font-weight:600;color:var(--dim);letter-spacing:0}
#force .ln{display:grid;grid-template-columns:2.6rem 1fr 7.4rem;align-items:center;gap:.6rem}
#force .ln+.ln{margin-top:.3rem}
#force .ll{font-size:1.15rem;font-weight:800;line-height:1.1;text-align:center}
#force canvas{width:100%;height:4.3rem;display:block;border-radius:.4rem;background:rgba(255,255,255,.04)}
#force .lv{text-align:right;font-size:2.6rem;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;transition:color .15s}
#force .lv small{font-size:1rem;font-weight:700;color:var(--dim);margin-left:.15rem}
#force .lg{margin-top:.4rem;font-size:.85rem;color:var(--dim)}
#force .lg i{display:inline-block;width:.7rem;height:.7rem;border-radius:.15rem;margin:0 .25rem 0 .6rem;vertical-align:-.05rem}`;

export function makeForce(world) {
  const waits = (world.route || []).filter(s => s.kind === 'wait'), waitLg = waits.length ? kindName('wait', waits.map(s => s.label).join()) : '';
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const el = document.createElement('div'); el.className = 'hud panel'; el.id = 'force';
  const lane = s => `<div class="ln"><div class="ll">${s}<br>腿</div><canvas></canvas><div class="lv">0.0<small>Nm</small></div></div>`;
  el.innerHTML = `<div class="fh">腿上的力 <span class="chip" id="fKind"></span><small id="fStr"></small></div>${lane('左')}${lane('右')}
    <div class="lg">实时 · 刻度 Nm · 颜色 = 路段：${[['up', '上坡'], ['stairs_up', '台阶'], ['down', '下坡'], ['wait', waitLg]].filter(x => x[1]).map(([k, n]) => `<i style="background:${SEG[k]}"></i>${n}`).join('')}</div>`;
  document.body.append(el);
  const cvs = [...el.querySelectorAll('canvas')], vals = [...el.querySelectorAll('.lv')];
  const hist = [[], []];                       // [{t, v, c}]，t = 收到的时刻（performance.now / 1000）
  const glow = [{ lv: 0, c: new THREE.Color() }, { lv: 0, c: new THREE.Color() }];
  let cap = 3, shells = null, flat = false, size = null;   // size：画布尺寸 + 刻度字号，只在窗口变了时量（每帧 getComputedStyle 太贵）
  addEventListener('resize', () => { size = null; flat = false; });
  const col = k => SEG[k] || SEG.flat;

  function draw(now) {
    if (!size || (!size.w && now - size.t > 0.5)) {           // 面板藏着（待机）时 w = 0：半秒再量一次
      const r = devicePixelRatio || 1;
      size = { t: now, w: cvs[0].clientWidth, h: cvs[0].clientHeight, r, fs: Math.max(11, Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.85)) };
      for (const cv of cvs) { cv.width = Math.round(size.w * r); cv.height = Math.round(size.h * r); }
    }
    const { w, h, r, fs } = size;
    if (!w) return;
    for (let k = 0; k < 2; k++) {
      const g = cvs[k].getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
      const y0 = h / 2, sy = (h / 2 - 4) / cap, X = t => w - (now - t) / WIN * w, Y = v => y0 - Math.max(-cap, Math.min(cap, v)) * sy;
      g.font = `700 ${fs}px -apple-system,"PingFang SC",sans-serif`; g.textBaseline = 'middle';
      for (let n = -Math.floor(cap); n <= cap; n++) {           // 刻度：每 1 Nm 一条，0 线最亮
        g.fillStyle = n ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.35)'; g.fillRect(0, Math.round(Y(n)), w, 1);
      }
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillText(`+${cap}`, 4, Y(cap) + fs * 0.45); g.fillText(`−${cap}`, 4, Y(-cap) - fs * 0.45); g.fillText('0', 4, y0 - fs * 0.5);
      const H = hist[k];
      for (let i = 1; i < H.length; i++) {                        // 一段一个颜色：出力那一刻在什么路段
        const a = H[i - 1], b = H[i], xa = X(a.t), xb = X(b.t);
        if (xb < 0) continue;
        g.fillStyle = b.c + '40'; g.beginPath(); g.moveTo(xa, y0); g.lineTo(xa, Y(a.v)); g.lineTo(xb, Y(b.v)); g.lineTo(xb, y0); g.fill();
        g.strokeStyle = b.c; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath(); g.moveTo(xa, Y(a.v)); g.lineTo(xb, Y(b.v)); g.stroke();
      }
      if (H.length) { const b = H[H.length - 1]; g.fillStyle = b.c; g.beginPath(); g.arc(X(b.t), Y(b.v), 4.5, 0, 7); g.fill(); }
    }
  }
  let last = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const ms = performance.now(), dt = Math.min(0.1, (ms - last) / 1000), now = ms / 1000; last = ms;
    for (const g of glow) g.lv *= Math.exp(-dt / 0.18);
    if (shells) for (let k = 0; k < 2; k++) {
      const m = shells[k], g = glow[k];
      m.visible = g.lv > 0.02;
      if (m.visible) { m.material.color.copy(g.c); m.material.opacity = Math.min(0.9, 0.3 + 0.6 * g.lv); m.scale.setScalar(1 + 0.25 * g.lv); }
    }
    const idle = hist.every(H => H.every(x => Math.abs(x.v) < ON));   // 窗口里全是 0：画过一次平线就不再重画（省 CPU）
    if (idle && flat) return;
    flat = idle; draw(now);
  }
  requestAnimationFrame(frame);

  return {
    el,
    // 每次 /state 调一次
    update(S) {
      const sent = (S.safety && S.safety.sent) || [0, 0], kind = S.terrain ? S.terrain.segment : null, c = col(kind);
      cap = Math.max(1, Math.round((S.safety && S.safety.cap) || 3));
      const now = performance.now() / 1000, chip = document.getElementById('fKind');
      chip.textContent = kind ? kindName(kind, S.terrain.label) : '共驾'; chip.style.background = c;
      for (let k = 0; k < 2; k++) {
        const H = hist[k], v = +sent[k] || 0;
        H.push({ t: now, v, c }); while (H.length > 2 && now - H[1].t > WIN) H.shift();
        let pk = 0; for (const x of H) if (now - x.t <= PEAK_S && Math.abs(x.v) > Math.abs(pk)) pk = x.v;
        vals[k].firstChild.textContent = `${pk > 0.05 ? '+' : pk < -0.05 ? '−' : ''}${Math.abs(pk).toFixed(1)}`;
        vals[k].style.color = Math.abs(pk) >= ON ? c : '';
        if (Math.abs(v) >= ON) { glow[k].lv = Math.max(glow[k].lv, Math.min(1, 0.35 + Math.abs(v) / cap)); glow[k].c.set(c); }
      }
    },
    // 化身大腿光壳（引擎在化身建好后调一次）；影子不加
    attach(av) {
      const J = n => av.bones[n];
      av.group.updateMatrixWorld(true);
      shells = ['L', 'R'].map(sd => {
        const hip = J(`leg_joint_${sd}_1`), knee = J(`leg_joint_${sd}_2`);
        if (!hip || !knee) return { visible: false, material: { color: new THREE.Color() }, scale: new THREE.Vector3() };
        const a = hip.getWorldPosition(new THREE.Vector3()), b = knee.getWorldPosition(new THREE.Vector3()), d = b.clone().sub(a), len = d.length();
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, len * 0.9, 4, 12),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.name = 'forceGlow'; m.renderOrder = 3; m.frustumCulled = false; m.visible = false;
        m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        m.updateMatrixWorld(true); hip.attach(m);   // 没父节点 = 上面就是世界坐标；attach 保持世界变换
        return m;
      });
    },
  };
}
