"""蒙眼二选一（2AFC）：验证"人分得清虚拟上坡和下坡"。没做过这个别在评委面前报数字。

ShellOS 要先在跑（--ctl terrain）。穿的人蒙眼或不看屏幕，按住 R2 原地踏步或走；
每一轮随机给 up 或 down 持续 N 秒，然后问他"上坡还是下坡"，记对错。10 轮，报正确率。
也可以测 "强/弱" 或 "早/晚"：--mode strength / --mode timing。每轮结果都写一条 /mark（进录制的 .marks.csv）。

  .venv/bin/python scripts/afc.py --trials 10 --seconds 8                  # 真人
  .venv/bin/python scripts/afc.py --api http://localhost:8803 --dry        # 干跑：配 --sim --force-deadman，不要人

--dry：自动让模拟器走路，"受试者"换成理想观察者——只看 /state 里真正发出去的力矩
（slope 看正负，strength 看峰值）。它答不对 = 刺激没送到腿上，先别找人做实验。timing 模式理想观察者分不了，随机答。
"""
from __future__ import annotations
import argparse
import json
import random
import time
import urllib.request


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=10)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--mode", default="slope", choices=["slope", "strength", "timing"])
    ap.add_argument("--api", default="http://localhost:8765")
    ap.add_argument("--dry", action="store_true", help="不要人：模拟器走路 + 理想观察者作答")
    ap.add_argument("--seed", type=int)
    a = ap.parse_args()
    rnd = random.Random(a.seed)

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
    base_strength = s["ctl"]["params"]["strength"][0]
    base_push = s["ctl"]["params"]["t_push"][0]
    ask = (lambda prompt: "") if a.dry else input
    print(f"模式 {a.mode}，{a.trials} 轮，每轮 {a.seconds} s。{'干跑（理想观察者）' if a.dry else '穿的人别看屏幕。回车开始每一轮。'}")
    if a.dry:
        post("/sim", {"walk": True})
    score, voids = [], 0
    try:
        while len(score) < a.trials:                           # 0 力轮作废重做，不计分
            i = len(score)
            ask(f"\n第 {i+1} 轮：按住 R2 开始走，回车给刺激 → ")
            if a.mode == "slope":
                truth = rnd.choice(["up", "down"]); post("/terrain/force", {"kind": truth})
                options, keys = "上坡(u) / 下坡(d)", {"u": "up", "d": "down"}
            elif a.mode == "strength":
                truth = rnd.choice(["strong", "weak"]); post("/terrain/force", {"kind": "up"})
                post("/set", {"name": "strength", "value": base_strength + (0.5 if truth == "strong" else -0.5)})
                options, keys = "强(s) / 弱(w)", {"s": "strong", "w": "weak"}
            else:
                truth = rnd.choice(["early", "late"]); post("/terrain/force", {"kind": "up"})
                post("/set", {"name": "t_push", "value": base_push + (-5 if truth == "early" else 5)})
                options, keys = "早(e) / 晚(l)", {"e": "early", "l": "late"}
            t0, sent = time.time(), []
            while time.time() - t0 < a.seconds:
                st = state()
                sent += st["safety"]["sent"]
                print(f"\r  {a.seconds - (time.time()-t0):4.1f}s  发出 {st['safety']['sent']}  R2 {st['safety']['deadman']:.2f}   ",
                      end="", flush=True)
                time.sleep(0.03 if a.dry else 0.2)
            post("/terrain/force", {"kind": None})
            post("/set", {"name": "strength", "value": base_strength}); post("/set", {"name": "t_push", "value": base_push})
            pos, neg = sum(x for x in sent if x > 0), -sum(x for x in sent if x < 0)
            peak = max((abs(x) for x in sent), default=0.0)
            if peak == 0:
                voids += 1
                post("/mark", {"label": f"AFC{' DRY' if a.dry else ''} {a.mode} {i+1}/{a.trials} VOID truth={truth} peak=0"})
                print("\n  ！这一轮一点力都没发出去：R2 没按 / 没在走 / 置信度门控。这轮不算数，重做")
                if voids >= a.trials:
                    print(f"  已作废 {voids} 轮，先查 R2 / 步态再来"); break
                continue
            if a.dry:
                if a.mode == "slope":
                    ans = "u" if pos > neg else "d"
                elif a.mode == "strength":
                    ans = "s" if peak > base_strength else "w"
                else:
                    ans = rnd.choice("el")
            else:
                ans = input(f"\n  他说是哪个？{options}：").strip().lower()
            ok = keys.get(ans) == truth
            score.append(ok)
            post("/mark", {"label": f"AFC{' DRY' if a.dry else ''} {a.mode} {i+1}/{a.trials} truth={truth} "
                                    f"answer={keys.get(ans)} {'OK' if ok else 'X'} peak={peak:.2f}"})
            print(f"\n  实际 {truth} → {'对' if ok else '错'}   累计 {sum(score)}/{len(score)}   发出峰值 {peak:.2f} Nm")
    finally:                                                   # Ctrl-C 也要把强制路段和参数还原
        post("/terrain/force", {"kind": None})
        post("/set", {"name": "strength", "value": base_strength}); post("/set", {"name": "t_push", "value": base_push})
        if a.dry:
            post("/sim", {"walk": False})
    n, k = len(score), sum(score)
    msg = (f"正确率 {k}/{n} = {k/n:.0%}" if n else "没跑完一轮") + (f"（另作废 {voids} 轮）" if voids else "")
    post("/mark", {"label": f"AFC{' DRY' if a.dry else ''} {a.mode} 结果 {msg}"})
    print(f"\n{msg}。10 轮里 ≥9 对才可以说'能分辨'（二项检验 p≈0.01）；≤7 对就是在猜。")


if __name__ == "__main__":
    main()
