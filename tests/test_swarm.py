"""蜂群：安全员（软限裁剪 / 30 s 内同一参数 ≥3 次否决 / 急停全否）、离线造山、大脑提议被裁剪。"""
from __future__ import annotations
from types import SimpleNamespace

from shellos import worlds
from shellos.agent import brain
from tests.test_app import app


def walking(a):
    a.gait = SimpleNamespace(state=SimpleNamespace(cadence=100, symmetry=1, l=SimpleNamespace(rom=20), r=SimpleNamespace(rom=20)))


def test_safety_caps_and_rate_limits(tmp_path):
    a = app(tmp_path)
    walking(a)
    a.guard = SimpleNamespace(soft_cap=2.5, estop=False)
    assert a.feedback("没感觉")["delta"] == {"strength": 0.5}          # 1.5 → 2.0
    assert a.feedback("还是没感觉")["delta"] == {"strength": 0.5}      # → 2.5 贴着软限
    assert a.feedback("再强一点") is None                              # 第 3 次：想到 3.0，裁成 0 → 不生效
    assert a.ctl.params["strength"][0] == 2.5
    assert any(m["who"] == "安全员" and m["verdict"] == "裁剪" for m in a.swarm)
    a.ctl.set_params({"strength": -1.0})
    assert a.feedback("没感觉") is not None                            # 30 s 内第 3 次生效（被裁成 0 的那次不算）
    assert a.feedback("没感觉") is None                                # 第 4 次：否决，防几个人来回拉锯
    assert a.swarm[-1]["verdict"] == "否决"
    a.guard.estop = True
    assert a.feedback("太早了") is None and "急停" in a.swarm[-1]["msg"]


def test_make_world_offline_is_walkable(tmp_path):
    a = app(tmp_path)
    w = a.make_world("峰哥亡命天涯，要陡，还要下山")
    assert w["generated"] == "rule" and w["id"] in worlds.WORLDS
    assert a.ctl.preset == w["id"] and a.ctl.total == sum(s["steps"] for s in w["route"])
    assert w["theme"]["style"] in {x["theme"]["style"] for x in worlds.WORLDS.values() if not x["id"].startswith("gen_")}
    assert [m["who"] for m in a.swarm][:2] == ["地形导演", "地形导演"]


def test_claude_proposal_is_clamped(tmp_path, monkeypatch):
    a = app(tmp_path)
    walking(a)
    monkeypatch.setattr(brain, "call", lambda path, body, timeout=0: {
        "changes": [{"param": "strength", "delta": 9.0}, {"param": "nope", "delta": 1}], "confidence": 3, "why": "x"})
    it = a.feedback("随便说一句")
    assert it["source"] == "claude" and abs(it["delta"]["strength"] - 0.45) < 1e-9 and list(it["delta"]) == ["strength"] and it["confidence"] == 1.0   # 范围 3 × 15%


def test_fengge_speaks_on_summit_and_red_offline(tmp_path):
    import time
    a = app(tmp_path)
    t = a.ctl
    a.story_tick()                                        # 记下基线，不说话
    t.laps, t.last_lap, t.best = 1, 31.0, 31.0
    a.story_tick()
    for _ in range(50):
        if a.fengge.last["text"]:
            break
        time.sleep(0.02)
    assert a.fengge.last["event"] == "summit" and a.fengge.last["source"] == "canned"
    assert a.swarm[-1]["who"] == "峰哥"
    a.set_terrain("tokyo_night")                          # 东京有红灯：走到红灯前一格
    a.story_tick()
    t = a.ctl
    t.pos = next(i for i in range(t.total) if t.segment_at(i) == "wait")
    a.story_tick()
    for _ in range(50):
        if a.fengge.last["event"] == "red":
            break
        time.sleep(0.02)
    assert a.fengge.last["event"] == "red"


def test_terrain_force_ttl_expires(tmp_path):
    """跑酷页带 ttl 设强制路段：不续就自动回 None；不带 ttl（2AFC）不过期。"""
    import time
    from shellos.ui.server import Dashboard
    a = app(tmp_path)
    d = Dashboard.__new__(Dashboard)          # 不起 HTTP 线程，只测 action + 看门狗的逻辑
    d.app, d._last_hold, d._force_exp = a, 0.0, 0.0
    d.action("/terrain/force", {"kind": "up", "ttl": 0.05})
    assert a.ctl.force == "up"
    time.sleep(0.08)
    d._expire_force()                         # 看门狗每 50 ms 调的就是它
    assert a.ctl.force is None
    d.action("/terrain/force", {"kind": "down"})
    assert d._force_exp == 0.0 and a.ctl.force == "down"
