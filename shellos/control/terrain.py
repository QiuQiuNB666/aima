"""虚拟地形：让腿感受一段不存在的路。路线来自 shellos/worlds/*.json（和登山游戏共用）。

穿戴者每走一步（步态估计接受的一个周期）位置前进一步；当前路段决定这一步给什么力：
  up          早支撑伸展脉冲——"有人在后面推"
  down        早支撑制动脉冲——"腿被拖住"（推断）
  stairs_up   阻力：支撑期往屈曲拉——"腿发沉、一级一级费劲蹬"（9/23 球球真机反馈：上楼要阻力）。
              摆动期不压腿：抬腿时往下压会让脚尖勾台阶（pulse_plot 的「30–90% 不许抗屈」就是防这个）
  stairs_down 助力：早支撑伸展推 + 摆动期帮着迈腿；**落阶冲击**：脚跟着地那一下一个短促屈曲脉冲——"身子往下一沉"
  lift        只在摆动期帮着抬腿（跑酷起跳前用；以前借的是 stairs_up，那时它是助力）
  wait        红灯：走着会被轻轻拉住、位置不前进；两腿静下来 1.5 s 放行（从停步算起中位约 2 s），最多 6 s
  flat        0
脉冲式而不是持续顶：发热小、电量省、人对变化更敏感。正 = 伸展（9/22 数据推断，待穿上验证）。

相位约定：文献以脚跟着地 = 0% 周期。估计器 0 = 髋角最大（≈蹬离地），脚跟着地 ≈ 估计器相位 HS_PHASE（默认 0.5，
现场校准）。参数表里的相位全按文献约定写，内部再加 HS_PHASE。
数字依据（调研/设备/髋关节力矩感知阈值与脉冲设计.md）：上坡 = 早支撑髋伸脉冲（Lay 2006、Montgomery 2018）；
脉冲宽 10–20% 周期、梯形；时序 JND ≈2.8% 周期、力矩 Weber 分数 12–19%。下坡用制动脉冲是推断。
"""
from __future__ import annotations
import math
import time

from .base import Controller
from .. import worlds as W

HS_PHASE = 0.5   # 脚跟着地在估计器相位里的位置，现场校准后改
# 红灯放行：没有新接受的步 + 两腿角速度 RMS < STILL_DPS 连续 WAIT_STILL_S 秒；不看 gait.moving ——
# 真人停步后相图不塌缩，moving 能一直真着（9/22 录制按 moving 判要 2–11 s，中位 5 s）。
# 按本规则回放 181327 停步 11 次：1.8–4.2 s，中位 2.2 s；走动中 0 次误放行（scratchpad/judge/redlight2.py）。
# 兜底：距上一步（或进红灯）WAIT_CAP_S 秒无论如何放行，演示不会卡死在路口。
WAIT_STILL_S = 1.5
STILL_DPS = 20.0
WAIT_CAP_S = 6.0
CAP = 3.0        # 控制律自己也不出软限（Guard 仍按 --cap 再裁一次）；main 启动时改成 --cap 的值
DEFAULT_STRENGTH = 1.5   # 缺省强度 / 脉冲宽：main 启动时按 --strength / --width 改；换人、演示复位新建 Terrain() 也用它（以前写死 1.5，复位就掉回去）
DEFAULT_WIDTH = 12.0
MULT = {"up": 1.0, "down": -0.8, "stairs_up": -1.2, "stairs_down": 1.0, "wait": -0.5, "lift": 0.0}   # 主脉冲峰值 = MULT × strength
SWING = 0.8      # 摆动期帮着迈腿 / 抬腿（68%，屈曲方向）占 strength 的比例：下台阶、lift
IMPACT = 1.0     # 下台阶落阶冲击峰值 = IMPACT × strength（Guard 的 50 Nm/s 斜率限制会把它削成约 60 ms 的顿挫，安全上不会是尖刺）
IMPACT_W = 10.0  # 落阶冲击底宽 % 周期（脚跟着地前后 ±5%；文献脉冲宽下限 10%）
LEGACY = {"台阶": "train_stairs", "长坡": "train_slope", "山的记忆": "taishan_18pan"}
RISE = {"flat": 0.0, "up": 0.08, "down": -0.08, "stairs_up": 0.12, "stairs_down": -0.12, "wait": 0.0}
PRESETS = {wid: [(s["kind"], s["steps"]) for s in w["route"]] for wid, w in W.WORLDS.items()}   # 兼容旧接口


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

    def __init__(self, preset=W.DEFAULT, strength=None):
        strength = DEFAULT_STRENGTH if strength is None else strength
        super().__init__()
        self.params = {
            "strength": [strength, 0.0, CAP],     # Nm，上坡脉冲峰值（下坡 ×0.8，台阶 ×1.2）；上限 = 软限
            # 中心限在 0–20%：宽 20% 时伸展脉冲也不会进 30–60%（摆动中段不抗屈，scripts/pulse_plot.py 核对）
            "t_push":   [11.0, 0.0, 20.0],        # 上坡伸展脉冲中心：早支撑 5–17%（脚跟着地=0%）
            "t_brake":  [10.0, 0.0, 20.0],        # 制动脉冲中心：5–15%
            "t_step":   [6.0, 0.0, 20.0],         # 上台阶支撑期阻力脉冲中心；摆动期脉冲固定在 68%；下台阶助力用 t_brake
            "width":    [DEFAULT_WIDTH, 10.0, 20.0],   # 脉冲底宽 % 周期（文献 10–20%）
        }
        self.force = None                         # 强制路段（2AFC / 演示）
        self.wearer = "anon"
        self.memory: dict = {}                    # 世界 id → (影子, 谁, 最佳)：换世界再换回来，「山的记忆」还在
        self.preset, self.ghost, self.ghost_who, self.best = None, [], "", None
        self.set_preset(preset)
        self._strides = None                      # None = 下一拍以步态当前计数为基准（新建/复位时步态可能早已走了几百步）

    # ---- 世界 ----
    def set_preset(self, preset):
        if self.ghost or self.best is not None:   # 先把当前世界的记忆存起来（空的不存，免得盖掉别处带进来的）
            self.memory[self.preset] = (self.ghost, self.ghost_who, self.best)
        wid = LEGACY.get(preset, preset)
        self.world = W.get(wid)
        self.preset = self.world["id"]
        self.route = self.world["route"]
        self.segments = [(s["kind"], s["steps"]) for s in self.route]
        self.total = sum(n for _, n in self.segments)
        self.pos = 0
        self.laps = 0
        self.lap_t0 = None
        self.lap_steps: list = []
        self.last_lap = None
        self._still_since = self._wait_t0 = None
        # 影子（上一位的每一步时刻）和最佳成绩按世界存：取出目标世界的
        self.ghost, self.ghost_who, self.best = self.memory.get(self.preset, ([], "", None))

    def reset(self):
        """换人/演示复位：回到起点。上一圈留作影子。"""
        self.pos = 0
        self._strides = None
        self.lap_t0 = None
        self.lap_steps = []
        self._still_since = self._wait_t0 = None

    def seg_index(self, pos):
        p = pos % self.total
        for i, (_, n) in enumerate(self.segments):
            if p < n:
                return i, p
            p -= n
        return len(self.segments) - 1, 0

    def segment_at(self, pos):
        if self.force:
            return self.force
        return self.segments[self.seg_index(pos)[0]][0]

    def profile(self):
        """每一步的累计高度（游戏单位）与路段，给界面画剖面/建山路。"""
        h, out = 0.0, []
        for seg in self.route:
            for _ in range(seg["steps"]):
                out.append({"kind": seg["kind"], "h": round(h, 3), "label": seg["label"]})
                h += RISE[seg["kind"]]
        return out

    # ---- 前进 ----
    def _advance(self, n, now):
        for _ in range(n):
            was_wait = self.segment_at(self.pos) == "wait"
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
            if not was_wait and self.segment_at(self.pos) == "wait":
                break                                  # 一拍来了好几步也停在红灯前

    def step(self, frame, gait=None):
        if gait is None:
            return 0.0, 0.0
        now = time.monotonic()
        kind = self.segment_at(self.pos)
        strides = gait.l.n_strides + gait.r.n_strides
        if self._strides is None or strides < self._strides:   # 刚复位 / 步态估计被重置（换人）
            self._strides = strides
        new = strides - self._strides
        self._strides = strides
        if kind == "wait" and not self.force:           # 红灯：走着不前进；腿静下来才放行
            if new > 0 or self._wait_t0 is None:
                self._wait_t0 = now
            rms = math.sqrt((gait.l.omega_f ** 2 + gait.r.omega_f ** 2) / 2)
            if new > 0 or rms >= STILL_DPS:             # 还在出步 / 腿还在摆就不算站定
                self._still_since = None
            else:
                self._still_since = self._still_since or now
            if (self._still_since and now - self._still_since >= WAIT_STILL_S) or now - self._wait_t0 >= WAIT_CAP_S:
                i, off = self.seg_index(self.pos)
                self._advance(self.segments[i][1] - off, now)
                self._still_since = self._wait_t0 = None
        elif new > 0:
            self._advance(new, now)
        kind = self.segment_at(self.pos)
        if kind == "flat" or not gait.moving:
            return 0.0, 0.0
        return self.pulse(kind, gait.l.phase), self.pulse(kind, gait.r.phase)

    def pulse(self, kind, phase):
        """某路段在估计器相位 phase(0..1) 的力矩。纯函数，scripts/pulse_plot.py 直接画它。"""
        if kind not in MULT:
            return 0.0
        s, w = self.p("strength"), self.p("width")
        x = ((phase - HS_PHASE) % 1.0) * 100.0           # 估计器相位 → 文献相位（脚跟着地=0%）
        center = self.p({"up": "t_push", "stairs_up": "t_step"}.get(kind, "t_brake"))   # wait：走着就轻轻拉住
        if kind == "stairs_down":                        # 助力脉冲排在落阶冲击后面，中间留 1% 过零，不直接正负翻转
            center = max(center, IMPACT_W / 2 + w / 2 + 1.0)
        t = MULT[kind] * s * _bump(x, center, w)
        if kind in ("stairs_down", "lift"):
            t -= SWING * s * _bump(x, 68.0, w)           # 摆动期屈曲：帮着迈腿 / 抬腿
        if kind == "stairs_down":
            t -= IMPACT * s * _bump(x, 0.0, IMPACT_W)    # 落阶冲击：脚跟着地一瞬间往下一沉
        return max(-CAP, min(CAP, t))

    # ---- 给游戏 / 仪表盘 ----
    def status(self):
        now = time.monotonic()
        el = (now - self.lap_t0) if self.lap_t0 is not None else 0.0
        ghost_pos = (sum(1 for x in self.ghost if x <= el) if self.lap_t0 is not None else 0) if self.ghost else None
        i, off = self.seg_index(self.pos)
        seg = self.route[i]
        nxt = None
        for j in range(i + 1, len(self.route)):
            if self.route[j]["kind"] != seg["kind"]:
                nxt = {"label": self.route[j]["label"], "kind": self.route[j]["kind"],
                       "in": sum(self.route[k]["steps"] for k in range(i, j)) - off}
                break
        prof = self.profile()
        hmax = max((p["h"] for p in prof), default=1.0) or 1.0
        h_now = prof[self.pos]["h"] if prof else 0.0
        a0, a1 = self.world["alt"]
        return {"preset": self.preset, "world": {k: self.world[k] for k in ("id", "name", "subtitle", "summit", "theme", "unit")},
                "pos": self.pos, "total": self.total, "laps": self.laps,
                "segment": self.segment_at(self.pos), "label": seg["label"], "next": nxt,
                "wait_still": round(now - self._still_since, 1) if (seg["kind"] == "wait" and self._still_since) else None,
                "wait_need": WAIT_STILL_S,
                "altitude": round(a0 + (a1 - a0) * (h_now / hmax)),
                "force": self.force, "profile": prof, "segments": self.segments,
                "presets": list(W.WORLDS), "hs_phase": HS_PHASE,
                "elapsed": round(el, 1), "best": self.best, "last_lap": self.last_lap,
                "ghost_pos": ghost_pos, "ghost_who": self.ghost_who}
