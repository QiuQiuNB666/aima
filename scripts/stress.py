"""稳定性压测（F 线）：全栈回放 + 故障注入 + loop_ms，只用标准库。

    # 12 段录制全栈各 60 s（起 main --replay 子进程，10 Hz 读 /state，汇总 DISARM / Traceback / loop_ms）
    .venv/bin/python scripts/stress.py stack --secs 60
    # 带故障（透传 SHELLOS_FAULTS 给子进程，写法见 shellos/device/replay.py）
    .venv/bin/python scripts/stress.py stack --secs 60 --faults "gap@10:3,noten@20,reboot@30:0.5"
    # 游戏屏开着时的 loop_ms：跑的同时起无头 Chrome 打开 /game（swiftshader 很吃 CPU，展位机别跑）
    .venv/bin/python scripts/stress.py stack --secs 40 --game data/recordings/0922-181327-qiuqiu.csv
    # 故障矩阵：11 种故障 × N 次，量归零 / 恢复用时（复用 tests/test_fault.py 的 rig / drive，不起子进程）
    .venv/bin/python scripts/stress.py matrix -n 3

不给录制就跑 data/recordings/ 下全部（去掉 .marks.csv）。每段一行 JSON 打到 stdout，全量写 --out。
任何一段异常退出 / 有 Traceback / 进过 DISARMED / 起不来 → 退出码 1（matrix：有故障 2 s 内没恢复 → 1）。
"""
from __future__ import annotations
import argparse
import collections
import glob
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_state(port):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/state", timeout=1))


def pct(xs, q):
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None


def summarize(rec, samples, last, log, exit_code, alive, boot_s):
    """samples = [(t, state, reason, loop_ms)]；last = 最后一次 /state。"""
    trans, prev = [], None
    for t, st, why, _ in samples:
        if st != prev:
            trans.append((round(t, 1), st, why))
            prev = st
    loops = sorted(x[3] for x in samples if x[3] is not None)
    last = last or {}
    link, terr = last.get("link") or {}, last.get("terrain") or {}
    r = dict(rec=os.path.basename(rec), boot_s=boot_s, alive_until_end=alive, exit=exit_code,
             traceback="Traceback" in log, polls=len(samples),
             disarms=sum(1 for x in trans if x[1] == "DISARMED"), transitions=trans[:20],
             states=dict(collections.Counter(x[1] for x in samples)),
             reasons=dict(collections.Counter(x[2] for x in samples)),
             loop_med=pct(loops, 0.5), loop_p95=pct(loops, 0.95), loop_max=loops[-1] if loops else None,
             over50=sum(1 for v in loops if v > 50),
             frames=link.get("n"), bad=link.get("bad"), enabled=link.get("enabled"), reboots=link.get("reboots"),
             strides=(last.get("gait") or {}).get("strides"), pos=terr.get("pos"), laps=terr.get("laps"),
             events=[e.get("text") for e in last.get("events", [])][-8:])
    # 回放放完会自己退出（exit 0）；起得来、没 Traceback、没进 DISARMED 就算过
    r["ok"] = bool(samples) and not r["traceback"] and r["disarms"] == 0 and (alive or exit_code == 0)
    return r


def chrome(url):
    d = tempfile.mkdtemp()
    p = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu-sandbox", "--use-angle=swiftshader",
                          "--enable-unsafe-swiftshader", "--hide-scrollbars", "--window-size=1920,1080",
                          f"--user-data-dir={d}", "--remote-debugging-port=0", "--no-first-run", url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return p, d


def run_one(rec, port, secs, faults, game, logdir):
    args = [sys.executable, "-m", "shellos.main", "--replay", rec, "--ctl", "terrain", "--no-record",
            "--no-input", "--http", str(port), "--force-deadman"]
    env = dict(os.environ, SDL_VIDEODRIVER="dummy")
    if faults:
        env["SHELLOS_FAULTS"] = faults
    logpath = os.path.join(logdir, os.path.basename(rec) + ".log")
    with open(logpath, "w") as logf:
        p = subprocess.Popen(args, cwd=ROOT, stdout=logf, stderr=subprocess.STDOUT, env=env)
        t0, last = time.monotonic(), None
        while time.monotonic() - t0 < 30 and p.poll() is None and last is None:
            try:
                last = get_state(port)
            except Exception:
                time.sleep(0.2)
        boot_s = round(time.monotonic() - t0, 1)
        ch = chrome(f"http://127.0.0.1:{port}/game") if game and last is not None else None
        samples, t0 = [], time.monotonic()
        while last is not None and time.monotonic() - t0 < secs and p.poll() is None:
            try:
                s = get_state(port)
            except Exception:
                time.sleep(0.1)
                continue
            last = s
            samples.append((time.monotonic() - t0, s["safety"]["state"], s["safety"]["reason"], s.get("loop_ms")))
            time.sleep(0.1)
        if ch:
            ch[0].terminate()
            try:
                ch[0].wait(5)
            except subprocess.TimeoutExpired:
                ch[0].kill()
            shutil.rmtree(ch[1], ignore_errors=True)
        alive = p.poll() is None
        if alive:
            p.send_signal(signal.SIGTERM)       # 走 main 的退出路径：DISABLE 必须发出去
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
    log = open(logpath, errors="replace").read()
    r = summarize(rec, samples, last, log, p.returncode, alive, boot_s)
    r["log"] = logpath
    return r


def cmd_stack(a):
    recs = a.recs or sorted(x for x in glob.glob(str(ROOT / "data/recordings/*.csv")) if not x.endswith(".marks.csv"))
    port = a.port or free_port()
    logdir = tempfile.mkdtemp(prefix="shellos-stress-")
    res = []
    for rec in recs:
        r = run_one(os.path.abspath(rec), port, a.secs, a.faults, a.game, logdir)
        res.append(r)
        print(json.dumps({k: r[k] for k in ("rec", "ok", "boot_s", "exit", "traceback", "disarms", "loop_med",
                                            "loop_p95", "loop_max", "bad", "strides", "reasons")},
                         ensure_ascii=False), flush=True)
        time.sleep(1)                           # 等端口释放
    bad = [r["rec"] for r in res if not r["ok"]]
    print(f"== {len(res) - len(bad)}/{len(res)} 段通过；日志 {logdir}" + (f"；不过：{bad}" if bad else ""))
    return res, not bad


def cmd_matrix(a):
    sys.path.insert(0, str(ROOT))
    from tests.test_fault import make_csv, rig, drive, recovered_at, SLEW
    from shellos.safety.guard import DISARMED
    csv = make_csv(pathlib.Path(tempfile.mkdtemp()) / "r.csv")
    cases = [  # (名字, 故障, 故障开始, 故障结束, 跑多久, 应该自己恢复)
        ("ERR,NOT_ENABLED", "noten@0.5", 0.5, 0.5, 2.0, True),
        ("设备复位 静默0.5s", "reboot@0.5:0.5", 0.5, 1.0, 3.0, True),
        ("设备复位 静默1.5s", "reboot@0.5:1.5", 0.5, 2.0, 4.5, True),
        ("设备复位 静默3s", "reboot@0.5:3", 0.5, 3.5, 6.0, True),
        ("断流 0.15s", "gap@0.5:0.15", 0.5, 0.65, 2.0, True),
        ("断流 0.5s", "gap@0.5:0.5", 0.5, 1.0, 2.5, True),
        ("断流 3s", "gap@0.5:3", 0.5, 3.5, 5.5, True),
        ("坏帧 0.1s", "bad@0.5:0.1", 0.5, 0.6, 2.0, True),
        ("坏帧 0.5s", "bad@0.5:0.5", 0.5, 1.0, 2.5, True),
        ("主机卡顿 0.3s", "stall@0.5:0.3", 0.5, 0.8, 2.0, True),
        ("主机卡顿 1.2s", "stall@0.5:1.2", 0.5, 1.7, 3.0, False),   # 看门狗 DISARMED，只能 rearm
    ]
    res, good = [], True
    for name, spec, t0, t1, secs, should in cases:
        rec, zero, host_zero, dis, slew_ok = [], [], [], 0, True
        for _ in range(a.n):
            link, guard = rig(csv, spec)
            zs = []
            guard.on_sent = lambda l, r, zs=zs, link=link: zs.append(time.monotonic() - link.t0) if l == 0 and r == 0 else None
            s = drive(link, guard, secs)
            h = next((z for z in zs if z >= t0), None)
            host_zero.append(None if h is None else round(h - t0, 3))
            r = recovered_at(s, t1)
            rec.append(None if r is None else round(r - t1, 3))
            z = next((x[0] for x in s if x[0] >= t0 and x[3] == 0.0), None)    # 腿上力矩第一次为 0
            zero.append(None if z is None else round(z - t0, 3))
            dis += any(x[1] == DISARMED for x in s)
            slew_ok &= all(b[2] - a_[2] <= SLEW + 1e-6 for a_, b in zip(s, s[1:]))
            link.close()
            guard._alive = False
        passed = slew_ok and (all(x is not None and x <= 2.0 for x in rec) and dis == 0 if should
                              else dis == a.n and all(x is None for x in rec))
        good &= passed
        res.append(dict(name=name, spec=spec, ok=passed, zero=zero, host_zero=host_zero, rec=rec,
                        disarmed=dis, slew_ok=slew_ok, n=a.n))
        print(json.dumps(res[-1], ensure_ascii=False), flush=True)
    return res, good


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stack", help="全栈回放")
    s.add_argument("recs", nargs="*", help="录制 CSV；缺省 data/recordings/*.csv")
    s.add_argument("--secs", type=float, default=60.0, help="每段跑多久（回放放完会提前结束）")
    s.add_argument("--port", type=int, default=0, help="HTTP 端口；0 = 随便挑个空的")
    s.add_argument("--faults", default=os.environ.get("SHELLOS_FAULTS", ""), help="透传 SHELLOS_FAULTS")
    s.add_argument("--game", action="store_true", help="同时开无头 Chrome 打开 /game（量游戏屏对 loop_ms 的影响）")
    s.add_argument("--out", help="全量结果 JSON")
    m = sub.add_parser("matrix", help="故障矩阵")
    m.add_argument("-n", type=int, default=3, help="每种故障跑几次")
    m.add_argument("--out", help="全量结果 JSON")
    a = ap.parse_args()
    res, good = (cmd_stack if a.cmd == "stack" else cmd_matrix)(a)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    sys.exit(0 if good else 1)


if __name__ == "__main__":
    main()
