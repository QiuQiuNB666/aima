"""把一句人话翻成参数差值。大模型（OpenAI 兼容，环境变量 SHELLOS_LLM_*）优先；
没配、超时、输出不合法 → 规则表兜底。两条路输出同一种结构，都经过范围裁剪。

返回 {"delta": {param: value}, "trigger": {"cadence": [lo, hi]}, "confidence": 0..1, "source": "llm"|"rule", "why": "..."}
或 None（听不懂）。
"""
from __future__ import annotations
import json
import os
import re
import urllib.request

# 规则表：控制律 → (关键词, 参数, 差值)。差值方向以"正 = 更多/更晚"为准，和控制律里的参数定义一致。
RULES = {
    "phase": [
        (r"早", "t_ext", -5), (r"晚|迟", "t_ext", +5),
        (r"轻|小|弱|少", "peak_ext", -0.5), (r"重|大|强|多|再来", "peak_ext", +0.5),
        (r"左.*(多|大|强|重)", "bias_l", +0.3), (r"左.*(少|小|轻|弱)", "bias_l", -0.3),
        (r"右.*(多|大|强|重)", "bias_r", +0.3), (r"右.*(少|小|轻|弱)", "bias_r", -0.3),
        (r"窄|短|脆", "width", -3), (r"宽|长|柔", "width", +3),
    ],
    "dofc": [
        (r"早", "delay_s", -0.03), (r"晚|迟", "delay_s", +0.03),
        (r"轻|小|弱|少", "gain", -0.03), (r"重|大|强|多|再来", "gain", +0.03),
        (r"反|顶|反了|相反", "gain", "flip"),
    ],
    "terrain": [
        (r"陡|累|重|大|强|太猛|明显", "strength", -0.5), (r"没感觉|轻|小|弱|不明显|再来", "strength", +0.5),
        (r"早", "t_push", -5), (r"晚|迟", "t_push", +5),
    ],
    "constant": [
        (r"左.*(多|大|强|重)", "tl", +0.5), (r"左.*(少|小|轻|弱)", "tl", -0.5),
        (r"右.*(多|大|强|重)", "tr", +0.5), (r"右.*(少|小|轻|弱)", "tr", -0.5),
        (r"轻|小|弱|少", "tl", -0.5), (r"重|大|强|多", "tl", +0.5),
    ],
}


def _band(cadence):
    c = float(cadence or 0)
    if c <= 0:
        return [0, 999]
    return [round(c - 10), round(c + 10)]


def by_rule(quote, controller, params, cadence):
    d = {}
    hit = []
    for pat, k, v in RULES.get(controller, []):
        if re.search(pat, quote) and k in params:
            if v == "flip":
                d[k] = -2 * params[k][0]          # 增益取反
            else:
                d[k] = d.get(k, 0) + v
            hit.append(pat)
    if not d:
        return None
    return {"delta": d, "trigger": {"cadence": _band(cadence)}, "confidence": 0.6, "source": "rule",
            "why": "规则表命中 " + "/".join(hit)}


def configured():
    return all(os.environ.get(k) for k in ("SHELLOS_LLM_BASE", "SHELLOS_LLM_KEY", "SHELLOS_LLM_MODEL"))


def by_llm(quote, controller, params, cadence, profile, timeout=6.0):
    if not configured():
        return None
    ptab = "\n".join(f"- {k}: 当前 {v[0]:g}，范围 {v[1]:g}~{v[2]:g}" for k, v in params.items())
    prompt = (f"你在给一台髋关节助行外骨骼调参。穿戴者刚说：「{quote}」。\n"
              f"当前控制律 {controller}，参数：\n{ptab}\n穿戴者画像：{json.dumps(profile, ensure_ascii=False)}\n"
              "把这句话翻成参数差值（不是绝对值），一次只改 1~2 个参数、幅度小（峰值 ±0.5 Nm、峰时 ±5%、增益 ±0.03、延迟 ±0.03 s 这个量级）。"
              "只输出 JSON：{\"delta\":{参数名:差值},\"confidence\":0到1,\"why\":\"一句话\"}。听不懂就输出 {\"delta\":{}}。")
    body = {"model": os.environ["SHELLOS_LLM_MODEL"], "max_tokens": 150, "temperature": 0,
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(os.environ["SHELLOS_LLM_BASE"].rstrip("/") + "/chat/completions",
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + os.environ["SHELLOS_LLM_KEY"]})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    s = text[text.find("{"): text.rfind("}") + 1]
    j = json.loads(s)
    d = {k: float(v) for k, v in j.get("delta", {}).items() if k in params}
    if not d:
        return None
    # 幅度裁剪：不让模型一口气改到头
    for k in d:
        lo, hi = params[k][1], params[k][2]
        cap = (hi - lo) * 0.15
        d[k] = max(-cap, min(cap, d[k]))
    return {"delta": d, "trigger": {"cadence": _band(cadence)},
            "confidence": max(0.0, min(1.0, float(j.get("confidence", 0.7)))), "source": "llm",
            "why": str(j.get("why", ""))[:80]}


def interpret(quote, controller, params, cadence, profile):
    try:
        r = by_llm(quote, controller, params, cadence, profile)
        if r:
            return r
    except Exception as e:  # noqa: BLE001
        r = None
        last = str(e)[:80]
    r = by_rule(quote, controller, params, cadence)
    return r
