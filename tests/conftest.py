import pytest

from shellos.agent import brain


@pytest.fixture(autouse=True)
def no_brain(monkeypatch):
    """测试永远不打 Claude：就算本机开着大脑，也指向一个连不上的端口，走规则兜底。"""
    monkeypatch.setattr(brain, "URL", "http://127.0.0.1:9")
    monkeypatch.setitem(brain.status, "ok", None)
