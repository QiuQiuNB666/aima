"""延迟输出反馈 DOFC：t = gain × 一段时间前的髋角差，不需要步态相位。

τ_L = -gain · s(t-d),  τ_R = +gain · s(t-d),  s = EMA(θ_L - θ_R)/2
符号方向（哪边为正 = 伸展助力）要在真机上验一次：走起来觉得"顶"就把 gain 取负。
三参数：gain (Nm/deg)、delay_s、ema (0–1，越小越平滑)。
参考：Lim et al. 2019 IEEE T-RO；延迟量原文未核到，从 0.15 s 起扫。
"""
from collections import deque

from .base import Controller

RATE = 200  # 数据流频率，用来把 delay_s 换成样本数


class DOFC(Controller):
    name = "dofc"

    def __init__(self, gain=0.05, delay_s=0.15, ema=0.2):
        super().__init__()
        self.params = {
            "gain":    [gain,    -0.15, 0.15],   # Nm/deg；髋角差 ±20° → ±3 Nm
            "delay_s": [delay_s,  0.05, 0.40],
            "ema":     [ema,      0.05, 1.0],
        }
        self.hist: deque[float] = deque(maxlen=RATE)   # 最多 1 s 历史
        self.s = 0.0
        self._last_ms = None

    def step(self, frame, gait=None):
        if frame.ms == self._last_ms:          # 同一帧别重复入历史
            return self._out()
        self._last_ms = frame.ms
        a = self.p("ema")
        self.s = (1 - a) * self.s + a * (frame.l_deg - frame.r_deg) / 2.0
        self.hist.append(self.s)
        return self._out()

    def _out(self):
        n = int(self.p("delay_s") * RATE)
        if len(self.hist) <= n:
            return 0.0, 0.0
        sd = self.hist[-1 - n]
        g = self.p("gain")
        return -g * sd, g * sd
