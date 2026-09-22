"""步态估计和相位控制律，对着合成步态。"""
from __future__ import annotations
import math

from shellos.device.frame import Frame
from shellos.gait.estimator import GaitEstimator
from shellos.control.phase_profile import PhaseProfile


def walk(seconds=8.0, spm=100.0, amp=20.0, rate=200):
    f = spm / 120.0                      # 周期频率 Hz（一个周期两步）
    for i in range(int(seconds * rate)):
        t = i / rate
        w = 2 * math.pi * f
        l, r = amp * math.sin(w * t), amp * math.sin(w * t + math.pi)
        ld, rd = amp * w * math.cos(w * t), amp * w * math.cos(w * t + math.pi)
        yield Frame(t, i * 5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 101, l, r, ld, rd)


def test_phase_monotonic_and_cadence():
    g = GaitEstimator()
    prev = None
    backwards = 0
    for fr in walk():
        st = g.update(fr)
        if prev is not None and st.conf > 0.5:
            d = (st.l.phase - prev + 0.5) % 1.0 - 0.5
            if d < -0.02:
                backwards += 1
        prev = st.l.phase
    assert backwards < 5, f"相位倒退 {backwards} 次"
    assert st.moving and st.conf > 0.8
    assert abs(st.cadence - 100) < 8, st.cadence
    assert 0.9 < st.symmetry < 1.1
    assert st.variability < 0.1
    assert 30 < st.l.rom < 45          # 摆幅 ±20 → 活动度 ≈ 40


def test_standing_confidence_collapses():
    g = GaitEstimator()
    for fr in walk(4.0):
        g.update(fr)
    for i in range(600):               # 站着不动 3 秒
        st = g.update(Frame(4 + i / 200, 10000 + i * 5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 101, 3.0, -2.0, 0, 0))
    assert st.conf < 0.3 and not st.moving


def test_phase_profile_peaks_where_told():
    c = PhaseProfile(peak_ext=2.0, t_ext=30, peak_flex=1.0, t_flex=75, width=10)
    assert abs(c.torque_at(0.30) - 2.0) < 1e-6
    assert abs(c.torque_at(0.75) + 1.0) < 1e-6
    assert abs(c.torque_at(0.52)) < 0.1              # 两峰之间接近 0
    c.set_params({"t_ext": -5})                      # "早一点"
    assert c.p("t_ext") == 25
    assert abs(c.torque_at(0.25) - 2.0) < 1e-6
    assert c.set_params({"peak_ext": 100})["peak_ext"] == 4.0


def test_gamepad_nudge_and_cycle():
    from shellos.main import App
    from shellos.input.gamepad import BTN

    class L:  # 最小假链路
        port = "x"; n_frames = 0; n_bad = 0
        def latest(self): return None
        def stream_age(self): return 0.0
        def send(self, c): pass
        def send_torque(self, a, b): pass
        def disable(self): pass
    from shellos.safety.guard import Guard
    app = App(L(), Guard(L()), "phase")
    app.on_button(BTN["up"]);    assert app.ctl.p("peak_ext") == 2.0      # 1.5 + 0.5
    app.on_button(BTN["left"]);  assert app.ctl.p("t_ext") == 20.0        # 25 - 5
    app.on_button(BTN["r1"]);    assert app.ctl.name == "transparent"     # phase → 绕回第一个
    app.on_button(BTN["l1"]);    assert app.ctl.name == "phase_profile"
    app.on_button(BTN["l1"]);    assert app.ctl.name == "dofc"
    app.on_button(BTN["right"]); assert abs(app.ctl.p("delay_s") - 0.16) < 1e-9   # 0.15 + 0.01
    app.on_button(BTN["l1"]);    assert app.ctl.name == "constant"
    app.on_button(BTN["up"]);    assert app.ctl.p("tl") == 0.5            # 0 + 0.5


def test_memory_loop(tmp_path, monkeypatch):
    """评委一句话 → 卡 → 删除回退 → 换人后走够步数自动命中。"""
    monkeypatch.delenv("SHELLOS_LLM_KEY", raising=False)
    from shellos.main import App
    from shellos.memory.store import Store
    from shellos.safety.guard import Guard

    class L:
        port = "x"; n_frames = 0; n_bad = 0
        def latest(self): return None
        def stream_age(self): return 0.0
        def send(self, c): pass
        def send_torque(self, a, b): pass
        def disable(self): pass
    app = App(L(), Guard(L()), "phase")
    app.store = Store(str(tmp_path / "exp.jsonl"))
    for fr in walk(6.0):                       # 先走出一个步频画像
        app.gait.update(fr)
    assert app.gait.state.cadence > 80
    card = app.feedback("早一点")
    assert card and card["delta"] == {"t_ext": -5} and app.ctl.p("t_ext") == 20
    app.delete_exp(card["id"])
    assert app.ctl.p("t_ext") == 25            # 回退
    app.enable_exp(card["id"])
    app.set_wearer("judge-02")                 # 换人：参数回缺省
    assert app.ctl.p("t_ext") == 25 and not app.recalled
    for fr in walk(6.0):
        app.gait.update(fr)
    app.auto_recall()
    assert app.recalled and app.applied == [card["id"]] and app.ctl.p("t_ext") == 20   # 步频相近 → 命中
    assert app.store.items[0]["hits"] == 1
