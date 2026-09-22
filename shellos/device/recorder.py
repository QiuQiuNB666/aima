"""录制：每帧一行、每条发出的力矩一行，同一个 CSV。回放器只读 kind=frame 的行。"""
import os
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

    def frame(self, f: Frame):
        self._fh.write("frame," + f.csv() + ",,\n")
        self.n += 1

    def torque(self, tl: float, tr: float):
        self._fh.write(f"torque,{time.monotonic():.4f}" + ",," * 14 + f",{tl:.3f},{tr:.3f}\n")

    def close(self):
        self._fh.close()
