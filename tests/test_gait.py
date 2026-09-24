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
    from shellos.control.terrain import HS_PHASE    # 峰时按文献相位（脚跟着地 = 0%），估计器相位要加 HS_PHASE
    c = PhaseProfile(peak_ext=2.0, t_ext=30, peak_flex=1.0, t_flex=75, width=10)
    assert abs(c.torque_at((HS_PHASE + 0.30) % 1) - 2.0) < 1e-6
    assert abs(c.torque_at((HS_PHASE + 0.75) % 1) + 1.0) < 1e-6
    assert abs(c.torque_at((HS_PHASE + 0.52) % 1)) < 0.1     # 两峰之间接近 0
    c.set_params({"t_ext": -5})                      # "早一点"
    assert c.p("t_ext") == 25
    assert abs(c.torque_at((HS_PHASE + 0.25) % 1) - 2.0) < 1e-6
    d = PhaseProfile()                               # 缺省和 terrain 同口径：早支撑伸展、摆动期屈曲
    assert d.torque_at((HS_PHASE + 0.11) % 1) > 1.4 and d.torque_at((HS_PHASE + 0.68) % 1) < -0.9
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
    app.on_button(BTN["left"]);  assert app.ctl.p("t_ext") == 6.0         # 11 - 5
    before = app.ctl.name
    app.on_button(BTN["r1"]);    assert app.ctl.name == before             # 9/24 展位：L1/R1 锁定，不再切控制律
    app.on_button(BTN["l1"]);    assert app.ctl.name == before
    app.set_ctl("dofc");         assert app.ctl.name == "dofc"             # 换控制律走仪表盘 / 接口
    app.on_button(BTN["right"]); assert abs(app.ctl.p("delay_s") - 0.16) < 1e-9   # 0.15 + 0.01
    app.on_button(BTN["l1"]);    assert app.ctl.name == "dofc"             # 锁定：仍是 dofc
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
    assert card and card["delta"] == {"t_ext": -5} and app.ctl.p("t_ext") == 6
    app.delete_exp(card["id"])
    assert app.ctl.p("t_ext") == 11            # 回退
    app.enable_exp(card["id"])
    app.set_wearer("judge-02")                 # 换人：参数回缺省
    assert app.ctl.p("t_ext") == 11 and not app.recalled
    for fr in walk(6.0):
        app.gait.update(fr)
    app.auto_recall()
    assert app.recalled and app.applied == [card["id"]] and app.ctl.p("t_ext") == 6   # 步频相近 → 命中
    assert app.store.items[0]["hits"] == 1


def test_terrain_and_puppet():
    from shellos.control.terrain import Terrain
    from shellos.control.puppet import Puppet
    t = Terrain("train_stairs", strength=2.0)
    g = GaitEstimator()
    seen = {}
    for fr in walk(20.0, spm=100):
        st = g.update(fr)
        tl, tr = t.step(fr, st)
        seen.setdefault(t.segment_at(t.pos), []).append(max(abs(tl), abs(tr)))
    assert t.pos > 0 and "stairs_up" in seen and "flat" in seen
    assert max(seen["flat"]) == 0.0                     # 平地不给力
    assert max(seen["stairs_up"]) > 0.5                 # 台阶有脉冲
    assert all(v <= 2.4 + 1e-9 for vs in seen.values() for v in vs)   # 台阶 = 1.2 × strength
    t.force = "up"; assert t.segment_at(99) == "up"      # 强制路段
    p = Puppet(scale=2.0); p.sticks = [0.5, -1.0]
    out = None
    for _ in range(40):                                  # 缓升：40 拍 ≈ 400 ms 才到位
        out = p.step(None)
    assert abs(out[0] - 1.0) < 1e-9 and abs(out[1] + 2.0) < 1e-9
    p.sticks = [0.0, 0.0]; out = p.step(None)
    assert abs(out[0] - 0.93) < 1e-9                    # 松开也是缓降，不是断崖


def test_terrain_lap_and_ghost():
    """走完一圈 → 记用时、留影子；复位后影子按时间前进。"""
    import time as _t
    from shellos.control.terrain import Terrain
    t = Terrain("train_stairs")
    t.wearer = "judge-01"
    g = GaitEstimator()
    for fr in walk(40.0, spm=110):
        st = g.update(fr)
        t.step(fr, st)
        if t.laps:
            break
    assert t.laps == 1 and t.ghost and t.ghost_who == "judge-01" and t.best is not None
    t.reset()
    s = t.status()
    assert s["pos"] == 0 and s["ghost_pos"] == 0          # 还没迈步，影子也在起点


def test_worlds_and_red_light():
    from shellos import worlds
    from shellos.control.terrain import Terrain
    assert {"tokyo_night", "taishan_18pan", "fuji_yoshida", "wutong_haohan"} <= set(worlds.WORLDS)
    for w in worlds.summary():
        assert w["steps"] > 10 and w["alt"][1] >= w["alt"][0]
    t = Terrain("tokyo_night")                  # 第 5–7 步是红灯
    g = GaitEstimator()
    t_sim = 0.0
    frames = list(walk(8.0, spm=110))
    for fr in frames:
        st = g.update(fr); t.step(fr, st)
    assert t.segment_at(t.pos) == "wait"        # 走到红灯前被拦住，不再前进
    stuck = t.pos
    for fr in frames[:200]:
        st = g.update(fr); t.step(fr, st)
    assert t.pos == stuck
    s = t.status()
    assert s["label"] == "十字路口·红灯" and s["next"]["label"] == "斑马线"


# ---------- A 线：步态鲁棒（门限依据见 docs/报告/步态审计.md） ----------
def _audit():
    import importlib.util
    import os
    p = os.path.join(os.path.dirname(__file__), "..", "scripts", "gait_audit.py")
    spec = importlib.util.spec_from_file_location("gait_audit", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _frames(fl, fr, seconds=20.0, rate=200, noise=0.3, seed=1):
    """fl/fr: t → (角度, 角速度)。加噪声的双腿帧。"""
    import random
    rnd = random.Random(seed)
    for i in range(int(seconds * rate)):
        t = i / rate
        (l, ld), (r, rd) = fl(t), fr(t)
        yield Frame(t, i * 5, 0, 0, 0, 0, 0, 0, 0, 0, 1, 101, l + rnd.gauss(0, noise), r + rnd.gauss(0, noise),
                    ld + rnd.gauss(0, noise), rd + rnd.gauss(0, noise))


def _plateau_leg(shift, f=110 / 120.0, amp=15.0):
    """真人那种：伸展端有平台（髋角停住、角速度≈0），没有锁存时相位会在 0/1 分界抖出假绕回。"""
    def leg(t):
        w = 2 * math.pi * f
        s = math.sin(w * t + shift)
        if s > 0.5:
            return amp * 0.5, 0.0
        return amp * s, amp * w * math.cos(w * t + shift)
    return leg


def test_latch_stops_double_count_on_plateau():
    counts = {}
    for latch in (True, False):
        g = GaitEstimator(latch=latch, trace=True)
        for fr in _frames(_plateau_leg(0.0), _plateau_leg(math.pi)):
            g.update(fr)
        counts[latch] = len(g._l.cycles)
    expect = 20.0 * 110 / 120.0                        # ≈18 个周期
    assert abs(counts[True] - expect) <= 3, counts      # 锁存：一步一个候选
    assert counts[False] > counts[True] + 5, counts     # 无锁存：平台上抖出一堆假绕回


def test_in_phase_and_single_leg_rejected():
    """坐下站起 / 弯腰（两腿同相）、单腿晃（另一条腿不动）都不算步。旧门限（无同相检查）会算。"""
    w = 2 * math.pi * 0.8
    swing = lambda t: (20 * math.sin(w * t), 20 * w * math.cos(w * t))
    still = lambda t: (-5.0, 0.0)
    for fl, fr in ((swing, swing), (swing, still)):
        g = GaitEstimator()
        old = GaitEstimator(sync_tol=None, cycle_conf=0.6, stride_min=0.7, stride_max=2.0)
        for f in _frames(fl, fr):
            g.update(f)
            old.update(f)
        assert g.state.l.n_strides + g.state.r.n_strides == 0
        assert old.state.l.n_strides > 5                 # 证明是同相检查拦下的，不是别的门限


def test_stepping_mode_accepts_small_steps():
    """原地踏步 ±6°（活动度 ≈12°）：默认门限全拒（rom≥15），踏步模式接得住；正常走路两种模式都接。"""
    A = _audit()
    small = A.synth(105, 6.0, 30.0, seed=3)
    d, s = A.sim_run(small), A.sim_run(small, stepping=True)
    expect = 27.0 * 105 / 120.0 * 2
    assert d["acc"] == 0
    assert s["acc"] >= 0.85 * expect and s["moving"] > 0.9 and abs(s["cad"] - 105) < 5
    walk_ = A.synth(110, 20.0, 30.0, seed=4)
    assert A.sim_run(walk_)["acc"] >= 0.9 * 27.0 * 110 / 120.0 * 2
    g = GaitEstimator(stepping=True)
    assert g._l.rom_min == 8.0 and g._l.r_ref == 4.0
    assert GaitEstimator(stepping=True, rom_min=10.0)._l.rom_min == 10.0   # 显式参数优先


def test_audit_reference_and_hs_detector():
    """审计脚本自检：反相 = 走路、同相 ≠ 走路；az 冲击放在已知相位，--hs 能找回来；只有一条腿有冲击时判"证据不够"。"""
    A = _audit()
    fr = A.synth(110, 20.0, 30.0, seed=5, hs_phase=0.6)
    walk = A.reference(fr)
    assert walk and sum(b - a for a, b in walk) > 25
    w = 2 * math.pi * 0.8
    same = list(_frames(lambda t: (20 * math.sin(w * t), 0.0), lambda t: (20 * math.sin(w * t), 0.0)))
    assert A.reference(same) == []
    cands, series = A.run(fr, walk)
    rec = {"cands": cands, "series": series, "walk": walk, "walk_s": 30.0, "table": False}
    m, why = A.hs_verdict(A.hs_analysis(rec))
    assert m is not None and abs(m - 0.6) < 0.06, (m, why)
    # 只在左腿相位 0.6 放冲击（= 右腿相位 0.1）：左右对不上 → 不给数
    one = []
    for f in fr:
        ph = (f.ms / 1000.0 * 110 / 120.0) % 1.0
        az = 1.0 + 0.3 * math.exp(-((((ph - 0.25 - 0.6) + 0.5) % 1.0 - 0.5) / 0.02) ** 2)
        one.append(Frame(f.t_host, f.ms, 0, 0, 0, 0, 0, 0, 0, 0, az, 101, f.l_deg, f.r_deg, f.l_dps, f.r_dps))
    cands, series = A.run(one, walk)
    m, why = A.hs_verdict(A.hs_analysis({"cands": cands, "series": series, "walk": walk, "walk_s": 30.0, "table": False}))
    assert m is None, why


def test_posture_change_stops_moving_fast():
    """走路（均值 +10°）后停在比均值更屈的姿态：慢均值撑着 conf，旧版相位钉在 0.5、走动中 6 s+ → 地形持续出力。
    现在相位停滞 → 0.3 s 内走动中为假；两腿同相的慢动作（坐下/站起）也不算走动中。"""
    w = 2 * math.pi * 110 / 120.0

    def leg(shift):
        def f(t):
            if t < 8.0:
                return 10 + 20 * math.sin(w * t + shift), 20 * w * math.cos(w * t + shift)
            return -60.0, 0.0                           # 8 s 起坐着不动
        return f
    slow = lambda t: (-40 + 30 * math.sin(2 * math.pi * 0.4 * t), 30 * 2 * math.pi * 0.4 * math.cos(2 * math.pi * 0.4 * t))
    for stepping in (False, True):                      # 踏步模式 r_ref 更小、conf 更高，停滞/同相两条照样要拦
        g = GaitEstimator(stepping=stepping)
        last_moving = None
        for fr in _frames(leg(0.0), leg(math.pi), seconds=12.0):
            st = g.update(fr)
            if st.moving:
                last_moving = fr.t_host
        assert 7.5 < last_moving < 8.3, (stepping, last_moving)
        g = GaitEstimator(stepping=stepping)
        assert not any(g.update(fr).moving for fr in _frames(slow, slow, seconds=10.0)), stepping
    g = GaitEstimator(inphase_tol=None)
    assert any(g.update(fr).moving for fr in _frames(slow, slow, seconds=10.0))   # 证明是同相检查拦下的


def test_cadence_median_ignores_stop_go_strides():
    """走 4 s 停 1.2 s：跨停顿的周期（≈1.7–2.2 s）也会被接受，均值会把 110 估成 100，中位数不会。"""
    w = 2 * math.pi * 110 / 120.0

    def leg(shift):
        def f(t):
            a = 20.0 if (t % 5.2) < 4.0 else 0.0
            return a * math.sin(w * t + shift), a * w * math.cos(w * t + shift)
        return f
    g = GaitEstimator()
    for fr in _frames(leg(0.0), leg(math.pi), seconds=31.2):
        st = g.update(fr)
    assert max(st.l.strides) > 1.5                     # 确实混进了跨停顿的周期
    assert abs(st.cadence - 110) < 3, st.cadence


def test_symmetry_is_rom_ratio():
    """跛行（左 ±20° / 右 ±9°）：周期比恒 ≈1，活动度比 ≈2.2。"""
    w = 2 * math.pi * 110 / 120.0
    g = GaitEstimator()
    for fr in _frames(lambda t: (20 * math.sin(w * t), 20 * w * math.cos(w * t)),
                      lambda t: (9 * math.sin(w * t + math.pi), 9 * w * math.cos(w * t + math.pi))):
        st = g.update(fr)
    assert st.l.n_strides > 10 and st.r.n_strides > 10
    assert 1.9 < st.symmetry < 2.5, st.symmetry


def test_stepping_mode_longest_output_after_sitting():
    """踏步模式全栈口径（GaitEstimator + Terrain 强制 stairs_up，conf≥0.5）：走 8 s 坐下，最长连续出力 <0.5 s；
    关掉相位停滞/同相检查就是旧 bug（坐下后持续出力 4 s+），证明审计的 longest_output 量得出来。"""
    A = _audit()
    w = 2 * math.pi * 110 / 120.0

    def leg(shift):
        def f(t):
            if t < 8.0:
                return 10 + 20 * math.sin(w * t + shift), 20 * w * math.cos(w * t + shift)
            return -60.0, 0.0
        return f
    fr = list(_frames(leg(0.0), leg(math.pi), seconds=12.0))
    assert A.longest_output(fr, params={"width": 20.0}, stepping=True)[0] < 0.5
    assert A.longest_output(fr, params={"width": 20.0}, stepping=True, prog_min=-1.0, inphase_tol=None)[0] > 2.0
