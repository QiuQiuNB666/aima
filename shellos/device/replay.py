"""回放器：读 recorder 写的 CSV，按 200 Hz 吐帧。接口和 SerialLink 一样，send 只记日志。没设备时用它。"""
from __future__ import annotations
import csv
import threading
import time
from collections import deque

from .frame import Frame, FIELDS
from .convention import R_SIGN


class ReplayLink:
    port = "replay"

    def __init__(self, path: str, on_frame=None, speed: float = 1.0, loop: bool = True):
        self.rows = []
        with open(path, newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("kind", "frame") != "frame":
                    continue
                self.rows.append([float(r[k]) for k in FIELDS])
        if not self.rows:
            raise RuntimeError(f"{path} 里没有帧")
        self.frames: deque[Frame] = deque(maxlen=2000)
        self.sent: list[str] = []
        self.on_frame = on_frame
        self.speed, self.loop = speed, loop
        self.n_frames = 0
        self.n_bad = 0
        self.last_frame_t = 0.0
        self._alive = True
        threading.Thread(target=self._play, name="replay", daemon=True).start()

    def _play(self):
        period = 0.005 / self.speed
        next_t = time.monotonic()
        while self._alive:
            for row in self.rows:
                if not self._alive:
                    return
                next_t += period
                t = time.monotonic()
                f = Frame(t, *row)
                self.frames.append(f)
                self.n_frames += 1
                self.last_frame_t = t
                if self.on_frame:
                    self.on_frame(f)
                time.sleep(max(0.0, next_t - time.monotonic()))
            if not self.loop:
                return

    def latest(self):
        return self.frames[-1] if self.frames else None

    def stream_age(self):
        return time.monotonic() - self.last_frame_t if self.last_frame_t else float("inf")

    def send(self, cmd: str):
        self.sent.append(cmd)

    def send_torque(self, tl, tr):
        self.send(f"T,{tl:.3f},{tr * R_SIGN:.3f}")

    def disable(self):
        self.send("DISABLE")

    def handshake(self):
        return "replay"

    def close(self):
        self._alive = False
