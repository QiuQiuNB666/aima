"""跑酷 static/parkour/logic.js 的回归检查（node 跑；没装 node 就跳过）：
走路不误触发跳 / 滑铲、高抬腿触发一次跳、下蹲触发滑铲；自动驾驶能过关卡、不操作会撞满 3 次结束；
腿上的力只会是 up / down / stairs_up / null，结束后回到 null。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "parkour")

CHECK = r"""
import { makeLegs, makeLevel, makeRun, forceKind, nextThreat, speedFor, TUNE } from './logic.js';
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
      if (th.what === 'lane') { const free = [0, 1, 2].filter(l => !th.o.lanes.includes(l)); inp.lane = Math.sign(free.sort((a, b) => Math.abs(a - S.lane) - Math.abs(b - S.lane))[0] - S.lane); }
    }
    S.step(1 / 60, inp); kinds.add(forceKind(S, lv)); t += 1 / 60;
  }
  return { over: S.over, lives: S.lives, dist: Math.round(S.dist), t: +t.toFixed(1), kinds: [...kinds], ev: [...new Set(S.events)], fin: forceKind(S, lv) };
}
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


def test_run(res):
    a = res["auto"]
    assert not a["over"] and a["lives"] == 3 and a["dist"] > 800, a          # 会玩的人 90 s 跑 800 m 不掉命
    assert {"jump", "slide", "land"} <= set(a["ev"])
    assert set(a["kinds"]) <= {None, "up", "down", "stairs_up"} and "up" in a["kinds"] and "down" in a["kinds"]
    i = res["idle"]
    assert i["over"] and i["lives"] == 0 and i["fin"] is None, i               # 光跑不躲：撞满 3 次结束，力回到 null
    s = res["stop"]
    assert not s["over"] and s["dist"] == 0 and s["kinds"] == [None], s         # 站着不动 = 还没开局，不出力
