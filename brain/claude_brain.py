"""ShellOS 的「大脑」：唯一调 Claude 的进程。和 ShellOS 分开跑，理由三条：
  1. anthropic SDK 1.x 要 Python ≥3.10，展位 MacBook 是 3.9；ShellOS 本体坚持零新依赖。
  2. MacBook 直连 api.anthropic.com 返回 403；大脑跑在能连上的机器，MacBook 走 SSH 反向隧道：
       ssh -N -R 8790:127.0.0.1:8790 zhongrenfei@100.112.252.66
     MacBook 上的 ShellOS 访问自己的 127.0.0.1:8790 = 这台机器的大脑。
  3. 大脑挂了 / 断网 / 超时，ShellOS 退回规则表，腿上的安全链路不经过这里。

  python3 -m venv brain/.venv && brain/.venv/bin/pip install anthropic
  export ANTHROPIC_API_KEY=...          # 或 ant auth login
  brain/.venv/bin/python brain/claude_brain.py

后端：有 Claude 凭据（ANTHROPIC_API_KEY / ant auth login）→ claude；否则 brain/.env 里有 MINIMAX_API_KEY → minimax
（同一个官方 SDK，只换 base_url；和 tts.py 读同一个 .env）；都没有 → none，请求回 502 kind=no_key。
MiniMax 的 Anthropic 兼容接口没有 output_config / betas / fallbacks：结构化输出改成强制调用一个工具（input_schema = 同一份 schema）。

POST /coach  {quote, controller, params:{k:[cur,lo,hi]}, profile}  → {changes:[{param,delta}], confidence, why}
POST /world  {text, styles:[...], kinds:[...]}                      → 世界草稿（ShellOS 再校验、裁剪、套主题）
POST /fengge {event: summit|red|world|ghost, ctx}                     → {line}：峰哥口吻一句解说
GET  /health  → {ok, model, key, backend}：key 只是布尔（有没有凭据），不回显 key
失败统一 502 {error, kind}，kind ∈ no_key / auth / refusal / timeout / rate_limit / overloaded / net / error，ShellOS 仪表盘据此显示是哪一种。
只听 127.0.0.1。
"""
from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import anthropic

from tts import _load_env                   # brain/.env 的读法和 TTS 共用一份

HERE = os.path.dirname(os.path.abspath(__file__))
_load_env(os.path.join(HERE, ".env"))
MODEL = os.environ.get("SHELLOS_CLAUDE_MODEL", "claude-opus-5")
PORT = int(os.environ.get("SHELLOS_BRAIN_PORT", "8790"))
# 国内站；platform.minimaxi.com 文档写 api.minimax.cn，这台机器上 api.minimaxi.com 建连快 2~4 倍，两个都通
MM_BASE = os.environ.get("MINIMAX_ANTHROPIC_BASE", "https://api.minimaxi.com/anthropic")
MM_MODELS = {"coach": os.environ.get("SHELLOS_MM_FAST", "MiniMax-M3"),       # M3 默认不思考，比关不掉思考的 M2.7-highspeed 快
             "fengge": os.environ.get("SHELLOS_MM_FAST", "MiniMax-M3"),
             "world": os.environ.get("SHELLOS_MM_WORLD", "MiniMax-M3")}

client = anthropic.Anthropic()
if client.api_key or client.auth_token or client.credentials:
    BACKEND = "claude"
elif os.environ.get("MINIMAX_API_KEY"):
    BACKEND = "minimax"
    client = anthropic.Anthropic(api_key=os.environ["MINIMAX_API_KEY"], base_url=MM_BASE)
else:
    BACKEND = "none"                         # 请求时 SDK 抛 TypeError → kind=no_key


def ask(prompt: str, schema: dict, effort: str, max_tokens: int, role: str = "coach") -> dict:
    if BACKEND == "minimax":
        return ask_minimax(prompt, schema, max_tokens, role)
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
    out["_model"], out["_usage"] = r.model, [r.usage.input_tokens, r.usage.output_tokens]
    return out


def ask_minimax(prompt: str, schema: dict, max_tokens: int, role: str) -> dict:
    """强制工具调用拿结构化结果。M2.x 的思考关不掉，M3 默认不思考。schema 不严格执行，ShellOS 那边照样校验裁剪。"""
    # 教练 / 峰哥要快：MiniMax 偶尔整条请求卡住（131 个 token 等了 18 s），5 s 没回就让 SDK 自己重发一次，最坏 ~10 s < ShellOS 的 12 s
    # 造山正常 4–13 s，偶尔卡到 30 s+：20 s 没回重发一次，最坏 ~40 s < ShellOS 的 90 s
    c = client.with_options(timeout=20.0 if role == "world" else 5.0, max_retries=1)
    for _ in range(2):                         # M3 偶尔无视 tool_choice 直接回文字（30 次里 1~2 次）：文字是 JSON 就用，不是再问一次
        r = c.messages.create(
            model=MM_MODELS[role],
            extra_body={"temperature": 0.1 if role == "coach" else 1.0},   # 教练要稳；SDK 1.x 已没有 temperature 形参
            max_tokens=max_tokens,
            tools=[{"name": "answer", "description": "提交结果", "input_schema": schema}],
            tool_choice={"type": "tool", "name": "answer"},
            messages=[{"role": "user", "content": prompt}],
        )
        if r.stop_reason == "max_tokens":
            raise RuntimeError("max_tokens")
        out = next((b.input for b in r.content if b.type == "tool_use"), None)
        if isinstance(out, dict):
            break
        text = "".join(getattr(b, "text", "") for b in r.content)
        try:                                   # 回的文字本身常常就是那份 JSON
            out = json.loads(text[text.index("{"):text.rindex("}") + 1])
            break
        except ValueError:
            pass
        sys.stderr.write(f"[brain] {role} 没调工具（{r.stop_reason}）：{text[:120]}\n")
    else:
        raise RuntimeError(f"没调工具：{r.stop_reason}")
    out["_model"], out["_usage"] = r.model, [r.usage.input_tokens, r.usage.output_tokens]
    return out


# 地形控制律各参数管哪段路（和 shellos/control/terrain.py 的 pulse() 对齐）
TERRAIN = (
    "terrain 控制律各参数管什么：\n"
    "- strength：所有路段共用的力度（Nm）。上坡在后面推，下坡拖住，上台阶是阻力（越大越沉越费劲），下台阶是助力。\n"
    "- impact：只管下台阶脚落地那一下「往下一沉」（strength 的倍数）。\n"
    "- t_push 上坡推的时机；t_step 上台阶阻力的时机；t_brake 下坡 / 下台阶的时机。\n"
    "- width：每一下的长短，越大越长越柔。\n"
    "没提路段 = 对所有路段说的：力度调 strength，时机把 t_push / t_step / t_brake 三个一起挪同样的量。"
    "提了上坡 / 上楼 / 下楼 / 落地，就只调那一段对应的参数。"
    "下楼时嫌「冲 / 砸 / 震 / 顿」是落地那一下 → 调 impact，不是时机；上楼嫌费劲、腿沉是阻力太大 → strength 减，不是时机。\n"
)
# 例句故意不用 scripts/eval_coach.py 里的测评句，免得对着考题调
RULES = (
    "怎么翻：\n"
    "1. 时机先分抱怨还是要求。抱怨现状：「太早了」→ 往晚（t 加），「太晚了」「慢半拍」→ 往早（t 减）；"
    "提要求：「早一点」→ t 减，「晚一点」→ t 加。\n"
    "2. 力度：「没感觉 / 不明显 / 不够劲 / 再来 / 更强」→ 加；「太猛 / 太冲 / 太累 / 太陡 / 太重 / 轻一点」→ 减"
    "（这是登山游戏，「太陡」「太累」说的是腿上的力太大）。\n"
    "3. 长短：「太短 / 一闪就过去」→ width 加；「太长 / 拖泥带水」→ width 减。\n"
    "4. 只改说到的那一件事，一句话说了两件事才改两件。幅度：力度 ±0.5，时机 ±5，width ±3，impact ±0.3，增益 ±0.03，延迟 ±0.03 s。\n"
    "5. 很短的一句（两三个字）也要照常翻；只有明显跟腿上的力无关（聊天、夸舒服）才返回空 changes。\n"
    "例：「推得跟没推一样」→ strength +0.5；「节奏慢半拍」→ t_push、t_step、t_brake 各 −5；"
    "「下坡那段拽得太早」→ t_brake +5；「下台阶一落地像踩空」→ impact +0.3。\n"
)


def coach(b: dict) -> dict:
    params = b["params"]
    ptab = "\n".join(f"- {k}: 当前 {v[0]:g}，范围 {v[1]:g}~{v[2]:g}" for k, v in params.items())
    prompt = (
        "你是一台髋关节外骨骼的调参教练，把穿戴者边走边说的一句话翻成参数差值（不是绝对值）。\n"
        f"当前控制律 {b['controller']}，参数：\n{ptab}\n"
        f"穿戴者画像：{json.dumps(b.get('profile', {}), ensure_ascii=False)}\n"
        "通用含义：strength / peak_* 是力矩峰值 Nm；t_* 是脉冲在步态周期里的位置（%，脚跟着地=0，加 = 更晚）；"
        "width 是脉冲宽度 %；gain / delay_s 是 DOFC 增益和延迟；bias_* / tl / tr 是左右偏置。\n"
        + (TERRAIN if b["controller"] == "terrain" else "") + RULES +
        f"why 一句中文，不超过 25 个字，说给评委听。\n\n穿戴者说：「{b['quote']}」"
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


# 人设节选自 github.com/YixiaJack/feng-ge-skill（MIT）的 SKILL.md，只留口吻，展位用不碰两性 / 政治
FENGGE = (
    "你在一个叫「峰哥亡命天涯」的体感登山游戏里当解说，口吻模仿 B 站 UP 主峰哥亡命天涯：\n"
    "- 辩证反转（赢学）：坏事先说「这是个好事儿啊」再讲为什么；好事就「恰恰相反」提醒别飘。\n"
    "- 短句，口语，一本正经地说荒诞的话；自称「我」或「老峰」，对玩家说「兄弟」或「你」。\n"
    "- 常用收尾：「这不就完了吗」「面子有什么用」。不煽情，平淡语气说事。\n"
    "- 绝对不碰：两性 / 性相关的黑话、政治、封号、真实人物的私事；不冒充他本人讲真实经历。\n"
    "只说一句，不超过 30 个字，不加引号。"
)
EVENTS = {
    "summit": "玩家刚登顶。数据：{ctx}。评一句（破纪录 / 输给影子 / 第一次，都能说成赢）。",
    "red": "玩家在「{ctx}」遇到红灯，必须站定 2 秒才能走。劝他停下。",
    "world": "现场刚造了一座山：{ctx}。给这座山来一句开场白。",
    "ghost": "{ctx}。评一句。",
}


def fengge(b: dict) -> dict:
    ev = EVENTS.get(b.get("event"), "{ctx}").format(ctx=json.dumps(b.get("ctx", {}), ensure_ascii=False))
    schema = {"type": "object", "properties": {"line": {"type": "string"}}, "required": ["line"], "additionalProperties": False}
    return ask(FENGGE + "\n\n" + ev, schema, effort="low", max_tokens=2000, role="fengge")


# 风格 → 画面长什么样（给模型选风格用；ShellOS 没有的风格不会出现在 b["styles"] 里）
STYLE_HINT = {"cyber_night": "霓虹雨夜的城市、天桥、楼梯", "dawn_mountain": "晨光里的石阶名山，泰山华山这类，没有更贴的就选它",
              "night_to_dawn": "夜爬星空到日出，富士山这类", "subtropical": "亚热带绿山、雾、城市天际线",
              "grid": "训练场网格，抽象", "snow_summit": "雪山冰川、高海拔，珠峰这类", "cliff_path": "悬崖栈道、绝壁，华山长空栈道这类"}


def world(b: dict) -> dict:
    prompt = (
        f"评委说：「{b['text']}」\n"
        "请据此设计一条登山/行走路线，给穿外骨骼、原地踏步的人玩。每走一步前进一格，路段决定腿上的力：\n"
        "flat 平地无力；up 上坡（后面有人推）；down 下坡（腿被拖住）；stairs_up 上台阶（蹬+抬腿）；"
        "stairs_down 下台阶；wait 红灯（要站定 2 秒才放行）。\n"
        "画面风格只能从这些里选一个最贴切的：" + "；".join(f"{k}（{STYLE_HINT.get(k, '')}）" for k in b["styles"]) + "\n"
        "name 是这条路线 / 这座山自己的名字（≤10 字，如「泰山十八盘」「乐高冰淇淋山」），不要用游戏名；"
        "alt_start / alt_end 是起点和终点的海拔（米），真实的山按真实海拔，虚构的给个合理的数。\n"
        "约束：总步数 30~70；4~9 段；起点是 flat；台阶段合计不超过总步数一半；wait 最多 2 段、每段 1 步；"
        "每段 label 是 2~8 个字的地名/路标；name ≤ 10 字；subtitle 用「A → B → C」串起关键路段；"
        "游戏叫「峰哥亡命天涯」：story 一两句、第二人称，summit_text 是登顶时屏幕上的一句话，这两个用峰哥的口吻（辩证反转、短句、「这是个好事儿啊」），不碰两性和政治。真实地点就按真实地形比例压缩，虚构的也要自洽。"
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
    return ask(prompt, schema, effort="medium", max_tokens=16000, role="world")


def has_key() -> bool:
    return BACKEND != "none"


def kind(e: Exception) -> str:
    """异常 → 一个词，给仪表盘看是哪种失败。"""
    if isinstance(e, TypeError) and "authentication" in str(e):
        return "no_key"                        # 没 export key、也没 ant auth login
    for cls, k in ((anthropic.AuthenticationError, "auth"), (anthropic.PermissionDeniedError, "auth"),
                   (anthropic.APITimeoutError, "timeout"), (anthropic.RateLimitError, "rate_limit"),
                   (anthropic.InternalServerError, "overloaded"), (anthropic.APIConnectionError, "net")):
        if isinstance(e, cls):
            return k
    return "refusal" if str(e).startswith("refusal") else "error"


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
            model = MODEL if BACKEND == "claude" else f"{MM_MODELS['coach']} / {MM_MODELS['world']}" if BACKEND == "minimax" else ""
            return self._json({"ok": True, "model": model, "key": has_key(), "backend": BACKEND})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        fn = {"/coach": coach, "/world": world, "/fengge": fengge}.get(self.path)
        if not fn:
            return self._json({"error": "not found"}, 404)
        try:
            t0 = time.time()
            out = fn(body)
            self.log_message("%s %s %.1fs tokens 入/出 %s", self.path, out.get("_model"), time.time() - t0, out.get("_usage"))
            self._json(out)
        except Exception as e:  # noqa: BLE001  ShellOS 看到非 200 就走规则兜底
            self.log_message("%s 失败（%s）：%s", self.path, kind(e), str(e)[:200])
            self._json({"error": str(e)[:200], "kind": kind(e)}, 502)


if __name__ == "__main__":
    print(f"大脑就绪 127.0.0.1:{PORT}  后端 {BACKEND}  " + (
        f"模型 {MODEL}" if BACKEND == "claude" else f"模型 {MM_MODELS}" if BACKEND == "minimax" else
        "没有凭据（export ANTHROPIC_API_KEY / ant auth login，或 brain/.env 写 MINIMAX_API_KEY）"))
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
