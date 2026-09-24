"""教练实测：评委原话逐句发给大脑 /coach，看参数选对、方向对、幅度在区间内、歧义句有没有反问，对比规则表，量延迟。

  python scripts/eval_coach.py                 # --dry（默认）：只打印将要发的请求，不花钱
  python scripts/eval_coach.py --live          # 真调：基准 60 句（BENCH）
  python scripts/eval_coach.py --live --all    # 60 + 老的 23 + 加试 7 + 台阶 6
  python scripts/eval_coach.py --live --url http://127.0.0.1:8798 --json /tmp/coach.json

判分（每句三项，全对才算「准确」）：
  参数选对 = 改动的参数集合非空且都在期望集合里（时机类改 t_push/t_step/t_brake 任意几个都算）；期望空 = 不改。
  方向对   = 改了的期望参数符号全对。
  幅度对   = 每个改动的绝对值落在 MAG 区间里（strength 0.25~1、t 2~10、width 1~5、impact 0.1~0.6）。
  期望 ASK（歧义句）= 不改参数、且 ask 非空（反问一句）。
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shellos.agent.interpret import by_rule            # noqa: E402
from shellos.control.terrain import Terrain            # noqa: E402
from tests import test_interpret as T                  # noqa: E402

P = Terrain().params
TIMING = ("t_push", "t_step", "t_brake")
ASK = "ask"
T_ALL = {k: +1 for k in TIMING}
T_ALL_NEG = {k: -1 for k in TIMING}
MAG = {"strength": (0.25, 1.0), "t_push": (2, 10), "t_step": (2, 10), "t_brake": (2, 10), "width": (1, 5), "impact": (0.1, 0.6)}

# 基准 60 句：评委站在展位上可能说的话。期望 = {参数: 符号} / {} 不改 / ASK 反问。
# 口径：这是登山游戏，「陡 / 累 / 酸 / 重 / 猛」都是腿上的力太大；上台阶是阻力；下台阶落地那一下归 impact。
BENCH = [
    # 力度减
    ("太陡了", {"strength": -1}), ("腿酸", {"strength": -1}), ("太累了", {"strength": -1}), ("太猛了", {"strength": -1}),
    ("别推我", {"strength": -1}), ("有点重", {"strength": -1}), ("轻一点", {"strength": -1}), ("推得太狠了", {"strength": -1}),
    ("腿都要断了", {"strength": -1}), ("劲儿小点", {"strength": -1}), ("我受不了了", {"strength": -1}), ("忒重了", {"strength": -1}),
    # 力度加
    ("没感觉", {"strength": +1}), ("再狠一点", {"strength": +1}), ("不够劲", {"strength": +1}), ("根本没在推我", {"strength": +1}),
    ("一点都不明显", {"strength": +1}), ("还能更强", {"strength": +1}), ("给我使劲", {"strength": +1}), ("太轻了", {"strength": +1}),
    ("加大力度", {"strength": +1}), ("莫得感觉", {"strength": +1}), ("像踩棉花", {"strength": +1, "width": -1}),
    # 时机
    ("早一点", T_ALL_NEG), ("晚一点", T_ALL), ("太早了", T_ALL), ("太晚了", T_ALL_NEG), ("慢半拍", T_ALL_NEG),
    ("还没落地就推了", T_ALL), ("每次都是脚落地了才推", T_ALL_NEG),
    # 路段专属
    ("下楼梯吓人", {"impact": -1, "strength": -1}), ("下台阶那一下太砸了", {"impact": -1}), ("落地没反应", {"impact": +1}),
    ("上楼太费劲", {"strength": -1}), ("上坡推得太早", {"t_push": +1}), ("上台阶阻力晚了", {"t_step": -1}),
    ("下坡拽得太晚", {"t_brake": -1}), ("上坡没人推我", {"strength": +1}), ("下楼一点感觉都没有", {"impact": +1, "strength": +1}),
    # 长短
    ("一闪就过去了", {"width": +1}), ("拖泥带水", {"width": -1}), ("每一下太短", {"width": +1}), ("太绵长了", {"width": -1}),
    # 否定 / 复合 / 口语
    ("不累", {}), ("不是太重，是太早了", T_ALL), ("力度行，就是晚了点", T_ALL_NEG), ("又重又早", {"strength": -1, **T_ALL}),
    ("轻是轻了，可以再重一点", {"strength": +1}), ("别改了，刚刚好", {}), ("太得劲了", {}), ("蛮陡的咧", {"strength": -1}),
    # 歧义 → 反问
    ("慢点", ASK), ("只帮左腿", ASK), ("上台阶像有人托", ASK), ("节奏对不上", ASK), ("怪怪的", ASK), ("换一下", ASK),
    # 无关 → 不改
    ("这个游戏挺好玩", {}), ("峰哥呢", {}), ("几点了", {}),
]
assert len(BENCH) == 60, len(BENCH)


def cases():
    out = [(q, {"strength": w}) for q, w in T.test_strength_direction.pytestmark[0].args[1]]
    out += [(q, {k: w for k in TIMING}) for q, w in T.test_timing_direction_all_pulses.pytestmark[0].args[1]]
    out.append(("今天天气不错", {}))
    assert len(out) == 23, len(out)
    return out


# 加试：规则表的盲区（同义换说法 / 一句两件事 / 英文 / 别动）
EXTRA = [
    ("推得有点猛", {"strength": -1}), ("几乎感受不到在推我", {"strength": +1}), ("It's too weak", {"strength": +1}),
    ("晚一点点，再用力一些", {"strength": +1, "t_push": +1, "t_step": +1, "t_brake": +1}),
    ("推的时机太靠前了", {k: +1 for k in TIMING}), ("力度刚刚好，别动", {}), ("不累", {}),
]

# 台阶：上台阶是阻力（strength 越大越费劲），下台阶是助力 + 落地那一下的冲击（impact）
STAIRS = [
    ("上楼太费劲", {"strength": -1, "width": -1}), ("下楼那一下太冲", {"impact": -1}), ("落地没感觉", {"impact": +1}),
    ("上楼的阻力来得太早", {"t_step": +1}), ("下楼的时候推得太晚", {"t_brake": -1}), ("台阶那一下太短，一闪就过去了", {"width": +1}),
]


def score(changes, want, ask=""):
    """changes: {param: delta}（去掉 0）；want: {param: 期望符号} 或 ASK。返回 (参数选对, 方向对, 幅度对)。"""
    got = {k for k, v in changes.items() if v}
    if want == ASK:
        ok = not got and bool(ask)
        return ok, ok, ok
    if not want:
        return not got, not got, not got
    param_ok = bool(got) and got <= set(want)
    hit = [k for k in got if k in want]
    dir_ok = bool(hit) and all((changes[k] > 0) == (want[k] > 0) for k in hit)
    mag_ok = bool(got) and all(MAG[k][0] <= abs(changes[k]) <= MAG[k][1] for k in got if k in MAG)
    return param_ok, dir_ok, mag_ok


def body(q):
    return {"quote": q, "controller": "terrain", "profile": {"wearer": "eval"}, "params": {k: list(v) for k, v in P.items()}}


def post(url, b, timeout, path="/coach"):
    """限频（大脑回 502 kind=rate_limit）最多等两次再重发：MiniMax 的 RPM 是整个 key 共用的，别的进程也在打。"""
    req = urllib.request.Request(url + path, data=json.dumps(b, ensure_ascii=False).encode(),
                                 headers={"Content-Type": "application/json"})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            j = json.load(e) if e.code == 502 else {}
            if j.get("kind") != "rate_limit" or i == 2:
                return j or {"error": str(e)[:80]}
            time.sleep(12 * (i + 1))


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="真调大脑（花钱）；不加 = dry")
    ap.add_argument("--url", default=os.environ.get("SHELLOS_BRAIN", "http://127.0.0.1:8790"))
    ap.add_argument("--all", action="store_true", help="基准 60 之外再跑老的 23 + 加试 + 台阶")
    ap.add_argument("--only", type=int, help="只跑前 N 句")
    ap.add_argument("--timeout", type=float, default=30.0, help="客户端超时 s（ShellOS 用 12，这里放宽好量出真延迟）")
    ap.add_argument("--json", help="逐句结果存成 JSON")
    ap.add_argument("--pace", type=float, default=1.5, help="两句之间歇几秒（MiniMax RPM 限频，整个 key 共用）")
    a = ap.parse_args()
    # 自检：打分规则 + 规则表在 23 句上应全对（和 tests/test_interpret.py 一致）
    assert score({"t_push": 5}, {k: 5 for k in TIMING}) == (True, True, True)
    assert score({"strength": 0.5, "width": 1}, {"strength": 0.5})[:2] == (False, True)
    assert score({"strength": -0.5}, {"strength": 0.5})[:2] == (True, False) and score({}, {}) == (True, True, True)
    assert score({"strength": 2.0}, {"strength": 1}) == (True, True, False)
    assert score({}, ASK, "哪条腿？") == (True, True, True) and score({}, ASK) == (False, False, False)
    assert all(score((by_rule(q, "terrain", P, 110) or {}).get("delta", {}), w)[1] for q, w in cases())
    rows = [(q, w, "基准60") for q, w in BENCH]
    if a.all:
        rows += [(q, w, "23") for q, w in cases()] + [(q, w, "加试") for q, w in EXTRA] + [(q, w, "台阶") for q, w in STAIRS]
    rows = rows[:a.only] if a.only else rows
    if not a.live:
        print(f"[dry] 将发 {len(rows)} 次 POST {a.url}/coach，例：")
        print(json.dumps(body(rows[0][0]), ensure_ascii=False))
        for q, w, g in rows:
            print(f"  [{g}] {q}  期望 {w or '不改'}")
        print("加 --live 真调。")
        return

    res: dict = {}
    for q, w, g in rows:
        rule = (by_rule(q, "terrain", P, 110) or {}).get("delta", {})
        t0 = time.time()
        try:
            j = post(a.url, body(q), a.timeout)
            err = j.get("error")
        except Exception as e:  # noqa: BLE001
            j, err = {}, str(e)[:80]
        dt = time.time() - t0
        time.sleep(a.pace)
        ch = {}
        for c in j.get("changes", []):
            ch.setdefault(c.get("param"), float(c.get("delta", 0)))
        ask = str(j.get("ask", "") or "")
        cp, cd, cm = score(ch, w, ask) if not err else (False, False, False)
        rp, rd, rm = score(rule, w)
        res.setdefault(g, []).append(dict(q=q, want=w, dt=dt, got=ch, ask=ask, why=j.get("why", ""), cp=cp, cd=cd, cm=cm,
                                          rule=rule, rp=rp, rd=rd, rm=rm, err=err, model=j.get("_model", "")))
        mark = "✓" if cp and cd and cm else "✗"
        print(f"{mark} {dt:5.1f}s [{g}] {q:<14} 大模型 {err or ch or ('反问：' + ask if ask else '不改')}"
              f"  规则 {rule or '—'}  {str(j.get('why', ''))[:40]}")

    for g, rs in res.items():
        n = len(rs)
        lat = [r["dt"] for r in rs if not r["err"]]
        models = sorted({r["model"] for r in rs if r["model"]})
        acc = sum(r["cp"] and r["cd"] and r["cm"] for r in rs)
        print(f"\n== {g}（{n} 句）==")
        print(f"大模型  准确 {acc}/{n}（{100 * acc / n:.0f}%）  参数 {sum(r['cp'] for r in rs)}/{n}  方向 {sum(r['cd'] for r in rs)}/{n}"
              f"  幅度 {sum(r['cm'] for r in rs)}/{n}  失败 {sum(bool(r['err']) for r in rs)}"
              f"  延迟 p50 {pct(lat, 50):.1f}s p95 {pct(lat, 95):.1f}s max {max(lat, default=0):.1f}s"
              f"  >12s {sum(x > 12 for x in lat)}  模型 {models}")
        racc = sum(r["rp"] and r["rd"] and r["rm"] for r in rs)
        print(f"规则表  准确 {racc}/{n}（{100 * racc / n:.0f}%）  参数 {sum(r['rp'] for r in rs)}/{n}  方向 {sum(r['rd'] for r in rs)}/{n}")
        bad = [r for r in rs if not (r["cp"] and r["cd"] and r["cm"])]
        if bad:
            print("错句：" + "；".join(f"「{r['q']}」→{r['err'] or r['got'] or ('反问' if r['ask'] else '不改')}" for r in bad))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
