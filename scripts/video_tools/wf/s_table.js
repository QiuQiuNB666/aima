// 场景 table（W12 · ⑪ 三方对比，约 11 s）：报纸表格。细线、无底色；「我们」一栏顶上是粗墨线。
// 表头 → 「管什么」一行从左到右（我们 → EvoMap → Hermes）→ 五行逐行擦出，全部在前 7 s 出完，之后静止给人读。内容口径见 docs/蜂群-拆解.md 第 5 节。
SCENES.table = (root, D, ctx) => {
  const b = ctx.beats.sw31 ?? .4;
  const T = (x, y, cls, html, css) => L.el('div', 'abs ' + cls, root, Object.assign({ left: x + 'px', top: y + 'px', whiteSpace: 'nowrap' }, css || {}), html);
  const title = L.title(root, '三方对比', { at: b - .1 });
  const X = [372, 868, 1364], W = 460, HEAD = 206, ROW0 = 378, RH = 100;
  const cols = [
    { name: '我们', note: '一人 + <span class="red">总指挥</span> + 二十条线', what: '一个人指挥一群完整 agent', at: b + 1.0, rule: '7px solid var(--ink)' },
    { name: 'EvoMap', note: '本届主办方', what: '经验在 agent 之间流动', at: b + 1.35, rule: '2px solid var(--ink)', num: 1 },
    { name: 'Hermes Agent', note: 'Nous Research', what: '一个 agent 带子 agent', at: b + 1.7, rule: '2px solid var(--ink)', num: 1 },
  ].map((c, i) => ({
    ...c,
    r: T(X[i], HEAD, '', '', { width: W + 'px', borderTop: c.rule }),
    h: T(X[i], HEAD + 16, 'h3', c.name, Object.assign({ fontSize: '44px' }, c.num ? { fontFamily: 'var(--num)', fontWeight: 700 } : {})),
    n: T(X[i], HEAD + 70, 'label g1', c.note),
    w: T(X[i], HEAD + 104, 'body', c.what, { fontSize: '30px', fontWeight: 600, color: 'var(--ink)' }),
  }));
  const rows = [
    ['编排单位', '完整的 Claude Code 会话', 'agent 节点：Evolver + Hub', '主 agent + 子 agent'],
    ['怎么通信', '跨会话消息 + 指挥板', 'A2A 协议：publish / fetch', '父子委派、群聊、私信'],
    ['结果怎么合', 'git 合并进 main', '发到 Hub，GDI 打分晋升', '子 agent 交回总结'],
    ['隔离与安全', 'worktree + 分支 + 合并锁', '质量门槛、内容哈希、声誉', '命令审批、黑名单、沙箱'],
    ['经验怎么传', '本地、人筛：指挥板 + 规则', '跨团队、按 GDI 评分自动筛', '单个 agent 的记忆和技能'],
  ].map(([k, ...cells], r) => {
    const y = ROW0 + r * RH;
    return {
      line: T(96, y, '', '', { width: '1728px', borderTop: '1px solid var(--g2)' }),
      k: T(96, y + 20, 'label g1', k),
      cells: cells.map((c, i) => T(X[i], y + 16, 'body', c, { fontSize: '30px', width: W + 'px', overflow: 'hidden' })),
    };
  });
  const bottom = T(96, ROW0 + rows.length * RH, '', '', { width: '1728px', borderTop: '2px solid var(--ink)' });

  return t => {
    title(t);
    cols.forEach((c, i) => {
      L.wipeX(c.r, L.ramp(t, b + .2 + i * .1, .6, L.ease)); L.wipe(c.h, L.ramp(t, b + .3 + i * .1, .5)); L.wipe(c.n, L.ramp(t, b + .45 + i * .1, .5));
      L.wipe(c.w, L.ramp(t, c.at, .6));
    });
    rows.forEach((r, j) => {
      const a = b + 2.3 + j * .75;
      L.wipeX(r.line, L.ramp(t, a, .5, L.ease)); L.wipe(r.k, L.ramp(t, a + .05, .4));
      r.cells.forEach((c, i) => L.wipe(c, L.ramp(t, a + .1 + i * .08, .45)));
    });
    L.wipeX(bottom, L.ramp(t, b + 2.3 + rows.length * .75, .5, L.ease));
  };
};
