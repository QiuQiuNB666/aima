"""展位脚本：语法；booth_up --sim 起一套后 booth_check 全绿（大脑 / TTS 用本地假 /health，语音缓存和 Chrome 跳过）；
看门狗把被 kill -9 的 ShellOS 拉起来并恢复世界 + 穿戴者；手动 run-mac.sh 换参数后看门狗不抢、再崩按新参数拉起。只用自己挑的空闲端口，结束 --down 只杀自己的。
需要 .venv（run-mac.sh 用它起 ShellOS），没有就跳过整合测试。"""
from __future__ import annotations
import json
import os
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = ["scripts/booth_up.sh", "scripts/booth_check.sh", "scripts/booth_recover.sh"]


def sh(*args, timeout=90, env=None):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, **(env or {})})


def test_syntax():
    for s in SCRIPTS:
        assert sh("bash", "-n", s).returncode == 0, s
    for s in ("run-mac.sh", "brain/run.sh"):
        assert sh("sh", "-n", s).returncode == 0, s


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def fake_health(body):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            d = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(d)))
            self.end_headers()
            self.wfile.write(d)
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def get(port, path):
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f"http://127.0.0.1:{port}{path}", timeout=2) as r:
        return json.load(r)


def post(port, path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=3) as r:
        return json.load(r)


def shellos_pid(port):
    r = sh("pgrep", "-f", f"shellos.main.*--http {port}")
    return int(r.stdout.split()[0]) if r.stdout.strip() else None


def wait(pred, secs):
    for _ in range(secs * 2):
        try:
            if pred():
                return True
        except Exception:  # noqa: BLE001  起来之前连接被拒
            pass
        time.sleep(0.5)
    return False


@pytest.mark.skipif(not os.path.exists(os.path.join(ROOT, ".venv", "bin", "python")), reason="没有 .venv，run-mac.sh 起不了 ShellOS")
def test_sim_all_green_and_watchdog_restores_world():
    port = free_port()
    brain, tts = fake_health({"ok": True, "model": "fake", "key": True, "backend": "test"}), fake_health({"ok": True, "voice": "say"})
    env = {"SHELLOS_BRAIN_PORT": str(brain.server_port), "SHELLOS_TTS_PORT": str(tts.server_port), "BOOTH_SKIP": "voice,chrome"}
    last = os.path.join(ROOT, "data", f"booth_{port}.json")
    try:
        up = sh("scripts/booth_up.sh", "--sim", "--no-chrome", "--http", str(port), "--no-record", "--no-input", timeout=150, env=env)
        assert up.returncode == 0 and "[!!]" not in up.stdout and "全绿" in up.stdout, up.stdout + up.stderr
        assert "[OK] 大脑" in up.stdout and "[OK] TTS" in up.stdout and "[--] 导游语音" in up.stdout

        post(port, "/wearer", {"name": "tester"})
        post(port, "/terrain", {"preset": "taishan_18pan"})
        assert wait(lambda: json.load(open(last))["world"] == "taishan_18pan", 10), "看门狗 3 s 内没快照世界"
        pid = shellos_pid(port)
        assert pid
        os.kill(pid, signal.SIGKILL)
        assert wait(lambda: shellos_pid(port) not in (None, pid) and get(port, "/state")["terrain"]["preset"] == "taishan_18pan", 60), \
            open(f"/tmp/booth-{port}.watchdog.log").read()
        st = get(port, "/state")
        assert st["wearer"] == "tester" and st["ctl"]["name"] == "terrain"

        chk = sh("scripts/booth_check.sh", "--http", str(port), env=env)
        assert chk.returncode == 0 and "全绿" in chk.stdout, chk.stdout

        # 手动换参数（= 早上 --sim、下午 run-mac.sh 换真机）：看门狗不能抢着按旧参数重起，崩了也要按新参数拉起
        assert "ShellOS up" in sh("./run-mac.sh", "--sim", "--force-deadman", "--ctl", "terrain", "--cap", "3",
                                  "--http", str(port), "--no-record", "--no-input", env=env).stdout
        time.sleep(2)
        pid = shellos_pid(port)
        os.kill(pid, signal.SIGKILL)
        assert wait(lambda: shellos_pid(port) not in (None, pid) and get(port, "/state")["safety"]["cap"] == 3.0, 60)
        wd = open(f"/tmp/booth-{port}.watchdog.log").read()
        assert wd.count("→ 重起") == 2, wd
    finally:
        sh("scripts/booth_up.sh", "--down", "--http", str(port))
        brain.shutdown(), tts.shutdown()
        for p in (last, f"/tmp/booth-{port}.args", f"/tmp/booth-{port}.starting", f"/tmp/booth-{port}.watchdog.log", f"/tmp/shellos-{port}.log"):
            if os.path.exists(p):
                os.remove(p)
    assert wait(lambda: shellos_pid(port) is None, 10)
