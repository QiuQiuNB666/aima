"""峰哥语音：缓存命中不联网、TTS 挂了不出声不报错、/voice/last.wav 只念当前这句、MiniMax 失败退到 say 且不缓存。
不调真 TTS：say 换成假的，MiniMax 是本机假服务。"""
from __future__ import annotations
import importlib.util
import json
import os
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from shellos.agent import voice
from shellos.ui.server import Dashboard

WAV = b"RIFF\x24\x00\x00\x00WAVEfake"
SAY = b"RIFF\x24\x00\x00\x00WAVEsay"
urlopen = urllib.request.build_opener(urllib.request.ProxyHandler({})).open     # 本机端口不走系统代理


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(voice, "URL", "http://127.0.0.1:9")
    monkeypatch.setattr(voice, "DIR", str(tmp_path / "voice"))
    monkeypatch.setattr(voice, "_down_t", -1e9)


@pytest.fixture
def brain_tts(monkeypatch, tmp_path):
    """brain/tts.py 模块：key 是假的、MiniMax 指向连不上的端口、voice_id / 参考音频都在 tmp。"""
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")          # 先占住，brain/.env 里真 key 不会被读进来
    spec = importlib.util.spec_from_file_location("brain_tts", os.path.join(os.path.dirname(__file__), "..", "brain", "tts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "MM_BASE", "http://127.0.0.1:9")
    monkeypatch.setattr(mod, "VOICE_ID_FILE", str(tmp_path / "voice_id"))
    monkeypatch.setattr(mod, "REF_WAV", str(tmp_path / "ref.wav"))
    monkeypatch.setattr(mod, "say", lambda text: SAY)
    return mod


@pytest.fixture
def minimax(brain_tts, monkeypatch):
    """假 MiniMax：记下每个请求，按路径回 JSON。"""
    seen, replies = [], {}

    class FakeMM(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            seen.append((self.path, self.headers["Authorization"], self.headers["Content-Type"], body))
            out = json.dumps(replies[self.path]).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeMM)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(brain_tts, "MM_BASE", f"http://127.0.0.1:{srv.server_address[1]}")
    yield SimpleNamespace(seen=seen, replies=replies)
    srv.shutdown()


@pytest.fixture
def tts(brain_tts, monkeypatch):
    """起 brain/tts.py 的服务，synth 换成假的，记调用次数。"""
    mod = brain_tts
    calls = []
    monkeypatch.setattr(mod, "synth", lambda text, vid="": (calls.append(text if not vid else (vid, text)) or WAV, True))
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
    monkeypatch.setattr(voice, "_open", lambda *a, **k: tried.append(1))
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
            urlopen(req, timeout=5)
        assert e.value.code == 400
    assert tts == []


def test_dashboard_voice_route_only_speaks_current_line(tts):
    app = SimpleNamespace(fengge=SimpleNamespace(last={"t": "", "event": "", "text": "", "source": ""}))
    dash = Dashboard(app, port=0)
    base = f"http://127.0.0.1:{dash.httpd.server_address[1]}"
    try:
        with urlopen(base + "/voice/last.wav") as r:
            assert r.status == 204                                   # 还没有解说：不出声
        app.fengge.last = {"t": "12:00:00", "event": "red", "text": "急什么，站定了再走。", "source": "canned"}
        with urlopen(base + "/voice/last.wav?text=%E5%88%AB%E7%9A%84") as r:
            assert r.status == 200 and r.headers["Content-Type"] == "audio/wav" and r.read() == WAV
        assert tts == ["急什么，站定了再走。"]                        # query 里塞的文字不念
        with urlopen(base + "/voice/voice.js") as r:
            assert b"/voice/last.wav" in r.read()
    finally:
        dash.httpd.shutdown()


def test_minimax_t2a_request_and_cache(brain_tts, minimax):
    open(brain_tts.VOICE_ID_FILE, "w").write("Fengge0923120000")
    minimax.replies["/v1/t2a_v2"] = {"data": {"audio": WAV.hex()}, "extra_info": {"usage_characters": 5},
                                     "base_resp": {"status_code": 0, "status_msg": "success"}}
    assert brain_tts.get("这不就完了吗") == (WAV, True)
    path, auth, _, body = minimax.seen[0]
    req = json.loads(body)
    assert path == "/v1/t2a_v2" and auth == "Bearer test-key"
    assert req["voice_setting"]["voice_id"] == "Fengge0923120000" and req["audio_setting"]["format"] == "wav"
    assert req["model"] == brain_tts.MM_MODEL and req["stream"] is False
    assert brain_tts.get("这不就完了吗") == (WAV, True) and len(minimax.seen) == 1      # 第二次走缓存，不再花钱


def test_minimax_error_falls_back_to_say_not_cached(brain_tts, minimax, monkeypatch):
    open(brain_tts.VOICE_ID_FILE, "w").write("Fengge0923120000")
    minimax.replies["/v1/t2a_v2"] = {"base_resp": {"status_code": 1008, "status_msg": "insufficient balance"}}
    srv = ThreadingHTTPServer(("127.0.0.1", 0), brain_tts.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(voice, "URL", f"http://127.0.0.1:{srv.server_address[1]}")
    try:
        assert voice.get("红灯是好事儿啊") == SAY                       # 欠费 → say 顶上，照样出声
        assert not os.path.isfile(voice.path("红灯是好事儿啊"))          # 大脑和 ShellOS 两边都不缓存女声
        assert voice.get("红灯是好事儿啊") == SAY and len(minimax.seen) == 1   # 30 s 内不再打 MiniMax
    finally:
        srv.shutdown()


def test_say_when_minimax_not_set_up_or_unreachable(brain_tts, monkeypatch):
    assert brain_tts.synth("这不就完了吗") == (SAY, True)                # 有 key 没复刻：say，可缓存
    open(brain_tts.VOICE_ID_FILE, "w").write("Fengge0923120000")
    assert brain_tts.synth("这不就完了吗") == (SAY, False)               # 配好了但连不上：say，不缓存
    monkeypatch.delenv("MINIMAX_API_KEY")
    assert brain_tts.synth("这不就完了吗") == (SAY, True)                # 没 key：say，可缓存


def test_clone_uploads_ref_and_saves_voice_id_once(brain_tts, minimax):
    open(brain_tts.REF_WAV, "wb").write(b"RIFFrefaudio")
    minimax.replies["/v1/files/upload"] = {"file": {"file_id": 42}, "base_resp": {"status_code": 0}}
    minimax.replies["/v1/voice_clone"] = {"base_resp": {"status_code": 0, "status_msg": "success"}}
    brain_tts.clone()
    (p1, auth, ct, body), (p2, _, _, body2) = minimax.seen
    assert p1 == "/v1/files/upload" and auth == "Bearer test-key" and ct.startswith("multipart/form-data; boundary=")
    assert b'name="purpose"\r\n\r\nvoice_clone\r\n' in body and b"RIFFrefaudio" in body
    req, vid = json.loads(body2), open(brain_tts.VOICE_ID_FILE).read()
    assert p2 == "/v1/voice_clone" and req["file_id"] == 42 and req["voice_id"] == vid
    assert vid[0].isalpha() and len(vid) >= 8
    with pytest.raises(SystemExit):
        brain_tts.clone()                                                  # 复刻过就不再传、不再花钱
    assert len(minimax.seen) == 2


def test_clone_without_verification_saves_nothing(brain_tts, minimax):
    open(brain_tts.REF_WAV, "wb").write(b"RIFFrefaudio")
    minimax.replies["/v1/files/upload"] = {"file": {"file_id": 42}, "base_resp": {"status_code": 0}}
    minimax.replies["/v1/voice_clone"] = {"base_resp": {"status_code": 2038, "status_msg": "no clone permission"}}
    with pytest.raises(RuntimeError, match="2038"):
        brain_tts.clone()
    assert not os.path.isfile(brain_tts.VOICE_ID_FILE)


def test_npc_route_whitelist_and_separate_cache(tts):
    """追兵 NPC：只念白名单台词、用预设音色、缓存在 npc/ 子目录，不和峰哥混。"""
    import re
    import urllib.parse
    js = open(os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "game", "npc.js"), encoding="utf-8").read()
    body = re.search(r"const LINES = \{(.*?)\};", js, re.S).group(1)
    assert set(re.findall(r"'([^']+)'", body)) - set(re.findall(r"^\s*(\w+):", body, re.M)) <= set(voice.NPC_LINES)
    dash = Dashboard(SimpleNamespace(fengge=SimpleNamespace(last={})), port=0)
    base = f"http://127.0.0.1:{dash.httpd.server_address[1]}/voice/npc.wav?t="
    try:
        line = voice.NPC_LINES[2]
        with urlopen(base + urllib.parse.quote(line)) as r:
            assert r.status == 200 and r.read() == WAV
        with urlopen(base + urllib.parse.quote("随便念一句")) as r:
            assert r.status == 204                                          # 不在白名单：不出声、不花钱
        assert tts == [(voice.NPC_VOICE, line)]
        assert os.path.isfile(voice.path(line, voice.NPC_VOICE)) and "npc" in voice.path(line, voice.NPC_VOICE)
        assert not os.path.isfile(voice.path(line))                          # 峰哥那份没被占
    finally:
        dash.httpd.shutdown()


def test_minimax_preset_voice_needs_no_clone(brain_tts, minimax):
    minimax.replies["/v1/t2a_v2"] = {"data": {"audio": WAV.hex()}, "base_resp": {"status_code": 0}}
    assert brain_tts.synth("风起了", "female-shaonv") == (WAV, True)       # 没复刻过也能用预设音色
    assert json.loads(minimax.seen[0][3])["voice_setting"]["voice_id"] == "female-shaonv"


def test_npc_voice_setting_passed_through(brain_tts, minimax, tts):
    """候选音色：语速 / 音高 / 情绪原样传给 MiniMax（多余字段丢掉），夹韩语用 language_boost=auto；参数不同缓存也分开。"""
    minimax.replies["/v1/t2a_v2"] = {"data": {"audio": WAV.hex()}, "base_resp": {"status_code": 0}}
    vs = dict(voice.NPC_CANDIDATES["B_韩语冷漠女孩"], label="不该传")
    brain_tts.minimax(voice.NPC_AUDITION[1], vs)
    req = json.loads(minimax.seen[0][3])
    assert req["voice_setting"] == {"voice_id": "Korean_ColdGirl", "speed": 1.25, "vol": 1, "pitch": 1, "emotion": "disgusted"}
    assert req["language_boost"] == "auto"
    a, b = voice.NPC_CANDIDATES["A_嚣张小姐"], dict(voice.NPC_CANDIDATES["A_嚣张小姐"], speed=1.1)
    assert voice.path("逮到了", a) != voice.path("逮到了", b)
    assert voice.get("逮到了", voice=a) == WAV and tts == [(a, "逮到了")]   # ShellOS → tts.py 走 HTTP 时字典也原样带过去
