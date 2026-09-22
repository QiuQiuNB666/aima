"""步态估计：极角相位 + 步频 + 对称性 + 活动度。每帧 update()，输出 GaitState。

相位（每条腿）：φ = atan2(k·ω, θ − θ̄) ∈ [0, 1)，k 自适应到让相图接近圆。
置信度：相图半径 / 参考半径，站着不动半径塌缩 → 置信度 0 → Guard 把力矩归零。
事件：φ 绕回一圈 = 一个步态周期(stride)；步频 = 2 × 60 / 最近周期时长的中位数（一个周期两步）。
相位停滞：最近 prog_s 秒相位净推进 < prog_min（腿停住 / 坐着晃）→ 这条腿 stalled，走动中直接为假；
两腿同相（相位差 < inphase_tol，坐下/站起/弯腰）走动中也为假。
"""
from __future__ import annotations
import math
import statistics
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
    roms: deque = field(default_factory=lambda: deque(maxlen=12))   # 最近接受周期的活动度（对称比用）
    n_strides: int = 0
    stalled: bool = True      # 相位停滞（见 _Leg.prog_s）


@dataclass
class GaitState:
    l: LegState = field(default_factory=LegState)
    r: LegState = field(default_factory=LegState)
    cadence: float = 0.0      # 步/分
    symmetry: float = 1.0     # 左活动度 / 右活动度（最近周期均值；1 = 对称，跛行时明显偏离）
    variability: float = 0.0  # 周期时长变异系数
    moving: bool = False

    @property
    def conf(self):
        return min(self.l.conf, self.r.conf)


# 周期接受门限（scripts/gait_audit.py 用 9/22 真机录制扫出来的，见 docs/报告/步态审计.md）
# 9/23 前：0.7–2.0 s、整周期最低 conf>0.6、rom≥15，无同相检查——录制里穿戴坐/站 13 个假周期、走路覆盖率 0.19
# 9/23 起：去掉整周期最低 conf（真人髋角在支撑相有平台，相图贴近原点，一瞬间掉到 0.5 以下整步就被拒；conf 仍由 Guard 管力矩），
# 改用同相检查挡坐/站 —— 穿戴 0 假周期、覆盖率 0.32。cycle_conf=-1 = 不查
DEFAULTS = dict(stride_min=0.8, stride_max=2.2, cycle_conf=-1.0, rom_min=15.0, sync_tol=0.2)
# 踏步模式：原地踏步摆幅小（±5–10°）、波形不是正弦，默认档的 rom≥15 会把 ±7° 以下的踏步全拒，
# r_ref=8 让置信度在相图贴近原点时掉到 0.5 以下（走动中断断续续、脉冲给不出来）。只在展位没走廊时开。
# 注意 r_ref 变小 = 置信度整体变高 = Guard 的 conf<0.5 归零门更容易通过：坐着晃腿也更容易被当成在动。
STEPPING = dict(rom_min=8.0, r_ref=4.0)


class _Leg:
    def __init__(self, ema=0.3, mean_ema=0.005, r_ref=8.0, stride_min=DEFAULTS["stride_min"],
                 stride_max=DEFAULTS["stride_max"], cycle_conf=DEFAULTS["cycle_conf"],
                 rom_min=DEFAULTS["rom_min"], sync_tol=DEFAULTS["sync_tol"], latch=True, trace=False,
                 prog_s=0.3, prog_min=0.05):
        self.s = LegState()
        self.ema, self.mean_ema, self.r_ref = ema, mean_ema, r_ref
        # 相位停滞：停步/坐下后 θ 停在离慢均值（τ≈2 s）很远的地方，相图半径 = |θ−θ̄| 撑着 conf≥0.5，
        # 相位钉在 0.5（坐着晃腿时在 0.4–0.6 来回抖），地形脉冲变成持续力矩（9/22 回放 175524 连续 1.8 Nm 1.3 s、
        # 开头坐着 width=20 时 5 s）。停滞只拦「走动中」、不改 conf：真人走路相位不匀速，也会短暂停滞，
        # 改 conf 会让走动中的 0.3 s 保持时间反复重来（实测走路段走动中占比 0.45 → 0.07）
        self.prog_s, self.prog_min = prog_s, prog_min
        self._unwrap = 0.0                 # 展开相位（累计圈数）
        self._hist = deque()               # (t, 展开相位)，最近 prog_s 秒
        self.stride_min, self.stride_max = stride_min, stride_max
        self.cycle_conf, self.rom_min = cycle_conf, rom_min
        # 双腿不同相：本腿绕回时，另一条腿的相位差离 0 至少 sync_tol、且置信度 >0.5。坐下/站起/弯腰两腿同相（差≈0），
        # 单腿晃另一条腿不动（置信度≈0）。None = 不查。注意 9/22 真人走路的相位差集中在 0.2–0.3，不是 0.5（髋角有平台，相位不匀速）
        self.sync_tol = sync_tol
        self.t_accept = None              # 最近一次接受周期的时刻
        # 半周期锁存：相位要先走到 0.35–0.65（髋角另一头）才允许下一次绕回。真人走路髋角在支撑相有平台，
        # 相位在 0/1 分界上抖，没有锁存时一步会被切成 0.8 s + 0.2 s 两段（9/22 录制里走路段一半以上的步被这样切碎）
        self.latch = latch
        self._armed = not latch
        self.cycles = [] if trace else None   # 诊断：每个候选周期 (t 结束, 时长, 最低置信度, 活动度, 是否接受, 与另一腿相位差, 另一腿置信度)
        self.amp_t = 10.0   # 髋角摆幅估计
        self.amp_w = 60.0   # 角速度摆幅估计
        self._prev_phase = None
        self._t_wrap = None
        self._mn = self._mx = None
        self._min_conf_cycle = 1.0      # 本周期内的最低置信度（cycle_conf 门限用）
        self.rejected = 0               # 被拒掉的假周期计数（诊断用）

    def update(self, theta: float, omega: float, t: float, other: LegState | None = None) -> LegState:
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
        if self._prev_phase is not None:
            self._unwrap += (phase - self._prev_phase + 0.5) % 1.0 - 0.5
        h = self._hist
        h.append((t, self._unwrap))
        while len(h) > 1 and t - h[1][0] >= self.prog_s:
            h.popleft()
        s.stalled = t - h[0][0] < self.prog_s or self._unwrap - h[0][1] < self.prog_min
        self._min_conf_cycle = min(self._min_conf_cycle, s.conf)
        # 事件：绕回。只有「时长像人走路 + 活动度像人走路 + 两腿不同相」才算一步（门限见 DEFAULTS）
        if 0.35 <= phase <= 0.65:
            self._armed = True
        if self._prev_phase is not None and phase < 0.25 and self._prev_phase > 0.75 and self._armed:
            self._armed = not self.latch
            if self._t_wrap is not None:
                stride = t - self._t_wrap
                rom = (self._mx - self._mn) if self._mn is not None else 0.0
                dphi = ((other.phase - phase) % 1.0) if other is not None else 0.5
                o_conf = other.conf if other is not None else 1.0
                anti = self.sync_tol is None or (min(dphi, 1.0 - dphi) >= self.sync_tol and o_conf > 0.5)
                ok = (self.stride_min <= stride <= self.stride_max and self._min_conf_cycle > self.cycle_conf
                      and rom >= self.rom_min and anti)
                if self.cycles is not None:
                    self.cycles.append((t, stride, self._min_conf_cycle, rom, ok, dphi, o_conf))
                if ok:
                    s.stride_s = stride
                    s.strides.append(stride)
                    s.roms.append(rom)
                    s.n_strides += 1
                    s.rom = rom
                    self.t_accept = t
                else:
                    self.rejected += 1
            self._t_wrap = t
            self._mn = self._mx = s.theta_f
            self._min_conf_cycle = s.conf
        if self._mn is not None:
            self._mn = min(self._mn, s.theta_f)
            self._mx = max(self._mx, s.theta_f)
        self._prev_phase = phase
        s.phase = phase
        return s


class GaitEstimator:
    """kw 传给每条腿（门限见 DEFAULTS）；stepping=True 用踏步模式门限；moving_hold 是走动中要求的连续高置信时长；
    recent_s：走动中还要求最近 recent_s 秒内至少接受过一个周期（None = 不要求）；
    inphase_tol：两腿相位差小于它 = 同相动作（坐下/站起），不算走动中（None = 不查）。"""

    def __init__(self, stepping=False, moving_conf=0.5, moving_hold=0.3, recent_s=None, inphase_tol=0.1, **kw):
        self.inphase_tol = inphase_tol
        if stepping:
            kw = {**STEPPING, **kw}
        self.stepping = stepping
        self.moving_conf, self.moving_hold, self.recent_s = moving_conf, moving_hold, recent_s
        self._l, self._r = _Leg(**kw), _Leg(**kw)
        self.state = GaitState(l=self._l.s, r=self._r.s)
        self._last_ms = None
        self._conf_since = None          # 连续高置信度的起始时刻

    def update(self, f: Frame) -> GaitState:
        st = self.state
        if f.ms == self._last_ms:
            return st
        self._last_ms = f.ms
        self._l.update(f.l_deg, f.l_dps, f.t_host, st.r)
        self._r.update(f.r_deg, f.r_dps, f.t_host, st.l)
        strides = list(st.l.strides) + list(st.r.strides)
        if strides:
            # 中位数：停停走走时跨停顿的周期（停顿 + 一个周期，≤2.2 s 也会被接受）不把步频拉低
            st.cadence = 120.0 / statistics.median(strides)
            if len(strides) > 2:
                mean = sum(strides) / len(strides)
                var = sum((x - mean) ** 2 for x in strides) / (len(strides) - 1)
                st.variability = math.sqrt(var) / mean
        if st.l.roms and st.r.roms:
            # 活动度比，不是周期比：两条腿的周期都是同一个步态周期，周期比天然 ≈1，跛行也测不出来
            ml = sum(st.l.roms) / len(st.l.roms)
            mr = sum(st.r.roms) / len(st.r.roms)
            st.symmetry = ml / mr if mr else 1.0
        # 走动中：连续 moving_hold 秒高置信度才成立，站起/坐下的瞬态不算
        if st.conf > self.moving_conf:
            if self._conf_since is None:
                self._conf_since = f.t_host
            st.moving = (f.t_host - self._conf_since) >= self.moving_hold
            if st.moving and self.recent_s is not None:
                ta = max((x for x in (self._l.t_accept, self._r.t_accept) if x is not None), default=None)
                st.moving = ta is not None and f.t_host - ta <= self.recent_s
        else:
            self._conf_since = None
            st.moving = False
        # 下面两条不重置保持计时，条件一消失走动中立刻回来。9/22 回放（地形强制 stairs_up）：
        # 175524 最长连续出力 1.34 s → 0.23 s（width=20：4.95 s → 0.29 s），174946 0.82 → 0.12 s（width=20：2.96 → 0.24 s）；
        # 非走路段误判走动中 163 s → 3 s；代价：181327 走路段脉冲数 301 → 267
        dphi = abs(st.l.phase - st.r.phase) % 1.0
        if st.l.stalled or st.r.stalled:     # 相位不走 = 不知道在周期哪儿，不给脉冲
            st.moving = False
        elif self.inphase_tol is not None and min(dphi, 1.0 - dphi) < self.inphase_tol:
            st.moving = False                # 两腿同相 = 坐下/站起的慢动作，相位在走但不是走路
        return st

    @property
    def rejected(self):
        return self._l.rejected + self._r.rejected
