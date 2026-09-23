"""模拟外骨骼：没有硬件时用。和 SerialLink / ReplayLink 同一个接口。

走路由外部控制：set_walk(True/False)、set_cadence(步/分)。走的时候左右髋角按正弦摆（左右反相），
停下时摆幅在约 0.5 s 内衰减到 0，模拟"站住"。发出去的力矩会让髋角有一点点偏移，让画面上能看出"被推了一下"
（只是视觉反馈，不是动力学模型）。
"""
from __future__ import annotations
import math
import random
import threading
import time
from collections import deque

from .frame import Frame


class SimLink:
    port = "sim"

    def __init__(self, on_frame=None, cadence=100.0, amp=20.0):
        self.frames: deque = deque(maxlen=2000)
        self.on_frame = on_frame
        self.cadence = cadence
        self.amp_target = 0.0
        self.amp_max = amp
        self.amp = 0.0
        self.walking = False
        self.n_frames = 0
        self.n_bad = 0
        self.last_frame_t = 0.0
        self.enabled = True
        self.reboots = 0
        self.replies_seen = {}
        self.last_err = ""
        self.sent: deque = deque(maxlen=200)
        self._torque = (0.0, 0.0)
        self._alive = True
        threading.Thread(target=self._run, name="sim", daemon=True).start()

    def set_walk(self, on: bool):
        self.walking = bool(on)
        self.amp_target = self.amp_max if on else 0.0

    def set_cadence(self, spm: float):
        self.cadence = max(60.0, min(200.0, float(spm)))   # 200：跑步演示（stride_min 0.6 s）

    def _run(self):
        period = 1 / 200
        next_t = time.monotonic()
        ph = 0.0
        ms = 0.0
        while self._alive:
            next_t += period
            t = time.monotonic()
            f = self.cadence / 120.0                      # 周期频率 Hz（一个周期两步）
            ph = (ph + 2 * math.pi * f * period) % (2 * math.pi)
            self.amp += (self.amp_target - self.amp) * 0.02   # ~0.25 s 时间常数
            w = 2 * math.pi * f
            tl, tr = self._torque
            push_l, push_r = tl * 1.5, tr * 1.5            # 力矩 → 几度的视觉偏移
            n = lambda: random.gauss(0, 0.3)
            l = self.amp * math.sin(ph) + push_l + n()
            r = self.amp * math.sin(ph + math.pi) + push_r + n()
            ld = self.amp * w * math.cos(ph) + n()
            rd = self.amp * w * math.cos(ph + math.pi) + n()
            pitch = 4.0 + 3.0 * (self.amp / max(self.amp_max, 1)) * math.sin(2 * ph)
            az = 1.0 + 0.25 * (self.amp / max(self.amp_max, 1)) * max(0.0, math.sin(2 * ph - 0.6)) ** 4
            ms += period * 1000
            fr = Frame(t, ms, pitch, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, az, 101.3, l, r, ld, rd)
            self.frames.append(fr)
            self.n_frames += 1
            self.last_frame_t = t
            if self.on_frame:
                self.on_frame(fr)
            time.sleep(max(0.0, next_t - time.monotonic()))

    def latest(self):
        return self.frames[-1] if self.frames else None

    def stream_age(self):
        return time.monotonic() - self.last_frame_t if self.last_frame_t else float("inf")

    def needs_recovery(self):
        return False

    def recover(self):
        return True

    def send(self, cmd: str):
        self.sent.append(cmd)

    def send_torque(self, tl, tr):
        self._torque = (tl, tr)
        self.sent.append(f"T,{tl:.3f},{tr:.3f}")

    def disable(self):
        self._torque = (0.0, 0.0)
        self.sent.append("DISABLE")

    def handshake(self):
        return "sim"

    def close(self):
        self._alive = False
