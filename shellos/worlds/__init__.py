"""世界 = 一条可以走进去的路线。每个世界一份 JSON，地形控制器和登山游戏共用。

字段：id, name, subtitle, story, note（真实性说明）, alt [起, 终] 海拔, unit,
      route [{kind, steps, label, turns?}], summit {name, text}, theme {style, sky, fog, ground, path, accent, props}, training?
kind ∈ flat / up / down / stairs_up / stairs_down / wait（红灯：要停下站 2 s 才放行）
加一个世界 = 往这个目录丢一份 JSON，不用改代码。
"""
from __future__ import annotations
import glob
import json
import os

KINDS = ("flat", "up", "down", "stairs_up", "stairs_down", "wait")
ORDER = ["tokyo_night", "taishan_18pan", "fuji_yoshida", "everest_north", "huashan_plank", "wutong_haohan", "train_stairs", "train_slope"]
_DIR = os.path.dirname(__file__)


def load_all() -> dict:
    out = {}
    for p in glob.glob(os.path.join(_DIR, "*.json")):
        w = json.load(open(p, encoding="utf-8"))
        for seg in w["route"]:
            if seg["kind"] not in KINDS:
                raise ValueError(f"{p}: 未知路段 {seg['kind']}")
        out[w["id"]] = w
    return dict(sorted(out.items(), key=lambda kv: ORDER.index(kv[0]) if kv[0] in ORDER else 99))


WORLDS = load_all()
DEFAULT = "everest_north"   # 9/23 珠峰定为展位主打


def get(world_id: str) -> dict:
    return WORLDS.get(world_id) or WORLDS[DEFAULT]


def summary() -> list:
    """给选择页：不含完整 theme 以外的大字段。"""
    res = []
    for w in WORLDS.values():
        n = sum(s["steps"] for s in w["route"])
        by = {}
        for s in w["route"]:
            by[s["kind"]] = by.get(s["kind"], 0) + s["steps"]
        res.append({k: w[k] for k in ("id", "name", "subtitle", "story", "note", "alt", "unit", "summit", "theme", "route")}
                   | {"steps": n, "mix": by, "training": w.get("training", False), "generated": w.get("generated")})
    return res
