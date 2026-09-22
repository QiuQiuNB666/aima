"""虚拟地形：让腿感受一段不存在的路。

地形 = 一串路段 [(kind, steps)]，kind ∈ flat / up / down / stairs_up / stairs_down。
穿戴者每走一步（步态估计的周期事件）位置前进一步；当前路段决定这一步给什么力：
  up          蹬地相位给伸展助力脉冲（正）——"有人在后面推"，坡越陡越大
  down        摆动末期给屈曲阻力脉冲（负）——"腿被拖住"
  stairs_up   触地相位一个短促的正脉冲——"台阶到了"
  stairs_down 短促负脉冲
  flat        0
脉冲式而不是持续顶：发热小、电量省、人对变化更敏感。正 = 伸展（9/22 数据推断，待穿上验证）。

相位约定：文献以脚跟着地 = 0% 周期。我们的相位估计器 0 = 髋角最大（≈蹬离地），脚跟着地 ≈ 估计器相位 HS_PHASE（默认 0.5，
现场校准：让人走几步，看 IMU 加速度冲击落在估计器相位的哪里）。参数表里的相位全按文献约定写，内部再加 HS_PHASE。
数字依据（调研/设备/髋关节力矩感知阈值与脉冲设计.md）：上坡 = 早支撑髋伸脉冲（Lay 2006、Montgomery 2018）；
脉冲宽 10–20% 周期、梯形；时序 JND ≈2.8% 周期、力矩 Weber 分数 12–19% → "早 5%"、"±0.5 Nm" 可分辨。
下坡用屈曲向制动脉冲是推断（文献只说下坡是膝在吸能）。
"""
from __future__ import annotations
import math
import time

from .base import Controller

HS_PHASE = 0.5   # 脚跟着地在估计器相位里的位置，现场校准后改

PRESETS = {
    "山的记忆": [("flat", 4), ("up", 8), ("stairs_up", 6), ("flat", 3), ("down", 8), ("stairs_down", 4), ("flat", 4)],
    "台阶": [("flat", 3), ("stairs_up", 8), ("flat", 3), ("stairs_down", 8), ("flat", 3)],
    "长坡": [("flat", 3), ("up", 15), ("flat", 3), ("down", 15), ("flat", 3)],
}
GRADE = {"flat": 0.0, "up": 1.0, "down": -1.0, "stairs_up": 1.5, "stairs_down": -1.5}


def _bump(phase_pct, center_pct, width_pct):
    """梯形脉冲：中心平台，两侧线性上升/下降（文献建议梯形，避免方波不连续）。"""
    d = abs((phase_pct - center_pct + 50.0) % 100.0 - 50.0)
    half, ramp = width_pct / 2.0, width_pct / 4.0
    if d <= half - ramp:
        return 1.0
    if d >= half:
        return 0.0
    return (half - d) / ramp


class Terrain(Controller):
    name = "terrain"

    def __init__(self, preset="山的记忆", strength=1.5):
        super().__init__()
        self.params = {
            "strength": [strength, 0.0, 3.0],     # Nm，上坡脉冲峰值（下坡 ×0.8，台阶 ×1.2）
            "t_push":   [11.0, 0.0, 100.0],       # 上坡伸展脉冲中心：早支撑 5–17%（脚跟着地=0%）
            "t_brake":  [10.0, 0.0, 100.0],       # 下坡制动脉冲中心：5–15%
            "t_step":   [6.0, 0.0, 100.0],        # 台阶伸展脉冲：0–12%；摆动期屈曲脉冲固定在 68%
            "width":    [12.0, 6.0, 20.0],        # 脉冲半宽 % 周期（文献 10–20%）
        }
        self.set_preset(preset)
        self._strides = 0
        self.force = None                         # 强制路段（2AFC 校准 / 演示时手动"给他上坡"）

    def set_preset(self, preset):
        self.preset = preset if preset in PRESETS else "山的记忆"
        self.segments = PRESETS[self.preset]
        self.total = sum(n for _, n in self.segments)
        self.pos = 0
        self.laps = 0
        self.lap_t0 = None            # 这一圈第一步的时刻
        self.lap_steps: list = []     # 这一圈每一步相对 lap_t0 的秒数
        self.ghost: list = []         # 上一圈（上一位）的每一步时刻 —— "山的记忆"
        self.ghost_who = ""
        self.best = None              # 最快一圈的秒数
        self.last_lap = None
        self.wearer = "anon"

    def reset(self):
        """换人/演示复位：回到山脚。上一圈留作影子。"""
        self.pos = 0
        self._strides = 0
        self.lap_t0 = None
        self.lap_steps = []

    def segment_at(self, pos):
        if self.force:
            return self.force
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
        if strides < self._strides:                     # 步态估计被重置（换人）
            self._strides = strides
        if strides != self._strides:                    # 一个新的步态周期 = 前进一步
            now = time.monotonic()
            for _ in range(strides - self._strides):
                if self.lap_t0 is None:
                    self.lap_t0 = now
                self.lap_steps.append(now - self.lap_t0)
                self.pos += 1
                if self.pos >= self.total:              # 登顶一圈
                    self.laps += 1
                    self.pos = 0
                    self.last_lap = self.lap_steps[-1]
                    self.best = self.last_lap if self.best is None else min(self.best, self.last_lap)
                    self.ghost, self.ghost_who = self.lap_steps, self.wearer
                    self.lap_steps, self.lap_t0 = [], None
            self._strides = strides
        kind = self.segment_at(self.pos)
        g = GRADE[kind]
        if g == 0.0 or not gait.moving:
            return 0.0, 0.0
        s, w = self.p("strength"), self.p("width")
        lit = lambda ph: ((ph - HS_PHASE) % 1.0) * 100.0     # 估计器相位 → 文献相位（脚跟着地=0%）
        if kind == "up":
            f = lambda ph: s * _bump(lit(ph), self.p("t_push"), w)
        elif kind == "down":
            f = lambda ph: -0.8 * s * _bump(lit(ph), self.p("t_brake"), w)
        elif kind == "stairs_up":                        # 早支撑伸展 + 摆动期屈曲（抬腿更高）
            f = lambda ph: 1.2 * s * _bump(lit(ph), self.p("t_step"), w) - 0.8 * s * _bump(lit(ph), 68.0, w)
        else:                                            # 下台阶：制动脉冲
            f = lambda ph: -1.0 * s * _bump(lit(ph), self.p("t_brake"), w)
        return f(gait.l.phase), f(gait.r.phase)

    def status(self):
        el = (time.monotonic() - self.lap_t0) if self.lap_t0 is not None else 0.0
        ghost_pos = None
        if self.ghost:
            ghost_pos = sum(1 for x in self.ghost if x <= el) if self.lap_t0 is not None else 0
        return {"preset": self.preset, "pos": self.pos, "total": self.total, "laps": self.laps,
                "segment": self.segment_at(self.pos), "force": self.force, "profile": self.profile(),
                "segments": self.segments, "presets": list(PRESETS), "hs_phase": HS_PHASE,
                "elapsed": round(el, 1), "best": self.best, "last_lap": self.last_lap,
                "ghost_pos": ghost_pos, "ghost_who": self.ghost_who}
