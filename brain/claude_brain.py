"""ShellOS 的「大脑」：唯一调 Claude 的进程。和 ShellOS 分开跑，理由三条：
  1. anthropic SDK 1.x 要 Python ≥3.10，展位 MacBook 是 3.9；ShellOS 本体坚持零新依赖。
  2. MacBook 直连 api.anthropic.com 返回 403；大脑跑在能连上的机器，MacBook 走 SSH 反向隧道：
       ssh -N -R 8790:127.0.0.1:8790 zhongrenfei@100.112.252.66
     MacBook 上的 ShellOS 访问自己的 127.0.0.1:8790 = 这台机器的大脑。
  3. 大脑挂了 / 断网 / 超时，ShellOS 退回规则表，腿上的安全链路不经过这里。

  python3 -m venv brain/.venv && brain/.venv/bin/pip install anthropic
  export ANTHROPIC_API_KEY=...          # 或 ant auth login
  brain/.venv/bin/python brain/claude_brain.py

POST /coach  {quote, controller, params:{k:[cur,lo,hi]}, profile}  → {changes:[{param,delta}], confidence, why}
POST /world  {text, styles:[...], kinds:[...]}                      → 世界草稿（ShellOS 再校验、裁剪、套主题）
GET  /health
只听 127.0.0.1。
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import anthropic

MODEL = os.environ.get("SHELLOS_CLAUDE_MODEL", "claude-opus-5")
PORT = int(os.environ.get("SHELLOS_BRAIN_PORT", "8790"))
client = anthropic.Anthropic()


def ask(prompt: str, schema: dict, effort: str, max_tokens: int) -> dict:
    # fallbacks="default"：Claude 的安全分类器误拒时，服务端自动换 Anthropic 推荐的模型重跑同一请求
    r = client.beta.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        thinking={"type": "adaptive"},
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": prompt}],
    )
    if r.stop_reason == "refusal":
        raise RuntimeError(f"refusal: {getattr(r.stop_details, 'category', None)}")
    if r.stop_reason == "max_tokens":
        raise RuntimeError("max_tokens")
    text = next(b.text for b in r.content if b.type == "text")
    out = json.loads(text)
    out["_model"] = r.model
    return out


def coach(b: dict) -> dict:
    params = b["params"]
    ptab = "\n".join(f"- {k}: 当前 {v[0]:g}，范围 {v[1]:g}~{v[2]:g}" for k, v in params.items())
    prompt = (
        f"你是一台髋关节外骨骼的调参教练。穿戴者边走边说了一句：「{b['quote']}」\n"
        f"当前控制律 {b['controller']}，参数：\n{ptab}\n"
        f"穿戴者画像：{json.dumps(b.get('profile', {}), ensure_ascii=False)}\n\n"
        "参数含义：strength / peak_* 是力矩峰值 Nm；t_* 是脉冲在步态周期里的位置（%，脚跟着地=0，越大越晚）；"
        "width 是脉冲宽度 %；gain / delay_s 是 DOFC 增益和延迟；bias_* / tl / tr 是左右偏置。\n"
        "注意区分抱怨和要求：「太早了」要往晚调，「早一点」要往早调；「太陡 / 太累」要减力，「没感觉」要加力。\n"
        "把这句话翻成参数差值（不是绝对值）。只改 1~2 个参数，幅度小：峰值 ±0.5 Nm、时机 ±5%、增益 ±0.03、延迟 ±0.03 s 这个量级。"
        "听不懂或跟调参无关就返回空 changes。why 用一句中文，说给评委听。"
    )
    schema = {
        "type": "object",
        "properties": {
            "changes": {"type": "array", "items": {
                "type": "object",
                "properties": {"param": {"type": "string", "enum": list(params)}, "delta": {"type": "number"}},
                "required": ["param", "delta"], "additionalProperties": False}},
            "confidence": {"type": "number"},
            "why": {"type": "string"},
        },
        "required": ["changes", "confidence", "why"], "additionalProperties": False,
    }
    return ask(prompt, schema, effort="low", max_tokens=4000)


def world(b: dict) -> dict:
    prompt = (
        f"评委说：「{b['text']}」\n"
        "请据此设计一条登山/行走路线，给穿外骨骼、原地踏步的人玩。每走一步前进一格，路段决定腿上的力：\n"
        "flat 平地无力；up 上坡（后面有人推）；down 下坡（腿被拖住）；stairs_up 上台阶（蹬+抬腿）；"
        "stairs_down 下台阶；wait 红灯（要站定 2 秒才放行）。\n"
        f"画面风格只能从这些里选一个最贴切的：{json.dumps(b['styles'], ensure_ascii=False)}\n"
        "约束：总步数 30~70；4~9 段；起点是 flat；台阶段合计不超过总步数一半；wait 最多 2 段、每段 1 步；"
        "每段 label 是 2~8 个字的地名/路标；name ≤ 10 字；subtitle 用「A → B → C」串起关键路段；"
        "story 一两句，第二人称；summit_text 是登顶时屏幕上的一句话。真实地点就按真实地形比例压缩，虚构的也要自洽。"
    )
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"}, "subtitle": {"type": "string"}, "story": {"type": "string"},
            "style": {"type": "string", "enum": b["styles"]},
            "alt_start": {"type": "integer"}, "alt_end": {"type": "integer"},
            "summit_name": {"type": "string"}, "summit_text": {"type": "string"},
            "route": {"type": "array", "items": {
                "type": "object",
                "properties": {"kind": {"type": "string", "enum": b["kinds"]}, "steps": {"type": "integer"},
                               "label": {"type": "string"}},
                "required": ["kind", "steps", "label"], "additionalProperties": False}},
        },
        "required": ["name", "subtitle", "story", "style", "alt_start", "alt_end", "summit_name", "summit_text", "route"],
        "additionalProperties": False,
    }
    return ask(prompt, schema, effort="medium", max_tokens=16000)


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("[brain] " + fmt % a + "\n")

    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._json({"ok": True, "model": MODEL})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        fn = {"/coach": coach, "/world": world}.get(self.path)
        if not fn:
            return self._json({"error": "not found"}, 404)
        try:
            self._json(fn(body))
        except Exception as e:  # noqa: BLE001  ShellOS 看到非 200 就走规则兜底
            self.log_message("%s 失败：%s", self.path, str(e)[:200])
            self._json({"error": str(e)[:200]}, 502)


if __name__ == "__main__":
    print(f"大脑就绪 127.0.0.1:{PORT}  模型 {MODEL}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
