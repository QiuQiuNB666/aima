// 场景「brief」（W04 ② 怎么派活）。左边是一页真实的派活单（本片这条线开工时收到的第一条消息，DATA.brief.lines），
// 右边一栏从上往下读：中位长度 1,613 字 → 派活单的骨架（6 段，逐段在纸上划记，页边编号和右栏编号对应）→ 21 份开线派活单一份没漏。
// 旁白对拍：短语起点按 vo/sw08–10.wav 的停顿实测（相对 beats 的秒数）。
// 划记时刻 = beats[mark.beat] + mark.dt（dt 已按 vo/sw09.wav 的停顿实测回写进 workflow_data.py）。
SCENES.brief = (root, D, ctx) => {
  const B = ctx.beats, b8 = B.sw08 ?? .4, b9 = B.sw09 ?? 6.6, b10 = B.sw10 ?? 14.1;
  const AT = { median: b8 + 4.14, skeleton: b9, commit: b10 + 2.14, board: b10 + 3.51, none: b10 + 3.9 };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { ink: css('--ink'), red: css('--red'), g1: css('--g1'), g2: css('--g2'), g3: css('--g3'), paper: css('--paper') };
  const { ramp, ease, out, clamp, wipe, wipeX } = L, K = D.counts, BR = D.brief;
  const txt = (x, y, html, cssx, cls, parent) => L.el('div', 'abs ' + (cls || ''), parent || root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, cssx || {}), html);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, p) => { const A = hex(a), Bc = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (Bc[i] - v) * p)).join(',')})`; };

  const head = L.title(root, '每条线的第一条消息：派活单', { cls: 'h3', top: 100, at: b8 - .3, w: 1100 });
  // ---------- 左：一页派活单（不加框不加底，只挂一条 3 px 墨线）----------
  const PX = 96, PY = 194, PW = 1164, PH = 700;
  const page = L.el('div', 'abs', root, { left: PX + 'px', top: PY + 'px', width: PW + 'px', height: PH + 'px', borderTop: `3px solid ${C.ink}` });
  const pHead = txt(60, 14, `<span style="color:${C.red}">总指挥</span> → 蜂群拆解视频线`, { fontSize: '26px', fontWeight: 600 }, '', page);
  const pSub = txt(390, 19, '开线后收到的第一条消息 · 节选', null, 'note', page);
  const pRule = L.el('div', 'abs hair', page, { left: '60px', top: '60px', width: PW - 100 + 'px', height: '1px' });
  const body = L.el('div', 'abs', page, { left: '60px', top: '74px', width: PW - 100 + 'px' });
  // 每段一个行内 span：划记是 span 的背景（压在字的下半截），background-size 从 0 扫到 100%，跨行时自动先扫第一行再扫下一行，不用量行位置
  const INK = 'rgba(18,18,17,.15)';
  const paras = BR.lines.map(s => {
    const p = L.el('div', '', body, { position: 'relative', fontSize: '26px', lineHeight: 1.34, marginBottom: '5px' });
    const sp = L.el('span', '', p, { backgroundImage: `linear-gradient(transparent 50%, ${INK} 50%, ${INK} 92%, transparent 92%)`, backgroundRepeat: 'no-repeat', backgroundSize: '0% 100%', padding: '0 2px' });
    sp.textContent = s;
    return { p, sp };
  });
  const marks = BR.marks.map((m, k) => {
    const at = (B[m.beat] ?? b9) + m.dt;
    // 页边编号：写在纸的左边白里，和该段第一行对齐；右栏同号
    const edge = L.el('div', 'abs bullet', paras[m.from].p, { left: '-50px', top: 26 * 1.34 / 2 - 14 + 'px', height: '28px', minWidth: '28px', borderRadius: '14px', fontSize: '16px', padding: '0', transformOrigin: '50% 50%' }, String(k + 1));
    // 页边竖线：从编号往下贯穿这一段（多段时连起来），像在纸边划的一道括号
    const bars = [];
    for (let i = m.from; i <= m.to; i++) bars.push(L.el('div', 'abs', paras[i].p, { left: '-37px', width: '2px', top: i === m.from ? '38px' : '-6px', bottom: '4px', background: C.ink, transformOrigin: '50% 0' }));
    return { m, k, at, edge, bars };
  });

  // ---------- 右栏 ----------
  const RX = 1292, RW = 1824 - RX;
  const rule = (y, at) => { const e = L.el('div', 'abs', root, { left: RX + 'px', top: y + 'px', width: RW + 'px', height: '2px', background: C.ink }); return t => wipeX(e, ramp(t, at, .6, ease)); };
  // 1,613 字
  const r1 = rule(104, AT.median - .3);
  const medLab = txt(RX, 116, '派活单中位长度', null, 'label');
  const medN = txt(RX - 6, 150, '0', { fontSize: '116px' }, 'num');
  medN.textContent = L.fmt(K.briefMedian);
  const medU = txt(RX - 6 + medN.offsetWidth + 12, 202, '字', { fontSize: '44px', fontWeight: 600 });
  const medNote = txt(RX, 272, `共 ${K.briefs} 份，每条线开工时收到的第一条消息`, null, 'note');
  // 骨架
  const r2 = rule(316, AT.skeleton - .1);
  const skLab = txt(RX, 328, '骨架固定', null, 'label');
  const items = marks.map(({ m, k, at }) => {
    const y = 370 + k * 58;
    return { at, bul: txt(RX, y + 3, String(k + 1), { transformOrigin: '50% 50%' }, 'bullet'),
      lab: txt(RX + 48, y - 4, m.label, { fontSize: '30px', fontWeight: 600, lineHeight: 1.3 }),
      note: txt(RX + 48, y + 33, m.note, { fontSize: '22px', lineHeight: 1 }, 'g1') };
  });
  // 21 份开线派活单，一份没漏
  const r3 = rule(726, b10 - .1);
  const tLab = txt(RX, 738, `<span class="num" style="font-size:34px">${K.chips}</span> 份开线派活单 <span class="g1" style="font-size:22px;font-weight:400">（含本片 1 条）</span>`, { fontSize: '26px', fontWeight: 600 });
  const tNone = txt(1824 - 200, 742, '一份没漏', { width: '200px', textAlign: 'right', fontSize: '26px', fontWeight: 600 });
  const SQ = 14, GAP = 4, SX = 1824 - K.chips * (SQ + GAP) + GAP;
  const tally = [['只提交不推送', AT.commit, 796], ['去指挥板留言', AT.board, 842]].map(([s, at, y]) => ({
    at, lab: txt(RX, y - 4, s, { fontSize: '24px', fontWeight: 500 }),
    cells: Array.from({ length: K.chips }, (_, i) => L.el('div', 'abs', root, { left: SX + i * (SQ + GAP) + 'px', top: y + 3 + 'px', width: SQ + 'px', height: SQ + 'px', boxSizing: 'border-box', border: `1.5px solid ${C.ink}` })),
  }));

  return t => {
    head(t);
    // 页面：第一条消息到了
    const pp = ramp(t, b8 + .05, .7, ease);
    page.style.opacity = pp > 0 ? 1 : 0; page.style.clipPath = `inset(0 -40px ${(1 - pp) * 100}% 0)`;
    wipe(pHead, ramp(t, b8 + .4, .6)); wipe(pSub, ramp(t, b8 + .6, .6)); wipeX(pRule, ramp(t, b8 + .6, .7));
    // 讲到骨架时整页先退成灰，划到哪段哪段回到墨色
    const dim = ramp(t, AT.skeleton, .6);
    marks.forEach(o => {
      for (let i = o.m.from, j = 0; i <= o.m.to; i++, j++) {
        const q = paras[i], back = ramp(t, o.at, .4);
        const wp = ramp(t, b8 + .8 + i * .12, .5); wipe(q.p, wp); if (wp >= 1) q.p.style.clipPath = 'none';   // 擦完就撤掉遮罩，页边编号才露得出来
        q.p.style.color = mix(C.ink, C.g2, dim * (1 - back));
        q.sp.style.backgroundSize = `${ramp(t, o.at + j * .35, .45, x => x) * 100}% 100%`;
        o.bars[j].style.transform = `scaleY(${ramp(t, o.at + .1 + j * .35, .45, ease)})`;
      }
      const bp = ramp(t, o.at, .3); o.edge.style.opacity = bp > 0 ? 1 : 0; o.edge.style.transform = `scale(${.3 + .7 * out(bp)})`;
    });
    // 右栏
    r1(t); wipe(medLab, ramp(t, AT.median - .2, .5));
    const np = ramp(t, AT.median, 1.2, ease); medN.style.opacity = np > 0 ? 1 : 0; L.count(medN, K.briefMedian, np);
    wipe(medU, ramp(t, AT.median + .6, .5)); wipe(medNote, ramp(t, AT.median + .9, .6));
    r2(t); wipe(skLab, ramp(t, AT.skeleton, .5));
    items.forEach(o => { const bp = ramp(t, o.at, .3); o.bul.style.opacity = bp > 0 ? 1 : 0; o.bul.style.transform = `scale(${.3 + .7 * out(bp)})`;
      wipe(o.lab, ramp(t, o.at + .05, .5)); wipe(o.note, ramp(t, o.at + .3, .5)); });
    r3(t); wipe(tLab, ramp(t, b10, .6));
    tally.forEach((r, k) => { wipe(r.lab, ramp(t, b10 + .3 + k * .15, .5));
      r.cells.forEach((c, i) => { const shown = ramp(t, b10 + .3 + i * .02, .2), fill = ramp(t, r.at + i * .035, .12);
        c.style.opacity = shown; c.style.background = fill >= 1 ? C.ink : fill > 0 ? mix(C.paper, C.ink, fill) : 'transparent'; }); });
    wipe(tNone, ramp(t, AT.none, .5));
  };
};
