"""串口层：唯一碰 pyserial 的地方。后台线程按行读，数据帧进环形缓冲，应答进队列。

握手：PING → PONG，VERSION → OK,VERSION,x，ENABLE → OK,ENABLE。
只有 Guard 应该调用 send_torque / disable；别的模块只读 latest()。
"""
from __future__ import annotations
import glob
import queue
import sys
import threading
import time
from collections import deque

import serial
from serial.tools import list_ports

from .frame import Frame, parse_line
from .convention import R_SIGN
from .ownership import DeviceLease, canonical_port

BAUD = 3_000_000


def usb_identity(port):
    """A COM number can be reused. Only a USB serial can authorize reconnect."""
    try:
        matches = [p for p in list_ports.comports() if canonical_port(p.device) == canonical_port(port)]
        if len(matches) == 1 and matches[0].serial_number:
            p = matches[0]
            return (p.vid, p.pid, p.serial_number)
    except (OSError, AttributeError, ValueError):
        pass
    return None


def find_port() -> str:
    if sys.platform == "win32":
        # VID/PID 只识别 CP210x 串口桥候选；设备协议仍需原有握手确认。
        cands = sorted(p.device for p in list_ports.comports()
                       if p.vid == 0x10C4 and p.pid == 0xEA60)
        if not cands:
            raise RuntimeError("没找到 CP210x 串口候选：请检查外骨骼电源、USB 数据线，"
                               "以及 Silicon Labs 官方 CP210x 驱动是否已安装")
        if len(cands) > 1:
            raise RuntimeError(f"发现多个 CP210x 串口候选：{', '.join(cands)}；"
                               "请确认设备后用 --port COMx 明确指定端口")
        return cands[0]
    cands = sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/cu.usbserial*")
                   + glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if not cands:
        raise RuntimeError("没找到串口：外骨骼插上了吗？开机了吗？")
    if len(cands) > 1:
        raise RuntimeError('发现多个串口候选；请用 --port 明确指定设备：' + ', '.join(cands))
    return cands[0]


class SerialLink:
    def __init__(self, port: str | None = None, on_frame=None, *, role='legs'):
        if role not in ('legs', 'hands'):
            raise ValueError('Device role must be legs or hands')
        if role == 'hands' and not port:
            raise ValueError('Hand devices require an explicit port')
        self._role = role
        self._lease = None
        self._bound_port = None
        self._usb_identity = None
        self._wlock = threading.RLock()
        self._alive = True
        self._closed = False
        self.ser = None
        if port is None:                      # 启动时外骨骼没插 / 没开机：照常启动（仪表盘先起来），读线程每秒找一次，插上就接
            try:
                port = find_port()
            except RuntimeError as e:
                print(f"[link] {e} 先起 ShellOS，插上自动连", flush=True)
        self.port = port or "(未连接)"
        if port:
            # timeout 必须设：断线时 readline 才不会永远阻塞
            self._lease = DeviceLease(port, role)
            self._bound_port = port
            self._usb_identity = usb_identity(port)
            try:
                self.ser = serial.Serial(self.port, BAUD, timeout=0.05)
            except Exception:
                self._lease.close()
                raise
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
        self._thr = threading.Thread(target=self._reader, name="serial-read", daemon=True)
        self._thr.start()

    @property
    def role(self):
        return self._role

    @property
    def closed(self):
        return self._closed

    # ---- 读 ----
    def _reader(self):
        while self._alive:
            if self.ser is None:                      # 启动时没插：等插上
                if not self._reconnect():
                    return
                continue
            try:
                raw = self.ser.readline()
            except (serial.SerialException, OSError):
                self.enabled = False
                self.replies_seen["SERIAL_LOST"] = self.replies_seen.get("SERIAL_LOST", 0) + 1
                if not self._reconnect():
                    return
                continue
            if not self._alive:
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
        """只重连原端口且 USB 身份必须一致；身份未知时等待本机重新绑定。
        手部连接没有腿部的自动 ENABLE 恢复路径。"""
        with self._wlock:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None
            self.enabled = False
        while self._alive:
            time.sleep(1.0)
            try:
                with self._wlock:
                    if not self._alive:
                        return False
                    # Once selected, never discover a replacement (e.g. the other role).
                    candidate = self._bound_port or find_port()
                    if self._lease is None:
                        self._lease = DeviceLease(candidate, self.role)
                        self._bound_port = candidate
                        self._usb_identity = usb_identity(candidate)
                    elif self._usb_identity is None or usb_identity(candidate) != self._usb_identity:
                        self.last_err = 'USB_IDENTITY_UNVERIFIED: stop and explicitly rebind the device'
                        self.replies_seen['REBIND_REQUIRED'] = self.replies_seen.get('REBIND_REQUIRED', 0) + 1
                        return False
                    self.ser = serial.Serial(candidate, BAUD, timeout=0.05)
                    self.port = candidate
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
            if self._closed:
                return
            try:
                if self.ser is None:
                    raise serial.SerialException("未连接")
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
        if self._closed or self.role != 'legs':
            return False
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
        """PING → VERSION → ENABLE。返回固件版本。失败抛 RuntimeError。没插着就返回「未连接」，插上后由 recover 补 ENABLE。"""
        if self._closed or self.role != 'legs':
            raise RuntimeError('Leg handshake cannot enable a closed or hand-role connection')
        if self.ser is None:
            return "未连接"
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
        with self._wlock:
            if self._closed:
                return
            self._alive = False
            self.disable()
            self._closed = True
            self.enabled = False
            # If close fails, retain the lease instead of allowing another owner.
            if self.ser is not None:
                self.ser.close()
            if self._lease is not None:
                self._lease.close()
