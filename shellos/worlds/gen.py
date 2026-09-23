"""一句话造一座山：评委说一句 → Claude（地形导演）出路线草稿 → 这里校验、裁剪、套现成主题 → 注册进 WORLDS 马上能走。
大脑不在就用关键词模板兜底（source=rule），界面照样有山，只是没那么懂人话。

主题不让模型发明：从 5 种已有画面风格里选一个，颜色/道具抄同风格的现成世界，游戏引擎不用改。
生成的世界只在内存里，重启就没了（ponytail: 要留就写到 data/worlds/，现场一局一座山够用）。
"""
from __future__ import annotations
import re

from . import KINDS, WORLDS

MIN_STEPS, MAX_STEPS, MAX_SEG = 20, 80, 20
KEEP = 8                                   # 最多留几座生成的山，多了删最早的
_n = [0]


def styles() -> dict:
    """风格 → 用它当主题模板的世界（同风格取第一个）。"""
    out = {}
    for w in WORLDS.values():
        out.setdefault(w["theme"]["style"], w)
    return out


def by_rule(text: str) -> dict:
    t = text or ""
    style = ("cliff_path" if re.search(r"华山|栈道|悬崖|绝壁|峭壁|长空|天险", t) and "cliff_path" in styles() else   # E 线主题没到就往下落，默认 dawn_mountain
             "snow_summit" if re.search(r"珠峰|珠穆朗玛|喜马拉雅|雪山|8848|冰川|高原|登顶世界", t) and "snow_summit" in styles() else
             "cyber_night" if re.search(r"夜|霓虹|东京|城|街|赛博", t) else
             "night_to_dawn" if re.search(r"日出|星|富士|夜爬|雪", t) else
             "subtropical" if re.search(r"深圳|梧桐|榕|热带|海|南方", t) else
             "grid" if re.search(r"训练|测试|练习", t) else "dawn_mountain")
    route = [("flat", 3, "起点"), ("up", 6, "缓坡"), ("stairs_up", 8, "石阶"), ("flat", 3, "歇脚台"),
             ("stairs_up", 8, "陡阶"), ("up", 5, "山脊"), ("flat", 2, "顶上")]
    if re.search(r"陡|难|累|硬核|地狱|要命|亡命", t):
        route[4] = ("stairs_up", 14, "绝壁天梯")
    if re.search(r"轻松|散步|平|老人|小孩", t):
        route = [(k if k != "stairs_up" else "up", n, lab) for k, n, lab in route]
    if re.search(r"下山|下坡|回家|下来", t):
        route += [("down", 5, "下山路"), ("stairs_down", 5, "下山台阶"), ("flat", 2, "山脚")]
    if re.search(r"红灯|路口|城|街", t):
        route.insert(2, ("wait", 1, "路口红灯"))
    name = re.sub(r"[，。！？,.!?\s]", "", t)[:10] or "无名山"
    return {"name": name, "subtitle": " → ".join(lab for _, _, lab in route[::2]), "story": f"你说「{t}」，山就长出来了。",
            "style": style, "alt_start": 100, "alt_end": 100 + 30 * sum(n for k, n, _ in route if k in ("up", "stairs_up")),
            "summit_name": route[-1][2], "summit_text": "这是个好事儿啊，爬上来了。面子有什么用，腿是自己的。",
            "route": [{"kind": k, "steps": n, "label": lab} for k, n, lab in route]}


def build(draft: dict, text: str, source: str):
    """草稿 → 可走的世界。返回 (world, 安全员备注列表)。不信任草稿里的任何数字。"""
    notes = []
    route = []
    waits = 0
    for s in draft.get("route", [])[:12]:
        kind = s.get("kind")
        if kind not in KINDS:
            notes.append(f"丢掉未知路段 {kind}")
            continue
        n = max(1, min(MAX_SEG, int(s.get("steps", 1))))
        if kind == "wait":
            if waits >= 2:
                notes.append("红灯超过 2 个，多的删掉")
                continue
            waits, n = waits + 1, 1
        route.append({"kind": kind, "steps": n, "label": str(s.get("label", ""))[:12] or kind})
    if not route or route[0]["kind"] != "flat":
        route.insert(0, {"kind": "flat", "steps": 2, "label": "起点"})
        notes.append("起点补了 2 步平地（先让步态估计稳住再给力）")
    total = sum(s["steps"] for s in route)
    stairs = sum(s["steps"] for s in route if s["kind"].startswith("stairs"))
    for s in reversed(route):                     # 台阶过半 → 从后往前把台阶改成坡
        if stairs * 2 <= total:
            break
        if s["kind"].startswith("stairs"):
            stairs -= s["steps"]
            s["kind"] = "up" if s["kind"] == "stairs_up" else "down"
            notes.append(f"「{s['label']}」台阶改成坡：台阶不超过一半，腿受不了")
    if total > MAX_STEPS:
        k = MAX_STEPS / total
        for s in route:
            s["steps"] = max(1, int(s["steps"] * k)) if s["kind"] != "wait" else 1
        notes.append(f"总长 {total} 步压到 {sum(s['steps'] for s in route)} 步")
    total = sum(s["steps"] for s in route)
    if total < MIN_STEPS:
        route.append({"kind": "flat", "steps": MIN_STEPS - total, "label": "山顶平台"})

    tpl = styles().get(draft.get("style")) or styles()["dawn_mountain"]
    _n[0] += 1
    wid = f"gen_{_n[0]}"
    a0 = int(draft.get("alt_start", 0) or 0)
    a1 = int(draft.get("alt_end", a0 + 300) or a0 + 300)
    w = {"id": wid, "name": str(draft.get("name", "无名山"))[:12], "subtitle": str(draft.get("subtitle", ""))[:60],
         "story": str(draft.get("story", ""))[:120],
         "note": f"现场生成（{draft.get('_model') or '大模型' if source == 'claude' else '规则模板'}）：「{text[:40]}」",
         "alt": [a0, a1 if a1 != a0 else a0 + 1], "unit": tpl.get("unit", "m"), "route": route,
         "summit": {"name": str(draft.get("summit_name", "终点"))[:12], "text": str(draft.get("summit_text", ""))[:60]},
         "theme": dict(tpl["theme"]), "training": False, "generated": source}
    gens = [k for k in WORLDS if k.startswith("gen_")]
    for k in gens[:max(0, len(gens) - KEEP + 1)]:
        del WORLDS[k]
    WORLDS[wid] = w
    return w, notes


def generate(text: str):
    """返回 (world, source, notes)。"""
    from ..agent import brain
    draft = brain.call("/world", {"text": text, "styles": list(styles()), "kinds": list(KINDS)}, timeout=90.0)
    if draft:
        try:
            w, notes = build(draft, text, "claude")
            return w, "claude", notes
        except (TypeError, ValueError, AttributeError) as e:    # MiniMax 的 schema 不严格：步数写成字符串之类
            brain.status.update(ok=False, kind="error", msg=f"/world 草稿格式坏了：{str(e)[:60]}")
    w, notes = build(by_rule(text), text, "rule")
    return w, "rule", notes


if __name__ == "__main__":                        # 自检：离线模板 + 恶意草稿都要被裁成能走的路
    w, notes = build(by_rule("峰哥亡命天涯，要陡，要下山"), "t", "rule")
    assert w["route"][0]["kind"] == "flat" and MIN_STEPS <= sum(s["steps"] for s in w["route"]) <= MAX_STEPS
    bad = {"style": "nope", "route": [{"kind": "stairs_up", "steps": 999, "label": "x"}] * 9 +
           [{"kind": "wait", "steps": 5, "label": "w"}] * 4 + [{"kind": "lava", "steps": 3}]}
    w, notes = build(bad, "t", "claude")
    r = w["route"]
    tot = sum(s["steps"] for s in r)
    assert tot <= MAX_STEPS and sum(s["kind"] == "wait" for s in r) <= 2 and all(s["kind"] in KINDS for s in r)
    assert sum(s["steps"] for s in r if s["kind"].startswith("stairs")) * 2 <= tot + 2, r
    assert w["theme"]["style"] == "dawn_mountain" and w["id"] in WORLDS
    try:                                          # 步数不是数字 → build 抛错，generate 会退回模板
        build({"route": [{"kind": "up", "steps": "很多"}]}, "t", "claude")
        raise AssertionError("应该抛错")
    except ValueError:
        pass
    assert by_rule("华山长空栈道")["style"] == ("cliff_path" if "cliff_path" in styles() else "dawn_mountain")
    print("ok", tot, notes)
