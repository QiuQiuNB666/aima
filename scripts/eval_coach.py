"""教练实测：tests/test_interpret.py 的 23 句评委原话逐句发给大脑 /coach，看参数选对、方向对、延迟，对比规则表。

  python scripts/eval_coach.py            # --dry（默认）：只打印将要发的请求，不花钱
  python scripts/eval_coach.py --live     # 真调 Claude：23 + 加试 7 = 30 次
  python scripts/eval_coach.py --live --only 23    # 只跑 23 句

参数选对 = 改动的参数集合非空且都在期望集合里（时机类改 t_push/t_step/t_brake 任意几个都算）；空期望 = 不改。
方向对   = 至少一个期望参数改了、且改了的期望参数符号全对（多改了别的参数不扣方向分，扣参数分）。
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shellos.agent.interpret import by_rule            # noqa: E402
from shellos.control.terrain import Terrain            # noqa: E402
from tests import test_interpret as T                  # noqa: E402

P = Terrain().params
TIMING = ("t_push", "t_step", "t_brake")


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


def score(changes, want):
    """changes: {param: delta}（去掉 0）；want: {param: 期望符号}。返回 (参数选对, 方向对)。"""
    got = {k for k, v in changes.items() if v}
    if not want:
        return not got, not got
    param_ok = bool(got) and got <= set(want)
    hit = [k for k in got if k in want]
    dir_ok = bool(hit) and all((changes[k] > 0) == (want[k] > 0) for k in hit)
    return param_ok, dir_ok


def body(q):
    return {"quote": q, "controller": "terrain", "profile": {"wearer": "eval"}, "params": {k: list(v) for k, v in P.items()}}


def post(url, b, timeout):
    req = urllib.request.Request(url + "/coach", data=json.dumps(b, ensure_ascii=False).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="真调大脑（花钱）；不加 = dry")
    ap.add_argument("--url", default=os.environ.get("SHELLOS_BRAIN", "http://127.0.0.1:8790"))
    ap.add_argument("--only", type=int, help="只跑前 N 句")
    ap.add_argument("--timeout", type=float, default=30.0, help="客户端超时 s（ShellOS 用 12，这里放宽好量出真延迟）")
    a = ap.parse_args()
    # 自检：打分规则 + 规则表在 23 句上应全对（和 tests/test_interpret.py 一致）
    assert score({"t_push": 5}, {k: 5 for k in TIMING}) == (True, True)
    assert score({"strength": 0.5, "width": 1}, {"strength": 0.5}) == (False, True)
    assert score({"strength": -0.5}, {"strength": 0.5}) == (True, False) and score({}, {}) == (True, True)
    assert all(score((by_rule(q, "terrain", P, 110) or {}).get("delta", {}), w)[1] for q, w in cases())
    rows = [(q, w, "23") for q, w in cases()] + [(q, w, "加试") for q, w in EXTRA]
    rows = rows[:a.only] if a.only else rows
    if not a.live:
        print(f"[dry] 将发 {len(rows)} 次 POST {a.url}/coach，例：")
        print(json.dumps(body(rows[0][0]), ensure_ascii=False))
        for q, w, g in rows:
            print(f"  [{g}] {q}  期望 {w or '不改'}")
        print("加 --live 真调。")
        return

    res = {"23": [], "加试": []}
    for q, w, g in rows:
        rule = (by_rule(q, "terrain", P, 110) or {}).get("delta", {})
        t0 = time.time()
        try:
            j = post(a.url, body(q), a.timeout)
            err = j.get("error")
        except Exception as e:  # noqa: BLE001
            j, err = {}, str(e)[:80]
        dt = time.time() - t0
        ch = {}
        for c in j.get("changes", []):
            ch.setdefault(c.get("param"), float(c.get("delta", 0)))
        cp, cd = score(ch, w) if not err else (False, False)
        rp, rd = score(rule, w)
        res[g].append(dict(q=q, dt=dt, cp=cp, cd=cd, rp=rp, rd=rd, err=err, model=j.get("_model", "")))
        mark = "✓" if cd else "✗"
        print(f"{mark} {dt:5.1f}s [{g}] {q:<14} 大模型 {err or ch}  规则 {rule or '—'}  {j.get('why', '')[:40]}")

    for g, rs in res.items():
        if not rs:
            continue
        n = len(rs)
        lat = [r["dt"] for r in rs if not r["err"]]
        models = sorted({r["model"] for r in rs if r["model"]})
        print(f"\n== {g}（{n} 句）==")
        print(f"大模型  参数 {sum(r['cp'] for r in rs)}/{n}  方向 {sum(r['cd'] for r in rs)}/{n}  失败 {sum(bool(r['err']) for r in rs)}"
              f"  延迟 p50 {pct(lat, 50):.1f}s p95 {pct(lat, 95):.1f}s max {max(lat, default=0):.1f}s"
              f"  >12s {sum(x > 12 for x in lat)}  模型 {models}")
        print(f"规则表  参数 {sum(r['rp'] for r in rs)}/{n}  方向 {sum(r['rd'] for r in rs)}/{n}")


if __name__ == "__main__":
    main()
