// 场景「open」（W01 开场）。一条阅读路径：左上球球那句话 → 大标题 → 右上四个数 → 中间铺满宽度的分叉图 → 底部目录。
// 分叉图 = 真实数据：朱红横线是总指挥（粗段 = 它在干活），二十条线按真实开工时间从它身上分出去，
// 墨色粗段 = 这条线在干活（10 分钟桶），朱红刻度 = 合并进 main，最后汇进右边的 main；时间轴 9/23 10:00 → 9/24 12:00，游标扫过去。
// 旁白对拍：各句里的短语起点是按 vo/sw01–03.wav 的停顿实测的（相对 beats 的秒数，见 AT）。
SCENES.open = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw01 ?? .4, b2 = B.sw02 ?? 8, b3 = B.sw03 ?? 15.2;
  const AT = {
    quote1: b1 + 3.34, quote2: b1 + 4.79,                       // 「你这样做太慢了」「你分几个任务给其他对话框吧」
    n20: b2 + .73, n287: b2 + 2.48, rest: b2 + 4.19,             // 二十条… / 近三百个… / 一起把…
    toc: [b3 + 2.01, b3 + 2.69, b3 + 3.37, b3 + 4.42, b3 + 5.12], hermes: b3 + 6.45,
  };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { ink: css('--ink'), red: css('--red'), g1: css('--g1'), g2: css('--g2'), g3: css('--g3'), paper: css('--paper') };
  const { ramp, ease, out, clamp, wipe, wipeX, draw } = L;

  // ---------- 分叉图几何 ----------
  const T0 = D.window.t0, T1 = D.window.t1, MIN = 60e3;
  const xa = 204, xb = 1688, xj = 1756, xe = 1824, Y0 = 586, P = 14.4;
  const X = ms => xa + (ms - T0) / (T1 - T0) * (xb - xa);
  const top = Y0 - 10 * P - 12, bot = Y0 + 10 * P + 12;
  const S = L.svgRoot(root);
  const G = L.svg('g', {}, S);
  const path = (d, stroke, w, extra) => L.svg('path', Object.assign({ d, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'butt' }, extra || {}), G);
  const rect = (x, y, w, h, fill, extra) => L.svg('rect', Object.assign({ x, y, width: w, height: h, fill }, extra || {}), G);

  // 峰值带（10 个会话同时在干活）：先建，垫在最底下
  const pk = D.conc.filter(c => c.n === D.peak.n), pk0 = pk[0].t, pk1 = pk[pk.length - 1].t + 10 * MIN;
  const peakBand = rect(X(pk0), top, X(pk1) - X(pk0), bot - top, C.ink, { opacity: .07 });
  peakBand.style.transformBox = 'fill-box'; peakBand.style.transformOrigin = '50% 0';

  // 时间轴（图下方）：每 2 小时一个刻度，0 点写日期
  const axY = bot + 8;
  const axis = L.svg('g', {}, S);
  L.svg('line', { x1: xa, y1: axY, x2: xb, y2: axY, stroke: C.ink, 'stroke-width': 1.5 }, axis);
  const axLabels = [];
  for (let t = T0; t <= T1; t += 2 * 3600e3) {
    L.svg('line', { x1: X(t), y1: axY, x2: X(t), y2: axY + 7, stroke: C.ink, 'stroke-width': 1.5 }, axis);
    const midnight = L.hh(t) === '00:00';
    axLabels.push(L.el('div', 'abs mono', root, { left: X(t) + 'px', top: axY + 9 + 'px', fontSize: '22px', transform: 'translateX(-50%)', color: midnight ? C.ink : C.g1, fontWeight: midnight ? 700 : 400 },
      midnight ? '9/24' : L.hh(t)));
  }
  axLabels.unshift(L.el('div', 'abs mono', root, { left: '96px', top: axY + 9 + 'px', fontSize: '22px', fontWeight: 700 }, '9/23'));

  // 总指挥：朱红横线（整段）+ 在干活的粗段
  const trunkA = path(`M${xa} ${Y0} L${xb} ${Y0}`, C.red, 2.5);
  const trunkB = path(`M${xb} ${Y0} L${xj} ${Y0}`, C.red, 2.5);
  const cmdSpans = D.commander.spans.filter(s => s[1] > T0 && s[0] < T1).map(([a, b]) => {
    const x0 = X(Math.max(a, T0)), x1 = X(Math.min(b, T1));
    return { x0, x1, r: rect(x0, Y0 - 4, 0, 8, C.red) };
  });

  // 二十条线：外圈 = 最早开工，上下交替；分叉 → 活着的一段（墨）→ 收工后到右端（浅灰）→ 汇入 main
  const lanes = D.lines.map((ln, i) => {
    const side = i % 2 ? 1 : -1, k = i >> 1, y = Y0 + side * (10 - k) * P;
    const xs = X(ln.start), lastM = ln.merges.length ? Math.max(...ln.merges) : 0;
    const life = Math.max(ln.end, lastM, ...ln.spans.map(s => s[1])), xl = X(life);
    const dy = Math.abs(y - Y0), dx = 22 + dy * .3, x0 = Math.max(xa + 6, xs - dx);
    const o = { y, xs, xl, x0, t0: ln.start, merged: ln.merges.length > 0 };
    // 底稿：开场先用极浅的灰把整张扇形的骨架画出来（分叉 → 这条线 → 汇进 main），真实数据随后由游标填上
    o.ghost = path(`M${x0} ${Y0} C${x0 + (xs - x0) * .55} ${Y0} ${xs - (xs - x0) * .45} ${y} ${xs} ${y} L${o.merged ? xb : xl} ${y}` +
      (o.merged ? ` C${xb + 38} ${y} ${xj - 34} ${Y0} ${xj} ${Y0}` : ''), C.g3, 1);
    o.branch = path(`M${x0} ${Y0} C${x0 + (xs - x0) * .55} ${Y0} ${xs - (xs - x0) * .45} ${y} ${xs} ${y}`, C.ink, 1.3, { opacity: .55 });
    o.life = path(`M${xs} ${y} L${xl} ${y}`, C.ink, 1.3, { opacity: .55 });
    if (o.merged) {
      o.post = path(`M${xl} ${y} L${xb} ${y}`, C.g3, 1.2);
      o.fanin = path(`M${xb} ${y} C${xb + 38} ${y} ${xj - 34} ${Y0} ${xj} ${Y0}`, C.g2, 1.2);
    } else o.cap = rect(xl - 1, y - 5, 2, 10, C.ink, { opacity: 0 });
    o.spans = ln.spans.map(([a, b]) => { const s0 = X(Math.max(a, ln.start)), s1 = X(b); return { s0, s1, r: rect(s0, y - 3.2, 0, 6.4, C.ink) }; });
    o.ticks = ln.merges.map(m => { const r = rect(X(m) - 1.2, y - 7, 2.4, 14, C.red); r.style.transformBox = 'fill-box'; r.style.transformOrigin = '50% 50%'; return { x: X(m), r }; });
    return o;
  });

  // 汇合点 → main（从总指挥那条红线出来）
  const main = path(`M${xj} ${Y0} L${xe} ${Y0}`, C.ink, 7);
  const jDot = L.svg('circle', { cx: xj, cy: Y0, r: 6, fill: C.red }, G);
  const mainLab = L.el('div', 'abs mono', root, { left: xe - 80 + 'px', width: '80px', textAlign: 'right', top: Y0 - 42 + 'px', fontSize: '28px', fontWeight: 700 }, 'main');
  const cmdDot = L.svg('circle', { cx: xa, cy: Y0, r: 9, fill: C.red }, S);
  const cmdLab = L.el('div', 'abs red', root, { left: '96px', top: Y0 - 20 + 'px', fontSize: '28px', fontWeight: 600, lineHeight: 1.4 }, '总指挥');

  // 游标
  const cur = L.svg('line', { x1: 0, y1: top - 6, x2: 0, y2: axY, stroke: C.ink, 'stroke-width': 1.5 }, S);
  const curLab = L.el('div', 'abs mono', root, { top: top - 34 + 'px', fontSize: '22px', fontWeight: 700, background: C.paper, padding: '0 6px', transform: 'translateX(-50%)', whiteSpace: 'nowrap' });
  const peakLab = L.el('div', 'abs label', root, { left: X(pk1) + 10 + 'px', top: top - 36 + 'px', whiteSpace: 'nowrap' },
    `峰值　<span class="mono">${L.hm(pk0)}–${L.hh(pk1)}</span>`);

  // ---------- 文字 ----------
  const kick = L.el('div', 'abs label g1', root, { left: '96px', top: '104px', whiteSpace: 'nowrap' }, '9/23 10:48　球球对总指挥说');
  const Q = '「你这样做太慢了 你分几个任务给其他对话框吧」';            // 照原话：中间是空格
  const quote = L.el('div', 'abs', root, { left: '96px', top: '140px', fontSize: '72px', fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', transformOrigin: '0 0' },
    Q);
  const QS = 40 / 72;                                                   // 落位后等于 40 px
  const title = [L.el('div', 'abs', root, { left: '92px', top: '200px', fontSize: '84px', fontWeight: 600, lineHeight: 1.08, whiteSpace: 'nowrap' }, '一个人，同时指挥'),
                 L.el('div', 'abs', root, { left: '92px', top: '291px', fontSize: '84px', fontWeight: 600, lineHeight: 1.08, whiteSpace: 'nowrap' }, '二十条 Agent 线')];

  // 四个数：2 × 2，各挂一条 2 px 上边线
  const stat = (s, x, y, at, red) => {
    const rule = L.el('div', 'abs', root, { left: x + 'px', top: y + 'px', width: '341px', height: '2px', background: C.ink });
    const num = L.el('div', 'abs num' + (red ? ' red' : ''), root, { left: x - 5 + 'px', top: y + 16 + 'px', fontSize: '104px' }, '0');
    const lab = L.el('div', 'abs label', root, { left: x + 'px', top: y + 112 + 'px', whiteSpace: 'nowrap' }, s.label);
    return t => { wipeX(rule, ramp(t, at - .15, .5)); const p = ramp(t, at, 1.1, ease); num.style.opacity = p > 0 ? 1 : 0; L.count(num, s.n, p); wipe(lab, ramp(t, at + .25, .6)); };
  };
  const st = D.stats;
  const stats = [stat(st[0], 1118, 104, AT.n20), stat(st[1], 1483, 104, AT.n287),
                 stat(st[2], 1118, 250, AT.rest + .3, true), stat(st[3], 1483, 250, AT.rest + 1.3)];

  // 目录：五格，各挂一条上边线
  const tocY = axY + 58;
  const TOC = [['怎么搭', 96, 268], ['怎么派活', 388, 268], ['怎么不撞车', 680, 268], ['怎么收活', 972, 268], ['对照 EvoMap', 1264, 560]];
  const toc = TOC.map(([s, x, w], i) => ({
    rule: L.el('div', 'abs', root, { left: x + 'px', top: tocY + 'px', width: w + 'px', height: '2px', background: C.ink }),
    txt: L.el('div', 'abs body', root, { left: x + 'px', top: tocY + 12 + 'px', fontSize: '34px', whiteSpace: 'nowrap' }, s),
    at: AT.toc[i],
  }));
  const herm = L.el('div', 'abs body', root, { left: 1264 + toc[4].txt.offsetWidth + 12 + 'px', top: tocY + 12 + 'px', fontSize: '34px', whiteSpace: 'nowrap' }, '/ Hermes Agent');

  // ---------- 游标时间：先停在 10:48（球球那句话），再扫完 25 小时 ----------
  const TQ = T0 + 48 * MIN;
  const cursorAt = t => t < b1 + 3.2 ? T0 + (TQ - T0) * ramp(t, b1 + .9, 2.3, ease)
                      : t < b1 + 6.4 ? TQ : TQ + (T1 - TQ) * ramp(t, b1 + 6.4, b2 + 4.4 - (b1 + 6.4), ease);
  const tEnd = b2 + 4.4;                                                // 扫完

  return t => {
    // 左上：球球那句话 —— 先大字随旁白擦出，句子讲完缩成导语落位
    const kp = ramp(t, b1, .6);
    const q1 = (Q.indexOf(' ') + 1) / Q.length, qp = t < AT.quote2 ? q1 * ramp(t, AT.quote1, 1.1, out) : q1 + (1 - q1) * ramp(t, AT.quote2, 2.0, x => x);
    wipeX(quote, qp); quote.style.opacity = qp > 0 ? 1 : 0;
    const dk = ramp(t, b2 - .55, .7, ease);
    quote.style.transform = `translateY(${(1 - dk) * 46}px) scale(${1 + (QS - 1) * dk})`;
    wipe(kick, kp); kick.style.transform = `translateY(${(1 - kp) * 24 + (1 - dk) * 42}px)`;
    title.forEach((e, i) => wipe(e, ramp(t, b2 + .05 + i * .12, .7)));
    stats.forEach(f => f(t));

    // 分叉图
    axis.style.clipPath = `inset(-40px ${(1 - ramp(t, b1 + .2, 1.2, ease)) * 100}% -10px 0)`;
    axLabels.forEach((e, i) => { e.style.opacity = ramp(t, b1 + .25 + i * .07, .3); });
    const cp = ramp(t, b1 + .5, .5);
    cmdDot.setAttribute('r', 9 * cp); wipe(cmdLab, cp);
    const cms = cursorAt(t), xc = X(cms), live = t >= b1 + .9;
    draw(trunkA, live ? clamp((xc - xa) / (xb - xa)) : 0);
    cmdSpans.forEach(s => s.r.setAttribute('width', live ? clamp(xc - s.x0, 0, s.x1 - s.x0) : 0));
    const fin = ramp(t, tEnd - .05, .6, ease);
    lanes.forEach((o, i) => {
      draw(o.ghost, ramp(t, b1 + .5 + i * .06, 1.6, ease));
      draw(o.branch, live ? clamp((cms - o.t0) / (8 * MIN)) : 0);            // 到了真实开工时间才分出去
      draw(o.life, clamp((xc - o.xs) / Math.max(1, o.xl - o.xs)));
      o.spans.forEach(s => s.r.setAttribute('width', clamp(xc - s.s0, 0, s.s1 - s.s0)));
      o.ticks.forEach(k => { k.r.style.transform = `scaleY(${clamp((xc - k.x) / 5)})`; });
      if (o.merged) { draw(o.post, clamp((xc - o.xl) / Math.max(1, xb - o.xl))); draw(o.fanin, fin); }
      else o.cap.setAttribute('opacity', xc >= o.xl ? 1 : 0);
    });
    draw(trunkB, fin);
    const mp = ramp(t, tEnd + .3, .5, ease);
    jDot.setAttribute('r', 6 * ramp(t, tEnd + .2, .3)); draw(main, mp); wipe(mainLab, ramp(t, tEnd + .45, .5));
    // 游标：跟着扫，扫完收起
    const on = live && t < tEnd + .35;
    cur.setAttribute('opacity', on ? 1 - ramp(t, tEnd + .05, .3) : 0);
    cur.setAttribute('x1', xc); cur.setAttribute('x2', xc);
    curLab.style.opacity = on ? 1 - ramp(t, tEnd + .05, .3) : 0;
    curLab.style.left = xc + 'px'; curLab.textContent = L.hm(cms);
    // 峰值：数到 10 时，图上亮出那半小时
    const pp = ramp(t, AT.rest + 1.3, .6, ease);
    peakBand.style.transform = `scaleY(${pp})`; wipe(peakLab, ramp(t, AT.rest + 1.5, .6));

    // 目录
    toc.forEach(o => { wipeX(o.rule, ramp(t, b3 + .15 + (o.at - AT.toc[0]) * .25, .8, ease)); wipe(o.txt, ramp(t, o.at, .55)); });
    wipe(herm, ramp(t, AT.hermes, .55));
  };
};
