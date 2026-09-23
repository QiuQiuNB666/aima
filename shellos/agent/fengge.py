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
CANNED.update({
    "seg": ["{label}到了。这是个好事儿啊，路越难走越值钱。", "前面是{label}。兄弟，别光看风景，看脚下。", "{label}？我跟你说实话，爬过的人都说好。",
            "到{label}了，喘口气可以，停下来不行。"],
    "fast": ["跑起来了？恰恰相反，慢一点腿才是你自己的。", "这速度，后面追你的都得喘。", "跑这么快干嘛，山又不会跑。"],
    "idle": ["兄弟，站着干嘛，山不会自己矮下去。", "歇够了没有？面子有什么用，迈腿。", "你不走，影子可要走了。"],
    "feedback": ["你说「{quote}」？行，改了。这不就完了吗。", "「{quote}」——听你的，手感调了，再走两步试试。"],
})
# 9/23 球球：主角是峰哥，要多讲话。事件间隔（秒）：同一种事件不重复；所有事件之间至少 ANY_GAP 秒，免得吵。
MIN_GAP_S = {"red": 20.0, "seg": 10.0, "fast": 30.0, "idle": 25.0, "ghost": 20.0}
ANY_GAP_S = 7.0
PRIORITY = ("summit", "world", "feedback", "red")   # 这几个不受全局间隔限制（red 是让人站定的安全提示）


class Commentator:
    def __init__(self, say):
        self.say = say             # App.say
        self.last = {"t": "", "event": "", "text": "", "source": ""}
        self._t: dict = {}
        self._any = -1e9

    def speak(self, event, ctx):
        now = time.monotonic()
        if now - self._t.get(event, -1e9) < MIN_GAP_S.get(event, 0.0):
            return
        if event not in PRIORITY and now - self._any < ANY_GAP_S:
            return
        self._t[event] = self._any = now
        threading.Thread(target=self._run, args=(event, ctx), name="fengge", daemon=True).start()

    def _run(self, event, ctx):
        from . import brain
        j = brain.call("/fengge", {"event": event, "ctx": ctx}, timeout=15.0)
        line, src = ((str(j.get("line", "")).strip()[:40], "claude") if j and j.get("line")
                     else (_fill(random.choice(CANNED.get(event, CANNED["summit"])), ctx), "canned"))
        self.last = {"t": time.strftime("%H:%M:%S"), "event": event, "text": line, "source": src}
        self.say("峰哥", line, "解说")


def _fill(line, ctx):
    """兜底台词里的 {label} / {quote} 用事件上下文填；缺字段就原样。"""
    try:
        return line.format(**ctx) if isinstance(ctx, dict) else line
    except (KeyError, IndexError):
        return line
