"""跑酷 static/parkour/logic.js 的回归检查（node 跑；没装 node 就跳过）：
走路不误触发跳 / 滑铲、高抬腿触发一次跳、下蹲触发滑铲；自动驾驶能过关卡、不操作会撞满 3 次结束；
腿上的力只会是 up / down / lift / null（stairs_up 现在是阻力，跑酷不用），结束后回到 null。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "parkour")

CHECK = r"""
import { makeLegs, makeLevel, makeRun, forceKind, nextThreat, speedFor, TUNE } from './logic.js';
import { makeHipTrack } from '../game/anim.js';
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const out = {};
// 1) 腿：真人走路（屈曲 −10…+30，60 fps，含角速度）不触发；高抬腿触发 1 次；下蹲 = 滑铲
const walkHip = t => 10 + 20 * Math.sin(2 * Math.PI * t);
let L = makeLegs(), jumps = 0, slides = 0;
for (let t = 0; t < 20; t += 0.1) { const a = walkHip(t), b = walkHip(t + 0.5); const r = L.push(a, b, 120 * Math.cos(2 * Math.PI * t) * Math.PI, 0); jumps += r.jump; slides += r.slide; }
out.walk = { jumps, slides };
L = makeLegs(); jumps = 0;
for (const [f, v] of [[10, 0], [30, 300], [55, 250], [70, 50], [60, -200], [20, -300], [10, 0]]) jumps += L.push(f, 5, v, 0).jump;
out.highknee = jumps;
L = makeLegs(); slides = 0;
for (let i = 0; i < 5; i++) slides += L.push(60, 55, 0, 0).slide;
out.squat = slides;
// 2) 一局：自动驾驶（看见就应对）跑 120 s；不操作跑到结束
function play(auto, secs, cadence) {
  const lv = makeLevel(3), S = makeRun(lv), kinds = new Set(); let t = 0;
  while (t < secs && !S.over) {
    const th = nextThreat(S, lv, 5), inp = { v: speedFor(cadence, true), jump: false, slide: false, lane: 0 };
    if (auto && th) {
      if (th.what === 'jump' && th.dx < 1.5 + S.speed * 0.12) inp.jump = true;
      if (th.what === 'slide' && th.dx < 2) inp.slide = true;
      if (th.what === 'turn' && th.dx < 6) inp.turn = th.o.d;
      if (th.what === 'lane') { const free = [0, 1, 2].filter(l => !th.o.lanes.includes(l)); inp.lane = Math.sign(free.sort((a, b) => Math.abs(a - S.lane) - Math.abs(b - S.lane))[0] - S.lane); }
    }
    S.step(1 / 60, inp); kinds.add(forceKind(S, lv)); t += 1 / 60;
  }
  const turns = S.events.filter(e => e === 'turn').length, miss = S.events.filter(e => e === 'turnMiss').length;
  return { over: S.over, lives: S.lives, dist: Math.round(S.dist), t: +t.toFixed(1), kinds: [...kinds], ev: [...new Set(S.events)], fin: forceKind(S, lv), turns, miss };
}
// 3) 第 5 轮：高抬腿识别延迟。1 Hz 走路（左腿髋最伸在 0.75 s），第 5 个周期左腿高抬（摆动开始后 0.6 s 内多抬 50°）；
//    lift 在估计器相位 0.18（髋最伸之后 0.18 个周期）出力。老路 = 10 Hz 原始样本到了才判；新路 = A2 的跟踪（外推 + one-euro）60 fps 判，再往前看 JUMP_LEAD
const hk = t => { const d = t - 5.75; return 10 + 20 * Math.sin(2 * Math.PI * t) + (d > 0 && d < 0.6 ? 50 * Math.sin(Math.PI * d / 0.6) ** 2 : 0); };
const hkR = t => 10 + 20 * Math.sin(2 * Math.PI * (t + 0.5));
const dv = (fn, t) => (fn(t + 1e-3) - fn(t - 1e-3)) / 2e-3;
function detect(kind, fnL, secs) {
  seed = 11; const pl = []; for (let ts = 0.2; ts < secs; ts += 0.1 + rnd() * 0.01) pl.push({ ts, arr: ts + 0.005 + rnd() * 0.035 });
  const L = makeLegs(), tr = makeHipTrack(), hits = []; let pi = 0;
  for (let t = 0.3; t < secs; t += 1 / 60) {
    while (pi < pl.length && pl[pi].arr <= t) {
      const p = pl[pi++];
      if (kind === 'old') { if (L.push(fnL(p.ts), hkR(p.ts), dv(fnL, p.ts), dv(hkR, p.ts)).jump) hits.push(t); }
      else tr.push(p.arr, p.ts, fnL(p.ts), hkR(p.ts), dv(fnL, p.ts), dv(hkR, p.ts));
    }
    if (kind === 'new') { const h = tr.sample(t, 1 / 60); if (h.fl !== 0 && L.push(h.fl + h.wl * TUNE.JUMP_LEAD, h.fr + h.wr * TUNE.JUMP_LEAD, h.wl, h.wr).jump) hits.push(t); }
  }
  return hits.map(x => +((x - (5.75 + 0.18)) * 1000).toFixed(0));   // 相对 lift 出力那一刻（毫秒）
}
out.hk = { old: detect('old', hk, 8), neu: detect('new', hk, 8), walkNew: detect('new', t => 10 + 20 * Math.sin(2 * Math.PI * t), 20).length };
out.auto = play(true, 90, 150);
out.idle = play(false, 120, 110);
out.stop = play(false, 30, 0);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def res():
    node = shutil.which("node")
    if not node:
        pytest.skip("没装 node")
    p = subprocess.run([node, "--input-type=module", "-e", CHECK], cwd=STATIC, capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_legs(res):
    assert res["walk"] == {"jumps": 0, "slides": 0}
    assert res["highknee"] == 1
    assert res["squat"] >= 1


def test_highknee_latency(res):
    h = res["hk"]
    assert len(h["old"]) == 1 and len(h["neu"]) == 1, h                        # 高抬腿各认出一次
    assert h["neu"][0] <= h["old"][0] - 40, h                                  # 新路（A2 跟踪 + 往前看）比等 10 Hz 样本至少早 40 ms
    assert h["walkNew"] == 0, h                                                # 正常走路 20 s 新路不误触发


def test_run(res):
    a = res["auto"]
    assert not a["over"] and a["lives"] == 3 and a["dist"] > 800, a          # 会玩的人 90 s 跑 800 m 不掉命
    assert {"jump", "slide", "land", "turn"} <= set(a["ev"])
    assert a["turns"] >= 5 and a["miss"] == 0, a                              # 第 6 轮：90 s 过 5 个以上路口，一个不漏
    assert set(a["kinds"]) <= {None, "up", "down", "lift"} and {"up", "down", "lift"} <= set(a["kinds"])
    i = res["idle"]
    assert i["over"] and i["lives"] == 0 and i["fin"] is None, i               # 光跑不躲：撞满 3 次结束，力回到 null
    assert "corner" in i["ev"] and i["miss"] >= 1, i                           # 不转弯 = 撞路口尽头的墙，扣一次、自动转过去
    s = res["stop"]
    assert not s["over"] and s["dist"] == 0 and s["kinds"] == [None], s         # 站着不动 = 还没开局，不出力
