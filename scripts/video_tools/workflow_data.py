#!/usr/bin/env python3
"""工作流拆解视频的动画数据：会话 / git / token 数据集（从会话记录和 git 挖出来的，不进 git）→ wf/data.js（window.DATA）。

  workflow_data.py <数据集目录> <docs/指挥板.md> <segs.json> <lines.tsv> <出 data.js>
segs.json：{"W01": {"_dur": 秒, "_chapter": "① 怎么搭", "sw01": [起点秒, 时长秒], …}, …}（cut_swarm.sh 按 wav 时长算好）
lines.tsv：旁白 id / 声音 / 文字（swarm_png.py lines 从文档第 7 节抽出来）

DATA 结构（场景文件 wf/s_*.js 只读这些字段）：
  stats[]      {n, label}                       开场大数字（核对过的口径）
  lines[]      {code, tag, name, title, branch, start, end, spans:[[ms,ms]…], merges:[ms…], sends}
               20 条线，按开工时间排；tag = 线路圆标上的字（H / V / A2 / 展 …）；spans = 按 10 分钟桶「在干活」的区间；merges = 这条线合进 main 的时刻
  commander    {spans, start, end}              总指挥自己的泳道
  mainMerges[] ms                               窗口内全部合进 main 的时刻
  conc[]       {t, n}                           每 10 分钟有几个会话在干活（总指挥 + 线）
  peak         {t, n}；outage {t0, t1, text}；window {t0, t1}（9/23 10:00 → 9/24 12:00）
  counts       派活 / 回报 / 后台 Agent / 工作流 / 巡检 等计数
  brief        {lines[], marks[{beat, dt, from, to, label, note}]}   本片收到的派活单节选 + 逐段高亮
  board[]      指挥板真实片段（行；以「## 」开头的是小节标题）
  tokens       {output, thinking, cacheRead, cacheWrite, input, linePhaseOutput, film, byCat{}, byDay{}, byModel{}}
  segs         {W01: {dur, chapter, beats:{sw01: 起点秒…}, subs:[{t0, t1, text}]}, …}
"""
import json, re, sys
from datetime import datetime, timezone, timedelta

TZ = timezone(timedelta(hours=8))
ms = lambda iso: int(datetime.fromisoformat(iso).timestamp() * 1000)
src, board_md, segs_json, lines_tsv, out = sys.argv[1:6]
J = lambda n: json.load(open(f'{src}/{n}', encoding='utf-8'))
sessions, conc, merges, tok = J('sessions.json'), J('concurrency.json'), J('merges.json'), J('tokens.json')
T0, T1 = ms('2026-09-23T10:00:00+08:00'), ms('2026-09-24T12:00:00+08:00')

ev = [s for s in sessions if s['project'] == 'evotavern' and s['role'] in ('commander', 'line')]
cmd = next(s for s in ev if s['role'] == 'commander')
lines = sorted([s for s in ev if s['role'] == 'line'], key=lambda s: s['start_iso'])
short = lambda s: s['title'].split('：')[0]
code = lambda s: s['line_code']

# 10 分钟桶 → 每条线「在干活」的区间
spans = {}
for b in conc['buckets']:
    t = ms(b['bucket_start'])
    if not (T0 <= t < T1):
        continue
    for c in b.get('active', []):
        sp = spans.setdefault(c, [])
        if sp and sp[-1][1] == t:
            sp[-1][1] = t + 600000
        else:
            sp.append([t, t + 600000])
mlist = merges['merges']
mt = lambda m: ms(m['time'].replace(' ', 'T') + '+08:00')
L = []
for s in lines:
    c = code(s)
    brs = s.get('branches') or [s['branch']]
    L.append({'code': c, 'tag': c if re.match(r'^[A-Z0-9]+$', c) else c[0], 'name': short(s), 'title': s['title'],
              'branch': s['branch'].replace('claude/', ''), 'start': ms(s['start_iso']), 'end': ms(s['end_iso']),
              'spans': spans.get(c, []), 'merges': [mt(m) for m in mlist if m.get('branch') in brs and T0 <= mt(m) < T1],
              'sends': s.get('commander_send_message_to_this', 0)})
peak = conc['summary']['peak_desktop_evotavern_cmd_plus_lines']

# 指挥板真实片段：9/23 下午「留言」一节（第 54–85 行），含 R 线 16:16 那条「/terrain/force 没有超时」
md = open(board_md, encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(md) if l.startswith('### 留言（给别的线 / 总指挥）'))
rline = next(i for i, l in enumerate(md) if i > start and l.startswith('- R → 总指挥') and '/terrain/force' in l)
board = ['## 留言（给别的线 / 总指挥）· 9/23 下午'] + [re.sub(r'\*\*', '', l) for l in md[start + 1:rline + 4] if l.startswith('- ')]
board = [l if len(l) < 118 else l[:116] + '…' for l in board]

# token（口径见文档第 2 节）
tot = tok['totals_after_exclusion']
allc = {k: sum(v.get(k, 0) for v in tot['by_category'].values()) for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'thinking_tokens_within_output')}
cat_name = {'commander_main': '总指挥', 'commander_agents': '总指挥的后台 Agent', 'lines_main': '二十条线', 'lines_agents': '各线的后台 Agent'}
film = tok['film_session_post_event']
def pick_out(x):
    if not isinstance(x, dict):
        return 0
    if 'output_tokens' in x:
        return x['output_tokens']
    for k in ('all', 'totals', 'total'):
        if isinstance(x.get(k), dict) and 'output_tokens' in x[k]:
            return x[k]['output_tokens']
    return sum(pick_out(v) for v in x.values() if isinstance(v, dict) and 'output_tokens' in v)
tokens = {'output': allc['output_tokens'], 'thinking': allc['thinking_tokens_within_output'], 'cacheRead': allc['cache_read_input_tokens'],
          'cacheWrite': allc['cache_creation_input_tokens'], 'input': allc['input_tokens'],
          'linePhaseOutput': tok['line_phase_window']['all']['output_tokens'], 'film': pick_out(film),
          'byCat': {cat_name[k]: v['output_tokens'] for k, v in tot['by_category'].items() if k in cat_name},
          'byDay': {f"{int(k[5:7])}/{int(k[8:10])}": v['output_tokens'] for k, v in tok['output_by_day_bj'].items()},
          'byModel': {k: v['output_tokens'] for k, v in tok['output_by_model'].items()}}

# 旁白节拍与字幕
text = {}
for ln in open(lines_tsv, encoding='utf-8'):
    p = ln.rstrip('\n').split('\t')
    if len(p) == 3:
        text[p[0]] = p[2]
segs = {}
for sid, v in json.load(open(segs_json, encoding='utf-8')).items():
    items = [(k, x) for k, x in v.items() if not k.startswith('_')]
    segs[sid] = {'dur': v['_dur'], 'chapter': v.get('_chapter', ''), 'beats': {k: x[0] for k, x in items},
                 'subs': [{'t0': x[0], 't1': round(x[0] + x[1] + 0.15, 3), 'text': text.get(k, '')} for k, x in items]}

D = {
  'stats': [{'n': len(lines), 'label': '条线，各自一个会话'}, {'n': 287, 'label': '个后台 Agent（整周）'}, {'n': 116, 'label': '次合并进 main'},
            {'n': peak[0], 'label': '个会话同时在干活（峰值）'}, {'n': 112, 'label': '条派活消息'}, {'n': 97, 'label': '条回报'}],
  'lines': L,
  'commander': {'spans': spans.get('总指挥', []), 'start': ms(cmd['start_iso']), 'end': ms(cmd['end_iso'])},
  'mainMerges': [mt(m) for m in mlist if T0 <= mt(m) < T1],
  'conc': [{'t': ms(b['bucket_start']), 'n': b['desktop_evotavern_cmd_plus_lines']} for b in conc['buckets'] if T0 <= ms(b['bucket_start']) < T1],
  'peak': {'t': ms(peak[1][0]), 'n': peak[0]},
  'outage': {'t0': ms('2026-09-24T03:49:00+08:00'), 't1': ms('2026-09-24T07:22:00+08:00'), 'text': '撞用量上限 + 应用重启，断了 3.5 小时'},
  'window': {'t0': T0, 't1': T1},
  'counts': {'dispatch': 112, 'reports': 97, 'lineToLine': 11, 'chips': 21, 'agents': 54, 'workflows': 8, 'workflowAgents': 110, 'crons': 6,
             'bg': 287, 'merges': 116, 'conflicts': 45, 'boardConflicts': 40, 'files': 584, 'filesSingle': 533, 'load': 728, 'chromes': 40, 'slots': 3,
             'human2cmd': 106, 'human2lines': 8, 'briefMedian': 1613, 'briefs': 38},
  'brief': {'lines': ['你是「蜂群拆解视频」线。仓库根：…/scratchpad/aima（项目「峰哥亡命天涯」，EvoTavern 深圳站）。',
                      '先 git worktree add ../aima-swarm -b claude/w-swarm main，在 worktree 里做，不碰主 checkout。',
                      '目标：一支专业的拆解视频（4–5 分钟，1080p，中文旁白 + 字幕 + 图卡 + 屏幕录制）……',
                      '产出：docs/蜂群-拆解.md + swarm_breakdown.mp4（≤ 100 MB），同时拷到 ~/黑客松-EvoTavern/视频素材/。',
                      '口径以 /tmp/intro.txt（提交表单）和 docs/提交/项目介绍.md 为准，数字不新编。',
                      '旁白用 brain/tts.py（key 在 brain/.env，绝不打印 / 提交 key）。',
                      '录屏用本机自起模拟器 --http <lsof 确认空闲端口>；开无头 Chrome 一律加前缀 with_chrome.sh。',
                      '展位 MacBook 8765 正在用，绝对不碰。',
                      '约束：commit 到 claude/w-swarm，不 push，不部署；做完在 docs/指挥板.md 底部给总指挥留 5 行以内留言。',
                      '材料里称呼用户只写「球球」，不写「队长」。'],
            'marks': [{'beat': 'sw09', 'dt': 1.0, 'from': 0, 'to': 0, 'label': '你是哪条线', 'note': '21 份开线派活单全都这样开头'},
                      {'beat': 'sw09', 'dt': 2.05, 'from': 1, 'to': 1, 'label': '先建自己的 worktree', 'note': '每条线一个 worktree、一条分支'},
                      {'beat': 'sw09', 'dt': 3.3, 'from': 2, 'to': 3, 'label': '要交什么', 'note': '产出写成文件路径'},
                      {'beat': 'sw09', 'dt': 4.04, 'from': 4, 'to': 4, 'label': '按哪份口径', 'note': '数字不许新编'},
                      {'beat': 'sw09', 'dt': 5.31, 'from': 5, 'to': 7, 'label': '绝对不做的事', 'note': '密钥 · 共享 Chrome · 展位真机'},
                      {'beat': 'sw09', 'dt': 6.39, 'from': 8, 'to': 9, 'label': '怎么回报', 'note': 'commit、不 push、指挥板留言：21 / 21'}]},
  'board': board,
  'tokens': tokens,
  'segs': segs,
}
open(out, 'w', encoding='utf-8').write('window.DATA=' + json.dumps(D, ensure_ascii=False) + ';')
print('lines', len(L), 'board', len(board), 'conc', len(D['conc']), 'segs', len(segs), 'tokens out', tokens['output'], 'film', tokens['film'])
