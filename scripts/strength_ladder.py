"""强度阶梯：同一路段 0.5 → 1.5 → 3 Nm 三档各走 N 步，评委选"刚好"那档，结果写回 ShellOS。

ShellOS 要先在跑（--ctl terrain）。档位是**主脉冲峰值 Nm**，脚本按路段倍率换算成 strength
（上台阶 ×1.2，所以 3 Nm 档 = strength 2.5）；超过 Guard 软限（/state safety.cap）的档自动压到软限并提示。
选完：/set strength 立即生效 + /mark 记一条（进录制的 .marks.csv 和事件流）+ /memory/add 写一张经验卡
（差值相对缺省 strength），换人/复位后参数回缺省，走 6 步检索命中这张卡再套用。

  .venv/bin/python scripts/strength_ladder.py --kind stairs_up --steps 8           # 真人：每档之间回车
  .venv/bin/python scripts/strength_ladder.py --api http://localhost:8803 --dry    # 干跑：配 --sim --force-deadman，自动选 --pick 档
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shellos.control.terrain import MULT, CAP, Terrain  # noqa: E402

NAMES = {"up": "上坡", "down": "下坡", "stairs_up": "上台阶", "stairs_down": "下台阶"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8765")
    ap.add_argument("--kind", default="stairs_up", choices=list(NAMES))
    ap.add_argument("--steps", type=int, default=8, help="每档走几步（被接受的步，和地形计步同一口径）")
    ap.add_argument("--tiers", default="0.5,1.5,3", help="峰值 Nm，逗号分隔")
    ap.add_argument("--dry", action="store_true", help="不要人：模拟器走路，自动选 --pick")
    ap.add_argument("--pick", type=int, default=2, help="干跑时选第几档（1 起）")
    a = ap.parse_args()

    def post(path, body=None):
        req = urllib.request.Request(a.api + path, data=json.dumps(body or {}).encode(),
                                     headers={"Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(req, timeout=3))

    def state():
        return json.load(urllib.request.urlopen(a.api + "/state", timeout=3))

    s = state()
    if s["ctl"]["name"] != "terrain":
        post("/ctl", {"name": "terrain"})
        s = state()
    if a.dry and not s["sim"]["on"]:
        raise SystemExit("--dry 只能对 --sim 跑（真机必须有人按着 R2）")
    cap = min(CAP, float(s["safety"]["cap"]))
    lo, hi = s["ctl"]["params"]["strength"][1:]
    base = s["ctl"]["params"]["strength"][0]
    m = abs(MULT[a.kind])
    tiers = []
    for t in (float(x) for x in a.tiers.split(",")):
        nm = min(t, cap)
        if nm < t:
            print(f"！{t:g} Nm 档超过软限，压到 {nm:g} Nm")
        tiers.append((nm, round(max(lo, min(hi, nm / m)), 3)))
    who = s.get("wearer", "anon")
    print(f"强度阶梯：{NAMES[a.kind]}，{len(tiers)} 档 × {a.steps} 步，穿戴者 {who}，软限 {cap:g} Nm")
    post("/mark", {"label": f"强度阶梯 开始 {a.kind} 档 {[t for t, _ in tiers]} Nm × {a.steps} 步"})
    ask = (lambda p: "") if a.dry else input
    if a.dry:
        post("/sim", {"walk": True})
    measured, picked = [], None
    try:
        for i, (nm, strength) in enumerate(tiers, 1):
            ask(f"\n第 {i} 档 {nm:g} Nm：让他按住 R2 走，回车开始 → ")
            post("/set", {"name": "strength", "value": strength})
            post("/terrain/force", {"kind": a.kind})
            n0 = state()["gait"]["strides"]
            t0, peak, n = time.time(), 0.0, 0
            while n < a.steps and time.time() - t0 < a.steps * 3 + 5:
                st = state()
                n = st["gait"]["strides"] - n0
                peak = max([peak] + [abs(x) for x in st["safety"]["sent"]])
                print(f"\r  第 {i} 档 {nm:g} Nm  {n}/{a.steps} 步  发出 {st['safety']['sent']}  峰值 {peak:.2f}   ", end="", flush=True)
                time.sleep(0.03)
            post("/terrain/force", {"kind": None})
            measured.append(peak)
            post("/mark", {"label": f"强度阶梯 第{i}档 目标 {nm:g} Nm strength={strength:g} 走了 {n} 步 实测峰值 {peak:.2f}"})
            print(f"\n  走了 {n} 步，实测峰值 {peak:.2f} Nm" + ("" if n >= a.steps else "（超时，步数不够）"))
            if peak == 0:
                print("  ！一点力都没发出去：R2 没按 / 没在走 / 置信度门控")
        if a.dry:
            picked = max(1, min(len(tiers), a.pick))
        else:
            while picked is None:
                r = ask(f"\n哪一档「刚好」？{' / '.join('%d=%g Nm' % (i, t) for i, (t, _) in enumerate(tiers, 1))}：").strip()
                picked = int(r) if r.isdigit() and 1 <= int(r) <= len(tiers) else None
        nm, strength = tiers[picked - 1]
        post("/set", {"name": "strength", "value": strength})
        post("/mark", {"label": f"强度阶梯 结果 {who} {a.kind} 选第{picked}档 {nm:g} Nm → strength={strength:g}"
                                f"（原 {base:g}；实测峰值 {', '.join('%.2f' % p for p in measured)}）"})
        default = Terrain().params["strength"][0]
        post("/memory/add", {"delta": {"strength": round(strength - default, 3)},
                             "quote": f"强度阶梯：{NAMES[a.kind]}选 {nm:g} Nm", "source": "ladder"})
        print(f"\n选第 {picked} 档 {nm:g} Nm → strength {strength:g}（原 {base:g}），已生效并记标记。")
    finally:
        post("/terrain/force", {"kind": None})
        if picked is None:
            post("/set", {"name": "strength", "value": base})
            print("\n没选完，strength 还原", base)
        if a.dry:
            post("/sim", {"walk": False})


if __name__ == "__main__":
    main()
