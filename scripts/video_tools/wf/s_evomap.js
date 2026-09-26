// 场景 evomap（W10 · ⑨ 对照 EvoMap）：两条并行的「经验流水线」，共用四个阶段栏（学会 → 打包 → 筛选 → 继承）。
//   上：EvoMap，细墨线，文字在线上方；末端散成一把灰色细线（跨团队的很多 agent）。
//   下：我们，粗墨线，文字在线下方；末端是 20 根墨色短竖（本机的二十条线）。
//   两线之间的空档留给 sw28 的设想：一条虚线从我们的「打包」接到 EvoMap 的「打包」，明确标「未实现」。
SCENES.evomap = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw26 ?? .4, b2 = B.sw27 ?? 11, b3 = B.sw28 ?? 20.2;
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  const title = L.title(root, '经验怎么传', { at: b1 - .1 });
  const slogan = T(1824 - 900, 128, 'body g1', '「一个 Agent 学会，百万 Agent 继承」<span class="label g1">　EvoMap</span>', { width: '900px', textAlign: 'right', fontSize: '34px' });
  const S = L.svgRoot(root), V = (tag, a) => L.svg(tag, a, S);
  const COL = [372, 696, 1040, 1344], END = 1824, YE = 420, YW = 560;

  // 阶段栏
  const heads = ['学会', '打包', '筛选', '继承'].map((s, i) => T(COL[i], 222, 'label g1', `<span class="mono g2">0${i + 1}</span>　${s}`));
  const headRule = T(COL[0], 214, '', '', { width: END - COL[0] + 'px', borderTop: '1px solid var(--g3)' });

  // ---------- EvoMap ----------
  const eName = T(96, 300, 'h3', 'EvoMap', { fontFamily: 'var(--num)', fontWeight: 700, fontSize: '52px' });
  const eNote = T(96, 364, 'label g1', '本届主办方<br>AI 自进化基础设施', { lineHeight: '1.4' });
  const eLine = V('line', { x1: COL[0], y1: YE, x2: 1640, y2: YE, stroke: '#121211', 'stroke-width': 2 });
  const eNodes = COL.map(x => V('circle', { cx: x, cy: YE, r: 7, fill: '#F1F1EC', stroke: '#121211', 'stroke-width': 2 }));
  const eTxt = [
    ['agent 验证过的经验', '解决了一个问题', '并验证过做法'],
    ['Gene + Capsule', '<span style="display:inline-block;width:100px">Gene</span>可复用的策略', '<span style="display:inline-block;width:100px">Capsule</span>验证过的成功结果'],
    ['Hub 按 GDI 自动筛', '打分、晋升、排名', ''],
    ['别的 agent 检索', '跨团队继承', ''],
  ].map((r, i) => [T(COL[i], 290, 'body', r[0], { fontSize: '30px', fontWeight: 600 }), T(COL[i], 334, 'label', r[1] + (r[2] ? '<br>' + r[2] : ''), { lineHeight: '1.4' })]);
  // 末端：一把灰色细线散开（很多 agent）
  const fan = [];
  for (let k = 0; k < 25; k++) {
    const y1 = YE - 84 + k * 7;
    fan.push(V('path', { d: `M1640 ${YE} C1700 ${YE} 1730 ${y1} ${END} ${y1}`, fill: 'none', stroke: '#A6A69F', 'stroke-width': 1 }));
  }
  const eU1 = T(COL[2], 328, '', '', { width: '262px', borderTop: '3px solid var(--ink)' });
  const eU2 = T(COL[3], 368, '', '', { width: '72px', borderTop: '3px solid var(--ink)' });

  // ---------- 我们 ----------
  const wName = T(96, 578, 'h3', '我们', { fontSize: '52px' });
  const wNote = T(96, 642, 'label g1', '一人 + <span class="red">总指挥</span><br>+ 二十条线', { lineHeight: '1.4' });
  const wLine = V('line', { x1: COL[0], y1: YW, x2: 1560, y2: YW, stroke: '#121211', 'stroke-width': 7 });
  const wNodes = COL.map(x => V('rect', { x: x - 8, y: YW - 8, width: 16, height: 16, fill: '#121211' }));
  const wTxt = [
    ['一条线踩了坑', '在指挥板上回报'],
    ['指挥板 · 规则 · 记忆', '<span class="mono">指挥板.md　CLAUDE.md<br>memory/*.md</span>'],
    ['球球人工筛', '判断写不写进规则'],
    ['本机的新会话', '开工就读进来'],
  ].map((r, i) => [T(COL[i], 584, 'body', r[0], { fontSize: '30px', fontWeight: 600 }), T(COL[i], 630, 'label', r[1], { lineHeight: '1.4' })]);
  const ticks = [];
  for (let k = 0; k < 20; k++) ticks.push(V('rect', { x: 1580 + k * 12.3, y: YW - 14, width: 4, height: 28, fill: '#121211' }));
  const wU1 = T(COL[2], 622, '', '', { width: '150px', borderTop: '3px solid var(--ink)' });

  // ---------- 设想（未实现） ----------
  const XP = COL[1];
  const link = V('path', { d: `M${XP} ${YW - 12} L${XP} ${YE + 14}`, fill: 'none', stroke: '#121211', 'stroke-width': 2.5, 'stroke-dasharray': '8 7' });
  const head = V('path', { d: `M${XP - 9} ${YE + 26} L${XP} ${YE + 11} L${XP + 9} ${YE + 26}`, fill: 'none', stroke: '#121211', 'stroke-width': 2.5 });
  const pTag = T(XP + 24, 468, 'label', '未实现', { background: 'var(--ink)', color: 'var(--paper)', padding: '2px 12px', fontWeight: 600 });
  const pTxt = T(XP + 132, 466, 'body', '设想：把「无头 Chrome 限流」这类踩坑经验打包发上去', { fontSize: '30px' });
  const specRule = T(COL[0], 742, '', '', { width: END - COL[0] + 'px', borderTop: '1px solid var(--g3)' });
  const specK = T(96, 756, 'label', '设想中的包', { fontWeight: 600 }), specK2 = T(96, 790, 'label', '草稿，没发布');
  const spec = [
    ['Gene', 'signals_match: multi-agent · git-worktree · headless-chrome'],
    ['', 'constraints: 全机无头 Chrome 同时最多 3 个'],
    ['Capsule', '9/24 02:31 开发机 load 728.8（约 40 个 Chrome）→ 02:53 上信号量'],
  ].map(([a, b], i) => T(COL[0], 756 + i * 44, 'label mono', `<span style="display:inline-block;width:150px;color:var(--g1)">${a}</span>${b}`, { fontSize: '24px' }));
  // 「别人的 Agent 蜂群直接继承」：一颗点沿 EvoMap 线从「打包」跑到末端，那把细线变成墨色
  const puck = V('circle', { cx: XP, cy: YE, r: 9, fill: '#121211' });

  return t => {
    title(t);
    L.wipe(slogan, L.ramp(t, b1 + .8, .7));
    L.wipeX(headRule, L.ramp(t, b1 + 1.2, .8, L.ease));
    heads.forEach((h, i) => L.wipe(h, L.ramp(t, b1 + 1.4 + i * .12, .5)));
    // EvoMap 线：随旁白一段段推进
    L.wipe(eName, L.ramp(t, b1 + .7, .6)); L.wipe(eNote, L.ramp(t, b1 + 2.4, .6));
    const eAt = [b1 + 4.0, b1 + 5.4, b1 + 7.4, b1 + 8.6];
    const eP = t < eAt[0] ? 0 : t < eAt[3] ? (() => { for (let i = 1; i < 4; i++) if (t < eAt[i]) return COL[i - 1] + (COL[i] - COL[i - 1]) * L.ease((t - eAt[i - 1]) / (eAt[i] - eAt[i - 1])); })() : COL[3] + (1640 - COL[3]) * L.ramp(t, eAt[3], .5);
    eLine.setAttribute('x2', Math.max(COL[0], eP)); eLine.style.opacity = t >= eAt[0] ? 1 : 0;
    eNodes.forEach((n, i) => { n.style.opacity = L.ramp(t, eAt[i], .3); });
    eTxt.forEach(([a, b], i) => { L.wipe(a, L.ramp(t, eAt[i] + .1, .6)); L.wipe(b, L.ramp(t, eAt[i] + .35, .6)); });
    const inked = L.ramp(t, b3 + 5.0, .6);
    fan.forEach((f, k) => { L.draw(f, L.ramp(t, eAt[3] + .5 + k * .016, .8, L.ease)); f.style.stroke = inked > 0 ? `rgb(${166 - 148 * inked},${166 - 149 * inked},${159 - 142 * inked})` : '#A6A69F'; });
    // 我们
    L.wipe(wName, L.ramp(t, b2 + .1, .6)); L.wipe(wNote, L.ramp(t, b2 + .4, .6));
    const wAt = [b2 + .8, b2 + 2.0, b2 + 4.6, b2 + 5.3];
    const wP = t < wAt[0] ? 0 : t < wAt[3] ? (() => { for (let i = 1; i < 4; i++) if (t < wAt[i]) return COL[i - 1] + (COL[i] - COL[i - 1]) * L.ease((t - wAt[i - 1]) / (wAt[i] - wAt[i - 1])); })() : COL[3] + (1560 - COL[3]) * L.ramp(t, wAt[3], .5);
    wLine.setAttribute('x2', Math.max(COL[0], wP)); wLine.style.opacity = t >= wAt[0] ? 1 : 0;
    wNodes.forEach((n, i) => { n.style.opacity = L.ramp(t, wAt[i], .3); });
    wTxt.forEach(([a, b], i) => { L.wipe(a, L.ramp(t, wAt[i] + .1, .6)); L.wipe(b, L.ramp(t, wAt[i] + .35, .6)); });
    ticks.forEach((s, k) => { s.style.opacity = L.ramp(t, wAt[3] + .5 + k * .03, .3); });
    // 对照的重点：人筛 vs 自动筛、本机 vs 跨团队
    L.wipeX(wU1, L.ramp(t, b2 + 4.9, .5, L.ease));
    L.wipeX(eU1, L.ramp(t, b2 + 6.2, .6, L.ease)); L.wipeX(eU2, L.ramp(t, b2 + 5.7, .5, L.ease));
    // 设想
    L.draw(link, L.ramp(t, b3 + .3, .9, L.ease)); head.style.opacity = L.ramp(t, b3 + 1.1, .3);
    L.wipe(pTag, L.ramp(t, b3 + .9, .5)); L.wipe(pTxt, L.ramp(t, b3 + 1.1, .7));
    L.wipeX(specRule, L.ramp(t, b3 + 2.0, .7, L.ease)); L.wipe(specK, L.ramp(t, b3 + 2.1, .5)); L.wipe(specK2, L.ramp(t, b3 + 2.3, .5));
    spec.forEach((s, i) => L.wipe(s, L.ramp(t, b3 + 2.3 + i * .35, .5)));
    const pr = L.ramp(t, b3 + 3.9, 1.2, L.ease);
    puck.setAttribute('cx', XP + (1640 - XP) * pr); puck.style.opacity = t < b3 + 3.9 ? 0 : 1 - L.ramp(t, b3 + 5.1, .4);
  };
};
