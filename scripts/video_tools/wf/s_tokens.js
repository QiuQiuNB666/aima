// 场景 tokens（W07b ⑥ 花了多少 token）：同一把尺子上比「写出来的」和「反复读的」。
//   sw19t 输出 1423 万 = 一根 6 px 的墨条；缓存读取 38.5 亿 = 从左铺到右的灰条（1728 px），两个数字 170 px 跟着条滚；
//         sw19u 开头整体收拢到上半屏（数字缩一半），给下面让位。
//   sw19u 那根 6 px 的墨条放大 270 倍落到下面，按谁写的切成四段（总指挥两段朱红，后台 Agent 那段用斜线）；
//         再用同一把放大尺画「二十条线并行的 25 小时」999 万、「做这支拆解片」120 万（赛后另算）；最后一行注：这些数是下限。
SCENES.tokens = (root, D, ctx) => {
  const { el, svg, ramp, wipe, ease, clamp, lerp } = L;
  const B = ctx.beats, b1 = B.sw19t, b2 = B.sw19u, K = D.tokens;
  const T = (x, y, html, cls = '', css = {}) => el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css), html);
  const TR = (x, y, html, cls = '', css = {}) => T(0, y, html, cls, Object.assign({ left: 'auto', right: (1920 - x) + 'px', textAlign: 'right' }, css));
  const INK = '#121211', G2 = '#A6A69F', RED = '#E8411A', PAPER = '#F1F1EC';
  const wan = v => Math.round(v / 1e4), yi = v => (v / 1e8).toFixed(1);
  const X0 = 96, FW = 1728, OUT = K.output, CR = K.cacheRead;
  const ow = FW * OUT / CR, zoom = FW / ow, Z = v => FW * v / OUT;       // 放大后的尺：1423 万 = 1728 px
  const fx = [];
  fx.push(L.title(root, '花了多少 token', { cls: 'h2', top: 100 }));

  const S = L.svgRoot(root), defs = svg('defs', {}, S);
  const hatch = (id, c) => { const p = svg('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs); svg('rect', { width: 6, height: 6, fill: PAPER }, p); svg('rect', { width: 2.4, height: 6, fill: c }, p); };
  hatch('tk-hr', RED); hatch('tk-hi', INK);

  // ---------- 上：同一把尺子 ----------
  // sw19t 时两个数字 170 px、灰条 110 px 高铺满下半屏；sw19u 一开始整体收拢到上半屏（数字缩到一半、条变细），给下面的放大图让位。
  const d1 = b2 - .35 - b1, q = t => ramp(t, b2 - .15, .8, ease);          // sw19t 的说话时长；收拢进度
  const at1 = b1 + .2 * d1, c0 = b1 + .56 * d1, cd = Math.min(3, .33 * d1); // 「写出 1423 万」「读了 38 亿」大约落在这两处
  const box = (html, cls, css) => { const o = el('div', 'abs', root, css); return [o, el('div', cls, o, { whiteSpace: 'nowrap' }, html)]; };
  const [o1, n1] = box('<span>0</span><span style="font-size:.5em;margin-left:.12em">万</span>', 'num', { left: (X0 - 6) + 'px', top: '0', fontSize: '170px', transformOrigin: '0 0' });
  const [ol1, l1] = box('输出：模型真正写出来的<br><span class="label g1">代码、文档、回复、思考</span>', '', { left: '0', top: '0', fontSize: '30px', fontWeight: 600, lineHeight: 1.45 });
  const sliver = svg('rect', { x: X0, y: 0, width: ow, height: 0, fill: INK }, S);
  const [oe1, e1] = box(`<span class="mono">${L.fmt(OUT)}</span>　<span class="g1">只有缓存读取的 ${(OUT / CR * 100).toFixed(2)}%</span>`, 'label', { left: '0', top: '0' });
  const e1b = e1.lastChild;
  const [o2, n2] = box('<span>0</span><span style="font-size:.5em;margin-left:.12em">亿</span>', 'num', { right: (1920 - X0 - FW - 4) + 'px', top: '0', fontSize: '170px', transformOrigin: '100% 0', textAlign: 'right' });
  const [ol2, l2] = box('缓存读取：为了记住上下文，反复读的<br><span class="label g1">每回复一次，都把整段对话从缓存里重读一遍</span>', '', { left: X0 + 'px', top: '0', fontSize: '30px', fontWeight: 600, lineHeight: 1.45 });
  const cache = svg('rect', { x: X0, y: 0, width: 0, height: 0, fill: G2 }, S);
  const [oe2, e2] = box(L.fmt(CR), 'mono g1', { right: (1920 - X0 - FW) + 'px', top: '0', fontSize: '22px' });
  const BAR1 = 306, BH = 40;                                                 // 收拢后输出条的位置（放大动画从这里起飞）
  fx.push(t => {
    const k = q(t), P = (a, b) => lerp(a, b, k);
    o1.style.transform = `translateY(${P(210, 222)}px) scale(${P(1, .5)})`;
    ol1.style.transform = `translate(${P(600, 356)}px, ${P(232, 228)}px)`;
    const h1 = P(64, BH) * ramp(t, at1, .5, ease), y1 = P(398, BAR1);
    sliver.setAttribute('y', y1 + P(64, BH) - h1); sliver.setAttribute('height', h1);
    oe1.style.transform = `translate(${P(126, 122)}px, ${y1 + P(64, BH) / 2 - 16}px)`;
    o2.style.transform = `translateY(${P(492, 354)}px) scale(${P(1, .5)})`;
    ol2.style.transform = `translateY(${P(514, 360)}px)`;
    const y2 = P(684, 452), h2 = P(112, BH);
    cache.setAttribute('y', y2); cache.setAttribute('height', h2);
    oe2.style.transform = `translateY(${y2 + h2 + 8}px)`;
    const p1 = ramp(t, at1, 2.4, ease);
    wipe(n1, ramp(t, at1 - .1, .5)); n1.firstChild.textContent = wan(OUT * p1);
    wipe(l1, ramp(t, at1 + .15, .5));
    wipe(e1, ramp(t, at1 + 2.4, .5)); e1b.style.opacity = ramp(t, c0 + cd + .1, .5);
    wipe(l2, ramp(t, c0 - .2, .5));
    const p2 = ramp(t, c0, cd, ease);
    cache.setAttribute('width', FW * p2);
    wipe(n2, ramp(t, c0, .5)); n2.firstChild.textContent = yi(CR * p2);
    wipe(e2, ramp(t, c0 + cd - .2, .5));
  });

  // ---------- 下：6 px 放大 270 倍，按谁写的切四段 ----------
  const ZY = 578, ZH = 40;
  const zl = T(X0, ZY - 44, `把输出放大 ${Math.round(zoom)} 倍：1423 万按谁写的`, 'label g1');
  const morph = svg('rect', { x: X0, y: BAR1, width: ow, height: BH, fill: INK, opacity: 0 }, S);   // 收拢之后才起飞
  const cp = svg('clipPath', { id: 'tk-seg' }, defs), cr = svg('rect', { x: X0, y: 0, width: 0, height: 1080 }, cp);
  const gSeg = svg('g', { 'clip-path': 'url(#tk-seg)' }, S);
  const cats = [['总指挥', RED], ['总指挥的后台 Agent', 'url(#tk-hr)'], ['二十条线', INK], ['各线的后台 Agent', 'url(#tk-hi)']];
  let x = X0; const segLabs = [];
  cats.forEach(([name, fill], k) => {
    const v = K.byCat[name], w = Z(v);
    svg('rect', { x, y: ZY, width: w, height: ZH, fill }, gSeg);
    if (k) svg('rect', { x: x - 1.5, y: ZY - 1, width: 3, height: ZH + 2, fill: PAPER }, gSeg);
    const last = k === cats.length - 1, html = `<span class="num" style="font-size:34px">${wan(v)}</span><span style="font-size:22px;font-weight:600"> 万</span><br><span class="label g1">${name}</span>`;
    segLabs.push(last ? TR(X0 + FW, ZY + ZH + 10, html, '', { lineHeight: 1.25 }) : T(x, ZY + ZH + 10, html, '', { lineHeight: 1.25 }));
    x += w;
  });
  // 同一把放大尺：线阶段 25 小时、拆解片
  const row = (y, v, lab, at) => {
    const lb = T(X0, y, lab, 'label g1');
    const bar = svg('rect', { x: X0, y: y + 34, width: 0, height: 28, fill: INK }, S);
    const n = T(X0, y + 26, '<span class="num" style="font-size:40px">0</span><span style="font-size:24px;font-weight:600"> 万</span>', '');
    return t => {
      wipe(lb, ramp(t, at, .5));
      const p = ramp(t, at + .3, 1.6, ease), w = Z(v) * p;
      bar.setAttribute('width', w);
      n.style.left = (X0 + w + 16) + 'px'; n.style.opacity = p > 0 ? 1 : 0; n.firstChild.textContent = wan(v * p);
    };
  };
  fx.push(row(730, K.linePhaseOutput, '其中，二十条线并行的那 25 小时（9/23 10:55 → 9/24 11:36）', b2 + 2.5));
  fx.push(row(812, K.film, '做这支拆解片本身（9/26，赛后另算，不在 1423 万里）', b2 + 4.9));
  const foot = TR(X0 + FW, 848, '这些数是下限：上下文压缩和旁路调用不进会话记录', 'label g1');
  fx.push(t => {
    const m = ramp(t, b2 + .7, .9, ease);
    const s = ramp(t, b2 + 1.6, .6, ease);                   // 落定后，四段从左往右换上颜色，墨条让位
    morph.setAttribute('opacity', m > 0 ? 1 : 0);
    morph.setAttribute('x', X0 + FW * s);
    morph.setAttribute('y', lerp(BAR1, ZY, m)); morph.setAttribute('width', lerp(ow, FW, m) * (1 - s)); morph.setAttribute('height', lerp(BH, ZH, m));
    cr.setAttribute('width', FW * s);
    wipe(zl, ramp(t, b2 + .85, .5));
    segLabs.forEach((e, k) => wipe(e, ramp(t, b2 + 1.7 + k * .15, .5)));
    wipe(foot, ramp(t, b2 + 6.3, .6));
  });
  return t => fx.forEach(f => f(t));
};
