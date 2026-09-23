"""故障注入：ReplayLink(faults=...) + 真 Guard + 跟 main.py 同样的恢复逻辑。跑：.venv/bin/pytest -q tests/test_fault.py

每条都用真实时间跑 2–4 s。验收口径（架构 v3 §3 F 线）：故障结束后 2 s 内回到 ARMED/ACTIVE 且设备重新出力；
断流/坏帧期间力矩归零；恢复后力矩从 0 按斜率限爬；急停 / 看门狗 DISARMED 之后只有 rearm 能恢复。
"""
from __future__ import annotations
import math
import time

import pytest

from shellos.device.frame import CSV_HEADER
from shellos.device.replay import ReplayLink, parse_faults
from shellos.main import recover_tick
from shellos.safety.guard import Guard, ARMED, ACTIVE, DISARMED

WANT = 1.0          # 控制律每拍要的力矩
SLEW = 0.5          # Guard 缺省斜率限（每拍）


def make_csv(path, n=2000, glued=0):
    """recorder 格式：正弦走路；glued 行模拟录制时两帧粘在一行。"""
    lines = ["kind," + CSV_HEADER + ",tl,tr"]
    for i in range(n):
        ph = 2 * math.pi * i / 220
        l, r = 20 * math.sin(ph), -20 * math.sin(ph)
        vals = [i * 0.005, i * 5.0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 101.3, l, r, 100 * math.cos(ph), -100 * math.cos(ph)]
        lines.append("frame," + ",".join(f"{v:.4f}" for v in vals) + ",,")
        if i < glued:
            lines.append("frame,1.0,2.0,-0.30frame,3,4,5,6,7,8,9,10,11,12,13,14,15,,")
    lines.append("torque,1.0" + ",," * 14 + ",0.5,0.5")
    path.write_text("\n".join(lines) + "\n")
    return str(path)


@pytest.fixture
def csv_path(tmp_path):
    return make_csv(tmp_path / "rec.csv")


def rig(csv_path, faults):
    link = ReplayLink(csv_path, faults=faults)
    guard = Guard(link)
    link.handshake()
    assert guard.arm()
    guard.set_deadman(1.0, "forced")
    return link, guard


def drive(link, guard, secs, at=None):
    """main.py 主循环的同一顺序：latest → submit → recover_tick（main.py 同一个函数）。
    at = {相对秒: 回调}，用来在某时刻急停 / rearm。返回每拍采样。"""
    at = dict(at or {})
    out, rs = [], {"last": 0.0, "reboots": 0}
    end = link.t0 + secs
    while time.monotonic() < end:
        f = link.latest()
        if f is not None:
            guard.submit(WANT, WANT)
        now = time.monotonic()
        recover_tick(link, guard, now, rs, log=lambda _: None)
        rel = now - link.t0
        for k in [k for k in at if k <= rel]:
            at.pop(k)(guard)
        out.append((rel, guard.state, guard.last_sent[0], link.applied()[0], link.enabled, link.stream_age()))
        time.sleep(0.01)
    return out


def ok(s):
    """恢复 = Guard 在 ARMED/ACTIVE、设备使能、数据流新鲜、腿上真的有力。"""
    rel, state, sent, applied, enabled, age = s
    return state in (ARMED, ACTIVE) and enabled and age < 0.2 and applied > 0


def recovered_at(samples, after):
    return next((s[0] for s in samples if s[0] >= after and ok(s)), None)


def assert_slew_ok(samples):
    """任何一拍力矩上升都不超过斜率限：恢复后从 0 重新爬，不会一下跳回原值。"""
    for a, b in zip(samples, samples[1:]):
        assert b[2] - a[2] <= SLEW + 1e-6, (a, b)


def test_parse_faults():
    assert parse_faults("noten@2, gap@1:3") == [(1.0, "gap", 3.0), (2.0, "noten", 0.0)]
    assert parse_faults("") == []
    with pytest.raises(ValueError):
        parse_faults("boom@1")


def test_glued_csv_rows_skipped(tmp_path):
    link = ReplayLink(make_csv(tmp_path / "g.csv", n=300, glued=3), faults="")
    assert len(link.rows) == 300 and link.n_bad == 3       # 181327 那种粘行：跳过计数，不再抛 ValueError
    link.close()


def test_env_var_faults(csv_path, monkeypatch):
    monkeypatch.setenv("SHELLOS_FAULTS", "gap@5:1")
    link = ReplayLink(csv_path)
    assert link.faults == [(5.0, "gap", 1.0)]
    link.close()


def test_baseline_no_fault(csv_path):
    link, guard = rig(csv_path, "")
    s = drive(link, guard, 1.0)
    assert all(x[1] != DISARMED for x in s) and s[-1][2] == WANT and s[-1][3] == WANT
    assert_slew_ok(s)


def test_not_enabled_recovers(csv_path):
    link, guard = rig(csv_path, "noten@0.5")
    s = drive(link, guard, 2.0)
    t = recovered_at(s, 0.55)
    assert t is not None and t - 0.5 < 2.0
    assert link.replies_seen.get("ERR,NOT_ENABLED", 0) >= 1 and link.enabled
    assert "ENABLE" in list(link.sent)[1:]                  # 主机重新 ENABLE 过
    assert_slew_ok(s)
    assert s[-1][3] == WANT


def test_reboot_recovers(csv_path):
    link, guard = rig(csv_path, "reboot@0.5:0.5")
    s = drive(link, guard, 3.0)
    assert link.reboots == 1
    silent = [x for x in s if 0.75 <= x[0] < 1.0]
    assert silent and all(x[2] == 0.0 and x[3] == 0.0 for x in silent)   # 复位静默：主机侧 >200 ms 断流归零
    t = recovered_at(s, 1.0)
    assert t is not None and t - 1.0 < 2.0
    assert_slew_ok(s)


def test_gap_zeroes_then_recovers(csv_path):
    link, guard = rig(csv_path, "gap@0.5:1.5")
    s = drive(link, guard, 3.5)
    gap = [x for x in s if 0.5 + 0.2 + 0.03 <= x[0] < 2.0]
    assert gap and all(x[2] == 0.0 and x[3] == 0.0 for x in gap)        # 断流 200 ms 后力矩归零，并且一直是 0
    assert all(x[1] != DISARMED for x in s)                              # 断流不 DISABLE，线回来直接恢复
    t = recovered_at(s, 2.0)
    assert t is not None and t - 2.0 < 2.0
    assert_slew_ok(s)


def test_bad_frames_zero_then_recover(csv_path):
    link, guard = rig(csv_path, "bad@0.5:0.5")
    s = drive(link, guard, 2.0)
    assert link.n_bad >= 50
    mid = [x for x in s if 0.75 <= x[0] < 1.0]
    assert mid and all(x[2] == 0.0 for x in mid)
    t = recovered_at(s, 1.0)
    assert t is not None and t - 1.0 < 2.0
    assert_slew_ok(s)


def test_host_stall_short_zeroes_no_disarm(csv_path):
    zeros = []
    link, guard = rig(csv_path, "stall@0.5:0.3")
    guard.on_sent = lambda a, b: zeros.append(time.monotonic() - link.t0) if a == 0 and b == 0 else None
    s = drive(link, guard, 1.5)
    assert any(0.55 < z < 0.75 for z in zeros)             # 看门狗在卡顿期间把力矩清零
    assert all(x[1] != DISARMED for x in s)
    assert recovered_at(s, 0.8) is not None
    assert_slew_ok(s)


def test_host_stall_long_disarms_and_needs_rearm(csv_path):
    link, guard = rig(csv_path, "stall@0.5:1.2,reboot@2.0:0.2")
    s = drive(link, guard, 3.5, at={3.0: lambda g: g.rearm()})
    dis = [x for x in s if 1.7 <= x[0] < 3.0]
    assert dis and all(x[1] == DISARMED and x[3] == 0.0 for x in dis)   # 设备复位 + 恢复逻辑也不会把它拉回来
    assert guard.state in (ARMED, ACTIVE) and s[-1][3] > 0              # 只有 rearm 能恢复
    assert_slew_ok(s)


def test_estop_survives_device_reset(csv_path):
    link, guard = rig(csv_path, "reboot@1.0:0.3,noten@2.0")
    s = drive(link, guard, 3.0, at={0.5: lambda g: g.trigger_estop("test")})
    after = [x for x in s if x[0] >= 0.55]
    assert after and all(x[1] == DISARMED and x[3] == 0.0 for x in after)
    assert guard.arm() is False and guard.state == DISARMED             # arm() 不能绕过急停
    assert guard.rearm() and guard.state == ARMED


def test_shutdown_inside_submit_does_not_deadlock():
    """Ctrl-C / SIGTERM 的处理函数在主线程里跑 guard.shutdown()；如果正好打断了 submit（持有锁），
    以前是 Lock → 死锁，进程挂住、DISABLE 发不出去（实测 12 次 SIGTERM 挂 1 次）。"""
    from tests.test_guard import armed_guard
    g, link = armed_guard()
    g.submit(1.0, 1.0)
    with g._lock:                      # 模拟信号打断在 submit 里面
        g.shutdown()
    assert g.state == DISARMED and link.sent[-1] == "DISABLE"


def _stress():
    import importlib.util
    import pathlib
    p = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "stress.py"
    spec = importlib.util.spec_from_file_location("stress", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_stress_summarize_flags_disarm_and_traceback():
    s = _stress()
    good = [(0.0, "ARMED", "ok", 14), (0.1, "ACTIVE", "ok", 15)]
    assert s.summarize("x.csv", good, {}, "", 0, False, 0.3)["ok"]
    r = s.summarize("x.csv", good + [(0.2, "DISARMED", "watchdog", 300)], {}, "", 0, True, 0.3)
    assert not r["ok"] and r["disarms"] == 1 and r["loop_max"] == 300
    assert not s.summarize("x.csv", good, {}, "Traceback (most recent call last)", 1, False, 0.3)["ok"]
    assert not s.summarize("x.csv", [], None, "", 1, False, 30.0)["ok"]          # 起不来


def test_stress_stack_end_to_end():
    """scripts/stress.py 真的起 main --replay 子进程、读 /state、正常退出。"""
    import json
    import pathlib
    import subprocess
    import sys
    root = pathlib.Path(__file__).resolve().parent.parent
    p = subprocess.run([sys.executable, "scripts/stress.py", "stack", "--secs", "2",
                        "data/recordings/synthetic-walk.csv"], cwd=root, capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stdout + p.stderr
    r = json.loads(p.stdout.splitlines()[0])
    assert r["ok"] and r["loop_med"] is not None


def test_serial_link_starts_without_device(monkeypatch):
    """外骨骼没插也要能起 ShellOS（仪表盘先起来）：不抛异常、写是空操作、握手返回「未连接」。"""
    from shellos.device import serial_link as SL
    monkeypatch.setattr(SL, "find_port", lambda: (_ for _ in ()).throw(RuntimeError("没找到串口")))
    link = SL.SerialLink(None)
    try:
        assert link.ser is None and link.port == "(未连接)"
        link.send_torque(1.0, 1.0)                     # 不抛
        assert link.replies_seen.get("SEND_FAIL", 0) >= 1 and not link.enabled
        assert link.handshake() == "未连接"
        assert link.needs_recovery()
    finally:
        link._alive = False
