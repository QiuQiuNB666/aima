#!/usr/bin/env python3
"""segments.txt + 旁白 wav 时长 → segs.json（每句旁白在片段里的起点和时长、片段总长）。节拍常量和 cut_swarm.sh 的 sseg 一致。
  segs.py <segments.txt> <vo 目录> <出 segs.json>"""
import json, subprocess, sys
LEAD, GAP, TAIL = 0.4, 0.35, 0.6
tab, vo, out = sys.argv[1:4]
dur = lambda i: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{vo}/{i}.wav'], capture_output=True, text=True).stdout)
res = {}
for ln in open(tab, encoding='utf-8'):
    if not ln.strip() or ln.startswith('#'):
        continue
    parts = ln.rstrip('\n').split('|'); sid, scene, chap, ids = parts[:4]; least = float(parts[4]) if len(parts) > 4 and parts[4] else 0   # 第 5 栏：最短秒数（表格这类要多停一会儿）
    t, d = LEAD, {'_scene': scene, '_chapter': chap}
    for i in ids.split():
        l = dur(i); d[i] = [round(t, 3), round(l, 3)]; t += l + GAP
    d['_dur'] = round(max(t - GAP + TAIL, least), 3)
    res[sid] = d
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(' '.join(f"{k}={v['_dur']}" for k, v in res.items()), 'total', round(sum(v['_dur'] for v in res.values()), 1))
