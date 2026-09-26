// 场景 three（W05 ③ 怎么不撞车）：三栏各一招，逐栏跟旁白出来。每栏 = 圆标标题 + 一句副题 + 大数字 + 一个会动的小图。
//   ① 584 格华夫图（按列从左往右填：533 墨 / 51 灰）  ② 116 根合并条码立在 main 上（71 墨 / 45 冲突朱红）
//   ③ 40 根无头 Chrome 细线挤向朱红闸门 with_chrome.sh，闸落下后只放 3 根过去；最后一行：展位真机谁都不许碰。
SCENES.three = (root, D, ctx) => {
  const { el, svg, ramp, wipe, wipeX, draw, ease, lerp, clamp } = L;
  const lin = x => clamp(x);
  const B = ctx.beats, K = D.counts;
  const b1 = B.sw11, b2 = B.sw12, b3 = B.sw13, b4 = B.sw14;
  const W = 560, X = [96, 680, 1264];                       // 12 栏网格：每招占 4 栏
  const RULE = 236, HEAD = 254, SUB = 322, NUM = 404, C0 = 612, C1 = 766, CAP = 786;
  const T = (x, y, html, cls = '', css = {}) => el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css), html);
  const TR = (x, y, html, cls = '', css = {}) => T(0, y, html, cls, Object.assign({ left: 'auto', right: (1920 - x) + 'px', textAlign: 'right' }, css));
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, p) => { const A = hex(a), Bc = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, Bc[i], p))).join(',')})`; };
  const INK = '#121211', G2 = '#A6A69F', G3 = '#D4D4CD', RED = '#E8411A';
  const S = L.svgRoot(root), defs = svg('defs', {}, S);
  const clip = id => { const c = svg('clipPath', { id }, defs); return svg('rect', { x: 0, y: 0, width: 0, height: 1080 }, c); };
  const fx = [];

  fx.push(L.title(root, '二十条线改同一个仓库：不撞车的三招', { cls: 'h2', top: 100 }));

  // 栏头：2 px 上边线 + 圆标 + 标题 + 副题
  const head = (x, n, h, sub, at, subAt) => {
    const rule = T(x, RULE, '', '', { width: W + 'px', height: '2px', background: 'var(--ink)' });
    const hd = T(x, HEAD, `<span class="bullet" style="vertical-align:10px;margin-right:16px">${n}</span>${h}`, 'h3', { fontSize: '48px' });
    const sb = T(x, SUB, sub, 'g1', { fontSize: '30px', fontWeight: 500 });
    fx.push(t => { wipeX(rule, ramp(t, at, .8, ease)); wipe(hd, ramp(t, at + .2, .6)); wipe(sb, ramp(t, subAt, .6)); });
  };
  // 大数字 + 右侧两行小标签
  const big = (x, html, lx, l1, l2) => {
    const n = T(x - 8, NUM, html, 'num', { fontSize: '180px' });
    const a = T(x + lx, NUM + 30, l1, '', { fontSize: '28px', fontWeight: 500 });
    const b = T(x + lx, NUM + 70, l2, '', { fontSize: '28px', fontWeight: 500 });
    return [n, a, b];
  };

  // ---------- ① 按文件归属拆：584 格华夫图 ----------
  {
    const x = X[0], WC = 49, WR = 12, p = W / WC, cs = p - 2.2, top = C1 - WR * p + 2.2;
    head(x, 1, '按文件归属拆', '谁名下的文件谁改', b1 + .1, b1 + 2.2);
    const [n, l1, l2] = big(x, '<span>0</span>%', 380, '的文件只被', '一个分支碰过');
    const num = n.firstChild;
    const gGrid = svg('g', {}, S), gInk = svg('g', { 'clip-path': 'url(#th-ink)' }, S), gRed = svg('g', { 'clip-path': 'url(#th-red)' }, S);
    const cInk = clip('th-ink'), cRed = clip('th-red'), cells = [];
    for (let i = 0; i < K.files; i++) {
      const c = Math.floor(i / WR), r = i % WR, a = { x: x + c * p, y: top + r * p, width: cs, height: cs };
      cells.push([svg('rect', Object.assign({ fill: G3, opacity: 0 }, a), gGrid), c + r * .6]);
      svg('rect', Object.assign({ fill: i < K.filesSingle ? INK : G2 }, a), i < K.filesSingle ? gInk : gRed);   // 被多个分支碰过的用灰：朱红只给总指挥的事
    }
    const inkCols = Math.ceil(K.filesSingle / WR), redC0 = Math.floor(K.filesSingle / WR);
    const cap1 = T(x, CAP, `${K.filesSingle} / ${K.files} 个文件`, 'label');
    const cap2 = TR(x + W, CAP, `${K.files - K.filesSingle} 个被多个分支碰过`, 'label g1');
    const key = TR(x + W, 590, '一格 = 一个被分支改过的文件', 'label g1');
    const kMax = WC + WR * .6;
    fx.push(t => {
      const g = ramp(t, b1 + 1.0, 3.2, ease) * (kMax + 1);
      cells.forEach(([e, k]) => e.setAttribute('opacity', clamp(g - k)));
      wipe(key, ramp(t, b1 + 1.4, .5));
      const wi = inkCols * p * ramp(t, b2 + .3, 2.6, ease);
      cInk.setAttribute('x', x); cInk.setAttribute('width', wi);
      cRed.setAttribute('x', x + redC0 * p); cRed.setAttribute('width', (WC - redC0) * p * ramp(t, b2 + 3.1, .7, ease));
      wipe(n, ramp(t, b2 + .1, .5));
      num.textContent = Math.round(Math.min(K.filesSingle, wi / p * WR) / K.files * 100);
      wipe(l1, ramp(t, b2 + .5, .5)); wipe(l2, ramp(t, b2 + .65, .5));
      wipe(cap1, ramp(t, b2 + 2.8, .5)); wipe(cap2, ramp(t, b2 + 3.6, .5));
    });
  }

  // ---------- ② 隔离，只有总指挥合并：116 根合并条码 ----------
  {
    const x = X[1], N = K.merges, CF = K.conflicts, pw = W / N, H = 150;
    head(x, 2, '隔离，只有总指挥合并', '每条线一个 worktree、一条分支', b3 + .1, b3 + 1.0);
    const [n, l1, l2] = big(x, '0', 322, '次合并', '进 main');
    const who = T(x, 842, '全由总指挥（和它的定时巡检）来合', '', { fontSize: '30px', fontWeight: 600 });
    const base = svg('rect', { x, y: C1, width: W, height: 3, fill: INK }, S);
    const bars = [];
    for (let k = 0; k < N; k++) bars.push(svg('rect', { x: x + k * pw + .6, y: C1, width: 2.6, height: 0, fill: k < N - CF ? G2 : RED }, S));   // 顺利合并灰、冲突朱红（和 W06 的条码同一套配色）
    const cap1 = T(x, CAP, `${N - CF} 次顺利合并`, 'label g1');
    const cap2 = TR(x + W, CAP, `${CF} 次有冲突`, 'label red');
    const s0 = b3 + 1.5, sd = 3.4;
    fx.push(t => {
      base.setAttribute('width', W * ramp(t, b3 + 1.2, .9, ease));
      bars.forEach((r, k) => { const h = H * ramp(t, s0 + k / N * sd, .35); r.setAttribute('y', C1 - h); r.setAttribute('height', h); });
      wipe(n, ramp(t, s0, .5));
      n.textContent = Math.round(N * ramp(t, s0, sd + .2, lin));
      wipe(l1, ramp(t, s0 + .3, .5)); wipe(l2, ramp(t, s0 + .45, .5)); wipe(who, ramp(t, b3 + 5.2, .6));
      wipe(cap1, ramp(t, s0 + sd * (N - CF) / N + .2, .5)); wipe(cap2, ramp(t, s0 + sd + .3, .5));
    });
  }

  // ---------- ③ 给共享资源上闸：40 根 Chrome → 闸 → 3 根 ----------
  {
    const x = X[2], NC = K.chromes, gx = x + 350, yc = (C0 + C1) / 2, tg = b4 + 6.1;
    head(x, 3, '给共享资源上闸', '无头 Chrome，展位真机', b4 + .1, b4 + .9);
    const [n, l1, l2] = big(x, `<span>0</span><span style="font-weight:300;font-size:.55em;vertical-align:.3em;margin:0 .16em">→</span><span>${K.slots}</span>`, 446, '个无头', 'Chrome');
    const [n40, arr, n3] = n.children;
    const gFan = svg('g', {}, S), fan = [];
    for (let j = 0; j < NC; j++) {
      const y = C0 + 2 + j * (C1 - C0 - 4) / (NC - 1), ye = yc + (j - (NC - 1) / 2) * .45;
      fan.push(svg('path', { d: `M${x} ${y} H${x + 130} C${x + 250} ${y} ${gx - 90} ${ye} ${gx - 6} ${ye}`, fill: 'none', stroke: INK, 'stroke-width': 1.2 }, gFan));
    }
    const outs = [-16, 0, 16].map(d => svg('path', { d: `M${gx + 6} ${yc + d} H${x + W}`, fill: 'none', stroke: INK, 'stroke-width': 4 }, S));
    const gate = svg('rect', { x: gx - 4, y: C0 - 14, width: 8, height: 0, fill: RED }, S);
    const gLab = T(gx + 18, C0 - 8, 'with_chrome.sh', 'mono red', { fontSize: '22px' });
    const cap1 = T(x, CAP, '4 核开发机，load <span class="mono">0</span>', 'label g1');
    const load = cap1.querySelector('span');
    const cap2 = TR(x + W, CAP, `全机最多 ${K.slots} 个`, 'label');
    const mac = T(x, 842, '展位真机 <span class="mono" style="font-size:26px">:8765</span>　谁都不许碰', '', { fontSize: '30px', fontWeight: 600 });
    const f0 = b4 + 2.3;
    fx.push(t => {
      fan.forEach((pth, j) => draw(pth, ramp(t, f0 + ((j * 17) % NC) / NC * 2.6, .9, ease)));
      gFan.style.opacity = 1 - .7 * ramp(t, tg + .1, .6);
      const g = ramp(t, tg, .45, ease); gate.setAttribute('height', 186 * g);
      outs.forEach((o, k) => draw(o, ramp(t, tg + .35 + k * .12, .7, ease)));
      wipe(n, ramp(t, f0, .5));
      n40.textContent = Math.round(NC * ramp(t, f0, 3.2, lin));
      n40.style.color = mix(INK, G2, ramp(t, tg + .1, .5));
      arr.style.opacity = n3.style.opacity = ramp(t, tg + .25, .4);
      wipe(l1, ramp(t, f0 + .3, .5)); wipe(l2, ramp(t, f0 + .45, .5));
      wipe(cap1, ramp(t, f0 + .2, .5));
      load.textContent = Math.round(K.load * ramp(t, f0 + .2, 3.4, ease));
      wipe(gLab, ramp(t, tg + .2, .5)); wipe(cap2, ramp(t, tg + .8, .5));
      wipe(mac, ramp(t, b4 + 7.6, .6));
    });
  }
  return t => fx.forEach(f => f(t));
};
