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


# ---- 9/23 审查修复 ----

def walked(a, strides=0, cadence=110):
    """把步态换成一个可控的假状态：已走 strides 步、步频 cadence。"""
    leg = SimpleNamespace(n_strides=strides // 2, rom=20, phase=0.3)
    a.gait = SimpleNamespace(state=SimpleNamespace(cadence=cadence, symmetry=1, l=leg, r=SimpleNamespace(**vars(leg)),
                                                   conf=0.9, moving=True))


def test_phase_standing_is_gated_by_confidence(tmp_path):
    """phase 控制律的 name 是 phase_profile：以前按名字判断，置信度永远给 1.0，站着不动也出力。"""
    from shellos.device.frame import Frame
    from shellos.safety.guard import Guard

    class L:
        def send(self, c): pass
        def send_torque(self, a, b): pass
        def disable(self): pass
        def stream_age(self): return 0.0
    g = Guard(L())
    g.arm()
    g.set_deadman(1.0)
    a = App(link=L(), guard=g, ctl_name="phase")
    a.log = lambda text: None
    for i in range(200):
        st = a.tick(Frame(i / 200, i * 5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 101, 3.0, -2.0, 0, 0))
    assert st.conf < g.min_conf and g.last_reason == "low confidence" and g.last_sent == (0.0, 0.0)


def test_feedback_then_recall_applies_once(tmp_path):
    """走满 6 步前说话：卡立即生效，之后检索不能再套一次；删卡回到 1.5。"""
    a = app(tmp_path)
    a.set_wearer("A")
    walked(a, strides=3)
    card = a.feedback("太陡了")
    assert a.ctl.p("strength") == 1.0
    walked(a, strides=8)
    a.auto_recall()
    assert a.recalled and a.ctl.p("strength") == 1.0 and a.applied == [card["id"]]
    a.delete_exp(card["id"])
    assert a.ctl.p("strength") == 1.5


def test_feedback_without_cadence_no_card(tmp_path):
    a = app(tmp_path)
    walked(a, strides=0, cadence=0)
    assert a.feedback("太陡了") is None and a.store.items == [] and a.ctl.p("strength") == 1.5


def test_change_wearer_while_puppet_resets_cached_terrain(tmp_path):
    a = app(tmp_path)
    walked(a, strides=2)
    a.feedback("太陡了")
    a.set_ctl("puppet")
    a.set_wearer("B")
    a.set_ctl("terrain")
    assert a.ctl.p("strength") == 1.5 and a.ctl.wearer == "B" and a.applied == [] and not a.recalled


def test_puppet_recall_does_not_use_up_terrain_recall(tmp_path):
    """开场 puppet 共驾走满 6 步做过一次检索（puppet 没卡）；切回 terrain 还要检索 terrain 的卡。"""
    a = app(tmp_path)
    walked(a, strides=2)
    card = a.feedback("太陡了")
    a.set_wearer("C")
    a.set_ctl("puppet")
    walked(a, strides=8)
    a.auto_recall()
    assert a.recalled
    a.set_ctl("terrain")
    assert not a.recalled
    a.auto_recall()
    assert a.applied == [card["id"]] and a.ctl.p("strength") == 1.0


def test_cards_from_many_judges_do_not_stack_to_zero(tmp_path):
    a = app(tmp_path)
    for who in "ABC":
        a.set_wearer(who)
        walked(a, strides=2)
        a.feedback("太陡了")
    a.set_wearer("D")
    walked(a, strides=8)
    a.auto_recall()
    assert len(a.applied) == 3 and a.ctl.p("strength") == 1.0      # 三张 −0.5 取平均，不是 −1.5


def test_terrain_timing_moves_all_pulses(tmp_path):
    """「早一点」/ 手柄 ←→ 不只动 t_push：台阶 t_step、下坡 t_brake 一起挪。"""
    from shellos.input.gamepad import BTN
    a = app(tmp_path)
    walked(a, strides=2)
    a.feedback("早一点")
    assert (a.ctl.p("t_push"), a.ctl.p("t_step"), a.ctl.p("t_brake")) == (6.0, 1.0, 5.0)
    a.on_button(BTN["right"])
    assert (a.ctl.p("t_push"), a.ctl.p("t_step"), a.ctl.p("t_brake")) == (6.5, 1.5, 5.5)


def test_change_wearer_keeps_other_worlds_memory(tmp_path):
    a = app(tmp_path)
    a.ctl.ghost, a.ctl.ghost_who, a.ctl.best = [1.0], "A", 34.8
    first = a.ctl.preset
    a.set_terrain("taishan_18pan")
    a.set_wearer("B")                        # 换人 → 新 Terrain 实例
    a.set_terrain(first)
    assert a.ctl.best == 34.8 and a.ctl.ghost_who == "A"
