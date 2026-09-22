"""网页仪表盘：纯标准库 http.server，页面 10 Hz 轮询 /state。

GET  /            页面
GET  /state       当前状态 JSON
POST /hold        网页版死人开关心跳：body {"v":1}；300 ms 没心跳自动归零
POST /estop       急停
POST /rearm       重新上膛
POST /param       {"name":..., "delta":...}
POST /ctl         {"name":"dofc"}
POST /log         {"text":...}   往事件流里写一条（评委原话先手工输入，Agent 层接上后由它改参）
"""
from __future__ import annotations
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOLD_TTL = 0.3


class Dashboard:
    def __init__(self, app, port=8765):
        self.app = app          # 需要: guard, link, ctl, gait, set_ctl(name), ctls, events(list)
        self.port = port
        self._last_hold = 0.0
        html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
        self._html = open(html_path, "rb").read()
        dash = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # 静默
                pass

            def _json(self, obj, code=200):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                if self.path.startswith("/state"):
                    return self._json(dash.state())
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(dash._html)))
                self.end_headers()
                self.wfile.write(dash._html)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                try:
                    return self._json(dash.action(self.path, body))
                except Exception as e:  # noqa: BLE001
                    return self._json({"error": str(e)}, 400)

        for i in range(20):                      # 上一个进程可能还没释放端口
            try:
                self.httpd = ThreadingHTTPServer(("0.0.0.0", port), H)
                break
            except OSError:
                if i == 19:
                    raise
                time.sleep(0.25)
        threading.Thread(target=self.httpd.serve_forever, name="dashboard", daemon=True).start()
        threading.Thread(target=self._hold_watch, name="hold-wd", daemon=True).start()

    def _hold_watch(self):
        while True:
            time.sleep(0.05)
            if self._last_hold and time.monotonic() - self._last_hold > HOLD_TTL:
                self.app.guard.set_deadman(0.0, "web")
                self._last_hold = 0.0

    def state(self):
        a = self.app
        g, f, st = a.guard, a.link.latest(), a.gait.state
        return {
            "t": time.time(),
            "safety": {"state": g.state, "reason": g.last_reason, "deadman": round(g.deadman, 2),
                       "sent": [round(x, 3) for x in g.last_sent], "cap": g.soft_cap,
                       "sources": {k: round(v, 2) for k, v in g._deadman_src.items() if v > 0}},
            "link": {"port": getattr(a.link, "port", "?"), "n": a.link.n_frames, "bad": a.link.n_bad,
                     "age_ms": round(min(a.link.stream_age(), 9.999) * 1000)},
            "frame": None if f is None else {"pitch": f.pitch, "roll": f.roll, "l": f.l_deg, "r": f.r_deg,
                                             "ldps": f.l_dps, "rdps": f.r_dps, "kpa": f.kpa},
            "gait": {"phase_l": st.l.phase, "phase_r": st.r.phase, "conf": st.conf, "cadence": st.cadence,
                     "symmetry": st.symmetry, "variability": st.variability, "rom_l": st.l.rom, "rom_r": st.r.rom,
                     "strides": st.l.n_strides + st.r.n_strides, "moving": st.moving},
            "ctl": {"name": next((k for k, c in a.ctls.items() if isinstance(a.ctl, c)), a.ctl.name), "params": {k: v for k, v in a.ctl.params.items()}, "available": list(a.ctls)},
            "events": a.events[-30:],
            "loop_ms": getattr(a, "loop_ms", 0),
        }

    def action(self, path, body):
        a = self.app
        if path == "/hold":
            v = float(body.get("v", 1))
            self._last_hold = time.monotonic() if v > 0 else 0.0
            a.guard.set_deadman(v, "web")
            return {"deadman": a.guard.deadman}
        if path == "/estop":
            a.guard.trigger_estop("web estop")
            a.log("急停（网页）")
            return {"state": a.guard.state}
        if path == "/rearm":
            ok = a.guard.rearm()
            a.log("重新上膛" if ok else "上膛失败")
            return {"state": a.guard.state}
        if path == "/param":
            out = a.ctl.set_params({body["name"]: float(body["delta"])})
            a.log(f"参数 {body['name']} {float(body['delta']):+g} → {out}")
            return out
        if path == "/ctl":
            a.set_ctl(body["name"])
            a.log(f"切换控制律 → {body['name']}")
            return {"ctl": a.ctl.name}
        if path == "/log":
            a.log(body.get("text", ""))
            return {"ok": True}
        raise ValueError(f"unknown {path}")
