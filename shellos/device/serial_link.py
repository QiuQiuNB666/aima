"""串口层：唯一碰 pyserial 的地方。后台线程按行读，数据帧进环形缓冲，应答进队列。

握手：PING → PONG，VERSION → OK,VERSION,x，ENABLE → OK,ENABLE。
只有 Guard 应该调用 send_torque / disable；别的模块只读 latest()。
"""
from __future__ import annotations
import glob
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
        self.port = port or find_port()
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
        self._wlock = threading.Lock()
        self._alive = True
        self._thr = threading.Thread(target=self._reader, name="serial-read", daemon=True)
        self._thr.start()

    # ---- 读 ----
    def _reader(self):
        while self._alive:
            try:
                raw = self.ser.readline()
            except serial.SerialException:
                self.replies.put("ERR,SERIAL_LOST")
                return
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
                    if self.replies.qsize() < 50:
                        self.replies.put(line)
                continue
            self.n_frames += 1
            self.last_frame_t = t
            self.frames.append(f)
            if self.on_frame:
                self.on_frame(f)

    def latest(self) -> Frame | None:
        return self.frames[-1] if self.frames else None

    def stream_age(self) -> float:
        """距上一帧多久（秒）。没收到过帧返回 inf。"""
        return time.monotonic() - self.last_frame_t if self.last_frame_t else float("inf")

    # ---- 写 ----
    def send(self, cmd: str):
        with self._wlock:
            self.ser.write((cmd + "\n").encode("ascii"))

    def send_torque(self, tl: float, tr: float):
        self.send(f"T,{tl:.3f},{tr * R_SIGN:.3f}")

    def disable(self):
        try:
            self.send("DISABLE")
        except Exception:
            pass

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
