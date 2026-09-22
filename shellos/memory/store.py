"""经验卡：一句纠正 → 一条可检索、可删除、可继承的记录。JSON 一行一条，追加写。

{"id": 7, "ts": "...", "wearer": "judge-03", "controller": "phase",
 "trigger": {"cadence": [95, 110]}, "delta": {"t_ext": -5}, "quote": "早一点",
 "confidence": 0.8, "hits": 2, "enabled": true, "source": "llm|rule"}

检索规则（故意简单、可解释）：同一控制律 + 步频落在 trigger 区间 + enabled。命中的 delta 相加。
"""
from __future__ import annotations
import json
import os
import threading
from datetime import datetime


class Store:
    def __init__(self, path="data/experiences.jsonl"):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.items: list[dict] = []
        self._lock = threading.Lock()
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if line:
                    self.items.append(json.loads(line))

    def _flush(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            for it in self.items:
                fh.write(json.dumps(it, ensure_ascii=False) + "\n")

    def add(self, wearer, controller, trigger, delta, quote, confidence, source):
        with self._lock:
            it = {"id": (max((i["id"] for i in self.items), default=0) + 1),
                  "ts": datetime.now().strftime("%m-%d %H:%M:%S"), "wearer": wearer, "controller": controller,
                  "trigger": trigger, "delta": delta, "quote": quote, "confidence": round(float(confidence), 2),
                  "hits": 0, "enabled": True, "source": source}
            self.items.append(it)
            self._flush()
            return it

    def set_enabled(self, id_, enabled):
        with self._lock:
            for it in self.items:
                if it["id"] == id_:
                    it["enabled"] = bool(enabled)
                    self._flush()
                    return it
        return None

    def retrieve(self, controller, cadence):
        """命中的经验列表（不改 hits，命中后由调用方 bump）。"""
        out = []
        for it in self.items:
            if not it["enabled"] or it["controller"] != controller:
                continue
            lo, hi = it["trigger"].get("cadence", [0, 999])
            if lo <= cadence <= hi:
                out.append(it)
        return out

    def bump(self, ids):
        with self._lock:
            for it in self.items:
                if it["id"] in ids:
                    it["hits"] += 1
            self._flush()

    def merged_delta(self, hits):
        d: dict = {}
        for it in hits:
            for k, v in it["delta"].items():
                d[k] = d.get(k, 0.0) + float(v)
        return d
