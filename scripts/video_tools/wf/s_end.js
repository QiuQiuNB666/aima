// 场景 end（W13 · 收尾）：能带走的三样，三栏并排，每栏一个小图：
//   01 派活单的七段骨架（原文口径见 docs/蜂群-拆解.md 第 3 节）｜02 指挥板：不同的线各写一行｜03 总指挥：派出去的线由它合并（朱红）进 main。
// 下面是数据来源和小字署名。
SCENES.end = (root, D, ctx) => {
  const B = ctx.beats, b1 = B.sw32 ?? .4, b2 = B.sw33 ?? 7.7;
  const C = D.counts;
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  const title = L.title(root, '能带走的就三样', { at: b1 - .1 });
  const X = [96, 680, 1264], W = 560, TOP = 214;
  const at = [b1 + 1.7, b1 + 3.5, b1 + 5.2];
  const heads = [
    ['01', '骨架固定的派活单', `${C.briefs} 份派活单，中位 ${L.fmt(C.briefMedian)} 字`],
    ['02', '人人能写的指挥板', '一份 markdown：31 行写到 615 行'],
    ['03', '一个只管合并的<span class="red">总指挥</span>', `线只 commit 不 push；${C.merges} 次合并进 main`],
  ].map(([n, h, note], i) => ({
    r: T(X[i], TOP, '', '', { width: W + 'px', borderTop: i === 2 ? '3px solid var(--red)' : '2px solid var(--ink)' }),
    n: T(X[i], TOP + 14, 'label mono g2', n),
    h: T(X[i], TOP + 48, 'h3', h, { fontSize: '44px' }),
    note: T(X[i], 576, 'label g1', note),
  }));
  // 01 七段骨架
  const brief = ['你是哪条线', '仓库在哪，先建自己的 worktree', '目标与产出：路径 + 验收标准', '数字按哪份口径', '绝对不做的事', '怎么回报：commit、不 push、留言', '称呼只写「球球」']
    .map((s, k) => T(X[0], 326 + k * 34, 'label', `<span class="mono g2" style="display:inline-block;width:32px">${k + 1}</span>${s}`));
  // 02 指挥板：每行一条线写的留言（圆标 + 灰条）
  const codes = D.lines.slice(0, 5).map(l => l.code);
  const board = codes.concat(['总']).map((c, k) => {
    const y = 330 + k * 38;
    const row = T(X[1], y, '', `<span class="bullet${c === '总' ? ' cmd' : ''}">${c}</span>`, { display: 'flex', alignItems: 'center', gap: '14px' });
    L.el('span', '', row, { display: 'inline-block', height: '8px', width: [300, 380, 240, 340, 280, 360][k] + 'px', background: 'var(--g3)' });
    return row;
  });
  // 03 总指挥 → 线 → 合并进 main
  const S = L.svgRoot(root), V = (tag, a) => L.svg(tag, a, S);
  const ox = X[2], cy = 434, lx0 = ox + 90, lx1 = ox + 330, mx = ox + 450;
  const fan = [0, 1, 2, 3, 4].map(k => {
    const y = 350 + k * 42;
    return {
      out: V('path', { d: `M${ox + 14} ${cy} C${ox + 50} ${cy} ${lx0 - 40} ${y} ${lx0} ${y}`, fill: 'none', stroke: '#121211', 'stroke-width': 1.2 }),
      bar: V('line', { x1: lx0, y1: y, x2: lx1, y2: y, stroke: '#121211', 'stroke-width': 7 }),
      mrg: V('path', { d: `M${lx1} ${y} C${lx1 + 50} ${y} ${mx - 50} ${cy} ${mx} ${cy}`, fill: 'none', stroke: '#E8411A', 'stroke-width': 2 }),
    };
  });
  const node = V('circle', { cx: ox + 14, cy, r: 13, fill: '#E8411A' });
  const main = V('line', { x1: mx, y1: cy, x2: ox + W, y2: cy, stroke: '#121211', 'stroke-width': 7 });
  const mainL = T(ox + W - 80, cy + 14, 'label mono', 'main', { width: '80px', textAlign: 'right', fontWeight: 700 });

  // 来源 + 署名
  const sRule = T(96, 676, '', '', { width: '1728px', borderTop: '1px solid var(--g2)' });
  const sK = T(96, 694, 'label', '数据来源', { fontWeight: 600 });
  const s1 = T(96, 734, 'body', '总指挥和二十条线的会话记录', { fontSize: '32px' });
  const s2 = T(96, 782, 'body', '<span class="mono" style="font-size:28px">aima</span> 仓库的 git 历史', { fontSize: '32px' });
  const credits = [
    '团队 PRX　<span class="mono">github.com/QiuQiuNB666/aima</span>',
    '峰哥亡命天涯　EvoTavern 深圳站',
    '讲解音色　MiniMax 预设',
    '配乐　“Meditation Impromptu 02” Kevin MacLeod (incompetech.com)　CC BY 4.0',
  ].map((s, k) => T(972, 696 + k * 36, 'note', s));

  return t => {
    title(t);
    heads.forEach((h, i) => {
      L.wipeX(h.r, L.ramp(t, at[i] - .2, .7, L.ease)); L.wipe(h.n, L.ramp(t, at[i] - .1, .4)); L.wipe(h.h, L.ramp(t, at[i], .6));
      L.wipe(h.note, L.ramp(t, at[i] + 1.2, .5));
    });
    brief.forEach((e, k) => L.wipe(e, L.ramp(t, at[0] + .3 + k * .1, .4)));
    board.forEach((e, k) => L.wipe(e, L.ramp(t, at[1] + .3 + k * .12, .4)));
    node.style.opacity = L.ramp(t, at[2] + .1, .3);
    fan.forEach((f, k) => {
      L.draw(f.out, L.ramp(t, at[2] + .2 + k * .05, .4, L.ease));
      f.bar.setAttribute('x2', lx0 + (lx1 - lx0) * L.ramp(t, at[2] + .5 + k * .05, .6, L.ease)); f.bar.style.opacity = t >= at[2] + .5 ? 1 : 0;
      L.draw(f.mrg, L.ramp(t, at[2] + 1.0 + k * .05, .5, L.ease));
    });
    main.setAttribute('x2', mx + (ox + W - mx) * L.ramp(t, at[2] + 1.4, .4)); main.style.opacity = t >= at[2] + 1.4 ? 1 : 0;
    L.wipe(mainL, L.ramp(t, at[2] + 1.5, .4));
    L.wipeX(sRule, L.ramp(t, b2 - .1, .8, L.ease)); L.wipe(sK, L.ramp(t, b2, .5));
    L.wipe(s1, L.ramp(t, b2 + .3, .6)); L.wipe(s2, L.ramp(t, b2 + 2.0, .6));
    credits.forEach((c, k) => L.wipe(c, L.ramp(t, b2 + 2.8 + k * .2, .5)));
  };
};
