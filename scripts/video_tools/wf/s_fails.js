// 场景 fails（W09 · ⑧ 翻车）：一页「勘误栏」，三条照实记。
//   01 撞限额那晚：9/23 22:00–9/24 10:00 的同时在干活会话数 + 合并进 main 的刻度，时间游标扫过去，03:49–07:22 是一段斜线空白。
//   02 重复劳动（演示视频 3 遍）｜路由断了（09:18 终验分派给 W/E/U/助理线，到 11:00 冻结 git 里没有修复）。
//   03 更正：派活单写成「拆解游戏里的 AI 蜂群」→ 划掉，应为「这套工作流」。
SCENES.fails = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw23 ?? .4, b2 = B.sw24 ?? 8.3, b3 = B.sw25 ?? 15.2;
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  // 右对齐到 x（L.wipe 会改 transform，所以不用 translateX）
  const TR = (x, y, w, cls, html, css) => T(x - w, y, cls, html, Object.assign({ width: w + 'px', textAlign: 'right' }, css || {}));
  const hr = (y, w = 1728, x = 96, css = '2px solid var(--ink)') => T(x, y, '', '', { width: w + 'px', borderTop: css });
  const title = L.title(root, '也有翻车', { at: b1 - .1 });
  const S = L.svgRoot(root), NSVG = (tag, a, p = S) => L.svg(tag, a, p);
  const defs = NSVG('defs', {});
  const pat = NSVG('pattern', { id: 'fhatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  NSVG('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#A6A69F', 'stroke-width': 1.5 }, pat);

  // ---------- 01 撞限额那晚 ----------
  const HOUR = 3600e3, T0 = Date.UTC(2026, 8, 23, 14), T1 = T0 + 12 * HOUR;          // 北京 9/23 22:00 → 9/24 10:00
  const CX0 = 540, CX1 = 1824, X = ms => CX0 + (ms - T0) / (T1 - T0) * (CX1 - CX0);
  const BASE = 390, K = 12;                                                           // 会话数 → 每个 12 px
  const o0 = D.outage.t0, o1 = D.outage.t1;                                          // 03:49 → 07:22
  const r1 = hr(206);
  const k1 = T(96, 222, 'label', '<span class="mono g2">01</span>　撞限额那晚');
  const big1 = T(96, 256, 'num', '3.5', { fontSize: '170px' });
  const big1u = T(360, 338, 'body', '小时');
  const big1n = T(96, 424, 'label', '<span class="mono">9/24 03:49 → 07:22</span>');
  // 同时在干活的会话数：阶梯面积
  const conc = D.conc.filter(c => c.t >= T0 && c.t < T1);
  let d = `M${X(T0)} ${BASE}`;
  for (const c of conc) { const x0 = X(c.t), x1 = X(Math.min(T1, c.t + 600e3)), y = BASE - c.n * K; d += ` L${x0} ${y} L${x1} ${y}`; }
  d += ` L${X(T1)} ${BASE} Z`;
  const clip = NSVG('clipPath', { id: 'fclip' }, defs), clipR = NSVG('rect', { x: CX0, y: 200, width: 0, height: 300 }, clip);
  const g = NSVG('g', { 'clip-path': 'url(#fclip)' });
  const hatch = NSVG('rect', { x: X(o0), y: 250, width: X(o1) - X(o0), height: BASE - 250 + 34, fill: 'url(#fhatch)' }, g);
  NSVG('path', { d, fill: '#D4D4CD', stroke: '#5C5C57', 'stroke-width': 1.2 }, g);
  NSVG('line', { x1: CX0, y1: BASE + 22, x2: CX1, y2: BASE + 22, stroke: '#121211', 'stroke-width': 1.5 }, g);
  for (const m of D.mainMerges) if (m >= T0 && m < T1) NSVG('rect', { x: X(m) - 1.2, y: BASE + 10, width: 2.4, height: 24, fill: '#E8411A' }, g);
  const base = NSVG('line', { x1: CX0, y1: BASE, x2: CX1, y2: BASE, stroke: '#121211', 'stroke-width': 1.5 });
  const cursor = NSVG('line', { x1: 0, y1: 240, x2: 0, y2: BASE + 40, stroke: '#121211', 'stroke-width': 1.5 });
  const axis = [22, 0, 2, 4, 6, 8, 10].map((h, i) => { const x = X(T0 + i * 2 * HOUR), w = 80; return T(i === 0 ? x : i === 6 ? x - w : x - w / 2, BASE + 42, 'note mono', `${String(h).padStart(2, '0')}:00`, { width: w + 'px', textAlign: i === 0 ? 'left' : i === 6 ? 'right' : 'center', fontSize: '24px' }); });
  const lgA = T(CX0, 248, 'label g1', '同时在干活的会话数'), lgM = TR(CX0 - 12, BASE + 4, 80, 'label mono', 'main');
  // 标注：03:13 撞上限 / 03:24 应用重启 / 空白里写巡检 / 07:22 接上
  const tA = Date.UTC(2026, 8, 23, 19, 13), tB = Date.UTC(2026, 8, 23, 19, 24);
  const pA = NSVG('line', { x1: X(tA), y1: 246, x2: X(tA), y2: BASE, stroke: '#121211', 'stroke-width': 1 });
  const aA = TR(X(tA) - 10, 214, 320, 'label', '<span class="mono">03:13</span> 撞会话用量上限');
  const aB = T(X(tB) + 12, 214, 'label', '<span class="mono">≈03:24</span> 应用重启');
  const aG = T(X(o0) + 10, 258, 'label', '6 个定时任务只活在会话里<br>跟着一起停了，没有任何回合', { background: 'var(--paper)', padding: '4px 8px', lineHeight: '1.4' });
  // 03:27:59–03:32:42 那 9 次合并：巡检在 bash 层连合，标出来免得看不懂
  const tM = Date.UTC(2026, 8, 23, 19, 28), bM = D.mainMerges.filter(m => m >= Date.UTC(2026, 8, 23, 19, 27) && m < Date.UTC(2026, 8, 23, 19, 33)).length;
  const aM = T(X(o0) + 10, 336, 'label', `<span class="mono">03:28</span> 巡检在 bash 层连合 ${bM} 条`, { background: 'var(--paper)', padding: '2px 8px' });
  const pM = NSVG('path', { d: `M${X(o0) + 10} 354 L${X(tM) + 4} 354 L${X(tM) + 4} ${BASE + 6}`, fill: 'none', stroke: '#121211', 'stroke-width': 1 });
  const aC = TR(1824, 214, 320, 'label', '<span class="mono">07:22</span> 球球点了 Try again');
  const pC = NSVG('line', { x1: X(o1), y1: 246, x2: X(o1), y2: BASE, stroke: '#121211', 'stroke-width': 1 });
  // 游标时间表：前段快、03:13–03:49 放慢、空白段匀速、之后快
  const key = [[b1 + .9, T0], [b1 + 2.7, tA], [b1 + 4.3, o0], [b1 + 5.9, o1], [b1 + 6.7, T1]];
  const cur = t => { if (t <= key[0][0]) return T0; for (let i = 1; i < key.length; i++) if (t <= key[i][0]) { const [ta, va] = key[i - 1], [tb, vb] = key[i]; return va + (vb - va) * (t - ta) / (tb - ta); } return T1; };

  // ---------- 02 重复劳动 ｜ 路由断了 ----------
  const r2 = hr(480);
  const k2 = T(96, 496, 'label', '<span class="mono g2">02</span>　重复劳动');
  const big2 = T(96, 532, 'num', '3', { fontSize: '150px' });
  const big2u = T(196, 602, 'body', '遍');
  const big2n = T(250, 582, 'label', '演示视频<br>前后做了三遍', { lineHeight: '1.3' });
  const sep = NSVG('line', { x1: 516, y1: 496, x2: 516, y2: 676, stroke: '#D4D4CD', 'stroke-width': 1 });
  const kR = T(CX0, 496, 'label', '路由断了');
  const xD = 720, xL = xD + 72, xF = 1600;                                            // 09:18 分派点 → 各线 → 11:00 冻结
  const who = ['W', 'E', 'U', '助理线'];
  const lanes = who.map((w, i) => {
    const y = 560 + i * 30;
    return {
      lab: T(xL + 8, y - 16, 'label', w, { fontFamily: w.length > 1 ? 'var(--sans)' : 'var(--mono)' }),
      fan: NSVG('path', { d: `M${xD} 546 C${xD + 36} 546 ${xD + 24} ${y} ${xL} ${y}`, fill: 'none', stroke: '#121211', 'stroke-width': 1.5 }),
      dot: NSVG('line', { x1: xL + 96, y1: y, x2: xF, y2: y, stroke: '#A6A69F', 'stroke-width': 2, 'stroke-dasharray': '2 8' }),
    };
  });
  const dispD = NSVG('circle', { cx: xD, cy: 546, r: 7, fill: '#121211' });
  const dispL = T(xD - 10, 498, 'label', '<span class="mono">09:18</span> 珠峰终验分派问题（如 snow.js 着色器编不过）');
  const frz = NSVG('line', { x1: xF, y1: 538, x2: xF, y2: 666, stroke: '#121211', 'stroke-width': 3 });
  const frzL = T(xF + 14, 532, 'label', '<span class="mono">11:00</span> 提交冻结');
  const none = T(xF + 14, 580, 'body', 'git 里没有<br>修复记录', { lineHeight: '1.3' });

  // ---------- 03 更正 ----------
  const r3a = hr(700, 1728, 96, '3px solid var(--ink)'), r3b = hr(707, 1728, 96, '1px solid var(--ink)');
  const k3 = T(96, 722, 'label', '<span class="mono g2">03</span>　本片自己返工');
  const cor = T(96, 758, 'h2', '更正');
  const w1 = T(CX0, 722, 'label g1', '派活单（<span class="red">总指挥</span>转述）写成：');
  const s1 = T(CX0, 754, 'body g1', '拆解游戏里的 AI 蜂群（教练 / 地形导演 / 记忆员 / 安全员）');
  const strike = T(CX0 - 6, 780, '', '', { height: '3px', background: 'var(--ink)' });
  const s2 = T(CX0, 808, 'body', '应为：拆解这套工作流——球球、总指挥和二十条线');
  const s3 = T(CX0, 856, 'body', '转述会走样。拿不准，就先问。', { fontSize: '30px', fontWeight: 600, lineHeight: '1.2' });

  let sw1 = 0;
  return t => {
    title(t);
    // 01
    L.wipeX(r1, L.ramp(t, b1 + .2, .8, L.ease)); L.wipe(k1, L.ramp(t, b1 + .4, .6));
    const now = cur(t), cx = X(now);
    clipR.setAttribute('width', Math.max(0, cx - CX0));
    base.setAttribute('x2', Math.max(CX0, cx));
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
    cursor.style.opacity = t < key[0][0] ? 0 : 1 - L.ramp(t, key[4][0], .4);
    axis.forEach((a, i) => { a.style.opacity = X(T0 + i * 2 * HOUR) <= cx + 1 && t >= key[0][0] ? 1 : 0; });
    L.wipe(lgA, L.ramp(t, b1 + 1.0, .5)); L.wipe(lgM, L.ramp(t, b1 + 1.0, .5));
    const inA = L.ramp(t, key[1][0] - .1, .5);
    pA.style.opacity = inA; L.wipe(aA, inA);
    L.wipe(aB, L.ramp(t, b1 + 3.5, .5));
    L.wipe(aG, L.ramp(t, key[2][0] + .3, .6));
    L.wipe(aM, L.ramp(t, key[2][0] + .7, .6)); L.draw(pM, L.ramp(t, key[2][0] + .7, .6));
    const inC = L.ramp(t, key[3][0], .5); pC.style.opacity = inC; L.wipe(aC, inC);
    const pBig = L.ramp(t, b1 + 4.9, 1.1);
    big1.textContent = (3.5 * pBig).toFixed(1); big1.style.opacity = t >= b1 + 4.9 ? 1 : 0;
    L.wipe(big1u, L.ramp(t, b1 + 5.3, .5)); L.wipe(big1n, L.ramp(t, b1 + 5.6, .5));
    // 02
    L.wipeX(r2, L.ramp(t, b2 - .1, .8, L.ease)); L.wipe(k2, L.ramp(t, b2 + .1, .5));
    L.count(big2, 3, L.ramp(t, b2 + .6, .9)); big2.style.opacity = t >= b2 + .6 ? 1 : 0;
    L.wipe(big2u, L.ramp(t, b2 + .9, .5)); L.wipe(big2n, L.ramp(t, b2 + 1.1, .5));
    sep.style.opacity = L.ramp(t, b2 + 2.4, .5);
    L.wipe(kR, L.ramp(t, b2 + 2.6, .5));
    dispD.style.opacity = L.ramp(t, b2 + 2.9, .3); L.wipe(dispL, L.ramp(t, b2 + 2.9, .6));
    lanes.forEach((l, i) => {
      L.wipe(l.lab, L.ramp(t, b2 + 3.3 + i * .12, .4));
      L.draw(l.fan, L.ramp(t, b2 + 3.3 + i * .12, .5));
      l.dot.setAttribute('x2', xL + 96 + (xF - xL - 96) * L.ramp(t, b2 + 3.7 + i * .12, 1.2, L.ease));
      l.dot.style.opacity = t >= b2 + 3.7 ? 1 : 0;
    });
    const pF = L.ramp(t, b2 + 5.0, .5); frz.style.opacity = pF; L.wipe(frzL, pF);
    L.wipe(none, L.ramp(t, b2 + 5.4, .6));
    // 03
    const pr = L.ramp(t, b3 - .1, .8, L.ease); L.wipeX(r3a, pr); L.wipeX(r3b, pr);
    L.wipe(k3, L.ramp(t, b3 + .1, .5)); L.wipe(cor, L.ramp(t, b3 + .3, .7));
    L.wipe(w1, L.ramp(t, b3 + 1.6, .5)); L.wipe(s1, L.ramp(t, b3 + 1.9, .6));
    sw1 = sw1 || s1.offsetWidth; strike.style.width = (sw1 + 12) * L.ramp(t, b3 + 3.4, .7, L.ease) + 'px';
    L.wipe(s2, L.ramp(t, b3 + 4.7, .7));
    L.wipe(s3, L.ramp(t, b3 + 7.0, .7));
  };
};
