"""安全层的七条规则，每条一个断言。跑：.venv/bin/pytest -q"""
from __future__ import annotations
import time

from shellos.device.frame import parse_line, Frame
from shellos.safety.guard import Guard, ARMED, ACTIVE, DISARMED
from shellos.control.dofc import DOFC


class FakeLink:
    def __init__(self):
        self.sent = []
        self._age = 0.0

    def send(self, c): self.sent.append(c)
    def send_torque(self, tl, tr): self.sent.append(f"T,{tl:.3f},{tr:.3f}")
    def disable(self): self.sent.append("DISABLE")
    def stream_age(self): return self._age


def armed_guard(**kw):
    link = FakeLink()
    g = Guard(link, **kw)
    g.arm()
    g.set_deadman(1.0)
    return g, link


def test_parse_frame():
    from shellos.device.convention import R_SIGN
    f = parse_line("S:1234,1.5,-0.2,90,0,0,0,0,0,1,101.3,10.5,-3.2,50,-40", 0.0)
    assert f and f.l_deg == 10.5 and f.r_deg == -3.2 * R_SIGN and f.r_dps == -40 * R_SIGN
    assert f.l_dps == 50
    assert parse_line("OK,ENABLE", 0.0) is None
    assert parse_line("S:1,2,3", 0.0) is None


def test_no_deadman_no_torque():
    g, link = armed_guard()
    g.set_deadman(0.0)
    assert g.submit(2.0, 2.0) == (0.0, 0.0)
    assert not any(c.startswith("T,") for c in link.sent)


def test_soft_cap_and_slew():
    g, link = armed_guard(soft_cap=3.0, slew=0.1)
    out = g.submit(10.0, -10.0)
    assert out == (0.1, -0.1)            # 斜率限：第一拍只能爬 0.1
    for _ in range(100):
        out = g.submit(10.0, -10.0)
    assert out == (3.0, -3.0)            # 最终停在软限，不是 10


def test_deadman_scales():
    g, link = armed_guard(slew=10.0)
    g.set_deadman(0.5)
    assert g.submit(2.0, 2.0) == (1.0, 1.0)


def test_release_deadman_disables():
    g, link = armed_guard(slew=10.0)
    g.submit(1.0, 1.0)
    assert g.state == ACTIVE
    g.set_deadman(0.0)
    g.submit(1.0, 1.0)
    assert g.state == DISARMED and link.sent[-1] == "DISABLE"
    assert g.submit(1.0, 1.0) == (0.0, 0.0)      # 不 rearm 就永远没力
    assert g.rearm() and g.state == ARMED and link.sent[-1] == "ENABLE"


def test_estop():
    g, link = armed_guard(slew=10.0)
    g.submit(1.0, 1.0)
    g.trigger_estop()
    assert g.state == DISARMED and "DISABLE" in link.sent


def test_low_confidence_zeroes():
    g, link = armed_guard(slew=10.0)
    assert g.submit(2.0, 2.0, confidence=0.1) == (0.0, 0.0)
    assert g.state == ACTIVE and g.last_reason == "low confidence"


def test_stale_stream_zeroes():
    g, link = armed_guard(slew=10.0)
    link._age = 1.0
    assert g.submit(2.0, 2.0) == (0.0, 0.0)
    assert g.last_reason == "stream stale"


def test_watchdog_disables_dead_loop():
    g, link = armed_guard(slew=10.0, wd_zero=0.02, wd_disable=0.05)
    g.submit(1.0, 1.0)
    time.sleep(0.1)                       # 控制线程"死了"
    assert g.state == DISARMED and link.sent[-1] == "DISABLE"


def test_dofc_shape_and_delay():
    c = DOFC(gain=0.1, delay_s=0.05, ema=1.0)
    # 前 10 帧 L-R = 20°，之后 = 0；延迟 0.05 s = 10 帧
    for i in range(11):
        out = c.step(Frame(i * 0.005, i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0))
    assert out == (-1.0, 1.0)             # 0.1 Nm/deg × 10° (差/2)，左右反号
    for i in range(11, 30):
        out = c.step(Frame(i * 0.005, i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    assert out == (0.0, 0.0)              # 延迟窗口过去后归零
    assert c.set_params({"gain": 5.0}) == {"gain": 0.15}   # 裁剪到上限
