"""整合层（main.App）：换人参数回缺省、切走 terrain 再切回不丢影子、差值为 0 不存卡、设备复位立即重试。"""
from __future__ import annotations
from types import SimpleNamespace

from shellos.main import App, recover_tick
from shellos.memory.store import Store


def app(tmp_path):
    a = App(link=None, guard=None, ctl_name="terrain")
    a.store = Store(str(tmp_path / "exp.jsonl"))
    a.log = lambda text: None
    return a


def test_demo_reset_params_back_to_default_ghost_kept(tmp_path):
    a = app(tmp_path)
    a.ctl.set_params({"strength": -1.0})
    a.ctl.ghost, a.ctl.ghost_who = [1.0, 2.0], "A"
    a.set_wearer("B")
    assert a.ctl.params["strength"][0] == 1.5
    assert a.ctl.ghost == [1.0, 2.0] and a.ctl.wearer == "B"


def test_switch_away_and_back_keeps_terrain(tmp_path):
    a = app(tmp_path)
    a.set_terrain("taishan_18pan")
    t = a.ctl
    t.ghost, t.ghost_who, t.best, t.pos = [1.0], "A", 42.0, 7
    a.set_ctl("puppet")
    a.set_ctl("terrain")
    assert a.ctl is t and a.ctl.preset == "taishan_18pan" and a.ctl.ghost == [1.0] and a.ctl.best == 42.0
    assert a.ctl.pos == 0
    a.set_ctl("puppet")
    a.set_terrain("taishan_18pan")          # 同一个世界：影子保留
    assert a.ctl is t and a.ctl.ghost == [1.0]


def test_feedback_zero_delta_no_card(tmp_path):
    a = app(tmp_path)
    a.gait = SimpleNamespace(state=SimpleNamespace(cadence=100, symmetry=1, l=SimpleNamespace(rom=20), r=SimpleNamespace(rom=20)))
    assert a.feedback("不明显") is not None and a.ctl.params["strength"][0] == 2.0
    assert a.feedback("轻一点")["delta"] == {"strength": -0.5}
    assert a.feedback("今天天气不错") is None
    assert a.add_exp({"strength": 0.0}, "x") is None and len(a.store.items) == 2


def test_recover_tick_retries_immediately_after_reboot():
    calls = []
    link = SimpleNamespace(reboots=0, needs_recovery=lambda: True, recover=lambda: calls.append(1) or True)
    guard = SimpleNamespace(state="ARMED", arm=lambda: True)
    rs = {"last": 0.0, "reboots": 0}
    recover_tick(link, guard, 10.0, rs)
    recover_tick(link, guard, 10.5, rs)          # 2 s 节拍内：不重试
    link.reboots = 1
    recover_tick(link, guard, 10.6, rs)          # 刚复位：立刻重试
    guard.state = "DISARMED"
    recover_tick(link, guard, 20.0, rs)          # DISARMED：不动
    assert len(calls) == 2


def test_world_switch_after_walking_does_not_fake_laps(tmp_path):
    """步态已经数了几百步时换世界 / 切回 terrain：不能一拍把几百步算成好几圈（0 s 登顶、假影子）。"""
    a = app(tmp_path)
    side = lambda n: SimpleNamespace(n_strides=n, phase=0.3)
    g = SimpleNamespace(l=side(300), r=side(300), moving=True)
    a.ctl.step(None, g)
    a.set_terrain("taishan_18pan")
    a.ctl.step(None, g)
    g.l = side(301)
    a.ctl.step(None, g)
    assert a.ctl.laps == 0 and a.ctl.pos == 1 and a.ctl.best is None
