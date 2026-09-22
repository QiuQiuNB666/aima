"""地形控制律：脉冲形状核对 + 红灯逻辑 + 计步。跑：.venv/bin/pytest -q tests/test_terrain.py"""
from __future__ import annotations
import os
import sys
from types import SimpleNamespace as NS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import pulse_plot as PP  # noqa: E402
from shellos.control import terrain as T  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def gait(strides=0, moving=True, phase=0.0):
    leg = NS(phase=phase, n_strides=strides)
    return NS(l=leg, r=NS(phase=(phase + 0.5) % 1.0, n_strides=0), moving=moving)


def rig(monkeypatch, world="tokyo_night"):
    clk = Clock()
    monkeypatch.setattr(T.time, "monotonic", clk)
    return T.Terrain(world), clk


def test_pulse_shapes_pass_all_checks():
    for kind in PP.KINDS:
        assert not PP.check(T.Terrain(), kind)["problems"], kind
        assert not PP.sweep(kind), kind           # 参数扫到边界也要过


def test_checks_catch_bad_pulses():
    """核对本身要能抓到问题，不然上面那条永远过。"""
    ctl = T.Terrain()
    ctl.params["t_push"][0] = 40.0                # 伸展推进 30–60% 摆动中段
    assert any("抗屈" in p for p in PP.check(ctl, "up")["problems"])
    ctl = T.Terrain()
    ctl.params["width"][0] = 6.0                  # 太窄
    assert any("底宽" in p for p in PP.check(ctl, "up")["problems"])


def test_param_ranges_keep_pulse_out_of_swing():
    ctl = T.Terrain()
    ctl.set_params({"t_push": +100, "width": +100, "strength": +100})
    assert ctl.p("t_push") + ctl.p("width") / 2 <= 30.0
    assert not PP.check(ctl, "up")["problems"]
    ctl.set_params({"width": -100})
    assert ctl.p("width") == 10.0


def test_peak_never_exceeds_cap():
    ctl = T.Terrain(strength=3.0)
    assert max(abs(ctl.pulse(k, i / 500)) for k in PP.KINDS for i in range(500)) <= T.CAP


def test_flat_and_standing_give_zero():
    ctl = T.Terrain("tokyo_night")                # 起点是平路
    assert ctl.step(None, gait(moving=True)) == (0.0, 0.0)
    ctl.force = "stairs_up"
    peak_ph = (T.HS_PHASE + ctl.p("t_step") / 100) % 1.0
    assert ctl.step(None, gait(moving=False, phase=peak_ph)) == (0.0, 0.0)
    assert ctl.step(None, gait(moving=True, phase=peak_ph))[0] > 1.0


def test_red_light_wait(monkeypatch):
    ctl, clk = rig(monkeypatch)
    first_wait = next(i for i, p in enumerate(ctl.profile()) if p["kind"] == "wait")
    n_wait = next(n for k, n in ctl.segments if k == "wait")
    s = 0
    ctl.step(None, gait(s))
    for _ in range(first_wait + 5):                # 走过头：多出来的步不许冲过红灯
        s += 1
        clk.t += 0.55
        ctl.step(None, gait(s))
    assert ctl.pos == first_wait and ctl.segment_at(ctl.pos) == "wait"
    # 走着不前进，而且会被轻拉
    ph = (T.HS_PHASE + ctl.p("t_brake") / 100) % 1.0
    tl, _ = ctl.step(None, gait(s, moving=True, phase=ph))
    assert tl < 0 and ctl.pos == first_wait
    # 站住 1.9 s 不放；中途冒出一步（置信度掉了但还在出步）要重新计时
    ctl.step(None, gait(s, moving=False))
    clk.t += 1.9
    ctl.step(None, gait(s, moving=False))
    assert ctl.pos == first_wait and ctl.status()["wait_still"] == 1.9
    s += 1
    ctl.step(None, gait(s, moving=False))          # 这一拍出了一步 → 计时清零
    clk.t += 0.01
    ctl.step(None, gait(s, moving=False))          # 下一拍重新开始计
    clk.t += 1.9
    ctl.step(None, gait(s, moving=False))
    assert ctl.pos == first_wait
    clk.t += 0.2
    ctl.step(None, gait(s, moving=False))          # 站定满 2 s → 放行
    assert ctl.pos == first_wait + n_wait and ctl.segment_at(ctl.pos) != "wait"
    # 放行后继续计步
    s += 1
    clk.t += 0.55
    ctl.step(None, gait(s))
    assert ctl.pos == first_wait + n_wait + 1


def test_force_overrides_wait_and_still_counts(monkeypatch):
    ctl, clk = rig(monkeypatch)
    ctl.force = "up"
    for s in range(0, 20):
        clk.t += 0.5
        ctl.step(None, gait(s))
    assert ctl.pos == 19                           # 强制路段时红灯不拦
    assert ctl.status()["force"] == "up"


def test_lap_and_ghost(monkeypatch):
    ctl, clk = rig(monkeypatch, "train_stairs")
    ctl.wearer = "球球"
    for s in range(0, ctl.total + 1):
        clk.t += 0.5
        ctl.step(None, gait(s))
    assert ctl.laps == 1 and ctl.pos == 0 and ctl.ghost_who == "球球"
    assert len(ctl.ghost) == ctl.total and ctl.best == ctl.last_lap
