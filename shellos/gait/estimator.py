"""步态估计：极角相位 + 步频 + 对称性 + 活动度。每帧 update()，输出 GaitState。

相位（每条腿）：φ = atan2(k·ω, θ − θ̄) ∈ [0, 1)，k 自适应到让相图接近圆。
置信度：相图半径 / 参考半径，站着不动半径塌缩 → 置信度 0 → Guard 把力矩归零。
事件：φ 绕回一圈 = 一个步态周期(stride)；步频 = 2 × 60 / stride 时间（一个周期两步）。
"""
from __future__ import annotations
import math
from collections import deque
from dataclasses import dataclass, field

from ..device.frame import Frame


@dataclass
class LegState:
    phase: float = 0.0        # 0..1
    conf: float = 0.0         # 0..1
    theta_f: float = 0.0      # 滤波后髋角
    omega_f: float = 0.0      # 滤波后角速度
    mean: float = 0.0         # 慢均值
    rom: float = 0.0          # 最近一个周期的活动度 °
    stride_s: float = 0.0     # 最近一个周期时长 s
    strides: deque = field(default_factory=lambda: deque(maxlen=12))
    n_strides: int = 0


@dataclass
class GaitState:
    l: LegState = field(default_factory=LegState)
    r: LegState = field(default_factory=LegState)
    cadence: float = 0.0      # 步/分
    symmetry: float = 1.0     # 左周期 / 右周期
    variability: float = 0.0  # 周期时长变异系数
    moving: bool = False

    @property
    def conf(self):
        return min(self.l.conf, self.r.conf)


class _Leg:
    def __init__(self, ema=0.3, mean_ema=0.005, r_ref=8.0):
        self.s = LegState()
        self.ema, self.mean_ema, self.r_ref = ema, mean_ema, r_ref
        self.amp_t = 10.0   # 髋角摆幅估计
        self.amp_w = 60.0   # 角速度摆幅估计
        self._prev_phase = None
        self._t_wrap = None
        self._mn = self._mx = None

    def update(self, theta: float, omega: float, t: float) -> LegState:
        s = self.s
        a = self.ema
        s.theta_f = (1 - a) * s.theta_f + a * theta
        s.omega_f = (1 - a) * s.omega_f + a * omega
        s.mean = (1 - self.mean_ema) * s.mean + self.mean_ema * s.theta_f
        d = s.theta_f - s.mean
        # 摆幅跟踪（慢），用来把相图拉圆
        self.amp_t = max(0.5, 0.995 * self.amp_t + 0.005 * abs(d) * 1.57)
        self.amp_w = max(5.0, 0.995 * self.amp_w + 0.005 * abs(s.omega_f) * 1.57)
        k = self.amp_t / self.amp_w
        r = math.hypot(d, k * s.omega_f)
        s.conf = max(0.0, min(1.0, r / self.r_ref))
        phase = (math.atan2(-k * s.omega_f, d) / (2 * math.pi)) % 1.0   # 负号让相位随时间递增
        # 事件：绕回
        if self._prev_phase is not None and phase < 0.25 and self._prev_phase > 0.75 and s.conf > 0.5:
            if self._t_wrap is not None:
                stride = t - self._t_wrap
                if 0.4 < stride < 3.0:
                    s.stride_s = stride
                    s.strides.append(stride)
                    s.n_strides += 1
                    if self._mn is not None:
                        s.rom = self._mx - self._mn
            self._t_wrap = t
            self._mn = self._mx = s.theta_f
        if self._mn is not None:
            self._mn = min(self._mn, s.theta_f)
            self._mx = max(self._mx, s.theta_f)
        self._prev_phase = phase
        s.phase = phase
        return s


class GaitEstimator:
    def __init__(self, **kw):
        self._l, self._r = _Leg(**kw), _Leg(**kw)
        self.state = GaitState(l=self._l.s, r=self._r.s)
        self._last_ms = None

    def update(self, f: Frame) -> GaitState:
        st = self.state
        if f.ms == self._last_ms:
            return st
        self._last_ms = f.ms
        self._l.update(f.l_deg, f.l_dps, f.t_host)
        self._r.update(f.r_deg, f.r_dps, f.t_host)
        strides = list(st.l.strides) + list(st.r.strides)
        if strides:
            mean = sum(strides) / len(strides)
            st.cadence = 120.0 / mean
            if len(strides) > 2:
                var = sum((x - mean) ** 2 for x in strides) / (len(strides) - 1)
                st.variability = math.sqrt(var) / mean
        if st.l.strides and st.r.strides:
            ml = sum(st.l.strides) / len(st.l.strides)
            mr = sum(st.r.strides) / len(st.r.strides)
            st.symmetry = ml / mr if mr else 1.0
        st.moving = st.conf > 0.5
        return st
