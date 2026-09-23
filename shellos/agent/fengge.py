"""峰哥解说：登顶 / 红灯 / 造山时来一句峰哥口吻的话。大脑（Claude）优先，后台线程调，不卡控制循环；
大脑不在就从下面的兜底语录里挑（口吻参考 github.com/YixiaJack/feng-ge-skill，MIT）。
"""
from __future__ import annotations
import random
import threading
import time

CANNED = {
    "summit": ["这是个好事儿啊，腿酸说明你真爬了。", "登顶了？恰恰相反，下山才是真考验。", "爬上来了，面子有什么用，腿是自己的。",
               "输给影子？这是好事儿啊，说明前面有人替你探过路。"],
    "red": ["兄弟，站住。停两秒死不了，这不就完了吗。", "红灯是好事儿啊，老天让你喘口气。", "急什么，站定了再走。"],
    "world": ["这山是你一句话说出来的，爬不上去别怪别人。", "这是个好事儿啊，没人爬过的山，第一名就是你。"],
    "ghost": ["被影子超了？这是好事儿啊，有人在前面替你挨累。", "超过影子了。恰恰相反，别飘。"],
}
MIN_GAP_S = {"red": 20.0}          # 红灯一趟可能好几个，别一直念


class Commentator:
    def __init__(self, say):
        self.say = say             # App.say
        self.last = {"t": "", "event": "", "text": "", "source": ""}
        self._t: dict = {}

    def speak(self, event, ctx):
        now = time.monotonic()
        if now - self._t.get(event, -1e9) < MIN_GAP_S.get(event, 0.0):
            return
        self._t[event] = now
        threading.Thread(target=self._run, args=(event, ctx), name="fengge", daemon=True).start()

    def _run(self, event, ctx):
        from . import brain
        j = brain.call("/fengge", {"event": event, "ctx": ctx}, timeout=15.0)
        line, src = ((str(j.get("line", "")).strip()[:40], "claude") if j and j.get("line")
                     else (random.choice(CANNED.get(event, CANNED["summit"])), "canned"))
        self.last = {"t": time.strftime("%H:%M:%S"), "event": event, "text": line, "source": src}
        self.say("峰哥", line, "解说")
