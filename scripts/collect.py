"""引导式采集：跟着屏幕做动作，自动打标签。ShellOS 要先在跑（./run-mac.sh --ctl transparent --cap 2.5 --wearer 名字）。

每一段：屏幕告诉你做什么 → 回车开始（输 s 跳过，q 结束）→ 倒计时 → 自动记 START/END 标签。
力矩段要求你按住 R2（或网页大按钮），没按住就等着，不会自己给力。
"""
import json
import sys
import time
import urllib.request

API = "http://localhost:8765"


def post(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body or {}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=3))


def state():
    return json.load(urllib.request.urlopen(API + "/state", timeout=3))


def big(msg):
    print("\n" + "=" * 60 + f"\n  {msg}\n" + "=" * 60, flush=True)


def countdown(sec, label):
    t_end = time.time() + sec
    while True:
        left = t_end - time.time()
        if left <= 0:
            break
        s = state()
        f = s["frame"] or {}
        print(f"\r  {label}  剩 {left:4.1f}s  | L {f.get('l', 0):6.1f}°  R {f.get('r', 0):6.1f}°  "
              f"pitch {f.get('pitch', 0):6.1f}°  | 发出 {s['safety']['sent']}  R2 {s['safety']['deadman']:.2f}   ",
              end="", flush=True)
        time.sleep(0.2)
    print()


def ask(prompt):
    r = input(f"\n{prompt}\n  → 回车开始，s 跳过，q 结束：").strip().lower()
    if r == "q":
        raise SystemExit
    return r != "s"


def wait_deadman():
    while state()["safety"]["deadman"] <= 0.05:
        print("\r  等你按住 R2 ……", end="", flush=True)
        time.sleep(0.2)
    print("\r  R2 已按住          ")


def seg(label, instr, sec):
    if not ask(f"【{label}】{instr}（{sec} 秒）"):
        return
    post("/mark", {"label": f"START {label}"})
    countdown(sec, label)
    post("/mark", {"label": f"END {label}"})


def torque_steps(pose):
    if not ask(f"【力矩阶跃·{pose}】{pose}，按住 R2 不放。我依次给两腿同样的力，每档 3 秒、间隔 2 秒。"
               f"\n  顺序：+0.5 +1.0 +1.5 +2.0 然后 -0.5 -1.0 -1.5 -2.0 Nm。不舒服立刻松 R2。"):
        return
    post("/ctl", {"name": "constant"})
    post("/set", {"name": "tl", "value": 0}); post("/set", {"name": "tr", "value": 0})
    wait_deadman()
    for t in (0.5, 1.0, 1.5, 2.0, -0.5, -1.0, -1.5, -2.0):
        post("/set", {"name": "tl", "value": t}); post("/set", {"name": "tr", "value": t})
        post("/mark", {"label": f"START step {pose} {t:+.1f}"})
        countdown(3, f"两腿 {t:+.1f} Nm —— 感觉是往前抬还是往后拉？")
        post("/mark", {"label": f"END step {pose} {t:+.1f}"})
        post("/set", {"name": "tl", "value": 0}); post("/set", {"name": "tr", "value": 0})
        countdown(2, "归零休息")
    post("/ctl", {"name": "transparent"})
    fb = input("\n  正值那几档是【前抬】还是【后拉】？（输 前 / 后 / 没感觉）：").strip()
    post("/mark", {"label": f"FEEDBACK step {pose} positive={fb}"})


def dofc_walk(gain):
    if not ask(f"【DOFC 走路 gain={gain:+.2f}】按住 R2，正常走（能走多远走多远，来回也行）。"):
        return
    post("/ctl", {"name": "dofc"})
    post("/set", {"name": "gain", "value": gain})
    wait_deadman()
    post("/mark", {"label": f"START dofc gain {gain:+.2f}"})
    countdown(30, f"DOFC gain {gain:+.2f}")
    post("/mark", {"label": f"END dofc gain {gain:+.2f}"})
    post("/ctl", {"name": "transparent"})
    fb = input("\n  感觉：顺 / 顶 / 没感觉？").strip()
    post("/mark", {"label": f"FEEDBACK dofc {gain:+.2f} {fb}"})


def main():
    s = state()
    big(f"ShellOS 在线：{s['link']['port']}，已收 {s['link']['n']} 帧。开始采集。")
    post("/ctl", {"name": "transparent"})
    big("第一部分：不给力，只录动作（先穿好外骨骼）")
    seg("站立静止", "站直别动", 15)
    seg("抬左腿", "只抬左腿（大腿向前抬到水平再放下），慢慢做 5 次", 20)
    seg("抬右腿", "只抬右腿，慢慢做 5 次", 20)
    seg("身体前倾", "腰往前弯再直起来，3 次", 15)
    seg("坐站", "坐下—站起，5 次", 30)
    seg("原地踏步", "原地踏步", 20)
    seg("慢走", "慢慢走（来回走）", 30)
    seg("正常走", "正常速度走", 30)
    seg("快走", "快走", 30)
    seg("上下台阶", "有台阶就上下台阶，没有就跳过（输 s）", 30)
    big("第二部分：给力（手里拿手柄，按住 R2 才有力）")
    torque_steps("站立")
    for g in (0.10, 0.20, -0.10):
        dofc_walk(g)
    big("采集完成。可以脱下外骨骼了。数据已经在录制文件里。")


if __name__ == "__main__":
    try:
        main()
    except (SystemExit, KeyboardInterrupt):
        try:
            post("/ctl", {"name": "transparent"}); post("/mark", {"label": "ABORT"})
        except Exception:
            pass
        print("\n已结束。")
