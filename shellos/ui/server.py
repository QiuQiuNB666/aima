"""网页仪表盘：纯标准库 http.server，页面 10 Hz 轮询 /state。

GET  /            页面
GET  /state       当前状态 JSON
POST /hold        网页版死人开关心跳：body {"v":1}；300 ms 没心跳自动归零
POST /estop       急停
POST /rearm       重新上膛
POST /param       {"name":..., "delta":...}
POST /ctl         {"name":"dofc"}
POST /feedback    {"text":...}   评委一句话 → 蜂群（教练 / 记忆员 / 安全员）→ 改参 + 经验卡
POST /world/generate {"text":...} 一句话造一座山（地形导演 → 安全员裁剪 → 切过去）
POST /log         {"text":...}   往事件流里写一条（评委原话先手工输入，Agent 层接上后由它改参）

所有 POST 只认本机（127.0.0.1 / ::1），局域网来的一律 403：死人开关、强度、控制律只有操作员这台机器能动。
GET（/state、/game、/worlds）仍对局域网开放，游戏屏可以放在另一台设备上看。
"""
from __future__ import annotations
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ..agent import brain

HOLD_TTL = 0.3
LOCAL = ("127.0.0.1", "::1", "::ffff:127.0.0.1")


class Dashboard:
    def __init__(self, app, port=8765):
        self.app = app          # 需要: guard, link, ctl, gait, set_ctl(name), ctls, events(list)
        self.port = port
        self._last_hold = 0.0
        html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
        self._html = open(html_path, "rb").read().replace(b"__V__", str(int(time.time())).encode())   # 模块脚本防缓存
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
                if self.path.split("?")[0] == "/worlds.json":
                    from .. import worlds
                    return self._json(worlds.summary())
                if self.path.split("?")[0] in ("/worlds", "/worlds.html"):
                    return self._file(os.path.join(os.path.dirname(__file__), "static", "worlds.html"), "text/html; charset=utf-8")
                if self.path.split("?")[0] in ("/fengge", "/fengge.html"):
                    return self._file(os.path.join(os.path.dirname(__file__), "static", "fengge.html"), "text/html; charset=utf-8")
                if self.path.split("?")[0] in ("/game", "/game.html"):
                    return self._file(os.path.join(os.path.dirname(__file__), "static", "game.html"), "text/html; charset=utf-8")
                if self.path.startswith(("/vendor/", "/models/", "/body3d.js", "/game/")):
                    return self._static(self.path.split("?")[0])
                if self.path.startswith("/voice/"):     # 峰哥语音：只念当前这句解说，不收任意文字
                    p = self.path.split("?")[0]
                    if p == "/voice/voice.js":
                        return self._file(os.path.join(os.path.dirname(__file__), "static", "voice.js"), "application/javascript")
                    if p == "/voice/last.wav":
                        from ..agent import voice
                        data = voice.get(dash.app.fengge.last.get("text", ""))
                        if not data:
                            self.send_response(204); self.end_headers(); return
                        self.send_response(200)
                        self.send_header("Content-Type", "audio/wav")
                        self.send_header("Content-Length", str(len(data)))
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        return self.wfile.write(data)
                    if p == "/voice/npc.wav":               # J 线追兵 NPC：只念白名单里的台词；真人录音优先，没有再合成
                        from urllib.parse import parse_qs, urlparse
                        from ..agent import voice
                        t = (parse_qs(urlparse(self.path).query).get("t") or [""])[0]
                        data = (voice.real(t) or voice.get(t, voice=voice.NPC_VOICE)) if t in voice.NPC_LINES else None
                        if not data:
                            self.send_response(204); self.end_headers(); return
                        self.send_response(200)
                        self.send_header("Content-Type", "audio/wav")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        return self.wfile.write(data)
                    self.send_response(404); self.end_headers(); return
                if self.path.startswith("/shots/"):
                    return self._file(os.path.join(dash.app.glasses.shots_dir, os.path.basename(self.path.split("?")[0])), "image/jpeg")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(dash._html)))
                self.end_headers()
                self.wfile.write(dash._html)

            def _file(self, full, ctype):
                if not os.path.isfile(full):
                    self.send_response(404); self.end_headers(); return
                data = open(full, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(data)

            def _static(self, path):
                base = os.path.join(os.path.dirname(__file__), "static")
                full = os.path.normpath(os.path.join(base, path.lstrip("/")))
                if not full.startswith(base) or not os.path.isfile(full):
                    self.send_response(404); self.end_headers(); return
                ctype = ("application/javascript" if full.endswith(".js") else "model/gltf-binary" if full.endswith(".glb")
                         else "image/jpeg" if full.endswith(".jpg") else "application/octet-stream")
                data = open(full, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "max-age=3600" if "/vendor/" in path or "/models/" in path else "no-cache")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                if self.client_address[0] not in LOCAL:
                    return self._json({"error": "POST 只认本机"}, 403)
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
            "pad": {"connected": bool(getattr(a, "pad", None) and a.pad.connected), "r2": round(getattr(getattr(a, "pad", None), "r2", 0.0) or 0.0, 2)},
            "sim": {"on": hasattr(a.link, "set_walk"), "walk": getattr(a.link, "walking", False),
                    "cadence": getattr(a.link, "cadence", 0)},
            "wearer": a.wearer,
            "link": {"port": getattr(a.link, "port", "?"), "n": a.link.n_frames, "bad": a.link.n_bad,
                     "age_ms": round(min(a.link.stream_age(), 9.999) * 1000),
                     "replies": {k: v for k, v in getattr(a.link, "replies_seen", {}).items() if "\x00" not in k},
                     "last_err": getattr(a.link, "last_err", ""), "enabled": getattr(a.link, "enabled", True),
                     "reboots": getattr(a.link, "reboots", 0)},
            "frame": None if f is None else {"pitch": f.pitch, "roll": f.roll, "yaw": f.yaw, "l": f.l_deg, "r": f.r_deg,
                                             "ldps": f.l_dps, "rdps": f.r_dps, "kpa": f.kpa},
            "gait": {"phase_l": st.l.phase, "phase_r": st.r.phase, "conf": st.conf, "cadence": st.cadence,
                     "symmetry": st.symmetry, "variability": st.variability, "rom_l": st.l.rom, "rom_r": st.r.rom,
                     "strides": st.l.n_strides + st.r.n_strides, "moving": st.moving},
            "ctl": {"name": next((k for k, c in a.ctls.items() if isinstance(a.ctl, c)), a.ctl.name), "params": {k: v for k, v in a.ctl.params.items()}, "available": list(a.ctls)},
            "events": a.events[-30:],
            "terrain": a.ctl.status() if hasattr(a.ctl, "status") else None,
            "memory": {"wearer": a.wearer, "recalled": a.recalled, "applied": a.applied,
                       "cards": a.store.items[-40:], "profile": a.profile()},
            "glasses": {"available": a.glasses.available, "busy": a.glasses.busy, "shot": bool(a.glasses.last_shot),
                        "shot_t": os.path.getmtime(a.glasses.last_shot) if a.glasses.last_shot else 0,
                        "terrain": a.terrain, "bin": a.glasses.bin, "error": a.glasses.last_error[-120:]},
            "swarm": a.swarm[-20:],
            "brain": brain.status,
            "fengge": a.fengge.last,
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
        if path == "/glasses/info":
            return {"ok": a.glasses.info()}
        if path == "/glasses/look":
            return {"ok": a.look()}
        if path == "/mark":
            a.mark(body.get("label", ""))
            return {"ok": True}
        if path == "/set":                      # 直接设参数绝对值（采集脚本用）
            k, v = body["name"], float(body["value"])
            cur = a.ctl.params[k][0]
            return a.ctl.set_params({k: v - cur})
        if path == "/feedback":
            it = a.feedback(body.get("text", ""))
            return {"card": it}
        if path == "/memory/add":               # {"delta":{"strength":x},"quote":...}，强度阶梯写卡
            return {"card": a.add_exp(body.get("delta"), body.get("quote", ""), body.get("source", "ladder"))}
        if path == "/memory/delete":
            return {"card": a.delete_exp(body["id"])}
        if path == "/memory/enable":
            return {"card": a.enable_exp(body["id"])}
        if path == "/wearer":
            a.set_wearer(body.get("name", "anon"))
            return {"wearer": a.wearer}
        if path == "/sim":
            if hasattr(a.link, "set_walk"):
                if "walk" in body:
                    a.link.set_walk(bool(body["walk"]))
                if "cadence" in body:
                    a.link.set_cadence(float(body["cadence"]))
                return {"walk": a.link.walking, "cadence": a.link.cadence}
            return {"error": "not sim"}
        if path == "/terrain":
            a.set_terrain(body.get("preset") or body.get("world") or "tokyo_night")
            return {"ok": True}
        if path == "/terrain/force":
            if hasattr(a.ctl, "force"):
                a.ctl.force = body.get("kind") or None
                a.log(f"地形强制：{a.ctl.force or '自动'}")
            return {"force": getattr(a.ctl, "force", None)}
        if path == "/world/generate":           # {"text": "一句话"} → 造一座山并切过去
            w = a.make_world(body.get("text", ""))
            return {"world": w and {k: w[k] for k in ("id", "name", "subtitle", "generated")}}
        if path == "/demo/reset":
            a.demo_reset()
            return {"ok": True}
        if path == "/log":
            a.log(body.get("text", ""))
            return {"ok": True}
        raise ValueError(f"unknown {path}")
