// 场景 human（W08 · ⑦ 人管什么）：一根消息缆绳从「球球」出发（每根细线 = 2 条消息），53 根（106 条）汇进总指挥、4 根（8 条）直接进线；
// 下半左边是 9/24 08:14 的原话，右边是教训落进 CLAUDE.md / 记忆文件、跨压缩和新会话继承 + 四条硬规则。
SCENES.human = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw20 ?? .4, b2 = B.sw21 ?? 10.05, b3 = B.sw22 ?? 15.7;
  const C = D.counts, N1 = C.human2cmd, N2 = C.human2lines;          // 106 / 8
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  const title = L.title(root, '人管三件事：定方向、拍板、纠偏', { at: b1 - .1 });

  // ---------- 上半：消息缆绳 ----------
  // 1 根 = 2 条消息：106 → 53 根，8 → 4 根，间距 4 px，视频里能数得出一根根线
  const S = L.svgRoot(root), X0 = 300, X1 = 1180, PER = 2, P = 4, M1 = Math.ceil(N1 / PER), M2 = Math.ceil(N2 / PER);
  const src = T(96, 330, 'h3', '球球'), srcN = T(96, 400, 'label g1', '线阶段发出的消息');
  // 画完的线去掉虚线数组：Chrome 对大量细虚线每帧重栅格化会轻微抖动，画完就当普通描边
  const drawLine = (path, p) => { if (p >= 1) { path.style.strokeDasharray = 'none'; path.style.strokeDashoffset = 0; } else L.draw(path, p); };
  const paths = [];
  for (let i = 0; i < M1 + M2; i++) {
    const y0 = 262 + i * P, up = i < M1, y1 = up ? 214 + i * P : 520 + (i - M1) * P, xm = (X0 + X1) / 2;
    paths.push({ up, i, p: L.svg('path', { d: `M${X0} ${y0} C${xm} ${y0} ${xm} ${y1} ${X1} ${y1}`, fill: 'none', stroke: '#121211', 'stroke-width': 1.6 }, S) });
  }
  const srcBar = L.svg('rect', { x: X0 - 6, y: 260, width: 6, height: (M1 + M2) * P, fill: '#121211' }, S);
  const cmdBar = L.svg('rect', { x: X1, y: 212, width: 8, height: M1 * P, fill: '#E8411A' }, S);
  const lineBar = L.svg('rect', { x: X1, y: 518, width: 8, height: M2 * P, fill: '#121211' }, S);
  // 数字右对齐成一栏（右缘 1480），标签统一在 x=1506
  const n1 = T(0, 262, 'num', '0', { fontSize: '140px', width: '1480px', textAlign: 'right' });
  const l1 = T(1506, 300, 'body', '条发给<span class="red">总指挥</span>');
  const n2 = T(0, 460, 'num', '0', { fontSize: '140px', width: '1480px', textAlign: 'right' });
  const l2 = T(1506, 498, 'body', '条直接打进各条线');
  const ann = T(560, 548, 'label', '每根细线 = 球球的 2 条消息');

  // ---------- 下左：原话 ----------
  const qRule = T(96, 596, '', '', { width: '852px', borderTop: '2px solid var(--ink)' });
  const qK = T(96, 612, 'label', '<span class="mono">9/24 08:14</span>　总指挥想自己动手时，球球说');
  const q1 = T(96 - 72, 660, 'h2', '「不用你亲自来做呀…', { fontSize: '72px' });
  const q2 = T(96, 745, 'h2', '你是指挥啊」', { fontSize: '72px' });
  const qU = T(96, 832, '', '', { width: '378px', borderTop: '5px solid var(--ink)' });
  const q3 = T(96, 852, 'body g1', '<span class="mono" style="font-size:26px">08:34</span>　「怎么都是你自己在跑，你再开个对话框啊」', { fontSize: '30px' });

  // ---------- 下右：写进文件 → 继承 → 四条规则 ----------
  const RX = 972, RW = 852;
  const rRule = T(RX, 596, '', '', { width: RW + 'px', borderTop: '2px solid var(--ink)' });
  const rK = T(RX, 612, 'label', '教训写进全局规则和记忆文件');
  const rF = T(RX, 650, 'label mono', '~/.claude/CLAUDE.md　memory/*.md');
  const R = L.svgRoot(root);
  const band = L.svg('rect', { x: RX, y: 690, width: RW, height: 6, fill: '#121211' }, R);
  // 总指挥：4 段红（中间 3 次上下文压缩）；二十条线：20 根墨色短竖
  const segs = [], drops = [];
  for (let k = 0; k < 4; k++) {
    const x = RX + k * 118;
    segs.push(L.svg('rect', { x, y: 722, width: 96, height: 10, fill: '#E8411A' }, R));
    drops.push(L.svg('line', { x1: x + 48, y1: 696, x2: x + 48, y2: 722, stroke: '#121211', 'stroke-width': 1 }, R));
  }
  const ticks = [];
  for (let k = 0; k < 20; k++) {
    const x = RX + 500 + k * 17.6;
    ticks.push(L.svg('rect', { x, y: 704, width: 4, height: 28, fill: '#121211' }, R));
  }
  const sL1 = T(RX, 740, 'label', '<span class="red">总指挥</span>　上下文压缩 3 次，规则还在');
  const sL2 = T(RX + 500, 740, 'label', '二十条线　新会话一开就读进来');
  const rules = [['01', '原任务有答案就停'], ['02', '工具坏了最多诊断一轮'], ['03', '「继续」有歧义先问'], ['04', '限频立刻收手']]
    .map(([n, s], k) => T(RX + (k % 2) * 426, 794 + (k >> 1) * 52, 'body', `<span class="mono g2" style="font-size:24px;margin-right:14px">${n}</span>${s}`, { fontSize: '32px' }));
  const ruleAt = [b3 + 3.9, b3 + 5.6, b3 + 6.5, b3 + 7.1];

  return t => {
    title(t);
    // 缆绳：先出「球球」，106 根向上汇入总指挥，8 根往下进线
    L.wipe(src, L.ramp(t, b1 + 3.2, .6)); L.wipe(srcN, L.ramp(t, b1 + 3.4, .6));
    srcBar.style.opacity = L.ramp(t, b1 + 3.3, .4);
    for (const o of paths) {
      const a = o.up ? b1 + 4.0 + o.i * .016 : b1 + 7.0 + (o.i - M1) * .06;
      drawLine(o.p, L.ramp(t, a, 1.6, L.ease));
    }
    const pUp = L.ramp(t, b1 + 5.2, .5), pDn = L.ramp(t, b1 + 8.2, .5);
    cmdBar.style.opacity = pUp; lineBar.style.opacity = pDn;
    L.count(n1, N1, L.ramp(t, b1 + 5.2, 1.2)); n1.style.opacity = t >= b1 + 5.2 ? 1 : 0;
    L.wipe(l1, L.ramp(t, b1 + 5.5, .6));
    L.count(n2, N2, L.ramp(t, b1 + 8.2, .6)); n2.style.opacity = t >= b1 + 8.2 ? 1 : 0;
    L.wipe(l2, L.ramp(t, b1 + 8.4, .6));
    L.wipe(ann, L.ramp(t, b1 + 6.4, .6));
    // 原话
    L.wipeX(qRule, L.ramp(t, b2 - .05, .7, L.ease)); L.wipe(qK, L.ramp(t, b2 + .1, .6));
    L.wipe(q1, L.ramp(t, b2 + .5, .7)); L.wipe(q2, L.ramp(t, b2 + 2.4, .7));
    L.wipeX(qU, L.ramp(t, b2 + 2.9, .6, L.ease));
    L.wipe(q3, L.ramp(t, b2 + 3.9, .7));
    // 规则落进文件，再被继承
    L.wipeX(rRule, L.ramp(t, b3 - .05, .7, L.ease)); L.wipe(rK, L.ramp(t, b3 + .1, .6)); L.wipe(rF, L.ramp(t, b3 + .6, .6));
    band.setAttribute('width', RW * L.ramp(t, b3 + 1.0, 1.2, L.ease));
    segs.forEach((s, k) => { const p = L.ramp(t, b3 + 2.2 + k * .18, .4); s.style.opacity = p; drops[k].style.opacity = p; });
    ticks.forEach((s, k) => { s.style.opacity = L.ramp(t, b3 + 2.8 + k * .03, .3); });
    L.wipe(sL1, L.ramp(t, b3 + 2.6, .6)); L.wipe(sL2, L.ramp(t, b3 + 3.2, .6));
    rules.forEach((r, k) => L.wipe(r, L.ramp(t, ruleAt[k], .6)));
  };
};
