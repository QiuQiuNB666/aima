"""回放器：读 recorder 写的 CSV，按 200 Hz 吐帧。接口和 SerialLink 一样（含 enabled / needs_recovery / recover），
send 只记日志。没设备时用它。

故障注入（压测用）：构造参数 faults="..." 或环境变量 SHELLOS_FAULTS，逗号分隔的 `种类@开始秒[:持续秒]`，
秒数从回放开始算。例：SHELLOS_FAULTS="gap@10:3,noten@20,reboot@30:0.5,bad@40:0.5,stall@50:0.3"
  gap     断流：持续期间不出帧、ENABLE 不应答（线松了）；使能状态不变
  noten   设备自己掉使能：吐一行 ERR,NOT_ENABLED，之后 T 被拒（真正作用到腿上的力矩 = 0）直到收到 ENABLE
  reboot  设备复位：静默持续秒后吐开机日志（[initImpl] / Total PSRAM），掉使能、reboots+1
  bad     帧格式错误：持续期间每帧都变成坏行（截断 / 粘连 / 非数字），走 parse_line，n_bad 计数
  stall   主机卡顿：控制线程（主线程）下一次 latest() 卡住持续秒（模拟 GC / 截图抢 CPU）
"""
from __future__ import annotations
import csv
import os
import threading
import time
from collections import deque

from .frame import Frame, FIELDS, parse_line
from .convention import R_SIGN

FAULT_DUR = {"gap": 2.0, "noten": 0.0, "reboot": 0.5, "bad": 0.5, "stall": 0.3}   # 缺省持续秒
BAD_LINES = ("S:1234,1.5,-0.2", "S:1,2,3,4,5,6,7,8,9,1,101.3,10.5,-3.2,50,-40frame,0.1",
             "S:x,1,2,3,4,5,6,7,8,9,10,11,12,13,14", "S:" + ",".join(["1"] * 16))
BOOT_LOG = ("[initImpl] replay reboot", "Total PSRAM: 8388608")
FW_ZERO_S = 0.1          # 固件：100 ms 没有新 T 自己清零


def parse_faults(spec: str) -> list:
    """'gap@10:3,noten@20' → [(10.0, 'gap', 3.0), (20.0, 'noten', 0.0)]，按开始时间排序。"""
    out = []
    for item in (s.strip() for s in (spec or "").split(",")):
        if not item:
            continue
        kind, _, rest = item.partition("@")
        at, _, dur = rest.partition(":")
        if kind not in FAULT_DUR or not at:
            raise ValueError(f"故障写错了：{item!r}（格式 种类@秒[:持续]，种类 {'/'.join(FAULT_DUR)}）")
        out.append((float(at), kind, float(dur) if dur else FAULT_DUR[kind]))
    return sorted(out)


class ReplayLink:
    port = "replay"

    def __init__(self, path: str, on_frame=None, speed: float = 1.0, loop: bool = True, faults=None):
        self.rows = []
        self.n_bad = 0                  # CSV 坏行（录制时两帧粘在一行）+ 注入的坏帧
        with open(path, newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("kind", "frame") != "frame":
                    continue
                try:
                    self.rows.append([float(r[k]) for k in FIELDS])
                except (TypeError, ValueError):
                    self.n_bad += 1
        if not self.rows:
            raise RuntimeError(f"{path} 里没有帧")
        self.n_bad_csv = self.n_bad
        if faults is None:
            faults = os.environ.get("SHELLOS_FAULTS", "")
        self.faults = parse_faults(faults) if isinstance(faults, str) else sorted(faults)
        self.frames: deque[Frame] = deque(maxlen=2000)
        self.sent: deque = deque(maxlen=5000)
        self.on_frame = on_frame
        self.speed, self.loop = speed, loop
        self.n_frames = 0
        self.last_frame_t = 0.0
        # 和 SerialLink 同名的设备状态
        self.enabled = False
        self.reboots = 0
        self.replies_seen: dict = {}
        self.last_err = ""
        self.fault_log: list = []       # (相对秒, 种类, 持续)
        self.n_rejected = 0             # 未使能时收到的 T 条数
        self._applied = (0.0, 0.0)      # 设备真正作用到腿上的力矩
        self._applied_t = 0.0
        self._silent_until = 0.0
        self._bad_until = 0.0
        self._boot_pending = False
        self._stall = 0.0
        self._lock = threading.RLock()     # 同 Guard：信号处理里 disable() 可能打断 send()
        self._alive = True
        self.t0 = time.monotonic()
        threading.Thread(target=self._play, name="replay", daemon=True).start()

    # ---- 设备侧 ----
    def _play(self):
        period = 0.005 / self.speed
        self.t0 = next_t = time.monotonic()
        pending = list(self.faults)
        k = 0
        while self._alive:
            for row in self.rows:
                if not self._alive:
                    return
                next_t += period
                t = time.monotonic()
                while pending and pending[0][0] <= t - self.t0:
                    self._start_fault(*pending.pop(0), t)
                if t < self._silent_until:
                    pass
                elif self._boot_pending:
                    self._boot_pending = False
                    for line in BOOT_LOG:
                        self._line(line, t)
                elif t < self._bad_until:
                    k += 1
                    self._line(BAD_LINES[k % len(BAD_LINES)], t)
                else:
                    self._frame(Frame(t, *row))
                time.sleep(max(0.0, next_t - time.monotonic()))
            if not self.loop:
                return

    def _start_fault(self, at, kind, dur, t):
        self.fault_log.append((round(t - self.t0, 3), kind, dur))
        if kind == "gap":
            self._silent_until = max(self._silent_until, t + dur)
        elif kind == "noten":
            with self._lock:
                self.enabled = False
            self._line("ERR,NOT_ENABLED", t)
        elif kind == "reboot":
            with self._lock:
                self._applied = (0.0, 0.0)
            self._silent_until = max(self._silent_until, t + dur)
            self._boot_pending = True
        elif kind == "bad":
            self._bad_until = max(self._bad_until, t + dur)
        elif kind == "stall":
            self._stall = dur

    def _frame(self, f: Frame):
        self.frames.append(f)
        self.n_frames += 1
        self.last_frame_t = f.t_host
        if self.on_frame:
            self.on_frame(f)

    def _line(self, line: str, t: float):
        """一行串口文本 → 跟 SerialLink._reader 一样的记账。"""
        f = parse_line(line, t)
        if f is not None:
            self._frame(f)
            return
        if line.startswith("S:"):
            self.n_bad += 1
            return
        key = ",".join(line.split(",")[:2])
        self.replies_seen[key] = self.replies_seen.get(key, 0) + 1
        with self._lock:
            if line.startswith("ERR"):
                self.last_err = line
                if line.startswith("ERR,NOT_ENABLED"):
                    self.enabled = False
            elif "[initImpl]" in line or line.startswith("Total PSRAM"):
                if self.enabled:                # 一次复位有好几行开机日志，只数第一行（SerialLink 会多数，见指挥板）
                    self.reboots += 1
                self.enabled = False
                self._applied = (0.0, 0.0)

    def applied(self) -> tuple:
        """设备真正在出的力矩（未使能 / 断线 / 100 ms 无新 T → 0）。测试用。"""
        with self._lock:
            if not self.enabled or time.monotonic() - self._applied_t > FW_ZERO_S:
                return (0.0, 0.0)
            return self._applied

    def _silent(self) -> bool:
        return time.monotonic() < self._silent_until

    # ---- 主机侧接口（同 SerialLink） ----
    def latest(self):
        if self._stall and threading.current_thread() is threading.main_thread():
            d, self._stall = self._stall, 0.0
            time.sleep(d)
        return self.frames[-1] if self.frames else None

    def stream_age(self):
        return time.monotonic() - self.last_frame_t if self.last_frame_t else float("inf")

    def send(self, cmd: str):
        self.sent.append(cmd)
        if self._silent():
            return                                  # 线松了：设备收不到
        with self._lock:
            if cmd == "ENABLE":
                self.enabled = True
                self.replies_seen["OK,ENABLE"] = self.replies_seen.get("OK,ENABLE", 0) + 1
            elif cmd == "DISABLE":
                self.enabled = False
                self._applied = (0.0, 0.0)
            elif cmd.startswith("T,"):
                if not self.enabled:
                    self.n_rejected += 1
                    self.replies_seen["ERR,NOT_ENABLED"] = self.replies_seen.get("ERR,NOT_ENABLED", 0) + 1
                    return
                _, a, b = cmd.split(",")
                self._applied = (float(a), float(b) * R_SIGN)
                self._applied_t = time.monotonic()

    def send_torque(self, tl, tr):
        self.send(f"T,{tl:.3f},{tr * R_SIGN:.3f}")

    def disable(self):
        self.send("DISABLE")

    def needs_recovery(self) -> bool:
        return (not self.enabled) or self.stream_age() > 1.0

    def recover(self) -> bool:
        self.send("ENABLE")
        if self._silent():
            time.sleep(0.5)             # 同 SerialLink.recover：等 OK,ENABLE 0.5 s 超时（这 0.5 s 控制循环是卡住的）
            return False
        return self.enabled

    def handshake(self):
        self.send("ENABLE")
        return "replay"

    def close(self):
        self._alive = False
