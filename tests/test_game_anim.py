"""游戏 anim.js 的回归检查（node 跑；没装 node 就跳过）：
髋角跟踪比旧的「落后 130 ms 线性插值」延迟低；膝按步态相位弯（摆动期屈、支撑期直）；站住放松、登顶举手、上台阶屈膝更多；零点能学出来。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static")

CHECK = r"""
import { makeHipTrack, makeBody, synthHip } from './anim.js';
const out = {};
// 真人样的髋角（屈曲 °）：支撑期平台 + 0.25 s 快速前摆，1 s 一个周期（9/22 真机录制就是这个形状）
const hip = t => { const g = ((t % 1) + 1) % 1; return g < 0.55 ? 10 : 10 + 25 * Math.sin(Math.PI * (g - 0.55) / 0.45) ** 2; };
const vel = t => (hip(t + 1e-3) - hip(t - 1e-3)) / 2e-3;
// 1) 延迟：10 Hz 轮询 + 5–40 ms 网络抖动，60 fps 采样，找最贴合的时移
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const polls = []; for (let ts = 0.2; ts < 30; ts += 0.1 + rnd() * 0.01) polls.push({ ts, arr: ts + 0.005 + rnd() * 0.035 });
function run(kind) {
  const tr = makeHipTrack(), buf = [], ys = []; let pi = 0;
  for (let t = 1; t < 30; t += 1 / 60) {
    while (pi < polls.length && polls[pi].arr <= t) { const p = polls[pi++]; if (kind === 'new') tr.push(p.arr, p.ts, hip(p.ts), hip(p.ts), vel(p.ts), vel(p.ts)); else { buf.push({ t: p.arr, f: hip(p.ts) }); if (buf.length > 8) buf.shift(); } }
    let y;
    if (kind === 'new') y = tr.sample(t, 1 / 60).fl;
    else { const rt = t - 0.13; y = buf[0].f; for (let k = buf.length - 1; k > 0; k--) { const a = buf[k - 1], b = buf[k]; if (rt >= a.t) { y = a.f + (b.f - a.f) * Math.min(1, (rt - a.t) / Math.max(1e-3, b.t - a.t)); break; } } }
    ys.push([t, y]);
  }
  let best = [1e9, 0];
  for (let lag = 0; lag <= 0.3; lag += 0.005) { let e = 0; for (const [t, y] of ys) e += (y - hip(t - lag)) ** 2; if (e < best[0]) best = [e, lag]; }
  return { lag: best[1], rms: Math.sqrt(best[0] / ys.length) };
}
out.old = run('old'); out.new = run('new');
// 2) 姿态：直接喂髋角 + 角速度
function walk(kind, secs, f = hip, v = vel, opts = {}) {
  const b = makeBody(opts); const rec = [];
  for (let t = 0; t < secs; t += 1 / 60) {
    const P = b.update(1 / 60, t, { fl: f(t), fr: f(t + 0.5), wl: v(t), wr: v(t + 0.5), kind, summit: opts.summit });
    if (t > secs - 3) rec.push({ w: v(t), knee: P.kneeL, lean: P.spine[2] + P.chest[2], arm: P.armL[1], act: b.act, bob: P.bob });
  }
  return { b, rec };
}
const flat = walk('flat', 8).rec, stairs = walk('stairs_up', 8).rec;
const swingKnee = r => Math.max(...r.filter(x => x.w > 30).map(x => x.knee));
out.flat_swing_knee = swingKnee(flat);
out.flat_stance_knee = Math.max(...flat.filter(x => x.w < -5).map(x => x.knee));   // 髋往后伸 = 支撑期
out.stairs_swing_knee = swingKnee(stairs);
out.flat_lean = flat.at(-1).lean; out.stairs_lean = stairs.at(-1).lean;
out.flat_act = flat.at(-1).act;
out.bob_range = Math.max(...flat.map(x => x.bob)) - Math.min(...flat.map(x => x.bob));
const still = walk('wait', 6, () => 12, () => 0).rec;
out.still_act = still.at(-1).act;
out.summit_arm = walk('flat', 4, () => 5, () => 0, { summit: true }).rec.at(-1).arm;
out.idle_arm = still.at(-1).arm;
// 3) 零点：整体偏屈 8° 的真机信号，学完后均值应接近 +5（零点 = 均值 − 5）
const w2 = walk('flat', 30, t => hip(t) + 8);
out.off = w2.b.off; out.mean = Array.from({ length: 1000 }, (_, i) => hip(i / 1000) + 8).reduce((a, b) => a + b) / 1000;
// 4) 影子合成步态：+28° 附近最屈、约 −6° 最伸
const s = Array.from({ length: 100 }, (_, i) => synthHip(i / 100)[0]);
out.synth = [Math.max(...s), Math.min(...s)];
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 node")
def test_anim(tmp_path):
    shutil.copy(os.path.join(STATIC, "game", "anim.js"), tmp_path / "anim.js")
    (tmp_path / "check.mjs").write_text(CHECK)
    r = subprocess.run(["node", "check.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["new"]["lag"] < o["old"]["lag"] - 0.04, o          # 延迟至少少 40 ms
    assert o["new"]["rms"] < 3.0, o                            # 扣掉延迟后波形不走样
    assert o["flat_swing_knee"] > 40 and o["flat_stance_knee"] < 25, o   # 摆动期屈膝、支撑期伸直
    assert o["stairs_swing_knee"] > o["flat_swing_knee"], o
    assert o["stairs_lean"] > o["flat_lean"] + 5, o            # 上台阶前倾
    assert o["flat_act"] > 0.9 and o["still_act"] < 0.1, o      # 走 / 站分得开
    assert 0.005 < o["bob_range"] < 0.08, o                    # 骨盆有起伏但不跳
    assert o["summit_arm"] < -40 < 50 < o["idle_arm"], o       # 登顶举手、站着手垂下
    assert abs(o["off"] - (o["mean"] - 5)) < 1.5, o
    assert 25 < o["synth"][0] < 31 and -10 < o["synth"][1] < -2, o
