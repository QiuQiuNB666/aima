"""录制：每帧一行、每条发出的力矩一行，同一个 CSV。回放器只读 kind=frame 的行。"""
from __future__ import annotations
import os
import threading
import time
from datetime import datetime

from .frame import Frame, CSV_HEADER


class Recorder:
    def __init__(self, wearer: str = "anon", root: str = "data/recordings"):
        os.makedirs(root, exist_ok=True)
        stamp = datetime.now().strftime("%m%d-%H%M%S")
        self.path = os.path.join(root, f"{stamp}-{wearer}.csv")
        self._fh = open(self.path, "w", buffering=1 << 16)
        self._fh.write("kind," + CSV_HEADER + ",tl,tr\n")
        self.n = 0
        self._lock = threading.Lock()   # frame() 在设备线程，torque() 在控制/看门狗线程：不锁会两行粘在一起
        self._marks = open(self.path.replace(".csv", ".marks.csv"), "w", buffering=1)
        self._marks.write("t_host,label\n")

    def frame(self, f: Frame):
        line = "frame," + f.csv() + ",,\n"
        with self._lock:
            self._fh.write(line)
            self.n += 1

    def torque(self, tl: float, tr: float):
        line = f"torque,{time.monotonic():.4f}" + "," * 15 + f",{tl:.3f},{tr:.3f}\n"   # t_host + 15 个空帧字段 + tl,tr
        with self._lock:
            self._fh.write(line)

    def mark(self, label: str):
        self._marks.write(f"{time.monotonic():.4f},{label.replace(',', ';')}\n")

    def close(self):
        with self._lock:
            self._fh.close()
        self._marks.close()
