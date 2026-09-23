"""连大脑（brain/claude_brain.py）。纯 urllib，零依赖，Python 3.9 可跑。

SHELLOS_BRAIN 默认 http://127.0.0.1:8790。展位 MacBook 连不上 Anthropic，用 SSH 反向隧道把大脑借过来（brain/run.sh）。
任何失败都返回 None，调用方走规则兜底；连不上 / 超时 / 没 key 之后 20 s 内不再试，免得每句话都等超时。
不走系统代理：MacBook 开着 Shadowrocket（系统 HTTP 代理 127.0.0.1:1082），urllib 默认会把 127.0.0.1:8790 也塞给它，
大脑不在时拿到的是代理的 503，大脑在时请求被代理转走。

status 给仪表盘：ok / kind / msg 是上一次调用的结果；up / key / model 是心跳（watch()，每 10 s GET /health）。
kind：offline 连不上大脑 · timeout 超时 · no_key 没配 key · auth key 被拒 · refusal 拒答 · rate_limit 限频 ·
      overloaded Anthropic 过载 · net 大脑连不上 Anthropic · error 其他 · ok
"""
from __future__ import annotations
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request

URL = os.environ.get("SHELLOS_BRAIN", "http://127.0.0.1:8790").rstrip("/")
BACKOFF_S = 20.0
LABEL = {"offline": "连不上大脑（没开 / 隧道断）", "timeout": "超时", "no_key": "大脑在，但没配 key", "auth": "key 被拒",
         "refusal": "Claude 拒答", "rate_limit": "限频", "overloaded": "Anthropic 过载", "net": "大脑连不上 Anthropic",
         "error": "其他错误"}
status = {"ok": None, "kind": "", "msg": "还没调用过", "t": 0.0, "up": None, "key": None, "model": "", "tp": 0.0}
_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open    # 不走系统代理


def _kind(e):
    """urllib 异常 → kind；大脑自己回的 502 带 kind。"""
    if isinstance(e, urllib.error.HTTPError):
        try:
            return json.load(e).get("kind") or "error"
        except Exception:  # noqa: BLE001
            return "error"
    r = getattr(e, "reason", e)
    if isinstance(r, (socket.timeout, TimeoutError)):
        return "timeout"
    if isinstance(r, (ConnectionError, OSError)):          # 拒绝连接 / 隧道在但大脑不在（对端直接断开）
        return "offline"
    return "error"


def call(path, body, timeout=12.0):
    now = time.time()
    if status["ok"] is False and status["kind"] != "refusal" and now - status["t"] < BACKOFF_S:
        return None
    if status["up"] is False and now - status["tp"] < 15:   # 心跳刚说大脑不在，别等超时
        return None
    req = urllib.request.Request(URL + path, data=json.dumps(body, ensure_ascii=False).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with _open(req, timeout=timeout) as r:
            out = json.load(r)
    except Exception as e:  # noqa: BLE001  502（拒答 / 无 key）、断网、超时一律兜底
        k = _kind(e)
        status.update(ok=False, kind=k, msg=f"{path} {LABEL.get(k, k)}：{str(e)[:60]}", t=time.time())
        return None
    status.update(ok=True, kind="ok", msg=f"{path} {time.time() - now:.1f}s {out.get('_model', '')}", t=time.time())
    return out


def probe(timeout=3.0):
    try:
        with _open(URL + "/health", timeout=timeout) as r:
            h = json.load(r)
        status.update(up=True, key=bool(h.get("key")), model=h.get("model", ""), tp=time.time())
    except Exception:  # noqa: BLE001
        status.update(up=False, key=None, tp=time.time())


def watch(period=10.0):
    """后台心跳：仪表盘不用等第一句评委话就能看到大脑在不在、有没有 key。ShellOS 启动时调一次。"""
    def loop():
        while True:
            probe()
            time.sleep(period)
    threading.Thread(target=loop, daemon=True, name="brain-watch").start()


if __name__ == "__main__":                      # 自检：拒绝连接 → offline；大脑回 502 kind=auth → auth；/health 读 key
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            d = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Length", str(len(d)))
            self.end_headers()
            self.wfile.write(d)

        def do_GET(self):
            self._send(200, {"ok": True, "model": "m", "key": False})

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self._send(502, {"error": "x", "kind": "auth"})

    URL = "http://127.0.0.1:9"
    assert call("/coach", {}) is None and status["kind"] == "offline", status
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_port}"
    status.update(ok=None)
    assert call("/coach", {}) is None and status["kind"] == "auth", status
    assert call("/coach", {}) is None and "被拒" in status["msg"]         # 退避中，不再打
    probe()
    assert status["up"] is True and status["key"] is False
    print("ok", status)
