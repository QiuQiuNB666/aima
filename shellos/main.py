"""装配：设备(串口/回放) → Guard → 控制律 → 100 Hz 循环 → 手柄/键盘。

  python -m shellos.main                       # 串口，transparent，只读数据
  python -m shellos.main --ctl dofc --cap 2    # DOFC，软限 2 Nm
  python -m shellos.main --replay data/recordings/xxx.csv --ctl dofc
按住 R2（或空格）才有力；× / Esc 急停；○ / R 重新上膛。
"""
from __future__ import annotations
import argparse
import signal
import sys
import time

from .control.base import Transparent
from .control.dofc import DOFC
from .control.phase_profile import PhaseProfile
from .gait.estimator import GaitEstimator
from .device.recorder import Recorder
from .safety.guard import Guard

CTLS = {"transparent": Transparent, "dofc": DOFC, "phase": PhaseProfile}
LOOP_HZ = 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port")
    ap.add_argument("--replay", help="录制 CSV，替代串口")
    ap.add_argument("--ctl", default="transparent", choices=CTLS)
    ap.add_argument("--cap", type=float, default=3.0, help="软限 Nm")
    ap.add_argument("--wearer", default="anon")
    ap.add_argument("--no-record", action="store_true")
    ap.add_argument("--force-deadman", action="store_true",
                    help="回放时没手柄也给力（只允许配合 --replay）")
    a = ap.parse_args()
    if a.force_deadman and not a.replay:
        ap.error("--force-deadman 只允许配合 --replay；真机必须用手柄或键盘")

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

    from .input.gamepad import Gamepad
    from .input.hotkeys import Hotkeys
    pad = Gamepad(guard)
    Hotkeys(guard)
    if a.force_deadman:
        guard.set_deadman(1.0)

    ctl = CTLS[a.ctl]()
    gait = GaitEstimator()
    print(f"[ctl] {ctl.name} {ctl.values()}")

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
    st = None
    while True:
        next_t += period
        f = link.latest()
        if f is not None:
            st = gait.update(f)
            tl, tr = ctl.step(f, st)
            guard.submit(tl, tr, confidence=st.conf if ctl.name == "phase" else 1.0)
        now = time.monotonic()
        if now - last_print > 0.5:
            last_print = now
            gs = guard.state
            fr = (f"L{f.l_deg:6.1f}° R{f.r_deg:6.1f}° φ{st.l.phase:.2f}/{st.r.phase:.2f} "
                  f"conf{st.conf:.2f} {st.cadence:4.0f}spm sym{st.symmetry:.2f}") if st else "no frames"
            print(f"\r[{gs:10s}] pad={'Y' if pad.connected else 'n'} dm={guard.deadman:.2f} "
                  f"sent=({guard.last_sent[0]:+.2f},{guard.last_sent[1]:+.2f}) {guard.last_reason:22s} "
                  f"{fr}  n={link.n_frames} bad={link.n_bad} age={link.stream_age()*1000:5.0f}ms   ",
                  end="", flush=True)
        time.sleep(max(0.0, next_t - time.monotonic()))


if __name__ == "__main__":
    main()
