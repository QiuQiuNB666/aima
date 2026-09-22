"""afc.py：发力为 0 的轮作废重做，不进正确率；/mark 记 VOID。用假 HTTP 服务，不起 ShellOS。"""
from __future__ import annotations
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_zero_force_round_is_void_and_redone():
    st = {"kind": None, "rounds": 0, "marks": []}
    void_rounds = {1}                                          # 第 1 次给刺激：一点力没发出去

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _ok(self, obj):
            b = json.dumps(obj).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            k = st["kind"]
            t = 0.0 if (k is None or st["rounds"] in void_rounds) else (2.0 if k == "up" else -2.0)
            self._ok({"ctl": {"name": "terrain", "params": {"strength": [1.0], "t_push": [30]}},
                      "sim": {"on": True}, "safety": {"sent": [t, t], "deadman": 1.0}})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
            if self.path == "/terrain/force":
                if body.get("kind") is not None and st["kind"] is None:
                    st["rounds"] += 1
                st["kind"] = body.get("kind")
            elif self.path == "/mark":
                st["marks"].append(body["label"])
            self._ok({"ok": True})

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        out = subprocess.run([sys.executable, str(ROOT / "scripts/afc.py"), "--api",
                              f"http://127.0.0.1:{srv.server_port}", "--dry", "--trials", "3",
                              "--seconds", "0.1", "--seed", "1"], capture_output=True, text=True, timeout=30)
    finally:
        srv.shutdown()
    assert out.returncode == 0, out.stderr
    marks = st["marks"]
    assert sum("VOID" in m for m in marks) == 1
    scored = [m for m in marks if "truth=" in m and "VOID" not in m]
    assert len(scored) == 3 and all(" OK " in m for m in scored)   # 作废那轮重做了，理想观察者全对
    assert "3/3" in marks[-1] and "作废 1 轮" in marks[-1]
