"""串口层：唯一碰 pyserial 的地方。后台线程按行读，数据帧进环形缓冲，应答进队列。

握手：PING → PONG，VERSION → OK,VERSION,x，ENABLE → OK,ENABLE。
只有 Guard 应该调用 send_torque / disable；别的模块只读 latest()。
"""
from __future__ import annotations
import glob
import itertools
import queue
import threading
import time
from collections import deque

import serial

from .frame import Frame, parse_line
from .convention import R_SIGN

BAUD = 3_000_000


def find_port() -> str:
    cands = sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/cu.usbserial*")
                   + glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if not cands:
        raise RuntimeError("没找到串口：外骨骼插上了吗？开机了吗？")
    return cands[0]


class SerialLink:
    def __init__(self, port: str | None = None, on_frame=None):
        if port is None:                      # 启动时外骨骼没插 / 没开机：等着，插上就接（以前直接抛异常，ShellOS 起不来）
            for i in itertools.count():
                try:
                    port = find_port()
                    break
                except RuntimeError as e:
                    if i % 10 == 0:
                        print(f"[link] {e} 每秒再找一次…", flush=True)
                    time.sleep(1.0)
        self.port = port
        # timeout 必须设：断线时 readline 才不会永远阻塞
        self.ser = serial.Serial(self.port, BAUD, timeout=0.05)
        self.frames: deque[Frame] = deque(maxlen=2000)   # 10 秒
        self.replies: queue.Queue[str] = queue.Queue()
        self.on_frame = on_frame            # 每帧回调（录制用），在读线程里调，要快
        self.n_frames = 0
        self.n_bad = 0
        self.last_frame_t = 0.0
        self.replies_seen: dict = {}          # 前缀 → 次数，例如 OK,T / ERR,NOT_ENABLED
        self.last_err = ""
        self.enabled = False                  # 收到 OK,ENABLE 为真；看到开机日志或 ERR,NOT_ENABLED 为假
        self.reboots = 0
        self._wlock = threading.RLock()       # 信号处理里的 disable() 可能打断正在 send() 的主线程
        self._alive = True
        self._thr = threading.Thread(target=self._reader, name="serial-read", daemon=True)
        self._thr.start()

    # ---- 读 ----
    def _reader(self):
        while self._alive:
            try:
                raw = self.ser.readline()
            except (serial.SerialException, OSError):
                self.enabled = False
                self.replies_seen["SERIAL_LOST"] = self.replies_seen.get("SERIAL_LOST", 0) + 1
                if not self._reconnect():
                    return
                continue
            if not raw:
                continue
            t = time.monotonic()
            line = raw.decode("ascii", "replace").strip()
            if not line:
                continue
            f = parse_line(line, t)
            if f is None:
                if line.startswith("S:"):
                    self.n_bad += 1
                else:
                    key = ",".join(line.split(",")[:2])
                    self.replies_seen[key] = self.replies_seen.get(key, 0) + 1
                    if line.startswith("ERR"):
                        self.last_err = line
                        if line.startswith("ERR,NOT_ENABLED"):
                            self.enabled = False
                    elif line.startswith("OK,ENABLE"):
                        self.enabled = True
                    elif line.startswith("OK,DISABLE"):
                        self.enabled = False
                    elif "[initImpl]" in line or line.startswith("Total PSRAM"):
                        if self.enabled:                       # 开机日志 = 设备刚复位；一次复位有两行，只数第一行
                            self.reboots += 1
                        self.enabled = False
                    if self.replies.qsize() < 50:
                        self.replies.put(line)
                continue
            self.n_frames += 1
            self.last_frame_t = t
            self.frames.append(f)
            if self.on_frame:
                self.on_frame(f)

    def _reconnect(self) -> bool:
        """线被拔了：每秒试着重开串口，直到插回来（以前最多等 60 s 就放弃，读线程退出后再插也没用）。
        重连后需要上层重新 ENABLE（needs_recovery 会为真）。"""
        try:
            self.ser.close()
        except Exception:
            pass
        while self._alive:
            time.sleep(1.0)
            try:
                self.port = find_port()
                self.ser = serial.Serial(self.port, BAUD, timeout=0.05)
                self.replies_seen["SERIAL_RECONNECT"] = self.replies_seen.get("SERIAL_RECONNECT", 0) + 1
                return True
            except Exception:
                continue
        return False

    def latest(self) -> Frame | None:
        return self.frames[-1] if self.frames else None

    def stream_age(self) -> float:
        """距上一帧多久（秒）。没收到过帧返回 inf。"""
        return time.monotonic() - self.last_frame_t if self.last_frame_t else float("inf")

    # ---- 写 ----
    def send(self, cmd: str):
        """线松一下（USB 闪断）写会抛 Device not configured：记一次、丢掉这条，不让主循环崩（9/23 真机崩过一次）。
        读线程会发现断线并重开串口；needs_recovery() 为真 → 上层重新 ENABLE。设备 100 ms 没新力矩自己清零。"""
        with self._wlock:
            try:
                self.ser.write((cmd + "\n").encode("ascii"))
            except (serial.SerialException, OSError):
                self.enabled = False
                self.replies_seen["SEND_FAIL"] = self.replies_seen.get("SEND_FAIL", 0) + 1

    def send_torque(self, tl: float, tr: float):
        self.send(f"T,{tl:.3f},{tr * R_SIGN:.3f}")

    def disable(self):
        try:
            self.send("DISABLE")
        except Exception:
            pass

    def needs_recovery(self) -> bool:
        """设备复位 / 未使能 / 断流 —— 调用方应重新 ENABLE。"""
        return (not self.enabled) or self.stream_age() > 1.0

    def recover(self) -> bool:
        """重新 ENABLE。成功返回 True。"""
        try:
            self.send("ENABLE")
        except Exception:
            return False
        return bool(self.wait_reply("OK,ENABLE", 0.5))

    def wait_reply(self, prefix: str, timeout: float = 1.0) -> str | None:
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                return None
            try:
                r = self.replies.get(timeout=left)
            except queue.Empty:
                return None
            if r.startswith(prefix):
                return r

    def handshake(self) -> str:
        """PING → VERSION → ENABLE。返回固件版本。失败抛 RuntimeError。"""
        self.send("PING")
        if not self.wait_reply("PONG"):
            raise RuntimeError("PING 无应答：波特率/端口不对，或设备没进入工作态")
        self.send("VERSION")
        ver = self.wait_reply("OK,VERSION") or "OK,VERSION,?"
        self.send("ENABLE")
        if not self.wait_reply("OK,ENABLE"):
            raise RuntimeError("ENABLE 无应答")
        return ver.split(",")[-1]

    def close(self):
        self._alive = False
        self.disable()
        time.sleep(0.05)
        try:
            self.ser.close()
        except Exception:
            pass
