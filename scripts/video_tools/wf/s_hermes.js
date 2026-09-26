// 场景 hermes（W11 · ⑩ 对照 Hermes Agent）：左右对照。
//   左：Hermes Agent —— 一个主 agent，弧上挂 10 个子 agent（斜线填充 = 各自隔离的上下文），每个只送回一行总结，在主 agent 旁摞成 10 根短线。
//   右：我们 —— 总指挥（朱红）拉出 20 条贯穿全宽的粗墨线（完整会话），球球能直接够到线，最后由总指挥合并（朱红）进 main。
SCENES.hermes = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw29 ?? .4, b2 = B.sw30 ?? 10.3;
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  const title = L.title(root, '子 agent 交回一段总结，线交回一条分支', { at: b1 - .1 });
  const S = L.svgRoot(root), V = (tag, a) => L.svg(tag, a, S);
  const defs = V('defs', {});
  const pat = L.svg('pattern', { id: 'hhatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  L.svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#A6A69F', 'stroke-width': 1.4 }, pat);

  // ---------- 左：Hermes Agent ----------
  const hRule = T(96, 214, '', '', { width: '816px', borderTop: '2px solid var(--ink)' });
  const hName = T(96, 228, 'h3', 'Hermes Agent', { fontFamily: 'var(--num)', fontWeight: 700, fontSize: '48px' });
  const hNote = T(96, 288, 'label g1', 'Nous Research 的开源通用 agent　MIT　v0.21.5（2026-09-24）');
  const MX = 300, MY = 590, RR = 260;
  const subs = [];
  for (let k = 0; k < 10; k++) {
    const a = (-58 + k * 116 / 9) * Math.PI / 180, x = MX + RR * Math.cos(a), y = MY + RR * Math.sin(a);
    const del = V('line', { x1: MX, y1: MY, x2: x, y2: y, stroke: '#121211', 'stroke-width': 1.2 });
    const c = V('circle', { cx: x, cy: y, r: 22, fill: 'url(#hhatch)', stroke: '#121211', 'stroke-width': 2 });
    const ret = V('circle', { cx: x, cy: y, r: 4, fill: '#121211' });
    const bar = V('rect', { x: MX - 104, y: MY + 30 + k * 9, width: 64, height: 3, fill: '#121211' });
    subs.push({ del, c, ret, bar, x, y });
  }
  const main = V('circle', { cx: MX, cy: MY, r: 26, fill: '#121211' });
  const mainL = T(MX - 40 - 140, MY - 64, 'label', '主 agent', { width: '140px', textAlign: 'right', fontWeight: 600 });
  const barL = T(MX - 40 - 220, MY + 122, 'label', '收回 10 段总结', { width: '220px', textAlign: 'right' });
  const subL = T(628, 404, 'body', '子 agent', { fontSize: '30px', fontWeight: 600 });
  const subM = T(628, 450, 'body', '默认最多同时 <span class="num" style="font-size:34px">10</span> 个', { fontSize: '30px' });
  const subN = T(628, 498, 'label', '上下文互相隔离');
  const retL = T(628, 668, 'body', '只交回总结', { fontSize: '30px', fontWeight: 600 });
  const retN = T(628, 712, 'label', '过程留在子 agent 里');

  // ---------- 右：我们 ----------
  const RX = 972, n = D.lines.length;                                                // 20 条线
  const wRule = T(RX, 214, '', '', { width: '852px', borderTop: '2px solid var(--ink)' });
  const wName = T(RX, 228, 'h3', '我们', { fontSize: '48px' });
  const wNote = T(RX, 288, 'label g1', '一人 + <span class="red">总指挥</span> + 二十条线');
  const CX = 1064, CY = 611, LX0 = 1150, LX1 = 1620, MXR = 1760, Y0 = 440, P = 18;
  const lanes = [];
  for (let i = 0; i < n; i++) {
    const y = Y0 + i * P;
    lanes.push({
      out: V('path', { d: `M${CX} ${CY} C${CX + 60} ${CY} ${LX0 - 60} ${y} ${LX0} ${y}`, fill: 'none', stroke: '#121211', 'stroke-width': 1.2 }),
      bar: V('line', { x1: LX0, y1: y, x2: LX1, y2: y, stroke: '#121211', 'stroke-width': 7 }),
      mrg: V('path', { d: `M${LX1} ${y} C${LX1 + 70} ${y} ${MXR - 70} ${CY} ${MXR} ${CY}`, fill: 'none', stroke: '#E8411A', 'stroke-width': 1.6 }),
    });
  }
  const cmd = V('circle', { cx: CX, cy: CY, r: 13, fill: '#E8411A' });
  const cmdL = T(CX - 22 - 90, CY - 17, 'label red', '总指挥', { width: '90px', textAlign: 'right', fontWeight: 600 });
  const mainR = V('line', { x1: MXR, y1: CY, x2: 1824, y2: CY, stroke: '#121211', 'stroke-width': 7 });
  const mainRL = T(1824 - 80, CY + 16, 'label mono', 'main', { width: '80px', textAlign: 'right', fontWeight: 700 });
  const laneL = T(LX0, 802, 'label', '每条线 = 一个完整会话：自己的上下文 + worktree + 分支');
  // 球球能直接跟线说话
  const qq = V('circle', { cx: CX, cy: 372, r: 9, fill: '#121211' });
  const qqL = T(CX - 22 - 90, 355, 'label', '球球', { width: '90px', textAlign: 'right', fontWeight: 600 });
  const qqCmd = V('line', { x1: CX, y1: 384, x2: CX, y2: CY - 16, stroke: '#121211', 'stroke-width': 3 });
  const qqDir = V('path', { d: `M${CX + 12} 372 L1322 372 Q1332 372 1332 382 L1332 ${Y0 - 8}`, fill: 'none', stroke: '#121211', 'stroke-width': 2, 'stroke-dasharray': '3 6' });
  const qqDot = V('circle', { cx: 1332, cy: Y0, r: 6, fill: '#F1F1EC', stroke: '#121211', 'stroke-width': 2 });
  const talkL = T(1350, 355, 'label', '人能直接跟任何一条线说话');
  const mrgL = T(1824 - 240, 398, 'label', '<span class="red">总指挥</span>用 git 合并', { width: '240px', textAlign: 'right' });
  const sep = V('line', { x1: 942, y1: 230, x2: 942, y2: 880, stroke: '#D4D4CD', 'stroke-width': 1 });

  return t => {
    title(t);
    // 左
    L.wipeX(hRule, L.ramp(t, b1 + .2, .8, L.ease)); L.wipe(hName, L.ramp(t, b1 + .3, .6)); L.wipe(hNote, L.ramp(t, b1 + 1.2, .6));
    sep.style.opacity = L.ramp(t, b1 + .6, .6);
    main.style.opacity = L.ramp(t, b1 + .6, .3); main.setAttribute('r', 26 * (.5 + .5 * L.ramp(t, b1 + .6, .5))); L.wipe(mainL, L.ramp(t, b1 + .8, .5));
    subs.forEach((s, k) => {
      const a = b1 + 4.0 + k * .16;
      L.draw(s.del, L.ramp(t, a, .5, L.ease));
      const pc = L.ramp(t, a + .4, .35); s.c.style.opacity = pc; s.c.setAttribute('r', 22 * (.6 + .4 * pc));
      // 交回：一颗点沿委派线回到主 agent，落成一根短线
      const pr = L.ramp(t, b1 + 7.3 + k * .12, .6, L.ease);
      s.ret.setAttribute('cx', s.x + (MX - s.x) * pr); s.ret.setAttribute('cy', s.y + (MY - s.y) * pr);
      s.ret.style.opacity = pr > 0 && pr < 1 ? 1 : 0;
      s.bar.setAttribute('width', 64 * L.ramp(t, b1 + 7.8 + k * .12, .3));
    });
    L.wipe(subL, L.ramp(t, b1 + 4.6, .6)); L.wipe(subM, L.ramp(t, b1 + 4.9, .6)); L.wipe(subN, L.ramp(t, b1 + 5.6, .6));
    L.wipe(retL, L.ramp(t, b1 + 7.4, .6)); L.wipe(retN, L.ramp(t, b1 + 7.7, .6));
    L.wipe(barL, L.ramp(t, b1 + 9.0, .5));
    // 右
    L.wipeX(wRule, L.ramp(t, b2 - .1, .8, L.ease)); L.wipe(wName, L.ramp(t, b2, .6)); L.wipe(wNote, L.ramp(t, b2 + .3, .6));
    cmd.style.opacity = L.ramp(t, b2 + .5, .3); L.wipe(cmdL, L.ramp(t, b2 + .6, .5));
    lanes.forEach((l, i) => {
      const a = b2 + .8 + i * .05;
      L.draw(l.out, L.ramp(t, a, .5, L.ease));
      l.bar.setAttribute('x2', LX0 + (LX1 - LX0) * L.ramp(t, a + .4, 1.4, L.ease)); l.bar.style.opacity = t >= a + .4 ? 1 : 0;
      L.draw(l.mrg, L.ramp(t, b2 + 6.3 + i * .03, .7, L.ease));
    });
    L.wipe(laneL, L.ramp(t, b2 + 2.4, .6));
    qq.style.opacity = L.ramp(t, b2 + 4.4, .3); L.wipe(qqL, L.ramp(t, b2 + 4.4, .5));
    L.draw(qqCmd, L.ramp(t, b2 + 4.5, .4)); L.draw(qqDir, L.ramp(t, b2 + 4.8, .8, L.ease));
    qqDot.style.opacity = L.ramp(t, b2 + 5.5, .3); L.wipe(talkL, L.ramp(t, b2 + 5.0, .6));
    mainR.setAttribute('x2', MXR + (1824 - MXR) * L.ramp(t, b2 + 6.9, .5)); mainR.style.opacity = t >= b2 + 6.9 ? 1 : 0;
    L.wipe(mainRL, L.ramp(t, b2 + 7.1, .5)); L.wipe(mrgL, L.ramp(t, b2 + 6.8, .6));
  };
};
