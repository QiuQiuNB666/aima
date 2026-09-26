// 场景 board（W06 ④ 怎么收活）：左栏是 DATA.board 的真实指挥板片段，像一页文档慢慢往上滚；右栏三块跟旁白逐块出来：
//   sw15 回报四件事；文档里每条留言的发信线画成圆标，滚动 sw15 慢、sw16 快，落地时跑酷线（R）那条 /terrain/force 留言停在视口上部
//   sw16 116 根合并条码 + 大数字 40（45 次冲突里卡在指挥板的）+ 两个解法（resolve_board.py、合并锁）
//   sw17 R 那条留言加深、画下划线；右下 9 分钟时间轴（16:16 留言 → 16:20 修复进 main → 16:25 用上），游标扫过，标「4 分钟进 main」「9 分钟用上」。
SCENES.board = (root, D, ctx) => {
  const { el, svg, ramp, wipe, wipeX, ease, clamp } = L;
  const B = ctx.beats, K = D.counts;
  const b1 = B.sw15, b2 = B.sw16, b3 = B.sw17;
  const T = (x, y, html, cls = '', css = {}) => el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css), html);
  const TR = (x, y, html, cls = '', css = {}) => T(0, y, html, cls, Object.assign({ left: 'auto', right: (1920 - x) + 'px', textAlign: 'right' }, css));
  const rule = (x, y, w) => T(x, y, '', '', { width: w + 'px', height: '2px', background: 'var(--ink)' });
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const INK = '#121211', G2 = '#A6A69F', RED = '#E8411A';
  const fx = [];
  fx.push(L.title(root, '所有回报，都写进同一个文件', { cls: 'h2', top: 100 }));

  // ---------- 左栏：指挥板文档 ----------
  const DX = 96, DW = 864, VY = 292, VH = 594;
  const dRule = rule(DX, 236, DW);
  const dHead = T(DX, 250, 'docs/指挥板.md', 'mono', { fontSize: '22px', fontWeight: 700 });
  const dNote = TR(DX + DW, 250, '25 个分支都改过它', 'label g1');
  const view = el('div', 'abs', root, { left: DX + 'px', top: VY + 'px', width: DW + 'px', height: VH + 'px', overflow: 'hidden' });
  const doc = el('div', '', view, { position: 'relative', willChange: 'transform' });
  // 每条留言「X → Y（…）：…」：发信线画成圆标（一眼看出人人都在写），收件人里的「总指挥」标朱红
  const bul = c => `<span class="bullet" style="min-width:26px;height:24px;font-size:${/^[A-Z0-9]+$/.test(c) ? 14 : 13}px;padding:0 6px;margin-right:8px;vertical-align:1px">${c}</span>`;
  const code = s => s.replace(/`([^`]+)`/g, '<span class="mono" style="font-size:20px">$1</span>').replace(/`/g, '');
  const entries = [];
  let hit = null, hitI = -1;                                  // 跑酷线 16:16 那条：/terrain/force 没有超时
  D.board.forEach(line => {
    const h = line.startsWith('## ');
    let html;
    if (h) html = `<span class="mono g2" style="font-weight:400;margin-right:12px">##</span>${esc(line.slice(3)).replace('总指挥', '<span class="red">总指挥</span>')}`;
    else {
      const m = line.match(/^- (\S+) → ([^（：]+)(.*)$/);
      if (!m) html = code(esc(line.replace(/^- /, '')));
      else {
        let rest = code(esc(m[3]));
        if (hitI < 0 && line.includes('/terrain/force')) {
          hitI = entries.length;
          rest = rest.replace(/：(.+?。)/, `：<span style="position:relative">$1<i style="position:absolute;left:0;bottom:-4px;height:4px;width:0;background:${INK}"></i></span>`);
        }
        html = `${bul(esc(m[1]))}<span class="g2">→</span> ${esc(m[2]).replace('总指挥', '<span class="red">总指挥</span>')}${rest}`;
      }
    }
    entries.push(el('div', '', doc, h
      ? { fontSize: '24px', fontWeight: 600, lineHeight: 1.4, margin: '4px 0 12px' }
      : { fontSize: '22px', fontWeight: 400, lineHeight: 1.5, color: 'var(--g1)', marginBottom: '12px', whiteSpace: 'normal' }, html));
  });
  if (hitI >= 0) hit = entries[hitI];
  const hitBar = hit && hit.querySelector('i');
  // 滚动：sw15 慢、sw16 快（一屏屏留言翻过去）、落地时 R 线那条停在视口上部，sw17 全程不动
  let s1 = null;
  const measure = () => { s1 = hit ? clamp(hit.offsetTop - 150, 0, Math.max(0, doc.scrollHeight - VH)) : Math.max(0, doc.scrollHeight - VH); };
  const markAt = [b1 + 1.4, b1 + 2.4, b1 + 3.6, b1 + 4.7];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), G1 = hex('#5C5C57'), IK = hex(INK);
  fx.push(t => {
    if (s1 === null) measure();
    wipeX(dRule, ramp(t, b1, .8, ease)); wipe(dHead, ramp(t, b1 + .15, .5));
    view.style.clipPath = `inset(0 0 ${(1 - ramp(t, b1 + .3, .9, ease)) * 100}% 0)`;
    doc.style.transform = `translateY(${-s1 * ramp(t, b1 + .8, b3 - b1 - 1.0, ease)}px)`;
    if (hit) {
      const k = ramp(t, b3 + .1, .5);
      hit.style.color = `rgb(${G1.map((v, i) => Math.round(v + (IK[i] - v) * k)).join(',')})`;
      if (hitBar) hitBar.style.width = 100 * ramp(t, b3 + .4, .7, ease) + '%';
    }
    wipe(dNote, ramp(t, b2 + .4, .5));
  });

  // ---------- 右栏 ----------
  const RX = 1040, RW = 784;
  // A：回报四件事
  {
    const r = rule(RX, 236, RW), lab = T(RX, 250, '每条回报写四件事', 'label g1');
    const words = ['做了什么', '怎么验证的', '没做到什么', '要谁拍板'];
    let x = RX; const ws = words.map(w => { const e = T(x, 288, w, '', { fontSize: '30px', fontWeight: 600 }); x += w.length * 30 + 42; return e; });
    fx.push(t => { wipeX(r, ramp(t, b1 + .6, .8, ease)); wipe(lab, ramp(t, b1 + .8, .5)); ws.forEach((e, k) => wipe(e, ramp(t, markAt[k], .5))); });
  }
  // B：116 次合并，40 次冲突卡在指挥板
  {
    const y0 = 372, N = K.merges, CF = K.conflicts, BC = K.boardConflicts, pw = RW / N;
    const r = rule(RX, y0, RW), lab = T(RX, y0 + 14, `${N} 次合并，${CF} 次冲突`, 'label g1');
    const S = L.svgRoot(root, { pointerEvents: 'none' });
    const bars = [];
    for (let k = 0; k < N; k++) bars.push(svg('rect', { x: RX + k * pw + .8, y: y0 + 92, width: 3, height: 0, fill: k < N - CF ? G2 : k < N - BC ? INK : RED }, S));
    const n = T(RX - 6, y0 + 112, '0', 'num red', { fontSize: '180px' });
    const l1 = T(RX + 236, y0 + 136, '次冲突卡在指挥板上', '', { fontSize: '30px', fontWeight: 600 });
    const l2 = T(RX + 236, y0 + 184, `它是唯一人人都写的文件`, 'label g1');
    const f1 = T(RX, y0 + 300, '<span class="mono" style="font-size:22px">resolve_board.py</span>　专门解它', 'label');
    const f2 = T(RX + 380, y0 + 300, '<span class="mono" style="font-size:22px">aima-merge.lock</span>　给合并加锁', 'label');
    const s0 = b2 + 2.7, sd = 1.9;                                       // 「一百一十六次合并」起
    fx.push(t => {
      wipeX(r, ramp(t, b2 + 2.4, .8, ease)); wipe(lab, ramp(t, b2 + 2.6, .5));
      bars.forEach((b, k) => { const h = 36 * ramp(t, s0 + k / N * sd, .3); b.setAttribute('y', y0 + 92 - h); b.setAttribute('height', h); });
      wipe(n, ramp(t, b2 + 4.4, .5)); n.textContent = Math.round(BC * ramp(t, b2 + 4.4, 1.2, ease));
      wipe(l1, ramp(t, b2 + 4.7, .5)); wipe(l2, ramp(t, b2 + 5.0, .5));
      wipe(f1, ramp(t, b2 + 6.6, .5)); wipe(f2, ramp(t, b2 + 8.4, .5));
    });
  }
  // C：跑酷线一次来回：4 分钟修复进 main（朱红段），9 分钟用上（墨段）
  {
    const y0 = 744, AY = 850, m0 = 16 * 60 + 16, span = 9, mM = 4, X = m => RX + (m - m0) / span * RW;
    const r = rule(RX, y0, RW), lab = T(RX, y0 + 14, '跑酷线（R）的一次来回', 'label g1');
    const ms = TR(RX + RW, y0 + 4, `<span style="display:inline-block"><span class="num red" style="font-size:44px">${mM}</span> 分钟进 main</span>　　<span style="display:inline-block"><span class="num" style="font-size:44px">${span}</span> 分钟用上</span>`, '', { fontSize: '26px', fontWeight: 600 });
    const [msA, msB] = ms.children;
    const S = L.svgRoot(root, { pointerEvents: 'none' });
    const axis = svg('rect', { x: RX, y: AY - .5, width: 0, height: 1, fill: G2 }, S);
    const progR = svg('rect', { x: RX, y: AY - 2, width: 0, height: 4, fill: RED }, S);
    const progI = svg('rect', { x: X(m0 + mM), y: AY - 2, width: 0, height: 4, fill: INK }, S);
    const bR = '<span class="bullet" style="min-width:26px;height:26px;font-size:15px;padding:0 6px;margin-right:6px;vertical-align:1px">R</span>';
    const ev = [[m0, `${bR}线留言：缺超时`, 0, 0], [m0 + 1, `${bR}线分支合进 main`, 1, 1], [m0 + 4, '修复：<span class="red">总指挥</span>加 TTL（进 main）', 0, 1], [m0 + 5, `${bR}线同步`, 1, 0], [m0 + 9, '用上', 1, 0]];
    const t0 = b3 + .5, td = 5.2, at = m => t0 + (m - m0) / span * td;
    const items = ev.map(([m, txt, below, red], k) => {
      const x = X(m), last = k === ev.length - 1, hm = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const html = `<span class="mono g1" style="font-size:22px;margin-right:10px">${hm}</span>${txt}`;
      const y = below ? AY + 14 : AY - 44;
      const lb = last ? TR(x, y, html, 'label') : T(x, y, html, 'label');
      const tick = svg('rect', { x: x - (last ? 3 : k ? 1.5 : 0), y: AY - 10, width: 3, height: 0, fill: red ? RED : INK }, S);
      return { m, x, lb, tick, last };
    });
    let fit = false;
    fx.push(t => {
      if (!fit) { fit = true; items.forEach(o => { if (!o.last && o.x + o.lb.offsetWidth > RX + RW) o.lb.style.left = (RX + RW - o.lb.offsetWidth) + 'px'; }); }   // 长标签别出右边距
      wipeX(r, ramp(t, b3 + .1, .8, ease)); wipe(lab, ramp(t, b3 + .25, .5));
      axis.setAttribute('width', RW * ramp(t, b3 + .1, .8, ease));
      const p = clamp((t - t0) / td), pm = mM / span;
      progR.setAttribute('width', RW * Math.min(p, pm)); progI.setAttribute('width', RW * Math.max(0, p - pm));
      wipe(ms, ramp(t, at(m0 + mM), .01)); wipe(msA, ramp(t, at(m0 + mM), .5)); wipe(msB, ramp(t, at(m0 + span), .5));
      items.forEach(({ m, lb, tick }) => { wipe(lb, ramp(t, at(m), .4)); tick.setAttribute('height', 20 * ramp(t, at(m), .25)); });
    });
  }
  return t => fx.forEach(f => f(t));
};
