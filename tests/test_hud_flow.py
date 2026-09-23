"""大屏状态流 hud_flow.js 的 pickMode（node 跑；没装 node 就跳过）：
扳机在门槛上抖（ACTIVE / ARMED 10 Hz 来回）时「游戏中 ↔ 按住 R2」不许跟着闪；松开 1.2 s 以上才切；急停立刻切；登顶压过待机。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "game")

CHECK = r"""
import { pickMode } from './hud_flow.js';
const out = {};
const run = (states, dt = 0.1) => {           // 按 10 Hz 喂 /state.safety.state，数模式切了几次
  let m = 'ready', lastActive = -1e9, flips = 0, t = 0; const seq = [];
  for (const st of states) {
    t += dt; if (st === 'ACTIVE') lastActive = t;
    const n = pickMode(m, { state: st, summit: false, idleFor: 0, notActiveFor: t - lastActive, idleS: 45 });
    if (n !== m) flips++; m = n; seq.push(m);
  }
  return { flips, last: m, seq };
};
out.jitter = run(Array.from({ length: 60 }, (_, i) => i % 2 ? 'ARMED' : 'ACTIVE')).flips;           // 6 s 抖动：只该切 1 次（进游戏中）
out.release = run([...Array(10).fill('ACTIVE'), ...Array(20).fill('ARMED')]);                      // 按 1 s 再松 2 s：最后回「按住 R2」
out.brief = run([...Array(10).fill('ACTIVE'), ...Array(5).fill('ARMED')]).last;                     // 松 0.5 s：还在游戏中
out.estop = run([...Array(10).fill('ACTIVE'), 'DISARMED']).last;                                   // 急停：下一帧就切
out.summitIdle = pickMode('play', { state: 'ACTIVE', summit: true, idleFor: 99, notActiveFor: 0, idleS: 45 });
out.idle = pickMode('play', { state: 'ARMED', summit: false, idleFor: 50, notActiveFor: 50, idleS: 45 });
out.forced = pickMode('play', { forced: 'idle', state: 'DISARMED' });
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="没装 node")
def test_pick_mode_no_flicker(tmp_path):
    f = tmp_path / "check.mjs"
    f.write_text(CHECK.replace("'./hud_flow.js'", json.dumps("file://" + os.path.abspath(os.path.join(STATIC, "hud_flow.js")))))
    r = subprocess.run(["node", str(f)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout.strip().splitlines()[-1])
    assert o["jitter"] == 1, o                      # 抖 6 s 只进一次游戏中，不来回闪
    assert o["release"]["last"] == "ready" and o["release"]["flips"] == 2, o
    assert o["brief"] == "play", o
    assert o["estop"] == "ready", o
    assert o["summitIdle"] == "summit", o
    assert o["idle"] == "idle", o
    assert o["forced"] == "idle", o
