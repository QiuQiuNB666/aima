"""峰哥语音（ShellOS 这边）：解说文字 → wav。纯 urllib，零依赖，Python 3.9 可跑。

先查本地缓存 data/voice/（兜底语录由 `brain/tts.py --canned` 预生成，deploy.sh 顺带同步到 MacBook），
没有再向 brain/tts.py 要（SHELLOS_TTS，默认 http://127.0.0.1:8791，展位走 SSH 反向隧道），拿到就存进缓存。
任何失败都返回 None，页面就不出声；连不上之后 20 s 内不再试。
data/voice/ 可能是克隆音色，不进 git（目录里有 .gitignore）。
"""
from __future__ import annotations
import hashlib
import json
import os
import threading
import time
import urllib.request

URL = os.environ.get("SHELLOS_TTS", "http://127.0.0.1:8791").rstrip("/")
DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "voice"))
BACKOFF_S = 20.0
_down_t = -1e9
_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open    # 不走系统代理（MacBook 的 Shadowrocket 会截走 127.0.0.1）
# J 线追兵 NPC「捷风」：MiniMax 系统预设音色（官方系统音色列表里的，不复刻任何真人、不用游戏音频），台词原创、白名单——/voice/npc.wav 只念这几句。
# NPC_LINES 和 static/game/npc.js 的 LINES 保持一致（tests/test_voice.py 会对一遍）。
# 声音优先级：① 配音演员本人当面同意、现场新录的真人录音（data/voice/npc/real/，brain/npc_intake.py 切好放进去）；
#   ② 用本人新录的参考音频快速复刻的音色（data/voice/npc_voice_id，brain/tts.py --clone-npc）；③ 下面的系统预设候选音色。
# 预设音色 = 一份 voice_setting（voice_id + 语速 / 音高 / 情绪）；强制用某个候选：SHELLOS_NPC_VOICE=<候选名>，再跑 brain/tts.py --npc。
# 顺序 = 录音台词单 docs/提交/捷风录音台词单.md 的编号 01–11（npc_intake.py 按编号对文件）。
NPC_LINES = ("가자！你先跑三秒。", "就这？빨리빨리！", "逮到了，慢死了。", "哟，跑挺快嘛。", "又是我先到，拜。", "啧，算你走运。",
             "喂！我还没热身呢。", "回头看看？我在这儿。", "红灯。站好，我也不动。", "绿灯了，가자！", "山顶风大，站稳了。")
NPC_AUDITION = (NPC_LINES[0], NPC_LINES[1], NPC_LINES[2], NPC_LINES[5])   # 试听用的 4 句（brain/tts.py --npc-candidates）
NPC_CANDIDATES = {   # 年轻、清亮、偏冷酷 / 痞帅；speed 1.1–1.3、pitch、emotion（speech-2.8-hd 支持 happy/sad/angry/fearful/disgusted/surprised/calm/fluent）
    "A_嚣张小姐": {"voice_id": "Arrogant_Miss", "speed": 1.2, "pitch": 1, "emotion": "happy"},                 # 官方描述：嚣张自信，展现优越感
    "B_韩语冷漠女孩": {"voice_id": "Korean_ColdGirl", "speed": 1.25, "pitch": 1, "emotion": "disgusted"},      # 冷漠的青年女孩，韩语；嫌弃 = 嘲讽
    "C_韩语女冒险家": {"voice_id": "Korean_BraveAdventurer", "speed": 1.25, "pitch": 2, "emotion": "angry"},   # 活泼勇敢的青年女冒险家，韩语
    "D_俏皮萌妹": {"voice_id": "qiaopi_mengmei", "speed": 1.3, "pitch": -1, "emotion": "surprised"},           # 俏皮，音高压低一点去掉奶气
    "清脆少女": {"voice_id": "Chinese (Mandarin)_Crisp_Girl"},                                                 # 第一版，球球试听说一点都不像
}
# 9/23 夜起缺省 NPC 换成「峰哥的助理」（捷风旧版 ?npc=jifeng，上面那套不动）。15 句干练的助理话术，和 static/game/assistant/lines.js 同顺序；
#   MiniMax 系统预设女声（不用真人录音）；`python3 brain/tts.py --asst` 预生成，/voice/npc.wav 对这些句子只读缓存、不现场合成。
ASST_LINES = ("出发！我在前面带路。", "看前面，到地标了。", "这段路我查过，跟着我。", "红灯，先停一下。", "绿灯了，走吧。",
              "节奏很好，保持住。", "台阶来了，抬脚。", "下坡慢一点，膝盖放松。", "氧气给你，慢慢吸。", "排队呢，我在前面挡着。",
              "到你了，上！", "登顶了！来，击个掌！", "喝口水，歇十秒。", "风大，拉好拉链。", "我在这儿，你慢慢来。")
ASST_VOICE = {"voice_id": "Chinese (Mandarin)_Warm_Bestie", "speed": 1.05, "pitch": 0}   # 官方描述：温暖清脆的青年女性，标准普通话，友好而清晰


def cached(text, voice=""):
    """只读缓存：有就返回 wav，没有就 None（不联网、不合成）。"""
    p = path(text, voice)
    if os.path.isfile(p):
        with open(p, "rb") as f:
            return f.read()
    return None


NPC_CLONE_ID = os.path.join(DIR, "npc_voice_id")


def _npc_voice():
    name = os.environ.get("SHELLOS_NPC_VOICE")
    if not name and os.path.isfile(NPC_CLONE_ID):
        return {"voice_id": open(NPC_CLONE_ID).read().strip()}
    return NPC_CANDIDATES[name or "清脆少女"]


NPC_VOICE = _npc_voice()
_lock = threading.Lock()   # ponytail: 全局锁，同一句两个页面同时要只合成一次；多句并发合成再换按文字加锁


def key(text, voice=""):
    if isinstance(voice, dict):    # voice_setting：语速 / 音高 / 情绪不同就是不同的音
        voice = json.dumps(voice, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1((voice + "|" + text if voice else text).encode()).hexdigest()[:16]


def path(text, voice=""):
    """voice 空 = 峰哥（data/voice/）；给了预设音色（ID 或 voice_setting）= NPC（data/voice/npc/，不和峰哥的混）。"""
    return os.path.join(DIR, "npc", key(text, voice) + ".wav") if voice else os.path.join(DIR, key(text) + ".wav")


def real_path(text):
    """真人录音（NPC）：按文字存，和音色无关。"""
    return os.path.join(DIR, "npc", "real", key(text) + ".wav")


def real(text):
    p = real_path(text)
    if os.path.isfile(p):
        with open(p, "rb") as f:
            return f.read()
    return None


def save(text, data, voice=""):
    p = path(text, voice)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "wb") as f:
        f.write(data)
    os.replace(p + ".tmp", p)


def get(text, timeout=25.0, voice=""):    # MiniMax 实测一句 10 s 上下，宁可晚念也别退成女声
    global _down_t
    if not text:
        return None
    with _lock:
        if os.path.isfile(path(text, voice)):
            with open(path(text, voice), "rb") as f:
                return f.read()
        if time.time() - _down_t < BACKOFF_S:
            return None
        body = {"text": text, "voice": voice} if voice else {"text": text}
        req = urllib.request.Request(URL + "/tts", data=json.dumps(body, ensure_ascii=False).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with _open(req, timeout=timeout) as r:
                data, keep = r.read(), r.headers.get("Cache-Control") != "no-store"
        except Exception:  # noqa: BLE001  TTS 没开 / 断网 / 超时 / 502：不出声
            _down_t = time.time()
            return None
        if keep:                   # no-store = 克隆音色这次失败、退到 say 念的，下次还要再问
            save(text, data, voice)
        return data
