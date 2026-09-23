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
_lock = threading.Lock()   # ponytail: 全局锁，同一句两个页面同时要只合成一次；多句并发合成再换按文字加锁


def key(text):
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def path(text):
    return os.path.join(DIR, key(text) + ".wav")


def save(text, data):
    os.makedirs(DIR, exist_ok=True)
    tmp = path(text) + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path(text))


def get(text, timeout=15.0):
    global _down_t
    if not text:
        return None
    with _lock:
        if os.path.isfile(path(text)):
            with open(path(text), "rb") as f:
                return f.read()
        if time.time() - _down_t < BACKOFF_S:
            return None
        req = urllib.request.Request(URL + "/tts", data=json.dumps({"text": text}, ensure_ascii=False).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data, keep = r.read(), r.headers.get("Cache-Control") != "no-store"
        except Exception:  # noqa: BLE001  TTS 没开 / 断网 / 超时 / 502：不出声
            _down_t = time.time()
            return None
        if keep:                   # no-store = 克隆音色这次失败、退到 say 念的，下次还要再问
            save(text, data)
        return data
