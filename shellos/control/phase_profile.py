"""相位驱动的力矩曲线：每条腿按自己的相位 φ∈[0,1) 查两个钟形峰。

τ(φ) = peak_ext · bump(φ, t_ext, width) − peak_flex · bump(φ, t_flex, width)
参数单位：峰值 Nm；峰时 % 周期（文献约定，脚跟着地 = 0%，和 terrain 同一口径）；width % 周期（钟形半宽）。
估计器相位 0 = 髋角最大，脚跟着地在 terrain.HS_PHASE，查表前先换算。
"早一点" = t_ext −5；"轻一点" = peak_ext −0.5；"左腿再多点" = 只改左（用 side 参数）。
伸展/屈曲哪个是正号要在真机上验（见 dofc.py 的说明），这里假设正 = 伸展助力。
"""
from __future__ import annotations
import math

from .base import Controller
from . import terrain as _terrain      # HS_PHASE 运行时读，现场校准改了这里也跟着变


def _bump(phase_pct: float, center_pct: float, width_pct: float) -> float:
    d = (phase_pct - center_pct + 50.0) % 100.0 - 50.0      # 环上距离 −50..50
    return math.exp(-(d / max(width_pct, 1.0)) ** 2)


class PhaseProfile(Controller):
    name = "phase_profile"

    def __init__(self, peak_ext=1.5, t_ext=11.0, peak_flex=1.0, t_flex=68.0, width=12.0):
        super().__init__()
        self.params = {
            "peak_ext":  [peak_ext,  0.0, 4.0],
            "t_ext":     [t_ext,     0.0, 100.0],
            "peak_flex": [peak_flex, 0.0, 4.0],
            "t_flex":    [t_flex,    0.0, 100.0],
            "width":     [width,     5.0, 30.0],
            "bias_l":    [0.0,      -1.0, 1.0],    # 左右不对称的微调，Nm
            "bias_r":    [0.0,      -1.0, 1.0],
        }

    def torque_at(self, phase01: float) -> float:
        p = ((phase01 - _terrain.HS_PHASE) % 1.0) * 100.0     # 估计器相位 → 文献相位
        return (self.p("peak_ext") * _bump(p, self.p("t_ext"), self.p("width"))
                - self.p("peak_flex") * _bump(p, self.p("t_flex"), self.p("width")))

    def step(self, frame, gait=None):
        if gait is None:
            return 0.0, 0.0
        tl = self.torque_at(gait.l.phase) + self.p("bias_l")
        tr = self.torque_at(gait.r.phase) + self.p("bias_r")
        return tl, tr
