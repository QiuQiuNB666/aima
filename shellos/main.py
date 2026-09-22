"""装配：设备(串口/回放) → Guard → 控制律 → 100 Hz 循环 → 手柄/键盘/网页。

  python -m shellos.main                       # 串口，transparent，只读数据
  python -m shellos.main --ctl dofc --cap 2    # DOFC，软限 2 Nm
  python -m shellos.main --replay data/recordings/xxx.csv --ctl phase --force-deadman
仪表盘 http://localhost:8765 。
手柄：按住 R2 才有力（按多深力多大）· × 急停 · ○ 重新上膛 · 方向键上下=第 1 个参数± 左右=第 2 个参数± · L1/R1 切换控制律 · △ 打标记
键盘：空格 / Esc / R；网页：大按钮 / 急停 / 重新上膛。
"""
from __future__ import annotations
import argparse
import signal
import sys
import time
from datetime import datetime

from .control.base import Transparent
from .control.dofc import DOFC
from .control.constant import Constant
from .control.phase_profile import PhaseProfile
from .gait.estimator import GaitEstimator
from .device.recorder import Recorder
from .safety.guard import Guard

CTLS = {"transparent": Transparent, "constant": Constant, "dofc": DOFC, "phase": PhaseProfile}
LOOP_HZ = 100


class App:
    """仪表盘和 Agent 层看到的东西都挂在这上面。"""

    def __init__(self, link, guard, ctl_name):
        self.link, self.guard = link, guard
        self.ctls = CTLS
        self.ctl = CTLS[ctl_name]()
        self.gait = GaitEstimator()
        self.events: list = []
        self.loop_ms = 0

    def set_ctl(self, name):
        self.ctl = CTLS[name]()          # 新控制律从 0 起，Guard 的斜率限负责平滑

    @staticmethod
    def _step(lo, hi):
        r = hi - lo
        return 5 if r >= 50 else 0.5 if r >= 3 else 0.1 if r >= 1 else 0.01

    def nudge(self, index, sign):
        """调第 index 个参数一档。手柄：上下调第 0 个（一般是峰值/增益），左右调第 1 个（峰时/延迟）。"""
        names = list(self.ctl.params)
        if index >= len(names):
            return
        k = names[index]
        _, lo, hi = self.ctl.params[k]
        out = self.ctl.set_params({k: sign * self._step(lo, hi)})
        self.log(f"手柄 {k} {'+' if sign > 0 else '-'} → {out[k]:g}")

    def cycle_ctl(self, d):
        keys = list(CTLS)
        cur = next((i for i, c in enumerate(CTLS.values()) if isinstance(self.ctl, c)), 0)
        name = keys[(cur + d) % len(keys)]
        self.set_ctl(name)
        self.log(f"手柄切换控制律 → {name}")

    def on_button(self, b):
        from .input.gamepad import BTN
        if b == BTN["up"]:      self.nudge(0, +1)
        elif b == BTN["down"]:  self.nudge(0, -1)
        elif b == BTN["right"]: self.nudge(1, +1)
        elif b == BTN["left"]:  self.nudge(1, -1)
        elif b == BTN["r1"]:    self.cycle_ctl(+1)
        elif b == BTN["l1"]:    self.cycle_ctl(-1)
        elif b == BTN["triangle"]: self.log("△ 标记：评委反馈点")

    def log(self, text):
        self.events.append({"t": datetime.now().strftime("%H:%M:%S"), "text": text})
        print(f"\n[{self.events[-1]['t']}] {text}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port")
    ap.add_argument("--replay", help="录制 CSV，替代串口")
    ap.add_argument("--ctl", default="transparent", choices=CTLS)
    ap.add_argument("--cap", type=float, default=3.0, help="软限 Nm")
    ap.add_argument("--wearer", default="anon")
    ap.add_argument("--no-record", action="store_true")
    ap.add_argument("--no-input", action="store_true", help="不起手柄/键盘线程（诊断用）")
    ap.add_argument("--http", type=int, default=8765, help="仪表盘端口，0 = 不起")
    ap.add_argument("--force-deadman", action="store_true",
                    help="回放时没手柄也给力（只允许配合 --replay）")
    a = ap.parse_args()
    if a.force_deadman and not a.replay:
        ap.error("--force-deadman 只允许配合 --replay；真机必须用手柄/键盘/网页按钮")

    rec = None if a.no_record else Recorder(a.wearer)
    on_frame = rec.frame if rec else None
    if a.replay:
        from .device.replay import ReplayLink
        link = ReplayLink(a.replay, on_frame=on_frame)
    else:
        from .device.serial_link import SerialLink
        link = SerialLink(a.port, on_frame=on_frame)
    print(f"[link] {link.port}")

    guard = Guard(link, soft_cap=a.cap, on_sent=(rec.torque if rec else None))
    ver = link.handshake()
    guard.arm()
    print(f"[handshake] firmware {ver}  state {guard.state}  cap {guard.soft_cap} Nm")

    app = App(link, guard, a.ctl)
    app.log(f"启动：{link.port} 固件 {ver}，控制律 {a.ctl}，软限 {a.cap} Nm")

    pad = None
    if not a.no_input:
        from .input.gamepad import Gamepad
        from .input.hotkeys import Hotkeys
        pad = Gamepad(guard, on_button=app.on_button)
        app.pad = pad
        Hotkeys(guard)
    if a.force_deadman:
        guard.set_deadman(1.0, "forced")
    if a.http:
        from .ui.server import Dashboard
        Dashboard(app, a.http)
        print(f"[ui] http://localhost:{a.http}")

    def stop(*_):
        guard.shutdown()
        link.close()
        if rec:
            rec.close()
            print(f"\n[rec] {rec.path} ({rec.n} frames)")
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    period = 1.0 / LOOP_HZ
    next_t = time.monotonic()
    last_print = 0.0
    last_recover = 0.0
    seen_reboots = 0
    st = None
    max_gap = 0.0
    prev_t = time.monotonic()
    while True:
        next_t += period
        now0 = time.monotonic()
        max_gap = max(max_gap, now0 - prev_t)
        prev_t = now0
        f = link.latest()
        if f is not None:
            st = app.gait.update(f)
            ctl = app.ctl
            tl, tr = ctl.step(f, st)
            guard.submit(tl, tr, confidence=st.conf if ctl.name == "phase" else 1.0)
        now = time.monotonic()
        if (not a.replay and now - last_recover > 2.0 and guard.state in ("ARMED", "ACTIVE")
                and link.needs_recovery()):
            last_recover = now
            if link.reboots != seen_reboots:
                seen_reboots = link.reboots
                app.log(f"设备复位了（第 {link.reboots} 次）——重新 ENABLE")
            ok = link.recover()
            guard.arm()                      # 力矩从 0 重新爬
            app.log("重新 ENABLE " + ("成功" if ok else "失败，2 秒后再试"))
        if now - last_print > 0.5:
            last_print = now
            app.loop_ms, max_gap = round(max_gap * 1000), 0.0
            gs = guard.state
            fr = (f"L{f.l_deg:6.1f}° R{f.r_deg:6.1f}° φ{st.l.phase:.2f}/{st.r.phase:.2f} "
                  f"conf{st.conf:.2f} {st.cadence:4.0f}spm sym{st.symmetry:.2f}") if st else "no frames"
            pc = 'Y' if (pad and pad.connected) else 'n'
            print(f"\r[{gs:10s}] pad={pc} dm={guard.deadman:.2f} "
                  f"sent=({guard.last_sent[0]:+.2f},{guard.last_sent[1]:+.2f}) {guard.last_reason:22s} "
                  f"{fr}  n={link.n_frames} bad={link.n_bad} age={link.stream_age()*1000:5.0f}ms loop{app.loop_ms:4d}ms   ",
                  end="", flush=True)
        time.sleep(max(0.0, next_t - time.monotonic()))


if __name__ == "__main__":
    main()
