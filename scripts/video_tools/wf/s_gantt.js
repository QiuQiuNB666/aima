// 场景 gantt（W07 ⑤ 两天摊开看）：21 条泳道（总指挥朱红 + 20 条线墨色）× 9/23 10:00 → 9/24 12:00。
//   sw18 时间游标从左扫到右：条跟着长出来、合并刻度出现；顶上「同时在干活」阶梯面积图，扫过 17:20 标峰值，扫过 03:10 标后台 Agent 41 个；
//        DATA.outage 用斜线阴影标「断了 3.5 小时」。
//   sw19 泳道层转灰压暗，main 行上 03:28 那一簇括出来，放大成一条 5 分钟小轴：9 次合并按真实时刻一颗颗落下（重叠的往上摞）。
SCENES.gantt = (root, D, ctx) => {
  const { el, svg, ramp, wipe, ease, clamp } = L;
  const B = ctx.beats, b1 = B.sw18, b2 = B.sw19;
  const T = (x, y, html, cls = '', css = {}) => el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css), html);
  const TR = (x, y, html, cls = '', css = {}) => T(0, y, html, cls, Object.assign({ left: 'auto', right: (1920 - x) + 'px', textAlign: 'right' }, css));
  const INK = '#121211', G3 = '#D4D4CD', RED = '#E8411A', PAPER = '#F1F1EC';
  const H = 3600e3, W0 = D.window.t0, W1 = D.window.t1;
  const x0 = 320, x1 = 1824, X = t => x0 + (t - W0) / (W1 - W0) * (x1 - x0);
  const AB = 272, AU = 9, AT = AB - 10 * AU;                 // 面积图底线、每个会话 9 px
  const LT = 318, P = 26.5, yc = i => LT + i * P + P / 2, MY = 890;   // 21 条泳道 + main 行
  const cs0 = b1 + .8, cs1 = b1 + 8.6, cur = t => x0 + (x1 - x0) * clamp((t - cs0) / (cs1 - cs0));   // 游标位置
  const tAt = ms => cs0 + (X(ms) - x0) / (x1 - x0) * (cs1 - cs0);                                        // 游标扫到某时刻的秒数
  const fx = [];

  const title = L.title(root, '每一条线什么时候在干活', { cls: 'h3', top: 92 });
  const sw = (w, h, c, extra = '') => `<svg width="${w}" height="${h}" style="vertical-align:${-(h - 16) / 2 - 2}px;margin-right:8px">${extra || `<rect width="${w}" height="${h}" fill="${c}"/>`}</svg>`;
  const legend = TR(1824, 110, sw(26, 11, INK) + '在干活　　' + sw(3, 22, RED) + '合并进 main　　' +
    sw(26, 18, '', `<rect width="26" height="18" fill="url(#gt-hatch)"/>`) + '断线', 'label');

  const S = L.svgRoot(root), defs = svg('defs', {}, S);
  const pat = svg('pattern', { id: 'gt-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: INK, 'stroke-width': 1.4, opacity: .38 }, pat);
  const cp = svg('clipPath', { id: 'gt-cur' }, defs), cr = svg('rect', { x: x0, y: 0, width: 0, height: 1080 }, cp);
  const grid = svg('g', {}, S), swept = svg('g', { 'clip-path': 'url(#gt-cur)' }, S);   // S 整层在 sw19 转灰压暗（不用透明度，免得朱红变粉）

  // 时间轴：每 2 小时一根竖线，午夜那根墨色
  const ticks = [];
  for (let k = 0; k <= 13; k++) {
    const t = W0 + k * 2 * H, x = X(t), hh = Math.round(t / H + 8) % 24;
    svg('rect', { x: x - .5, y: AT - 4, width: 1, height: MY - AT + 14, fill: hh === 0 ? INK : G3 }, grid);
    if (k < 13) ticks.push(T(x, AB + 8, hh === 0 ? '9/24' : String(hh).padStart(2, '0') + ':00', hh === 0 ? 'label' : 'mono g1', { fontSize: '22px', transform: 'translateX(-50%)', fontWeight: hh === 0 ? 700 : 400 }));
  }
  // 断线：斜线阴影（跟着游标露出来）
  const oa = X(D.outage.t0), ob = X(D.outage.t1);
  svg('rect', { x: oa, y: AT - 4, width: ob - oa, height: MY - AT + 14, fill: 'url(#gt-hatch)' }, swept);
  // 同时在干活的会话数：10 分钟一格的阶梯面积
  let d = `M${X(D.conc[0].t)} ${AB}`;
  D.conc.forEach(c => { d += ` L${X(c.t)} ${AB - c.n * AU} L${X(c.t + 600e3)} ${AB - c.n * AU}`; });
  d += ` L${X(D.conc[D.conc.length - 1].t + 600e3)} ${AB} Z`;
  svg('path', { d, fill: G3, stroke: INK, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, swept);
  svg('rect', { x: x0, y: AB, width: x1 - x0, height: 1.5, fill: INK }, grid);
  const aLab = T(x0 + 10, AT - 4, '同时在干活的会话', 'label g1');

  // 21 条泳道：总指挥 + 20 条线
  const lanes = [{ tag: '总', name: '总指挥', spans: D.commander.spans, merges: [], cmd: 1 }].concat(D.lines);
  const labs = lanes.map((ln, i) => {
    const y = yc(i);
    ln.spans.forEach(([a, b]) => svg('rect', { x: X(a), y: y - 6, width: Math.max(2, X(b) - X(a)), height: 12, fill: ln.cmd ? RED : INK }, swept));
    ln.merges.forEach(m => svg('rect', { x: X(m) - 1.5, y: y - 9, width: 3, height: 18, fill: RED }, swept));
    const cjk = !/^[A-Z0-9]+$/.test(ln.tag);
    return T(96, y - 17, `<span class="bullet${ln.cmd ? ' cmd' : ''}" style="min-width:26px;height:26px;padding:0 6px;margin-right:12px;vertical-align:1px;font-size:${cjk ? 14 : 15}px;${cjk ? 'font-family:var(--sans)' : ''}">${ln.tag}</span>${ln.name}`,
      ln.cmd ? 'red' : '', { fontSize: '24px', fontWeight: ln.cmd ? 600 : 500, lineHeight: '34px' });
  });
  // main 行：全部合并
  const mainLab = T(96, MY - 17, '<span class="mono" style="font-weight:700">main</span>', '', { fontSize: '24px', lineHeight: '34px' });
  const S2 = L.svgRoot(root);                                 // main 行、游标、注释：sw19 不压暗
  const mainBase = svg('rect', { x: x0, y: MY - 1, width: x1 - x0, height: 2, fill: INK }, S2);
  const gMain = svg('g', { 'clip-path': 'url(#gt-cur)' }, S2);
  D.mainMerges.forEach(m => svg('rect', { x: X(m) - 1.5, y: MY - 9, width: 3, height: 18, fill: RED }, gMain));
  const cursor = svg('rect', { x: x0, y: AT - 14, width: 2, height: MY - AT + 26, fill: INK }, S2);

  // 注：峰值、后台 Agent 41、断线
  const pk = D.peak, px = X(pk.t + 300e3), pkY = AB - pk.n * AU;
  const pkLine = svg('rect', { x: px - .75, y: 170, width: 1.5, height: pkY - 170, fill: INK }, S2);
  const pkLab = T(px + 10, 152, `峰值：<b>${pk.n} 个会话</b>同时在干活　<span class="mono g1">${L.hm(pk.t)}</span>`, 'label');
  const agT = W0 + 17 * H + 10 * 60e3, ax = X(agT);          // 9/24 03:10
  // 41 是后台 Agent，不是面积图里的会话数：只在时间轴上点一个点，注释用同样的点对齐在正上方，不往面积图里画线
  const agDot = svg('circle', { cx: ax, cy: AB + .75, r: 0, fill: INK }, S2);
  const agLab = T(ax - 6, 152, `<svg width="12" height="12" style="margin-right:10px;vertical-align:0"><circle cx="6" cy="6" r="5.5" fill="${INK}"/></svg><span class="mono g1">03:10</span>　后台 Agent 最多 <b>41 个</b>同时跑`, 'label');
  const [o1, o2] = D.outage.text.split('，');
  const oLab = T(oa + 8, 388, `<span class="mono" style="font-size:22px">${L.hh(D.outage.t0)}–${L.hh(D.outage.t1)}</span><br>${o1.replace(' + ', '<br>+ ')}<br><b style="font-size:28px">${o2}</b>`,
    '', { fontSize: '24px', lineHeight: 1.4, background: PAPER, padding: '6px 10px 8px', marginLeft: '-2px' });

  fx.push(t => {
    title(t);
    wipe(legend, ramp(t, b1 + .3, .5));
    labs.forEach((e, i) => wipe(e, ramp(t, b1 + .1 + i * .035, .5)));
    wipe(mainLab, ramp(t, b1 + .85, .5));
    ticks.forEach((e, k) => wipe(e, ramp(t, b1 + .2 + k * .04, .4)));
    grid.style.opacity = ramp(t, b1, .6);
    wipe(aLab, ramp(t, b1 + .6, .5));
    const cx = cur(t);
    cr.setAttribute('width', cx - x0);
    cursor.setAttribute('x', cx - 1);
    cursor.style.opacity = ramp(t, cs0 - .2, .3) * (1 - ramp(t, cs1, .4));
    const pp = ramp(t, tAt(pk.t), .5, ease);
    pkLine.setAttribute('y', pkY - (pkY - 170) * pp); pkLine.setAttribute('height', (pkY - 170) * pp); wipe(pkLab, ramp(t, tAt(pk.t) + .15, .5));
    agDot.setAttribute('r', 6 * ramp(t, tAt(agT), .3)); wipe(agLab, ramp(t, tAt(agT) + .1, .5));
    wipe(oLab, ramp(t, tAt(D.outage.t1), .5));
    const g = ramp(t, b2 + .1, .6);
    S.style.filter = g > 0 ? `grayscale(${g}) opacity(${1 - .5 * g})` : '';
    [pkLine, agDot, mainBase].forEach(e => { e.style.opacity = 1 - .5 * g; });
    [pkLab, agLab, oLab, aLab].forEach(e => { if (t > b2) e.style.opacity = 1 - .5 * g; });
  });

  // ---------- sw19：03:28 那一簇，放大成 5 分钟小轴 ----------
  {
    const c0 = W0 + 17 * H + 27 * 60e3, c1 = c0 + 6 * 60e3;   // 03:27 → 03:33 窗口里找
    const cl = D.mainMerges.filter(m => m >= c0 && m < c1).sort((a, b) => a - b);
    const Z0 = c0 + 30e3, Z1 = c0 + 6 * 60e3, zx0 = 700, zx1 = 1290, ZX = m => zx0 + (m - Z0) / (Z1 - Z0) * (zx1 - zx0), ZY = 842;
    const cxA = X(cl[0]) - 5, cxB = X(cl[cl.length - 1]) + 5;
    const brk = svg('rect', { x: cxA, y: MY - 14, width: cxB - cxA, height: 28, fill: 'none', stroke: RED, 'stroke-width': 2 }, S2);
    const lead = svg('path', { d: `M${(cxA + cxB) / 2} ${MY - 14} V${ZY} H${zx1 + 14}`, fill: 'none', stroke: RED, 'stroke-width': 1.5 }, S2);
    const pane = T(zx0 - 16, 713, '', '', { width: (zx1 - zx0 + 32) + 'px', height: '164px', background: PAPER });
    const rule = T(zx0, 718, '', '', { width: (zx1 - zx0) + 'px', height: '2px', background: 'var(--ink)' });
    const f = ms => L.hh(ms) + ':' + String(new Date(ms).getUTCSeconds()).padStart(2, '0');
    const l1 = T(zx0, 730, `巡检连合 <span class="num" style="font-size:30px">0</span> 次　<span class="mono g1" style="font-size:22px">${f(cl[0])} → ${f(cl[cl.length - 1])}</span>`, '', { fontSize: '26px', fontWeight: 600 });
    const cnt = l1.querySelector('.num');
    const l2 = T(zx0, 766, '会话撞了用量上限，定时巡检在 bash 层照样合', 'label g1');
    const Sz = L.svgRoot(root), gz = svg('g', {}, Sz);
    const zAxis = svg('rect', { x: zx0, y: ZY, width: 0, height: 2, fill: INK }, Sz);
    const mins = [];
    for (let m = 1; m <= 5; m++) { const x = ZX(c0 + m * 60e3); svg('rect', { x: x - .5, y: ZY, width: 1, height: 8, fill: INK }, gz); mins.push(T(x, ZY + 5, L.hh(c0 + m * 60e3), 'mono g1', { fontSize: '22px', transform: 'translateX(-50%)' })); }
    // 重叠的往上摞：和同一摞最底那颗相距 < 13 px 就叠上去
    let last = -99, lvl = 0;
    const dots = cl.map((m, k) => { const x = ZX(m); lvl = x - last < 13 ? lvl + 1 : 0; if (!lvl) last = x; return { x: lvl ? last : x, y: ZY - 10 - lvl * 14, at: b2 + 2.2 + k * .38, c: svg('circle', { cx: lvl ? last : x, cy: ZY - 10 - lvl * 14, r: 0, fill: RED }, Sz) }; });
    fx.push(t => {
      const p = ramp(t, b2 + .3, .5, ease);
      brk.style.opacity = lead.style.opacity = p;
      L.draw(lead, ramp(t, b2 + .4, .7, ease));
      pane.style.opacity = ramp(t, b2 + .7, .3);
      L.wipeX(rule, ramp(t, b2 + .8, .6, ease));
      wipe(l1, ramp(t, b2 + 1.0, .5)); wipe(l2, ramp(t, b2 + 1.3, .5));
      zAxis.setAttribute('width', (zx1 - zx0) * ramp(t, b2 + 1.1, .7, ease));
      gz.style.opacity = ramp(t, b2 + 1.3, .4);
      mins.forEach((e, k) => wipe(e, ramp(t, b2 + 1.3 + k * .06, .4)));
      let n = 0;
      dots.forEach(o => { const q = ramp(t, o.at, .3); if (q > 0) n++; o.c.setAttribute('r', 6 * q); });
      cnt.textContent = n;
    });
  }
  return t => fx.forEach(f => f(t));
};
