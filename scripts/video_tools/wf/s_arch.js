// 场景「arch」（W03 ① 怎么搭）。一条阅读路径，从左往右：球球 → 总指挥 → 二十条线（线路圆标 + 名称 + 分支 + 开工）→ 指挥板；
// 再沿底部那条朱红线回来：总指挥自己的泳道，挂着它的工具（后台 Agent / 工作流 / 定时巡检），读完指挥板，汇成 main。
// main 从总指挥那条红线出来，不从指挥板出来。数字全取 DATA.counts / DATA.lines。
// 旁白对拍：短语起点按 vo/sw04–07.wav 的停顿实测（相对 beats 的秒数）。
SCENES.arch = (root, D, ctx) => {
  const B = ctx.beats, b4 = B.sw04 ?? .4, b5 = B.sw05 ?? 4.2, b6 = B.sw06 ?? 12.6, b7 = B.sw07 ?? 20;
  const AT = {
    cmd: b4 + 2.29,                                        // 它叫总指挥
    rows: b5 + .25, session: b5 + 2.1, branch: b5 + 5.49,  // 拆成线 / 每条线是一个独立的… / 有自己的 git worktree 和分支
    agent: b6, flow: b6 + 2.0, night: b6 + 3.74, cron: b6 + 4.94,
    board: b7, read: b7 + 1.9, merge: b7 + 2.7,           // 合并和 main 提前到「总指挥读完」那一拍，留够 3 s 读
  };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { ink: css('--ink'), red: css('--red'), g1: css('--g1'), g2: css('--g2'), g3: css('--g3'), paper: css('--paper') };
  const { ramp, ease, out, clamp, wipe, wipeX, draw } = L, K = D.counts;
  const S = L.svgRoot(root);
  const path = (d, stroke, w, extra) => L.svg('path', Object.assign({ d, fill: 'none', stroke, 'stroke-width': w }, extra || {}), S);
  const txt = (x, y, html, cssx, cls) => L.el('div', 'abs ' + (cls || ''), root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, cssx || {}), html);
  const pop = (e, p) => { e.style.opacity = p > 0 ? 1 : 0; e.style.transform = `scale(${.4 + .6 * out(p)})`; };

  const head = L.title(root, '一个总指挥，二十条线', { cls: 'h3', top: 100, at: .1, w: 620 });

  // ---------- 左：球球 → 总指挥 ----------
  const rows0 = 202, pitch = 27.5, N = D.lines.length, Y = rows0 + pitch * (N - 1) / 2;   // 球球、总指挥和扇形原点都在列表的中线上
  const qq = txt(96, Y - 38, '球球', { fontSize: '56px', fontWeight: 600, lineHeight: 1.2 });
  const qqNote = txt(96, Y + 34, `直接找线只有 ${K.human2lines} 条`, null, 'label g1');
  const arrow = path(`M236 ${Y} L366 ${Y}`, C.ink, 3);
  const head1 = path(`M356 ${Y - 8} L368 ${Y} L356 ${Y + 8}`, C.ink, 3);
  const arrowLab = txt(240, Y - 42, `<span class="num" style="font-size:30px">${K.human2cmd}</span> 条消息`, null, 'label');
  const node = L.svg('circle', { cx: 384, cy: Y, r: 12, fill: C.red }, S);
  const cmdLab = txt(408, Y - 38, '总指挥', { fontSize: '56px', fontWeight: 600, lineHeight: 1.2 }, 'red');
  const cmdNote = txt(410, Y + 34, 'Claude Code 会话', null, 'label g1');
  const chips = txt(410, Y - 160, `<span class="num" style="font-size:34px">${K.chips}</span> 张任务卡片`, { fontSize: '26px', fontWeight: 600 });
  const chipsNote = txt(410, Y - 116, '球球一键点开成线<br>（含本片 1 条）', { lineHeight: 1.3 }, 'label g1');   // 21 = 20 条线 + 9/25 本片这条线

  // ---------- 中：二十条线 ----------
  const FX = 598, BX = 712, NX = 764, BRX = 932, TX = 1408, EX = 1424, BOARD = [1540, Y];
  const hdr = [txt(BX, 152, '线 · 独立会话', null, 'label g1'), txt(BRX, 152, 'worktree · 分支', null, 'label g1'), txt(TX - 60, 152, '开工', { width: '60px', textAlign: 'right' }, 'label g1')];
  const hdrRule = L.el('div', 'abs', root, { left: BX + 'px', top: '186px', width: EX - BX + 'px', height: '2px', background: C.ink });
  let prevDay = '';
  const rows = D.lines.map((ln, i) => {
    const y = rows0 + i * pitch, day = L.hm(ln.start).split(' ')[0];
    const o = { y };
    o.fan = path(`M${FX} ${Y} C${FX + 60} ${Y} ${BX - 60} ${y} ${BX - 6} ${y}`, C.ink, 1.1, { opacity: .5 });
    o.fin = path(`M${EX} ${y} C${EX + 60} ${y} ${BOARD[0] - 60} ${BOARD[1]} ${BOARD[0]} ${BOARD[1]}`, C.ink, 1.1, { opacity: .5 });
    o.dot = L.svg('circle', { cx: EX, cy: y, r: 3, fill: C.ink }, S);
    o.bul = L.el('div', 'abs bullet', root, { left: BX + 'px', top: y - 13 + 'px', height: '26px', minWidth: '26px', borderRadius: '13px', fontSize: '15px', padding: '0 6px', transformOrigin: '13px 13px' }, ln.tag);
    o.name = txt(NX, y - 17, ln.name, { fontSize: '24px', fontWeight: 500, lineHeight: 1.4 });
    o.br = txt(BRX, y - 15, ln.branch, { fontSize: '22px', lineHeight: 1.35 }, 'mono g1');
    o.time = txt(TX - 150, y - 15, (day !== prevDay ? `<b style="color:${C.ink}">${day}</b> ` : '') + L.hh(ln.start), { width: '150px', textAlign: 'right', fontSize: '22px', lineHeight: 1.35 }, 'mono g1');
    prevDay = day;
    if (i) o.hair = L.el('div', 'abs hair', root, { left: NX + 'px', top: y - pitch / 2 + 'px', width: TX - NX + 'px', height: '1px' });
    return o;
  });

  // ---------- 右：指挥板 ----------
  const doc = L.el('div', 'abs', root, { left: '1556px', top: Y - 22 + 'px', width: '30px', height: '40px', border: `2px solid ${C.ink}`, background: C.paper });
  [9, 17, 25].forEach(d => L.el('div', 'abs', doc, { left: '5px', top: d + 'px', width: '16px', height: '2px', background: C.ink }));
  const boardLab = txt(1602, Y - 38, '指挥板', { fontSize: '48px', fontWeight: 600, lineHeight: 1.3 });
  const boardPath = txt(1604, Y + 26, 'docs/指挥板.md', { fontSize: '22px' }, 'mono g1');
  const BOARD_MSGS = 129;                                 // 文档第 2 节：指挥板上解析出至少 129 条「X → Y」留言（DATA.counts 里没有这一项）
  const reports = txt(1604, Y - 118, `≥ <span class="num" style="font-size:34px">${BOARD_MSGS}</span> 条留言`, { fontSize: '26px', fontWeight: 600 });
  const reportsNote = txt(1604, Y - 76, '各线干完在板上留言', null, 'label g1');
  // 97 = 各线发给总指挥的回报消息（SendMessage），挂在「线 → 总指挥」方向
  const back = txt(410, Y + 78, `<span class="num" style="font-size:34px">${K.reports}</span> 条回报消息`, { fontSize: '26px', fontWeight: 600 });
  const backNote = txt(410, Y + 122, '各线 → 总指挥', null, 'label g1');

  // ---------- 底：总指挥的泳道（朱红）→ main ----------
  const LY = 850, JX = 1668, RX = 1571;
  const lane1 = path(`M384 ${Y + 14} L384 ${LY - 24} Q384 ${LY} 408 ${LY} L1330 ${LY}`, C.red, 4);
  const lane2 = path(`M1330 ${LY} L${JX} ${LY}`, C.red, 4);
  const main = path(`M${JX} ${LY} L1824 ${LY}`, C.ink, 8);
  const jDot = L.svg('circle', { cx: JX, cy: LY, r: 8, fill: C.red }, S);
  const readArrow = path(`M${RX} ${Y + 64} L${RX} ${LY - 12}`, C.ink, 2.5);
  const readHead = path(`M${RX - 7} ${LY - 22} L${RX} ${LY - 10} L${RX + 7} ${LY - 22}`, C.ink, 2.5);
  const station = (x, at, n, what, note) => {
    const c = L.svg('circle', { cx: x, cy: LY, r: 8, fill: C.paper, stroke: C.red, 'stroke-width': 3.5 }, S);
    c.style.transformBox = 'fill-box'; c.style.transformOrigin = '50% 50%';
    const a = txt(x - 10, LY - 82, (n != null ? `<span class="num" style="font-size:36px">${n}</span> ` : '') + what, { fontSize: '26px', fontWeight: 600, lineHeight: 1.2 });
    const b = txt(x - 10, LY - 40, note, null, 'label g1');
    return t => { const p = ramp(t, at, .35); c.style.transform = `scale(${out(p)})`; c.style.opacity = p > 0 ? 1 : 0; wipe(a, ramp(t, at + .1, .55)); wipe(b, ramp(t, at + .3, .55)); };
  };
  const stations = [
    station(520, AT.agent + .2, K.agents, '次后台 Agent', '短活'),
    station(830, AT.flow, K.workflows, '次工作流', `大活 · 共 ${K.workflowAgents} 个 Agent`),
    station(1140, AT.night, K.crons, '个定时任务', '没人盯的夜里接着合并'),
  ];
  const readSt = station(RX, AT.read + .3, null, '', '');
  const readNote = txt(RX + 18, Y + 70, '总指挥读板', null, 'label');
  const mergeBox = txt(1564, LY - 164, `<span class="num" style="font-size:84px">0</span> <span style="font-size:26px;font-weight:600">次合并</span>`, { width: '260px', textAlign: 'right' }, 'red');
  const mergeN = mergeBox.firstChild, mergeLab = mergeBox.lastChild;
  mergeLab.style.display = 'inline-block';
  const mainLab = txt(1824 - 120, LY - 58, 'main', { width: '120px', textAlign: 'right', fontSize: '40px', fontWeight: 700, lineHeight: 1.2 }, 'mono');

  return t => {
    head(t);
    // 球球 → 总指挥
    wipe(qq, ramp(t, b4 + .2, .6));
    draw(arrow, ramp(t, b4 + .7, .7, ease)); head1.style.opacity = ramp(t, b4 + 1.3, .15);
    wipe(arrowLab, ramp(t, b4 + .9, .6));
    wipe(qqNote, ramp(t, b4 + 1.4, .6));
    const cp = ramp(t, AT.cmd, .4); node.setAttribute('r', 12 * out(cp));
    wipe(cmdLab, ramp(t, AT.cmd + .05, .6)); wipe(cmdNote, ramp(t, AT.cmd + .3, .6));
    // 拆成线：扇形逐条画出，每条线的圆标、名称、开工时间跟着出来；讲到 worktree 和分支时分支名一列擦出
    wipe(chips, ramp(t, AT.rows - .1, .6)); wipe(chipsNote, ramp(t, AT.rows + .2, .6));
    wipe(hdr[0], ramp(t, AT.session, .6)); wipe(hdr[2], ramp(t, AT.rows, .6)); wipe(hdr[1], ramp(t, AT.branch, .6));
    wipeX(hdrRule, ramp(t, AT.rows, .9, ease));
    rows.forEach((o, i) => {
      const a = AT.rows + .15 + i * .265;
      draw(o.fan, ramp(t, a, .4, ease));
      pop(o.bul, ramp(t, a + .3, .25));
      wipe(o.name, ramp(t, a + .35, .45)); wipe(o.time, ramp(t, a + .4, .45));
      if (o.hair) wipeX(o.hair, ramp(t, a + .3, .5));
      wipe(o.br, ramp(t, AT.branch + .1 + i * .075, .45));
      // 回报：干完的线连到指挥板
      o.dot.setAttribute('r', 3 * ramp(t, AT.board + i * .04, .2));
      draw(o.fin, ramp(t, AT.board + .05 + i * .04, .55, ease));
    });
    // 指挥板
    const bp = ramp(t, AT.board + .6, .5);
    doc.style.opacity = bp > 0 ? 1 : 0; doc.style.transform = `translateY(${(1 - out(bp)) * 16}px)`;
    wipe(boardLab, ramp(t, AT.board + .7, .6)); wipe(boardPath, ramp(t, AT.board + .9, .6));
    wipe(reports, ramp(t, AT.board + 1.1, .6)); wipe(reportsNote, ramp(t, AT.board + 1.3, .6));
    wipe(back, ramp(t, AT.board + .5, .6)); wipe(backNote, ramp(t, AT.board + .7, .6));
    // 总指挥的泳道：工具挂在上面
    draw(lane1, ramp(t, AT.agent - .1, 1.6, ease));
    stations.forEach(f => f(t));
    // 读完指挥板 → 统一合并进 main
    draw(readArrow, ramp(t, AT.read, .5, ease)); readHead.style.opacity = ramp(t, AT.read + .45, .15);
    wipe(readNote, ramp(t, AT.read + .1, .6));
    draw(lane2, ramp(t, AT.read + .2, .6, ease)); readSt(t);
    const mp = ramp(t, AT.merge, .35);
    jDot.setAttribute('r', 8 * out(mp)); draw(main, ramp(t, AT.merge + .15, .5, ease));
    wipe(mainLab, ramp(t, AT.merge + .35, .5));
    const np = ramp(t, AT.merge + .05, .8, ease); mergeN.style.opacity = np > 0 ? 1 : 0; L.count(mergeN, K.merges, np);
    wipe(mergeLab, ramp(t, AT.merge + .4, .5));
  };
};
