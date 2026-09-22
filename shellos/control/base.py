"""控制律统一接口。params 里每项是 (value, min, max)；改参只能走 set_params，自动裁剪。"""
from __future__ import annotations
from ..device.frame import Frame


class Controller:
    name = "base"

    def __init__(self):
        self.params: dict[str, list] = {}   # name -> [value, min, max]

    def set_params(self, delta: dict[str, float]) -> dict[str, float]:
        """按差值改参，裁剪到范围，返回改后的值。未知参数忽略。"""
        out = {}
        for k, d in delta.items():
            if k not in self.params:
                continue
            v, lo, hi = self.params[k]
            self.params[k][0] = max(lo, min(hi, v + d))
            out[k] = self.params[k][0]
        return out

    def values(self) -> dict[str, float]:
        return {k: v[0] for k, v in self.params.items()}

    def p(self, k):
        return self.params[k][0]

    def step(self, frame: Frame, gait=None) -> tuple[float, float]:
        raise NotImplementedError


class Transparent(Controller):
    """力矩恒 0。穿上先跑这个。"""
    name = "transparent"

    def step(self, frame, gait=None):
        return 0.0, 0.0
