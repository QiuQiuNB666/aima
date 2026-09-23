"""连大脑（brain/claude_brain.py）。纯 urllib，零依赖，Python 3.9 可跑。

SHELLOS_BRAIN 默认 http://127.0.0.1:8790。展位 MacBook 连不上 Anthropic，用 SSH 反向隧道把大脑借过来：
  （在跑大脑的那台机器上）ssh -N -R 8790:127.0.0.1:8790 zhongrenfei@100.112.252.66
任何失败都返回 None，调用方走规则兜底；连不上之后 20 s 内不再试，免得每句话都等超时。
"""
from __future__ import annotations
import json
import os
import time
import urllib.request

URL = os.environ.get("SHELLOS_BRAIN", "http://127.0.0.1:8790").rstrip("/")
BACKOFF_S = 20.0
status = {"ok": None, "msg": "还没调用过", "t": 0.0}    # 仪表盘显示


def call(path, body, timeout=12.0):
    if status["ok"] is False and time.time() - status["t"] < BACKOFF_S:
        return None
    req = urllib.request.Request(URL + path, data=json.dumps(body, ensure_ascii=False).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = json.load(r)
    except Exception as e:  # noqa: BLE001  HTTPError(502 拒答/无 key)、断网、超时一律兜底
        status.update(ok=False, msg=f"{path} 失败：{str(e)[:80]}", t=time.time())
        return None
    status.update(ok=True, msg=f"{path} {time.time() - t0:.1f}s {out.get('_model', '')}", t=time.time())
    return out
