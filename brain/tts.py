"""峰哥语音：文字 → wav，按文字缓存。跑在大脑那台机器上，和 claude_brain.py 并排，独立端口。只用标准库。

  python3 brain/tts.py --clone      # 一次性：把 data/voice/ref/fengge_ref.wav 传给 MiniMax 快速复刻，voice_id 存 data/voice/minimax_voice_id
  python3 brain/tts.py --canned     # 把 shellos/agent/fengge.py 的兜底语录预生成进 data/voice/（断网也有声）
  python3 brain/tts.py --npc        # 把追兵 NPC 的台词（shellos/agent/voice.py NPC_LINES，预设音色）预生成进 data/voice/npc/
  python3 brain/tts.py --clone-npc  # 疾风：用配音演员本人现场新录的参考音频（data/voice/ref/jifeng_ref.m4a，npc_intake.py 生成）快速复刻，9.9 元，球球确认后才跑
  python3 brain/tts.py --npc-candidates   # NPC 候选音色各念 4 句试听，存 data/voice/npc_candidates/<候选名>/，最后打一行 afplay 试听命令
  python3 brain/tts.py              # 起服务，127.0.0.1:8791

展位 MacBook 走同一条 SSH 反向隧道，多转一个口：
  ssh -N -R 8790:127.0.0.1:8790 -R 8791:127.0.0.1:8791 zhongrenfei@100.112.252.66

POST /tts {text[, voice]} → audio/wav（voice 缺省 = 峰哥复刻音色；给了 = MiniMax 系统预设音色 ID 或 voice_setting 字典，J 线追兵 NPC 用，缓存在 data/voice/npc/）（已缓存直接给；say 兜底出来的带 Cache-Control: no-store，ShellOS 不落缓存）
GET  /health
只听 127.0.0.1。

合成走 synth()：MiniMax（brain/.env 里有 MINIMAX_API_KEY 且已 --clone）→ 失败 / 断网 / 没配就 macOS `say -v Tingting`（普通女声，不是峰哥）。
MiniMax 国内站 api.minimax.cn（文档 platform.minimax.cn/docs，快速复刻前账号要先做个人实名认证）；国际站是 api.minimax.io，key 不通用。
换音色后清缓存重生成：rm data/voice/*.wav && python3 brain/tts.py --canned && ./deploy.sh（参考音频在 ref/ 子目录，不会被删）

峰哥是真人：参考音频（YeJe-cpu/talk-to-fengge 里 45 s 的 fengge_ref.wav，剪自他的公开直播）会上传给 MiniMax。
克隆音色只用于比赛原型，展示前当面征得峰哥本人同意；克隆音频只在 data/voice/ 本地缓存，不进 git、不公开发布。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from shellos.agent import voice  # noqa: E402  缓存目录和文件名规则跟 ShellOS 共用一份


def _load_env(path):
    """brain/.env：KEY=VALUE 一行一个，# 开头是注释。已经 export 的环境变量优先。"""
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8"):
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#"):
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


_load_env(os.path.join(HERE, ".env"))
PORT = int(os.environ.get("SHELLOS_TTS_PORT", "8791"))
SAY_VOICE = os.environ.get("SHELLOS_SAY_VOICE", "Tingting")
MM_BASE = os.environ.get("MINIMAX_BASE", "https://api.minimax.cn").rstrip("/")
MM_MODEL = os.environ.get("MINIMAX_MODEL", "speech-2.8-hd")
REF_WAV = os.path.join(voice.DIR, "ref", "fengge_ref.wav")
REF_M4A = os.path.join(voice.DIR, "ref", "fengge_ref.m4a")   # 有就优先传它：开发机上行约 10 KB/s，1.5 MB 的 wav 传不完（afconvert -f m4af -d aac -b 32000）
VOICE_ID_FILE = os.path.join(voice.DIR, "minimax_voice_id")
MAX_CHARS = 200
MM_BACKOFF_S = 30.0
_mm_down_t = -1e9


def _mm_voice_id():
    if os.path.isfile(VOICE_ID_FILE):
        return open(VOICE_ID_FILE).read().strip()
    return ""


def _mm(path, body, ctype="application/json", timeout=10.0):
    """调 MiniMax，返回 JSON。错误也是 HTTP 200，要看 base_resp.status_code。"""
    req = urllib.request.Request(MM_BASE + path, data=body, headers={
        "Authorization": "Bearer " + os.environ["MINIMAX_API_KEY"], "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.load(r)
    br = j.get("base_resp") or {}
    if br.get("status_code", 0) != 0:
        raise RuntimeError(f"MiniMax {path} {br.get('status_code')}: {br.get('status_msg')}")
    return j


MM_TIMEOUT = 15.0                                # 9/23 实测一句 4–10 s；加上退到 say 的时间，要在 ShellOS 那边 25 s 之内


VS_KEYS = ("voice_id", "speed", "pitch", "vol", "emotion")   # voice_setting 里允许从外面传进来的字段


def _voice_setting(voice):
    """"" = 峰哥复刻音色；str = 预设音色 ID；dict = voice_setting（只留 VS_KEYS）。"""
    vs = {"voice_id": _mm_voice_id(), "speed": 1, "vol": 1, "pitch": 0}
    if isinstance(voice, str) and voice:
        vs["voice_id"] = voice
    elif isinstance(voice, dict):
        vs.update({k: voice[k] for k in VS_KEYS if k in voice})
    return vs


def minimax(text: str, voice="") -> bytes:
    j = _mm("/v1/t2a_v2", json.dumps({
        "model": MM_MODEL, "text": text, "stream": False, "output_format": "hex",
        "language_boost": "auto" if voice else "Chinese",   # NPC 台词夹韩语感叹词
        "voice_setting": _voice_setting(voice),
        "audio_setting": {"sample_rate": 24000, "format": "wav", "channel": 1},
    }, ensure_ascii=False).encode(), timeout=MM_TIMEOUT)
    data = bytes.fromhex(j["data"]["audio"])
    if not data.startswith(b"RIFF"):
        raise RuntimeError("MiniMax 返回的不是 wav")
    info = j.get("extra_info") or {}
    sys.stderr.write(f"[tts] minimax {info.get('usage_characters')} 计费字符 {info.get('audio_length')} ms\n")
    return data


def say(text: str) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "a.wav")
        # 文字走 stdin，不当参数：以 - 开头的话不会被当成选项
        subprocess.run(["say", "-v", SAY_VOICE, "--file-format=WAVE", "--data-format=LEI16@22050", "-o", out],
                       input=text.encode(), check=True, timeout=30)
        with open(out, "rb") as f:
            return f.read()


def synth(text: str, voice_id=""):
    """文字 → (wav 字节, 能不能缓存)。MiniMax 配好了但这次失败，say 出来的不缓存，免得恢复后还是女声。
    voice_id = 系统预设音色（NPC）：不需要复刻过，有 key 就行。"""
    global _mm_down_t
    if not (os.environ.get("MINIMAX_API_KEY") and (voice_id or _mm_voice_id())):
        return say(text), True
    if time.time() - _mm_down_t > MM_BACKOFF_S:
        try:
            return minimax(text, voice_id), True
        except Exception as e:  # noqa: BLE001  断网 / 超时 / 限流 / 欠费：退到 say
            _mm_down_t = time.time()
            sys.stderr.write(f"[tts] MiniMax 失败，{MM_BACKOFF_S:.0f} s 内用 say：{str(e)[:200]}\n")
    return say(text), False


def get(text: str, voice_id=""):
    path = voice.path(text, voice_id)
    if os.path.isfile(path):
        with open(path, "rb") as f:
            return f.read(), True
    data, keep = synth(text, voice_id)
    if keep:
        voice.save(text, data, voice_id)
    return data, keep


def clone(ref=None, id_file=None, prefix="Fengge"):
    """上传参考音频 → 快速复刻。花钱：9.9 元/音色，首次用它合成时才扣（MiniMax 按量计费页）。缺省 = 峰哥；--clone-npc = 疾风。"""
    id_file = id_file or VOICE_ID_FILE
    if os.path.isfile(id_file):
        sys.exit(f"已经复刻过：{open(id_file).read().strip()}（重来就删掉 {id_file}）")
    b = uuid.uuid4().hex
    if ref is None:
        ref = REF_M4A if os.path.exists(REF_M4A) else REF_WAV
    ctype = "audio/mp4" if ref.endswith(".m4a") else "audio/wav"
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nvoice_clone\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(ref)}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n").encode() + open(ref, "rb").read() + f"\r\n--{b}--\r\n".encode()
    file_id = _mm("/v1/files/upload", body, "multipart/form-data; boundary=" + b, timeout=180)["file"]["file_id"]
    vid = time.strftime(prefix + "%m%d%H%M%S")       # 规则：8~256 位，字母开头，不能跟已有的重复
    _mm("/v1/voice_clone", json.dumps({"file_id": file_id, "voice_id": vid,
                                       "need_noise_reduction": True, "need_volume_normalization": True}).encode(), timeout=60)
    os.makedirs(os.path.dirname(id_file), exist_ok=True)
    with open(id_file, "w") as f:
        f.write(vid)
    print("复刻好了", vid, "（7 天内不用会被 MiniMax 删掉）")


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("[tts] " + fmt % a + "\n")

    def _send(self, data, ctype, code=200, keep=True):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if not keep:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            mm = bool(os.environ.get("MINIMAX_API_KEY") and _mm_voice_id())
            return self._send(json.dumps({"ok": True, "voice": f"minimax:{MM_MODEL}" if mm else f"say:{SAY_VOICE}"}).encode(),
                              "application/json")
        self._send(b"{}", "application/json", 404)

    def do_POST(self):
        if self.path != "/tts":
            return self._send(b"{}", "application/json", 404)
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        text, vid = str(req.get("text", "")).strip(), req.get("voice") or ""
        vid = {k: vid[k] for k in VS_KEYS if k in vid} if isinstance(vid, dict) else str(vid)[:64]
        if not text or len(text) > MAX_CHARS:
            return self._send(b'{"error":"text"}', "application/json", 400)
        try:
            data, keep = get(text, vid)
            self._send(data, "audio/wav", keep=keep)
        except Exception as e:  # noqa: BLE001  ShellOS 看到非 200 就不出声
            self.log_message("合成失败：%s", str(e)[:200])
            self._send(json.dumps({"error": str(e)[:200]}).encode(), "application/json", 502)


if __name__ == "__main__":
    if "--clone" in sys.argv:
        clone()
        sys.exit(0)
    if "--canned" in sys.argv:
        from shellos.agent.fengge import CANNED
        MM_TIMEOUT, MM_BACKOFF_S = 60.0, 0.0            # 离线预生成：慢点没关系，一句失败别连累后面的
        for line in sorted({s for v in CANNED.values() for s in v}):
            _, keep = get(line)
            print("ok" if keep else "say（MiniMax 失败，没缓存）", voice.key(line), line)
        sys.exit(0)
    if "--clone-npc" in sys.argv:                       # 配音演员本人当面同意、现场新录的参考音频；不是游戏素材
        clone(os.path.join(voice.DIR, "ref", "jifeng_ref.m4a"), voice.NPC_CLONE_ID, "Jifeng")
        sys.exit(0)
    if "--npc-candidates" in sys.argv:                  # 预设音色，按字数计费：4 候选 × 4 句约 220 计费字符，一两毛钱
        MM_TIMEOUT, MM_BACKOFF_S = 60.0, 0.0
        out = os.path.join(voice.DIR, "npc_candidates")
        for name, vs in voice.NPC_CANDIDATES.items():
            if name == "清脆少女":
                continue
            os.makedirs(os.path.join(out, name), exist_ok=True)
            for i, line in enumerate(voice.NPC_AUDITION, 1):
                data, keep = get(line, vs)                  # 顺手进 npc/ 缓存：选中之后 --npc 不用再花这 4 句的钱
                with open(os.path.join(out, name, f"{i}.wav"), "wb") as f:
                    f.write(data)
                print("ok" if keep else "say（MiniMax 失败）", name, i, line)
        print(f'试听：cd "{out}" && for d in */; do echo "== $d"; for f in "$d"*.wav; do afplay "$f"; done; sleep 1; done')
        sys.exit(0)
    if "--npc" in sys.argv:                             # 预设音色，按字数计费（6 句几十个字，几分钱）
        MM_TIMEOUT, MM_BACKOFF_S = 60.0, 0.0
        for line in voice.NPC_LINES:
            _, keep = get(line, voice.NPC_VOICE)
            print("ok" if keep else "say（MiniMax 失败，没缓存）", voice.NPC_VOICE, voice.key(line, voice.NPC_VOICE), line)
        sys.exit(0)
    mm = bool(os.environ.get("MINIMAX_API_KEY") and _mm_voice_id())
    print(f"峰哥语音就绪 127.0.0.1:{PORT}  声音 {'minimax:' + MM_MODEL if mm else 'say:' + SAY_VOICE}")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
