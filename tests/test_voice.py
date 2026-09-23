"""峰哥语音：缓存命中不联网、TTS 挂了不出声不报错、/voice/last.wav 只念当前这句。不调真 TTS（say / 克隆服务）。"""
from __future__ import annotations
import importlib.util
import json
import os
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from shellos.agent import voice
from shellos.ui.server import Dashboard

WAV = b"RIFF\x24\x00\x00\x00WAVEfake"


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(voice, "URL", "http://127.0.0.1:9")
    monkeypatch.setattr(voice, "DIR", str(tmp_path / "voice"))
    monkeypatch.setattr(voice, "_down_t", -1e9)


@pytest.fixture
def tts(monkeypatch):
    """起 brain/tts.py 的服务，synth 换成假的，记调用次数。"""
    spec = importlib.util.spec_from_file_location("brain_tts", os.path.join(os.path.dirname(__file__), "..", "brain", "tts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    calls = []
    monkeypatch.setattr(mod, "synth", lambda text: calls.append(text) or WAV)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(voice, "URL", f"http://127.0.0.1:{srv.server_address[1]}")
    yield calls
    srv.shutdown()


def test_cache_hit_needs_no_network():
    voice.save("这不就完了吗。", WAV)
    assert voice.get("这不就完了吗。") == WAV


def test_tts_down_is_silent_and_backs_off(monkeypatch):
    assert voice.get("兄弟，站住。") is None
    tried = []
    monkeypatch.setattr(voice.urllib.request, "urlopen", lambda *a, **k: tried.append(1))
    assert voice.get("兄弟，站住。") is None and tried == []      # 20 s 内不再试


def test_fetch_from_brain_tts_then_cached(tts):
    assert voice.get("登顶了？恰恰相反。") == WAV
    assert voice.get("登顶了？恰恰相反。") == WAV
    assert tts == ["登顶了？恰恰相反。"]                          # 第二次走缓存
    assert os.path.isfile(voice.path("登顶了？恰恰相反。"))


def test_brain_tts_rejects_empty_and_long(tts):
    for text in ("", "长" * 201):
        req = urllib.request.Request(voice.URL + "/tts", data=json.dumps({"text": text}).encode())
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=5)
        assert e.value.code == 400
    assert tts == []


def test_dashboard_voice_route_only_speaks_current_line(tts):
    app = SimpleNamespace(fengge=SimpleNamespace(last={"t": "", "event": "", "text": "", "source": ""}))
    dash = Dashboard(app, port=0)
    base = f"http://127.0.0.1:{dash.httpd.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/voice/last.wav") as r:
            assert r.status == 204                                   # 还没有解说：不出声
        app.fengge.last = {"t": "12:00:00", "event": "red", "text": "急什么，站定了再走。", "source": "canned"}
        with urllib.request.urlopen(base + "/voice/last.wav?text=%E5%88%AB%E7%9A%84") as r:
            assert r.status == 200 and r.headers["Content-Type"] == "audio/wav" and r.read() == WAV
        assert tts == ["急什么，站定了再走。"]                        # query 里塞的文字不念
        with urllib.request.urlopen(base + "/voice/voice.js") as r:
            assert b"/voice/last.wav" in r.read()
    finally:
        dash.httpd.shutdown()
