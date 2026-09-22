"""恒定力矩：两条腿各给一个固定值。用来测手感、定方向、给评委"感受一下 1 Nm 是多大"。
按住死人开关才有；仍受软限和斜率限。
"""
from __future__ import annotations
from .base import Controller


class Constant(Controller):
    name = "constant"

    def __init__(self, tl=1.5, tr=1.5):
        super().__init__()
        self.params = {"tl": [tl, -4.0, 4.0], "tr": [tr, -4.0, 4.0]}

    def step(self, frame, gait=None):
        return self.p("tl"), self.p("tr")
