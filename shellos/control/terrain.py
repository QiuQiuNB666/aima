"""虚拟地形：让腿感受一段不存在的路。

地形 = 一串路段 [(kind, steps)]，kind ∈ flat / up / down / stairs_up / stairs_down。
穿戴者每走一步（步态估计的周期事件）位置前进一步；当前路段决定这一步给什么力：
  up          蹬地相位给伸展助力脉冲（正）——"有人在后面推"，坡越陡越大
  down        摆动末期给屈曲阻力脉冲（负）——"腿被拖住"
  stairs_up   触地相位一个短促的正脉冲——"台阶到了"
  stairs_down 短促负脉冲
  flat        0
脉冲式而不是持续顶：发热小、电量省、人对变化更敏感。正 = 伸展（9/22 数据推断，待穿上验证）。
"""
from __future__ import annotations
import math

from .base import Controller

PRESETS = {
    "山的记忆": [("flat", 4), ("up", 8), ("stairs_up", 6), ("flat", 3), ("down", 8), ("stairs_down", 4), ("flat", 4)],
    "台阶": [("flat", 3), ("stairs_up", 8), ("flat", 3), ("stairs_down", 8), ("flat", 3)],
    "长坡": [("flat", 3), ("up", 15), ("flat", 3), ("down", 15), ("flat", 3)],
}
GRADE = {"flat": 0.0, "up": 1.0, "down": -1.0, "stairs_up": 1.5, "stairs_down": -1.5}


def _bump(phase_pct, center_pct, width_pct):
    d = (phase_pct - center_pct + 50.0) % 100.0 - 50.0
    return math.exp(-(d / max(width_pct, 1.0)) ** 2)


class Terrain(Controller):
    name = "terrain"

    def __init__(self, preset="山的记忆", strength=1.5):
        super().__init__()
        self.params = {
            "strength": [strength, 0.0, 4.0],     # Nm，坡度 1.0 对应的峰值
            "t_push":   [30.0, 0.0, 100.0],       # 上坡助力脉冲的相位（% 周期）
            "t_brake":  [75.0, 0.0, 100.0],       # 下坡阻力脉冲的相位
            "t_step":   [5.0, 0.0, 100.0],        # 台阶"敲一下"的相位
            "width":    [10.0, 4.0, 30.0],
        }
        self.set_preset(preset)
        self._strides = 0

    def set_preset(self, preset):
        self.preset = preset if preset in PRESETS else "山的记忆"
        self.segments = PRESETS[self.preset]
        self.total = sum(n for _, n in self.segments)
        self.pos = 0
        self.laps = 0

    def reset(self):
        self.pos = 0
        self._strides = 0

    def segment_at(self, pos):
        p = pos % self.total
        for kind, n in self.segments:
            if p < n:
                return kind
            p -= n
        return "flat"

    def profile(self):
        """给界面画剖面：每一步的累计高度。"""
        h, out = 0.0, []
        for kind, n in self.segments:
            for _ in range(n):
                out.append({"kind": kind, "h": h})
                h += GRADE[kind] * 0.15
        return out

    def step(self, frame, gait=None):
        if gait is None:
            return 0.0, 0.0
        strides = gait.l.n_strides + gait.r.n_strides
        if strides != self._strides:                    # 一个新的步态周期 = 前进一步
            self.pos += strides - self._strides
            self._strides = strides
            if self.pos >= self.total:
                self.laps += self.pos // self.total
                self.pos %= self.total
        kind = self.segment_at(self.pos)
        g = GRADE[kind]
        if g == 0.0 or not gait.moving:
            return 0.0, 0.0
        s, w = self.p("strength"), self.p("width")
        if kind == "up":
            f = lambda ph: s * g * _bump(ph * 100, self.p("t_push"), w)
        elif kind == "down":
            f = lambda ph: s * g * _bump(ph * 100, self.p("t_brake"), w)
        else:                                            # 台阶：短促
            f = lambda ph: s * (g / 1.5) * _bump(ph * 100, self.p("t_step"), w * 0.5)
        return f(gait.l.phase), f(gait.r.phase)

    def status(self):
        return {"preset": self.preset, "pos": self.pos, "total": self.total, "laps": self.laps,
                "segment": self.segment_at(self.pos), "profile": self.profile(), "presets": list(PRESETS)}
