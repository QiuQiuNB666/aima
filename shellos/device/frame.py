"""一帧 200 Hz 数据。协议：S:<ms>,<pitch>,<roll>,<yaw>,<gx>,<gy>,<gz>,<ax>,<ay>,<az>,<kPa>,<Ldeg>,<Rdeg>,<Ldps>,<Rdps>"""
from dataclasses import dataclass, fields

FIELDS = ("ms", "pitch", "roll", "yaw", "gx", "gy", "gz", "ax", "ay", "az",
          "kpa", "l_deg", "r_deg", "l_dps", "r_dps")


@dataclass(slots=True)
class Frame:
    t_host: float          # 主机收到的时间 time.monotonic()
    ms: float              # 主板时间
    pitch: float; roll: float; yaw: float          # 穿戴系欧拉角 °
    gx: float; gy: float; gz: float                # 腰部陀螺仪 °/s
    ax: float; ay: float; az: float                # 腰部加速度 g
    kpa: float                                     # 气压
    l_deg: float; r_deg: float                     # 左右髋角 °
    l_dps: float; r_dps: float                     # 左右髋角速度 °/s

    def csv(self) -> str:
        return ",".join(f"{getattr(self, f.name):.4f}" for f in fields(self))


CSV_HEADER = ",".join(f.name for f in fields(Frame))


def parse_line(line: str, t_host: float) -> Frame | None:
    """`S:` 开头的数据行 → Frame；别的行（OK/ERR/PONG）返回 None。坏行也返回 None，不抛。"""
    if not line.startswith("S:"):
        return None
    parts = line[2:].strip().split(",")
    if len(parts) != len(FIELDS):
        return None
    try:
        return Frame(t_host, *map(float, parts))
    except ValueError:
        return None
