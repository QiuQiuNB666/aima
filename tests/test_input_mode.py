"""输入模式（exo / keyboard / pad）：/drive 只在非 exo 生效；键盘模式 0 力矩、步态不推进、红灯 1.5 s 没按键放行；切回 exo 不跳步。"""
from __future__ import annotations
from types import SimpleNamespace as NS

from shellos.control import terrain as T
from shellos.main import App
from shellos.ui.server import Dashboard


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


def gait(strides, moving=True, phase=0.3):
    leg = NS(phase=phase, n_strides=strides, omega_f=90.0)
    return NS(l=leg, r=NS(phase=0.8, n_strides=0, omega_f=-90.0), moving=moving)


def rig(monkeypatch, world="tokyo_night"):
    clk = Clock()
    monkeypatch.setattr(T.time, "monotonic", clk)
    a = App(link=None, guard=None, ctl_name="terrain")
    a.log = lambda text: None
    a.set_terrain(world)
    d = Dashboard.__new__(Dashboard)
    d.app = a
    return a, d, clk


def test_drive_rejected_in_exo_mode(monkeypatch):
    a, d, _ = rig(monkeypatch)
    assert d.action("/drive", {"steps": 2}) == {"error": "exo mode"}
    assert a.ctl.pos == 0 and a.input_mode == "exo"


def test_keyboard_drive_advances_and_stops_at_red_light(monkeypatch):
    a, d, clk = rig(monkeypatch)                 # tokyo_night：flat 4 → wait 3
    assert d.action("/input", {"mode": "keyboard"}) == {"mode": "keyboard"}
    assert d.action("/drive", {"steps": 3})["pos"] == 3
    d.action("/drive", {"steps": 5})             # 一次最多 5 步，且停在红灯前
    assert a.ctl.pos == 4 and a.ctl.segment_at(4) == "wait"
    d.action("/drive", {"steps": 1})             # 红灯里按键 = 还在走，不前进
    a.ctl.step(None, gait(0)); clk.t += 1.0; a.ctl.step(None, gait(0))
    assert a.ctl.pos == 4
    clk.t += 0.6                                 # 1.5 s 没按键：放行整段红灯
    a.ctl.step(None, gait(0))
    assert a.ctl.pos == 7


def test_keyboard_step_zero_torque_and_ignores_gait(monkeypatch):
    a, d, _ = rig(monkeypatch, "taishan_18pan")
    d.action("/input", {"mode": "keyboard"})
    d.action("/drive", {"steps": 5})             # pos 5 = 上坡段，exo 模式这里会出力
    assert a.ctl.step(None, gait(10)) == (0.0, 0.0)
    assert a.ctl.step(None, gait(40)) == (0.0, 0.0) and a.ctl.pos == 5


def test_back_to_exo_rebases_strides(monkeypatch):
    a, d, _ = rig(monkeypatch, "taishan_18pan")
    d.action("/input", {"mode": "pad"})
    a.ctl.step(None, gait(300)); a.ctl.step(None, gait(340))
    d.action("/input", {"mode": "exo"})
    a.ctl.step(None, gait(340))
    assert a.ctl.pos == 0                        # 键盘 / 手柄期间步态数的 340 步不算
    a.ctl.step(None, gait(342))
    assert a.ctl.pos == 2
    a.ctl.step(None, gait(345))
    assert a.ctl.pos == 5 and a.ctl.step(None, gait(345, phase=T.HS_PHASE + 0.11))[0] > 0   # 上坡段：exo 模式力矩回来了
