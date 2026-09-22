"""安全层：硬件和一切代码之间的唯一通道。

规则按顺序，任一触发即短路：
1. estop                     → DISABLE，进 DISARMED，要 rearm() 才能再用
   deadman==0                → 力矩归零回 ARMED（不 DISABLE：DISABLE 会停数据流），再按住即恢复
2. 软限 |t| <= soft_cap        （默认 3 Nm；硬件 7.5 永远不用满）
3. 斜率限 每拍变化 <= slew      （默认 0.5 Nm/拍 = 50 Nm/s @100 Hz；文献上限 ~150 Nm/s，脉冲控制律需要）
4. deadman 深度全局缩放          扳机按一半，力就一半
5. 步态置信度 < min_conf        → 力矩归零（不 DISABLE）
6. 看门狗：>100 ms 没 submit    → T,0,0；>1 s → DISABLE（固件自身 100 ms 无 T 即清零，DISABLE 只兜底）
7. 断流 > stream_timeout        → 立即 T,0,0（不走斜率限；不 DISABLE，否则恢复不了）
8. 进程退出/异常               → DISABLE
"""
from __future__ import annotations
import atexit
import threading
import time

DISCONNECTED, CONNECTED, ARMED, ACTIVE, DISARMED = "DISCONNECTED", "CONNECTED", "ARMED", "ACTIVE", "DISARMED"


class Guard:
    HARD_CAP = 7.5

    def __init__(self, link, soft_cap=3.0, slew=0.5, min_conf=0.5,
                 wd_zero=0.1, wd_disable=1.0, stream_timeout=0.2, on_sent=None):
        self.link = link
        self.soft_cap = min(soft_cap, self.HARD_CAP)
        self.slew = slew
        self.min_conf = min_conf
        self.wd_zero, self.wd_disable, self.stream_timeout = wd_zero, wd_disable, stream_timeout
        self.on_sent = on_sent                      # (tl, tr) 回调，录制用
        self.state = CONNECTED
        self._deadman_src: dict = {}
        self.estop = False
        self.last_sent = (0.0, 0.0)
        self.last_submit_t = time.monotonic()
        self.last_reason = "init"
        self._lock = threading.RLock()     # 可重入：Ctrl-C / SIGTERM 的处理函数在主线程里调 shutdown，可能正打断 submit
        self._alive = True
        atexit.register(self.shutdown)
        threading.Thread(target=self._watchdog, name="guard-wd", daemon=True).start()

    # ---- 外部信号 ----
    def set_deadman(self, v: float, source: str = "default"):
        self._deadman_src[source] = max(0.0, min(1.0, v))

    @property
    def deadman(self) -> float:
        return max(self._deadman_src.values(), default=0.0)

    def trigger_estop(self, reason="estop"):
        self.estop = True
        self._disarm(reason)

    def arm(self):
        """握手成功 / 设备复位重新 ENABLE 后调用。DISARMED（急停、看门狗）只能走 rearm()。"""
        with self._lock:
            if self.state == DISARMED or self.estop:
                return False
            self._arm_locked()
            return True

    def _arm_locked(self):
        self.state = ARMED
        self.last_sent = (0.0, 0.0)
        self.last_reason = "armed"

    def rearm(self):
        """DISARMED 之后要重新 ENABLE 才能再给力。"""
        try:
            self.link.send("ENABLE")
        except Exception:
            return False
        with self._lock:
            self.estop = False
            self._arm_locked()
        return True

    # ---- 核心 ----
    def submit(self, tl: float, tr: float, confidence: float = 1.0) -> tuple[float, float]:
        """控制线程每拍调一次。返回真正发出去的力矩。"""
        with self._lock:
            self.last_submit_t = time.monotonic()
            if self.state in (DISCONNECTED, CONNECTED, DISARMED):
                return self.last_sent
            if self.estop:
                self._disarm_locked("estop")
                return self.last_sent
            if self.deadman <= 0.0:
                if self.last_sent != (0.0, 0.0):
                    self.link.send_torque(0.0, 0.0)
                    self.last_sent = (0.0, 0.0)
                    if self.on_sent:
                        self.on_sent(0.0, 0.0)
                self.state = ARMED
                self.last_reason = "deadman released"
                return self.last_sent
            if self.link.stream_age() > self.stream_timeout:
                self.link.send_torque(0.0, 0.0)              # 断流短路：立刻归零，不走斜率限
                self.last_sent = (0.0, 0.0)
                if self.on_sent:
                    self.on_sent(0.0, 0.0)
                self.state = ACTIVE
                self.last_reason = "stream stale"
                return self.last_sent
            if confidence < self.min_conf:
                tl = tr = 0.0
                self.last_reason = "low confidence"
            else:
                self.last_reason = "ok"
            tl, tr = self._clip(tl), self._clip(tr)
            tl, tr = tl * self.deadman, tr * self.deadman
            ptl, ptr = self.last_sent
            tl, tr = self._slew(ptl, tl), self._slew(ptr, tr)
            self.link.send_torque(tl, tr)
            self.last_sent = (tl, tr)
            self.state = ACTIVE
            if self.on_sent:
                self.on_sent(tl, tr)
            return self.last_sent

    def _clip(self, t):
        return max(-self.soft_cap, min(self.soft_cap, t))

    def _slew(self, prev, want):
        d = want - prev
        if abs(d) > self.slew:
            d = self.slew if d > 0 else -self.slew
        return prev + d

    def _disarm(self, reason):
        with self._lock:
            self._disarm_locked(reason)

    def _disarm_locked(self, reason):
        self.link.disable()
        self.state = DISARMED
        self.last_sent = (0.0, 0.0)
        self.last_reason = reason
        if self.on_sent:
            self.on_sent(0.0, 0.0)

    # ---- 看门狗 ----
    def _watchdog(self):
        while self._alive:
            time.sleep(0.01)
            if self.state != ACTIVE:
                continue
            age = time.monotonic() - self.last_submit_t
            if age > self.wd_disable:
                self._disarm("watchdog: control loop dead")
            elif age > self.wd_zero and self.last_sent != (0.0, 0.0):
                with self._lock:
                    self.link.send_torque(0.0, 0.0)
                    self.last_sent = (0.0, 0.0)
                    self.last_reason = "watchdog: zeroed"
                    if self.on_sent:
                        self.on_sent(0.0, 0.0)

    def shutdown(self):
        if not self._alive:
            return
        self._alive = False
        self._disarm("shutdown")
