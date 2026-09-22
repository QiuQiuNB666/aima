"""第一次插上外骨骼跑这个：PING → VERSION → ENABLE → 看 3 秒数据 → (可选) 小力矩 2 秒 → DISABLE。

  .venv/bin/python scripts/probe.py            # 只读
  .venv/bin/python scripts/probe.py --torque 0.5   # 再发 T,0.5,0.5 两秒，感受方向
任何异常都会先发 DISABLE 再退出。
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellos.device.serial_link import SerialLink  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--port")
ap.add_argument("--torque", type=float, default=0.0, help="Nm，0 = 不发力")
ap.add_argument("--seconds", type=float, default=3.0)
a = ap.parse_args()

link = SerialLink(a.port)
print(f"port {link.port}")
try:
    ver = link.handshake()
    print(f"firmware {ver}  ENABLE ok")
    t0 = time.monotonic()
    n0 = link.n_frames
    while time.monotonic() - t0 < a.seconds:
        time.sleep(0.5)
        f = link.latest()
        if f:
            print(f"  ms={f.ms:.0f} pitch={f.pitch:7.2f} L={f.l_deg:7.2f} R={f.r_deg:7.2f} "
                  f"Ldps={f.l_dps:7.1f} Rdps={f.r_dps:7.1f} kPa={f.kpa:.1f}")
    rate = (link.n_frames - n0) / a.seconds
    print(f"stream {rate:.0f} Hz  (期望 200)  bad lines {link.n_bad}")
    if a.torque:
        t = min(abs(a.torque), 2.0)
        print(f"T,{t},{t} for 2 s — 感受方向：正值是伸展还是屈曲？记下来")
        t0 = time.monotonic()
        while time.monotonic() - t0 < 2.0:
            link.send_torque(t, t)
            time.sleep(0.02)
        print(f"reply: {link.wait_reply('OK,T', 0.5)}")
finally:
    link.close()
    print("DISABLE sent, closed")
