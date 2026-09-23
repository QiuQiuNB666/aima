"""峰哥语音：文字 → wav，按文字缓存。跑在大脑那台机器上，和 claude_brain.py 并排，独立端口。

  python3 brain/tts.py              # 起服务，127.0.0.1:8791
  python3 brain/tts.py --canned     # 把 shellos/agent/fengge.py 的兜底语录预生成进 data/voice/（断网也有声）

展位 MacBook 走同一条 SSH 反向隧道，多转一个口：
  ssh -N -R 8790:127.0.0.1:8790 -R 8791:127.0.0.1:8791 zhongrenfei@100.112.252.66

POST /tts {text} → audio/wav（已缓存直接给）
GET  /health
只听 127.0.0.1。

合成只在 synth() 里；换 TTS 方案只改它，换完清缓存重生成：rm data/voice/*.wav && python3 brain/tts.py --canned && ./deploy.sh
现在是方案 C（macOS `say -v Tingting`，普通女声，不是峰哥）：方案 A MOSS-TTS-Nano 的 onnxruntime 在 Intel Mac + Py3.14 没有轮子。
声音克隆（A / B）只用于比赛原型，展示前当面征得峰哥本人同意；克隆音频只在 data/voice/ 本地缓存，不进 git、不公开发布。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shellos.agent import voice  # noqa: E402  缓存目录和文件名规则跟 ShellOS 共用一份

PORT = int(os.environ.get("SHELLOS_TTS_PORT", "8791"))
SAY_VOICE = os.environ.get("SHELLOS_SAY_VOICE", "Tingting")
MAX_CHARS = 200


def synth(text: str) -> bytes:
    """文字 → wav 字节。换方案只改这里。"""
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "a.wav")
        # 文字走 stdin，不当参数：以 - 开头的话不会被当成选项
        subprocess.run(["say", "-v", SAY_VOICE, "--file-format=WAVE", "--data-format=LEI16@22050", "-o", out],
                       input=text.encode(), check=True, timeout=30)
        with open(out, "rb") as f:
            return f.read()


def get(text: str) -> bytes:
    path = voice.path(text)
    if os.path.isfile(path):
        with open(path, "rb") as f:
            return f.read()
    data = synth(text)
    voice.save(text, data)
    return data


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("[tts] " + fmt % a + "\n")

    def _send(self, data, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(json.dumps({"ok": True, "voice": SAY_VOICE}).encode(), "application/json")
        self._send(b"{}", "application/json", 404)

    def do_POST(self):
        if self.path != "/tts":
            return self._send(b"{}", "application/json", 404)
        n = int(self.headers.get("Content-Length") or 0)
        text = str(json.loads(self.rfile.read(n) or b"{}").get("text", "")).strip()
        if not text or len(text) > MAX_CHARS:
            return self._send(b'{"error":"text"}', "application/json", 400)
        try:
            self._send(get(text), "audio/wav")
        except Exception as e:  # noqa: BLE001  ShellOS 看到非 200 就不出声
            self.log_message("合成失败：%s", str(e)[:200])
            self._send(json.dumps({"error": str(e)[:200]}).encode(), "application/json", 502)


if __name__ == "__main__":
    if "--canned" in sys.argv:
        from shellos.agent.fengge import CANNED
        for line in sorted({s for v in CANNED.values() for s in v}):
            get(line)
            print("ok", voice.key(line), line)
        sys.exit(0)
    print(f"峰哥语音就绪 127.0.0.1:{PORT}  声音 say:{SAY_VOICE}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
