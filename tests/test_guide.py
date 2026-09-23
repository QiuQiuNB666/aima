"""G 线峰哥导游：每个内置世界都有导游词；/guide/* 只读缓存，没缓存不现场合成。"""
import json
import os
import shutil
import subprocess
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

from shellos import worlds
from shellos.agent import guide, voice
from shellos.ui.server import Dashboard


def test_every_world_has_lines():
    for w in worlds.WORLDS:
        if not w.startswith("gen_"):
            ls = guide.lines(w)
            assert ls and "R2" in ls[-1], w                       # 最后一句引导按 R2
            assert all(len(s) <= 40 for s in ls), w                # 一句一个气泡
    assert sum(len(s) for ls in guide.GUIDE.values() for s in ls) <= 5000


def test_route_reads_cache_only(monkeypatch, tmp_path):
    monkeypatch.setattr(voice, "DIR", str(tmp_path))
    monkeypatch.setattr(voice, "get", lambda *a, **k: pytest.fail("导游不该现场合成"))
    line = guide.lines("tokyo_night")[1]
    open(voice.path(line), "wb").write(b"RIFFguide")
    dash = Dashboard(SimpleNamespace(fengge=SimpleNamespace(last={})), port=0)
    base = f"http://127.0.0.1:{dash.httpd.server_address[1]}/guide/"
    try:
        assert json.load(urlopen(base + "tokyo_night.json"))["lines"] == guide.lines("tokyo_night")
        assert json.load(urlopen(base + "gen_abc.json"))["lines"] == []
        assert urlopen(base + "tokyo_night/1.wav").read() == b"RIFFguide"
        for bad in ("tokyo_night/0.wav", "tokyo_night/99.wav", "tokyo_night/x.wav", "nope/0.wav"):
            with pytest.raises(HTTPError) as e:
                urlopen(base + bad)
            assert e.value.code == 404, bad
        assert os.listdir(str(tmp_path)) == [os.path.basename(voice.path(line))]
    finally:
        dash.httpd.shutdown()


def test_missing_and_check(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(voice, "DIR", str(tmp_path))
    monkeypatch.setattr(voice, "get", lambda *a, **k: pytest.fail("fill=False 不该去要语音"))
    n = sum(map(len, guide.GUIDE.values()))
    assert len(guide.missing()) == n
    line = guide.lines("tokyo_night")[0]
    open(voice.path(line), "wb").write(b"RIFF")
    miss = guide.check()
    assert len(miss) == n - sum(s == line for ls in guide.GUIDE.values() for s in ls)
    assert "tokyo_night/1" in capsys.readouterr().out


@pytest.mark.skipif(not shutil.which("node"), reason="没装 node")
@pytest.mark.parametrize("f", ["guide.js", "voice_bus.js", "fengge_hud.js", "engine.js"])
def test_js_parses_as_module(f):
    """按 ES 模块查语法（node --check 直接查 .js 会漏掉同一作用域重复声明这类错，9/24 第 4 轮就栽在这）。"""
    src = open(os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "game", f), encoding="utf-8").read()
    r = subprocess.run(["node", "--input-type=module", "--check"], input=src, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
