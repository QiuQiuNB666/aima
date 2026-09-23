// 珠峰声景（M2 写，E 挂）：全部 kit.sfx / kit.sfxLoop 现合成，不加文件。音量都乘设置页「捷风 / 音效音量」，?sfx=0 静音，离线预览不出声（kit 里统一管）。
//   ① 风：持续音，海拔越高越大，「大风口」路段最大、尖啸最多，带阵风起伏；登顶那几秒风小下来
//   ② 脚步：化身每跨过一步（和 stepFx 同一拍，st.s 过整数）按脚下路面出声——雪 = 冰爪咯吱、冰壁 = 冰爪咬冰的脆响、岩石 / 台阶 = 闷响；
//      路段名带「梯」= 铝梯金属声；「北坳」冰壁上隔一步踩一次横架的铝梯；站着（红灯 / 排队）不响
//   ③ 路绳吱呀：冰壁、北山脊（固定路绳）上每两三步绳子吃一次劲
//   ④ 喘气：按缺氧程度（st.hyp，没有就按海拔算）越高越急、越响；登顶后慢慢平复
//   ⑤ 营地：大本营、前进营地附近有炉子「呼——」、远处有人说话、帐篷布被风抽；经幡啪啪 E 已经有了，这里不做
// 接口：const snd = makeSoundscape(kit)；每帧 snd.update(st)，st = snow_summit.js update(dt, st) 的那个（s / dt / kind / summit / camera，可选 alt、hyp）。
// 调试：window.__snd = 各类声音触发了几次（验收「每类都调用过」用）。
export function makeSoundscape(kit) {
  const wind = kit.sfxLoop('wind'), stove = kit.sfxLoop('stove');
  const C = window.__snd = { wind: 0, crunch: 0, ice: 0, rock: 0, ladder: 0, rope: 0, breath: 0, stove: 0, voice: 0, flap: 0 };
  const play = (n, v, o) => { kit.sfx(n, v, o); C[n]++; };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let R = null, last = null, t = 0, breathT = 0, calm = 0, ropeN = 0, voiceT = 1, flapT = 2, windOn = false, stoveOn = false;
  let camps = [];
  const init = () => {                                      // 路段表从引擎的路线拿（第一帧 window.__game 还没挂上，下一帧再来）
    const rt = window.__game && window.__game.route; if (!rt) return;
    R = rt.segs.map(g => ({ kind: g.kind, label: g.label || '', start: g.start, steps: g.steps }));
    camps = R.filter(g => /大本营|前进营地/.test(g.label)).map(g => g.start + g.steps / 2);
  };
  const segAt = s => { let g = R[0]; for (const q of R) if (s >= q.start) g = q; return g; };
  // 脚下是什么：梯 → 金属；冰壁 → 冰；台阶 / 岩 → 岩；山脊 → 岩雪交替；其余雪
  const surface = (g, k) => /梯/.test(g.label) ? 'ladder' : /冰壁/.test(g.label) ? 'ice' : (/台阶|岩/.test(g.label) || g.kind.startsWith('stairs')) ? 'rock' : /山脊/.test(g.label) ? (k % 3 ? 'crunch' : 'rock') : 'crunch';
  return {
    update(st) {
      if (!R) { init(); if (!R) return; }
      const dt = Math.min(0.1, st.dt || 0.016), s = st.s ?? 0;
      t += dt;
      const g = segAt(Math.max(0, Math.floor(s))), p = st.progress ?? 0;
      const alt = st.alt ?? (st.terrain && st.terrain.altitude) ?? (5200 + 3649 * p);
      const altK = smooth(5200, 8849, alt), gustZ = /风口/.test(g.label) ? 1 : /山脊/.test(g.label) ? 0.6 : 0;
      calm = st.summit ? Math.min(1, calm + dt * 0.25) : Math.max(0, calm - dt * 0.5);   // 登顶：4 s 里慢慢平下来

      // ① 风
      const gust = 0.5 + 0.3 * Math.sin(t * 0.83) + 0.2 * Math.sin(t * 2.1 + 1.3) + 0.25 * Math.max(0, Math.sin(t * 0.37 + 0.6)) ** 6;   // 慢起伏 + 偶尔一阵猛的
      const wv = (0.12 + 0.45 * altK + 0.4 * gustZ) * (0.6 + 0.5 * gust) * (1 - 0.55 * calm);
      wind.set(wv, Math.min(1, 0.25 * altK + 0.85 * gustZ) * (1 - 0.6 * calm));
      if (!windOn && wv > 0.01) { windOn = true; C.wind++; }

      // ② ③ 脚步 + 路绳：st.s 过整数（和 stepFx 同一拍）；站着的路段不响
      if (last === null || st.summit || Math.abs(s - last) > 3) last = s;
      for (let k = Math.floor(last) + 1; k <= Math.floor(s); k++) {
        const q = segAt(k - 1);
        if (q.kind === 'wait') continue;
        const sf = surface(q, k), v = 0.55 + 0.25 * Math.random();
        if (sf === 'ladder') play('ladder', 0.5, { pitch: 0.92 + Math.random() * 0.16 });
        else play(sf, v, { pitch: 0.95 + Math.random() * 0.1 });
        if (/北坳/.test(q.label) && /冰壁/.test(q.label) && k % 2 === 0) play('ladder', 0.35, { pitch: 1.1 });   // 北坳冰壁：横架在冰裂缝上的铝梯
        if (/冰壁|山脊/.test(q.label) && ++ropeN % (2 + (k % 2)) === 0) play('rope', 0.45, { pitch: 0.9 + Math.random() * 0.25 });
      }
      last = s;

      // ④ 喘气：周期 = 4.2 − 1.4k s（和缺氧暗角同一个呼吸节奏），登顶后按 calm 慢下来
      const hyp = (st.hyp ?? Math.pow(altK, 1.1)) * (1 - 0.6 * calm);
      if (hyp > 0.08) {
        breathT -= dt;
        if (breathT <= 0) { breathT = 4.2 - 1.4 * hyp - 0.8 * hyp * hyp; play('breath', 0.25 + 0.55 * hyp, { pitch: 1 + 0.9 * hyp }); }
      }

      // ⑤ 营地：离营地中心 3 步内满，10 步外没有
      const near = camps.reduce((m, c) => Math.max(m, 1 - smooth(3, 10, Math.abs(s - c))), 0) * (st.summit ? 0 : 1);
      stove.set(0.5 * near, 0.3 + 0.4 * gust);
      if (!stoveOn && near > 0.05) { stoveOn = true; C.stove++; }
      if (near > 0.05) {
        if ((voiceT -= dt) <= 0) { play('voice', 0.25 + 0.2 * near, { pitch: 0.85 + Math.random() * 0.4 }); voiceT = 0.9 + Math.random() * 2.2; }
        if ((flapT -= dt * (0.6 + gust)) <= 0) { play('flap', 0.35 * near); flapT = 1.2 + Math.random() * 2; }
      }
    },
  };
}
