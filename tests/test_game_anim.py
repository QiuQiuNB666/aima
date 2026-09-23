"""游戏 anim.js 的回归检查（node 跑；没装 node 就跳过）：
髋角跟踪比旧的「落后 130 ms 线性插值」延迟低；膝按步态相位弯（摆动期屈、支撑期直）；站住放松、登顶举手、上台阶屈膝更多；零点能学出来；
步频上去切成跑；下台阶落脚膝有缓冲；外骨骼给屈曲方向的力时撑地膝被压弯；站着也能学零点。"""
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
// 2) 姿态：直接喂髋角 + 角速度（per = 一个周期秒数，1 s = 120 步/分）
function walk(kind, secs, f = hip, v = vel, opts = {}) {
  const b = makeBody(opts); const rec = [], per = opts.per || 1, F = t => f(t / per), Vv = t => v(t / per) / per;
  for (let t = 0; t < secs; t += 1 / 60) {
    const tq = opts.tq ? [opts.tq(t / per), opts.tq(t / per + 0.5)] : null;
    const P = b.update(1 / 60, t, { fl: F(t), fr: F(t + per / 2), wl: Vv(t), wr: Vv(t + per / 2), kind, summit: opts.summit, tq });
    if (t > secs - 3) rec.push({ w: Vv(t), knee: P.kneeL, lean: P.spine[2] + P.chest[2], arm: P.armL[1], elbow: P.armL[2], act: b.act, bob: P.bob, run: b.run, cad: b.cad });
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
// 5) 跑：0.7 s 一个周期 = 171 步/分；走 1.2 s = 100 步/分
const runR = walk('flat', 10, hip, vel, { per: 0.7 }).rec, slow = walk('flat', 10, hip, vel, { per: 1.2 }).rec;
out.run = runR.at(-1).run; out.run_cad = runR.at(-1).cad; out.walk_run = slow.at(-1).run; out.walk_cad = slow.at(-1).cad;
out.run_elbow = Math.max(...runR.map(x => x.elbow)); out.walk_elbow = Math.max(...slow.map(x => x.elbow));
out.run_lean = runR.at(-1).lean; out.walk_lean = slow.at(-1).lean;
out.run_knee = swingKnee(runR); out.walk_knee = swingKnee(slow);
const rng_ = r => Math.max(...r.map(x => x.bob)) - Math.min(...r.map(x => x.bob));
out.run_bob = rng_(runR); out.walk_bob = rng_(slow);
// 6) 落脚：髋角速度由正转负（脚跟着地）后撑地膝的峰值——下台阶 > 平地
const landKnee = r => Math.max(...r.filter(x => x.w <= 0.5).map(x => x.knee));   // 支撑期（含平台）
out.land_down = landKnee(walk('stairs_down', 8).rec); out.land_flat = landKnee(walk('flat', 8).rec);
// 7) 外骨骼屈曲方向的力（支撑期 −2 Nm）→ 撑地膝更弯
out.yield_knee = landKnee(walk('flat', 8, hip, vel, { tq: g => (((g % 1) + 1) % 1) < 0.5 ? -2 : 0 }).rec);
// 8) 站着（两髋都 15° 不动）也学零点 → 零点 ≈ 15
out.stand_off = walk('flat', 15, () => 15, () => 0).b.off;
out.sit_off = walk('flat', 15, () => 70, () => 0).b.off;   // 坐着不学
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
    assert o["run"] > 0.8 and 160 < o["run_cad"] < 185, o      # 171 步/分 → 跑
    assert o["walk_run"] < 0.05 and 90 < o["walk_cad"] < 110, o
    assert o["run_elbow"] > o["walk_elbow"] + 40 and o["run_lean"] > o["walk_lean"] + 5, o
    assert o["run_knee"] > o["walk_knee"] + 20 and o["run_bob"] > o["walk_bob"] + 0.02, o   # 抬膝更高、有腾空
    assert o["land_down"] > o["land_flat"] + 10, o             # 下台阶落脚膝缓冲
    assert o["yield_knee"] > o["land_flat"] + 8, o
    assert 13 < o["stand_off"] < 16 and abs(o["sit_off"]) < 1, o
