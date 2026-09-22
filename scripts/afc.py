"""蒙眼二选一（2AFC）：验证"人分得清虚拟上坡和下坡"。没做过这个别在评委面前报数字。

ShellOS 要先在跑（--ctl terrain）。穿的人蒙眼或不看屏幕，按住 R2 原地踏步或走；
每一轮随机给 up 或 down 持续 N 步，然后问他"上坡还是下坡"，记对错。10 轮，报正确率。
也可以测 "强/弱" 或 "早/晚"：--mode strength / --mode timing。

  .venv/bin/python scripts/afc.py --trials 10 --seconds 8
"""
import argparse
import json
import random
import time
import urllib.request

API = "http://localhost:8765"


def post(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body or {}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=3))


def state():
    return json.load(urllib.request.urlopen(API + "/state", timeout=3))


ap = argparse.ArgumentParser()
ap.add_argument("--trials", type=int, default=10)
ap.add_argument("--seconds", type=float, default=8.0)
ap.add_argument("--mode", default="slope", choices=["slope", "strength", "timing"])
a = ap.parse_args()

s = state()
if s["ctl"]["name"] != "terrain":
    post("/ctl", {"name": "terrain"})
base_strength = state()["ctl"]["params"]["strength"][0]
base_push = state()["ctl"]["params"]["t_push"][0]
print(f"模式 {a.mode}，{a.trials} 轮，每轮 {a.seconds} s。穿的人别看屏幕。回车开始每一轮。")
score = []
for i in range(a.trials):
    input(f"\n第 {i+1} 轮：按住 R2 开始走，回车给刺激 → ")
    if a.mode == "slope":
        truth = random.choice(["up", "down"]); post("/terrain/force", {"kind": truth}); options = "上坡(u) / 下坡(d)"; keys = {"u": "up", "d": "down"}
    elif a.mode == "strength":
        truth = random.choice(["strong", "weak"]); post("/terrain/force", {"kind": "up"})
        post("/set", {"name": "strength", "value": base_strength + (0.5 if truth == "strong" else -0.5)}); options = "强(s) / 弱(w)"; keys = {"s": "strong", "w": "weak"}
    else:
        truth = random.choice(["early", "late"]); post("/terrain/force", {"kind": "up"})
        post("/set", {"name": "t_push", "value": base_push + (-5 if truth == "early" else 5)}); options = "早(e) / 晚(l)"; keys = {"e": "early", "l": "late"}
    t0 = time.time()
    while time.time() - t0 < a.seconds:
        st = state(); print(f"\r  {a.seconds - (time.time()-t0):4.1f}s  发出 {st['safety']['sent']}  R2 {st['safety']['deadman']:.2f}   ", end="", flush=True); time.sleep(0.2)
    post("/terrain/force", {"kind": None}); post("/set", {"name": "strength", "value": base_strength}); post("/set", {"name": "t_push", "value": base_push})
    ans = input(f"\n  他说是哪个？{options}：").strip().lower()
    ok = keys.get(ans) == truth
    score.append(ok)
    post("/mark", {"label": f"AFC {a.mode} truth={truth} answer={keys.get(ans)} {'OK' if ok else 'X'}"})
    print(f"  实际 {truth} → {'对' if ok else '错'}   累计 {sum(score)}/{len(score)}")
n, k = len(score), sum(score)
print(f"\n正确率 {k}/{n} = {k/n:.0%}。10 轮里 ≥9 对才可以说'能分辨'（二项检验 p≈0.01）；≤7 对就是在猜。")
