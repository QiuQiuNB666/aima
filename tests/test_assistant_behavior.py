"""助理行为（static/game/assistant/behavior.js）的回归检查，node 跑（没装 node 就跳过）：
平时在峰哥前面半步、右边；峰哥停她停；到地标停下指路（一次、有气泡）；北坳站定 0.3 s 后递氧气（转身、贴近）；
排队红灯时站到正前方挡着、绿灯那一下让开说「到你了」；登顶（laps + 1）举手击掌。路线用珠峰的路段结构（和 E 线 zonesOf 同一套规则）。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static")

CHECK = r"""
import { makeAssist, zones, landmarks } from './behavior.js';
// 珠峰的路段（everest_north.json）：大本营 3 平 / 冰川 19 上 / 前进营地 2 平 / 冰壁 5 台阶 / 北坳 1 等 / 山脊 19 上 / 第一台阶 2 / 排队 1 等 / 中国梯 3 / 雪坡 1
const SEG = [['flat',3,'珠峰大本营'],['up',19,'东绒布冰川'],['flat',2,'前进营地'],['stairs_up',5,'北坳冰壁'],['wait',1,'北坳营地·吸氧'],
  ['up',19,'北山脊·大风口'],['stairs_up',2,'第一台阶'],['wait',1,'第二台阶·排队上梯'],['stairs_up',3,'第二台阶·中国梯'],['up',1,'顶峰雪坡']];
const segs = []; let st = 0; for (const [kind, steps, label] of SEG) { segs.push({ kind, steps, label, start: st }); st += steps; }
const route = { segs, N: st };
const Z = zones(route), out = { col: Z.col.start, queue: Z.queue.start, marks: landmarks(route).map(m => m.label) };
const A = makeAssist(route), me = { s: 0 };
let t = 0; const dt = 1 / 30, log = [];
const run = (secs, f) => { for (let k = 0; k < secs / dt; k++) { t += dt; const T = f(); const b = A.step(t, dt, { T, me, preview: false }); log.push({ t, ps: me.s, ...b }); } };
const seg = s => segs.find(g => s >= g.start && s < g.start + g.steps) || segs[segs.length - 1];
const T0 = laps => () => ({ laps, segment: seg(me.s).kind });
// 1) 从 0 走到北坳前面（1 步 / 秒）
run(Z.col.start - 0.1, () => { me.s += dt; return T0(0)(); });
const walk = log.filter(x => x.ps > 10 && x.ps < 12);   // 冰川中段：前后都没有地标
out.lead = Math.min(...walk.map(x => x.s - x.ps)); out.lat = walk[0].lat;
out.marksSaid = log.filter(x => x.say && x.say.key === 'mark').map(x => x.say.text);
out.pointMax = Math.max(...log.map(x => x.point));
// 2) 北坳：站在等待段 2 s
me.s = Z.col.start + 0.2; log.length = 0;
run(2, () => ({ laps: 0, segment: 'wait' }));
out.oxy = log.filter(x => x.act.oxygen > 0.9).length > 0; out.oxyFirst = log.find(x => x.act.oxygen > 0)?.t;
out.oxySay = log.filter(x => x.say && x.say.key === 'oxygen').length;
out.oxyLat = log[log.length - 1].lat; out.oxyFace = log[log.length - 1].face;
// 3) 峰哥停在路上（不是红灯）：她也停
me.s = Z.col.start + 3; log.length = 0;
run(3, () => ({ laps: 0, segment: 'up' }));
const a = log[Math.floor(log.length / 2)].s, b = log[log.length - 1].s; out.stopDrift = Math.abs(b - a);
run(7, () => ({ laps: 0, segment: 'up' }));
out.waitSay = log.filter(x => x.say && x.say.key === 'wait').length;
log.length = 0; run(0.2, () => ({ laps: 0, segment: 'up', ghost_pos: me.s + 0.6 }));
out.ghostLat = log[log.length - 1].lat;
// 4) 排队：红灯 2 s → 绿灯
me.s = Z.queue.start + 0.1; log.length = 0;
run(2, () => ({ laps: 0, segment: 'wait' }));
out.guard = log[log.length - 1].act.guard; out.guardLat = log[log.length - 1].lat; out.guardAhead = log[log.length - 1].s - me.s;
log.length = 0; me.s = Z.queue.start + 1;
run(0.5, () => ({ laps: 0, segment: 'stairs_up' }));
out.goSay = log.filter(x => x.say && x.say.key === 'go').length;
// 5) 登顶：laps 0 → 1
log.length = 0; me.s = route.N + 1.2;
run(3, () => ({ laps: 1, segment: 'up' }));
out.fiveMax = Math.max(...log.map(x => x.act.five)); out.summitSay = log.filter(x => x.say && x.say.key === 'summit').length;
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="没装 node")
def test_assistant_behavior(tmp_path):
    shutil.copy(os.path.join(STATIC, "game", "assistant", "behavior.js"), tmp_path / "behavior.js")
    (tmp_path / "check.mjs").write_text(CHECK)
    r = subprocess.run(["node", "check.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert (o["col"], o["queue"]) == (29, 51), o                   # 北坳 / 排队按类型找到
    assert 0.3 < o["lead"] < 0.7 and o["lat"] < -0.5, o            # 前面半步、右边
    assert o["marksSaid"] and all(m.startswith("前面就是") for m in o["marksSaid"]) and o["pointMax"] > 0.9, o
    assert len(o["marksSaid"]) == len(set(o["marksSaid"])), o     # 每个地标只说一次
    assert o["oxy"] and 0.3 < o["oxyFirst"] - 0 and o["oxySay"] == 1 and o["oxyLat"] > -0.6 and o["oxyFace"] > 0.5, o
    assert o["stopDrift"] < 0.01, o                                 # 峰哥停她停
    assert o["waitSay"] == 1, o
    assert o["ghostLat"] > -0.4, o                                  # 影子挨着时往路中间让                                     # 停 8 s 以上说一次「我在这儿，你慢慢来」
    assert o["guard"] == 1 and o["guardLat"] > 0 and o["guardAhead"] > 0.5, o   # 挡在正前方
    assert o["goSay"] == 1, o
    assert o["fiveMax"] > 0.9 and o["summitSay"] == 1, o
