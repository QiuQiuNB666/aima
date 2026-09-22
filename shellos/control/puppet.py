"""Ghost 操控 Shell：手柄摇杆直接驱动两条腿。

左摇杆上下 → 左腿力矩，右摇杆上下 → 右腿力矩（推上去 = 伸展 = 正）。
R2 仍是死人开关：不按住摇杆再推也没力。评委拿手柄，队友穿——"义体被接管"。
摇杆值由 Gamepad 线程写进 self.sticks（-1..1），没有手柄就永远 0。
"""
from __future__ import annotations
from .base import Controller


class Puppet(Controller):
    name = "puppet"

    def __init__(self, scale=2.0):
        super().__init__()
        self.params = {"scale": [scale, 0.0, 4.0]}   # 摇杆推到底 = 多少 Nm
        self.sticks = [0.0, 0.0]                      # (left_y, right_y)，上为正
        self.out = [0.0, 0.0]
        self.ramp = 0.07                              # Nm/拍 @100 Hz ≈ 7 Nm/s：2 Nm 用 300 ms 爬到（调研建议 ≥300 ms）

    def step(self, frame, gait=None):
        s = self.p("scale")
        for i in range(2):
            want = s * self.sticks[i]
            d = max(-self.ramp, min(self.ramp, want - self.out[i]))
            self.out[i] += d
        return self.out[0], self.out[1]
