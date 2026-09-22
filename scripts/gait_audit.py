"""步态门限审计：用 9/22 真机录制 + 模拟步态，扫估计器的周期接受门限，看哪档最稳。

    .venv/bin/python scripts/gait_audit.py            # 门限网格 + 每段录制明细 + 走动中 + 原地踏步
    .venv/bin/python scripts/gait_audit.py --hs       # 用腰部 az 冲击估 HS_PHASE（脚跟着地在估计器相位里的位置）
    .venv/bin/python scripts/gait_audit.py --rec data/recordings/x.csv   # 只看某几段（明天真机录的新数据直接跑）

参考标签（和估计器门限无关，独立判断"这段是不是在走路"）：
  - 文件名带 table 的：设备没穿在人身上（桌上/手里摆弄），整段"不是走路"，接受的周期全算假周期（单列）
  - 其余：3 s 窗口里左右髋角**反相**（相关 ≤ -0.3）且两腿活动度都 ≥ 8° → 走路；坐下/站起/弯腰是两腿**同相**
  - 走路段前后 1.5 s 算"边界"，不计真也不计假
估计器按主循环的方式喂：100 Hz 取最新一帧（不是全速 183 Hz），和现场一致。
候选周期（相位绕回一圈）的产生和门限无关：每段录制只跑一遍估计器（门全开、记下每个候选的统计量），门限离线套。
"""
from __future__ import annotations
import argparse
import bisect
import csv
import glob
import itertools
import math
import os
import random
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from shellos.device.frame import Frame, FIELDS  # noqa: E402
from shellos.gait.estimator import GaitEstimator, DEFAULTS, STEPPING  # noqa: E402

REC_DIR = os.path.join(ROOT, "data", "recordings")
DUP = {"real-0922-173111-table.csv"}          # 0922-173111-table 的截短清洗版，不重复计数
GATES = ("stride_min", "stride_max", "cycle_conf", "rom_min", "sync_tol")
OPEN = dict(stride_min=0.0, stride_max=1e9, cycle_conf=-1.0, rom_min=-1.0, sync_tol=None)
GRID = dict(stride_min=(0.6, 0.7, 0.8), stride_max=(1.8, 2.0, 2.2), cycle_conf=(-1.0, 0.3, 0.4, 0.5, 0.6, 0.7),
            rom_min=(10.0, 12.0, 15.0, 18.0, 20.0), sync_tol=(None, 0.1, 0.15, 0.2))
HOLDS = (0.2, 0.3, 0.4, 0.5)
RECENTS = (None, 1.5, 2.5)
EDGE_S = 1.5
HS_WINS = {"front": (0.25, 0.75), "back": (0.75, 1.25)}   # 前半周 = 本腿在前（髋屈），后半周 = 本腿在后（髋伸）


# ---------- 读数据 ----------
def load(path):
    """录制 CSV → Frame 列表（t_host 用文件里的主机时间）。坏行（9/22 有一段带 NUL 字节）跳过。"""
    out, last_t = [], -1e9
    with open(path, newline="", errors="replace") as fh:
        for r in csv.DictReader(fh):
            if r.get("kind", "frame") != "frame":
                continue
            try:
                t = float(r["t_host"])
                v = [float(r[k]) for k in FIELDS]
            except (TypeError, ValueError, KeyError):
                continue
            if t <= last_t:
                continue
            last_t = t
            out.append(Frame(t, *v))
    return out


def ticks(frames, hz=100.0):
    """主循环的喂法：每 1/hz 秒取最新一帧。"""
    i, n = 0, len(frames)
    t, dt = frames[0].t_host, 1.0 / hz
    while i < n:
        while i + 1 < n and frames[i + 1].t_host <= t:
            i += 1
        yield frames[i]
        if i == n - 1:
            return
        t += dt


def has_hip(frames):
    return any(f.l_deg != 0.0 or f.r_deg != 0.0 for f in frames)


# ---------- 参考标签：左右反相 = 走路 ----------
def reference(frames, win=3.0, step=0.5, corr_max=-0.3, rom_min=8.0):
    """返回走路区间 [(t0, t1)]。只用髋角的左右相关和活动度，不用估计器。"""
    if not frames:
        return []
    ts = [f.t_host for f in frames]
    walk, t, j0 = [], ts[0], 0
    while t + win <= ts[-1]:
        while ts[j0] < t:
            j0 += 1
        j1 = bisect.bisect_left(ts, t + win, j0)
        L = [f.l_deg for f in frames[j0:j1]]
        R = [f.r_deg for f in frames[j0:j1]]
        ok = False
        if len(L) > 50 and max(L) - min(L) >= rom_min and max(R) - min(R) >= rom_min:
            ml, mr = sum(L) / len(L), sum(R) / len(R)
            sl = math.sqrt(sum((x - ml) ** 2 for x in L))
            sr = math.sqrt(sum((x - mr) ** 2 for x in R))
            c = sum((a - ml) * (b - mr) for a, b in zip(L, R)) / (sl * sr) if sl and sr else 0.0
            ok = c <= corr_max
        if ok:
            a, b = t + win / 2 - step / 2, t + win / 2 + step / 2
            if walk and a <= walk[-1][1] + 1e-9:
                walk[-1] = (walk[-1][0], b)
            else:
                walk.append((a, b))
        t += step
    return [(a - win / 2 + step / 2, b + win / 2 - step / 2) for a, b in walk]   # 窗口中心 → 覆盖范围


def region(t, walk, table):
    if table:
        return "table"
    for a, b in walk:
        if a <= t <= b:
            return "walk"
    for a, b in walk:
        if a - EDGE_S <= t <= b + EDGE_S:
            return "edge"
    return "still"


# ---------- 跑估计器 ----------
def run(frames, walk=(), table=False, hz=100.0, **kw):
    """门全开跑一遍。候选周期 (leg, t_end, stride, min_conf, rom, dphi, o_conf, region)，
    每拍 (t, conf, φL, φR, az, θL, θR, 任一腿相位停滞)。kw 里的非门限参数（r_ref、latch、stepping…）照常生效。"""
    g = GaitEstimator(**{**kw, **OPEN, "trace": True})
    series = []
    for f in ticks(frames, hz):
        st = g.update(f)
        series.append((f.t_host, st.conf, st.l.phase, st.r.phase, f.az, f.l_deg, f.r_deg, st.l.stalled or st.r.stalled))
    cands = []
    for leg, cyc in (("l", g._l.cycles), ("r", g._r.cycles)):
        for t, stride, mc, rom, _ok, dphi, oc in cyc:
            cands.append((leg, t, stride, mc, rom, dphi, oc, region(t - stride / 2, walk, table)))
    return sorted(cands, key=lambda c: c[1]), series


def longest_output(frames, kind="stairs_up", hz=100.0, conf_th=0.5, params=None, **kw):
    """主循环同款：GaitEstimator + Terrain（强制路段 kind），任一腿 |τ|>0.05 且 conf≥Guard 门（0.5）算「在出力」，
    返回最长一段连续出力 (秒, 起点 t_host)。Guard 的斜率限没算（只会把段拉长约 1 拍）。kw 给估计器，params 给地形。"""
    from shellos.control.terrain import Terrain
    g, ter = GaitEstimator(**kw), Terrain()
    ter.force = kind
    for k, v in (params or {}).items():
        ter.params[k][0] = v
    best, start, prev = (0.0, None), None, None
    for f in ticks(frames, hz):
        st = g.update(f)
        tl, tr = ter.step(f, st)
        on = (abs(tl) > 0.05 or abs(tr) > 0.05) and st.conf >= conf_th
        if on and start is None:
            start = f.t_host
        elif not on and start is not None:
            best = max(best, (prev - start + 1.0 / hz, start))
            start = None
        prev = f.t_host
    if start is not None:
        best = max(best, (prev - start + 1.0 / hz, start))
    return best


OUT_PARAMS = ({}, {"width": 20.0}, {"t_step": 3.0})   # 缺省 / 最宽脉冲 / 台阶脉冲最早：9/22 回放里最长连续出力的最坏档


def gates(stepping=False, **kw):
    """一个估计器实际用的门限（和 GaitEstimator 的合并规则一致）。"""
    base = {**DEFAULTS, **(STEPPING if stepping else {}), **kw}
    return {k: base[k] for k in GATES}


def accept(c, cfg):
    stride, conf, rom, dphi, oc = c[2], c[3], c[4], c[5], c[6]
    if not (cfg["stride_min"] <= stride <= cfg["stride_max"] and conf > cfg["cycle_conf"] and rom >= cfg["rom_min"]):
        return False
    return cfg["sync_tol"] is None or (min(dphi, 1.0 - dphi) >= cfg["sync_tol"] and oc > 0.5)


def evaluate(rec, cfg, cands=None):
    """一段录制在一档门限下：各区域接受数、走路覆盖率、步频。"""
    out = {"walk": 0, "edge": 0, "still": 0, "table": 0, "rej": 0, "rej_walk": 0, "cad": [], "cov_s": 0.0}
    for c in (rec["cands"] if cands is None else cands):
        if accept(c, cfg):
            out[c[7]] += 1
            if c[7] == "walk":
                out["cad"].append(120.0 / c[2])
                out["cov_s"] += c[2]
        else:
            out["rej"] += 1
            out["rej_walk"] += c[7] == "walk"
    wd = rec["walk_s"]
    out["coverage"] = out["cov_s"] / (2 * wd) if wd else None   # 两条腿，1.0 = 每一步都算上了
    return out


def pct(xs, p):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def moving_stats(rec, hold, recent, cfg, conf_th=0.5, inphase_tol=0.1):
    """用每拍置信度 + 接受周期时刻复算"走动中"（与 GaitEstimator.update 的规则一致：相位停滞 / 两腿同相 → 假，不重置保持计时）。"""
    acc_t = sorted(c[1] for c in rec["cands"] if accept(c, cfg))
    false_s = walk_s = 0.0
    episodes, since, prev_t, prev_m = 0, None, None, False
    first = {}
    for t, conf, pl, pr, *rest in rec["series"]:
        if conf > conf_th:
            since = t if since is None else since
            m = t - since >= hold
            if m and recent is not None:
                i = bisect.bisect_right(acc_t, t)
                m = i > 0 and t - acc_t[i - 1] <= recent
        else:
            since, m = None, False
        d = abs(pl - pr) % 1.0
        if rest[-1] or (inphase_tol is not None and min(d, 1.0 - d) < inphase_tol):
            m = False
        where = region(t, rec["walk"], rec["table"])
        if prev_t is not None and m:
            if where in ("still", "table"):
                false_s += t - prev_t
            elif where == "walk":
                walk_s += t - prev_t
        if m and not prev_m and where in ("still", "table"):
            episodes += 1
        if m and where == "walk":
            for a, b in rec["walk"]:
                if a <= t <= b and a not in first:
                    first[a] = t - a
        prev_t, prev_m = t, m
    return {"false_s": false_s, "episodes": episodes, "walk_s": walk_s, "onsets": list(first.values())}


def recordings(paths, latch_compare=True):
    recs = []
    for p in paths:
        name = os.path.basename(p)
        fr = load(p)
        if len(fr) < 200:
            recs.append({"name": name, "skip": f"只有 {len(fr)} 帧"})
            continue
        dur = fr[-1].t_host - fr[0].t_host
        if not has_hip(fr):
            recs.append({"name": name, "skip": "髋角全为 0（编码器没数据），只有 IMU", "dur": dur})
            continue
        table = "table" in name
        walk = [] if table else reference(fr)
        cands, series = run(fr, walk, table)
        rec = {"name": name, "table": table, "walk": walk, "walk_s": sum(b - a for a, b in walk), "dur": dur,
               "cands": cands, "series": series, "dup": name in DUP, "frames": fr}
        if latch_compare:
            rec["cands_nolatch"] = run(fr, walk, table, latch=False)[0]
        recs.append(rec)
    return recs


# ---------- 模拟：照 shellos/device/sim.py 的模型离线生成（不开线程，快） ----------
def synth(cadence=110.0, amp=20.0, seconds=30.0, noise=0.3, jitter=0.0, harm=0.0, rate=200, seed=0,
          hs_phase=None, walk_from=0.0):
    """sim.py 同款：左右反相正弦、摆幅 0.02/帧 缓升、髋角/角速度加 0.3 高斯噪声。
    jitter：每个周期步频随机 ±jitter；harm：二次谐波（真人踏步波形不是正弦）；
    hs_phase：在估计器相位 hs_phase 处放一个 az 冲击（给 --hs 做自检）；walk_from：之前站着不动。"""
    rnd = random.Random(seed)
    ph, a, out, ms = 0.0, 0.0, [], 0.0
    fcyc = cadence / 120.0 * (1 + rnd.uniform(-jitter, jitter))
    for i in range(int(seconds * rate)):
        t = i / rate
        prev = ph
        ph = (ph + 2 * math.pi * fcyc / rate) % (2 * math.pi)
        if ph < prev:
            fcyc = cadence / 120.0 * (1 + rnd.uniform(-jitter, jitter))
        a += ((amp if t >= walk_from else 0.0) - a) * 0.02
        w = 2 * math.pi * fcyc

        def ang(p):
            return a * (math.sin(p) + harm * math.sin(2 * p)) / (1 + harm)

        def vel(p):
            return a * w * (math.cos(p) + 2 * harm * math.cos(2 * p)) / (1 + harm)
        az = 1.0
        if hs_phase is not None and a > 1.0:   # 估计器相位 0 = θ 最大 = sin 相位 π/2
            for p in (ph, ph + math.pi):
                d = ((p / (2 * math.pi) - 0.25 - hs_phase + 0.5) % 1.0) - 0.5
                az += 0.3 * math.exp(-(d / 0.02) ** 2)
        ms += 1000 / rate
        out.append(Frame(t, ms, 0, 0, 0, 0, 0, 0, 0, 0, az, 101.3,
                         ang(ph) + rnd.gauss(0, noise), ang(ph + math.pi) + rnd.gauss(0, noise),
                         vel(ph) + rnd.gauss(0, noise), vel(ph + math.pi) + rnd.gauss(0, noise)))
    return out


def sim_run(frames, warm=3.0, **kw):
    """模拟数据上直接用某组参数跑：接受周期数（去掉头 warm 秒）、走动中占比、步频。"""
    g = GaitEstimator(**{**kw, "trace": True})
    mov = n = 0
    for f in ticks(frames):
        st = g.update(f)
        if f.t_host > warm:
            n += 1
            mov += st.moving
    acc = [c for leg in (g._l, g._r) for c in leg.cycles if c[4] and c[0] - c[1] > warm]
    allc = [c for leg in (g._l, g._r) for c in leg.cycles if c[0] - c[1] > warm]
    return {"acc": len(acc), "moving": mov / max(1, n),
            "cad": statistics.median([120 / c[1] for c in acc]) if acc else 0.0,
            "rom": statistics.median([c[3] for c in allc]) if allc else 0.0,
            "minconf": statistics.median([c[2] for c in allc]) if allc else 0.0}


# ---------- 输出小工具 ----------
def fmt(x, nd=2):
    if x is None or (isinstance(x, float) and x != x):
        return "—"
    return f"{x:.{nd}f}" if isinstance(x, float) else str(x)


def cfg_name(c):
    s = f"{c['stride_min']:.1f}–{c['stride_max']:.1f}s"
    s += "·最低conf关" if c["cycle_conf"] < 0 else f"·最低conf>{c['cycle_conf']:.1f}"
    s += f"·rom≥{c['rom_min']:.0f}"
    if c.get("sync_tol") is not None:
        s += f"·同相拒{c['sync_tol']:.2f}"
    return s


def summary(use, cfg):
    ev = [evaluate(r, cfg) for r in use]
    wsum = sum(r["walk_s"] for r in use)
    return {"cfg": cfg, "worn": sum(e["still"] for e in ev), "table": sum(e["table"] for e in ev),
            "edge": sum(e["edge"] for e in ev), "walk": sum(e["walk"] for e in ev),
            "cov": sum(e["cov_s"] for e in ev) / (2 * wsum) if wsum else None,
            "cad": [x for e in ev for x in e["cad"]]}


# ---------- 主审计 ----------
def audit(recs):
    use = [r for r in recs if "skip" not in r and not r["dup"]]
    t0s = {r["name"]: r["series"][0][0] for r in use}
    print("## 录制概况\n")
    print("| 录制 | 时长 s | 类型 | 参考走路段 | 候选周期 |")
    print("|---|---|---|---|---|")
    for r in recs:
        if "skip" in r:
            print(f"| {r['name']} | {fmt(r.get('dur'), 0)} | 跳过：{r['skip']} | | |")
            continue
        kind = "桌上/手里（没穿）" if r["table"] else "穿戴"
        t0 = r["series"][0][0]
        walks = "、".join(f"{a - t0:.0f}–{b - t0:.0f}" for a, b in r["walk"]) or "无"
        print(f"| {r['name']}{'（重复，不计总数）' if r['dup'] else ''} | {r['dur']:.0f} | {kind} | "
              f"{walks}（共 {r['walk_s']:.0f} s） | {len(r['cands'])} |")

    cur_cfg = gates()
    if all("cands_nolatch" in r for r in use):
        print("\n## 半周期锁存（新）vs 无锁存（9/23 前），门限都用 9/23 前的默认 0.7–2.0s·最低conf>0.6·rom≥15\n")
        old_cfg = dict(OPEN, stride_min=0.7, stride_max=2.0, cycle_conf=0.6, rom_min=15.0)
        print("| 录制 | 候选周期 旧→新 | 走路里接受 旧→新 | 假周期 旧→新 | 覆盖率 旧→新 |")
        print("|---|---|---|---|---|")
        for r in use:
            o = evaluate(r, old_cfg, r["cands_nolatch"])
            n = evaluate(r, old_cfg)
            print(f"| {r['name']} | {len(r['cands_nolatch'])}→{len(r['cands'])} | {o['walk']}→{n['walk']} | "
                  f"{o['still'] + o['table']}→{n['still'] + n['table']} | {fmt(o['coverage'])}→{fmt(n['coverage'])} |")

    keys = list(GRID)
    results = [summary(use, dict(zip(keys, vals))) for vals in itertools.product(*(GRID[k] for k in keys))]
    by = {tuple(x["cfg"][k] for k in keys): x for x in results}

    def neighbours(x):
        idx = [GRID[k].index(x["cfg"][k]) for k in keys]
        for d in range(len(keys)):
            for s in (-1, 1):
                j = idx[:]
                j[d] += s
                if 0 <= j[d] < len(GRID[keys[d]]):
                    yield by[tuple(GRID[keys[i]][j[i]] for i in range(len(keys)))]

    for x in results:
        x["plateau"] = x["worn"] == 0 and all(n["worn"] == 0 for n in neighbours(x))
    cur = by.get(tuple(cur_cfg[k] for k in keys)) or summary(use, cur_cfg)
    cur.setdefault("plateau", False)
    old = summary(use, dict(OPEN, stride_min=0.7, stride_max=2.0, cycle_conf=0.6, rom_min=15.0))
    # 推荐：穿戴坐/站 0 假周期且邻档都 0；桌上假周期不多于 9/23 前；走路覆盖率最高
    safe = [x for x in results if x["plateau"] and x["table"] <= old["table"]]
    best = max(safe, key=lambda x: ((x["cov"] or 0), -x["table"])) if safe else None

    wsum = sum(r["walk_s"] for r in use)
    print(f"\n## 门限网格（{len(results)} 档；{len(use)} 段录制合计，走路参考 {wsum:.0f} s）\n")
    print("- **穿戴假周期**：穿在人身上、不在走路（坐、站、坐下站起、单腿晃）时被接受的周期——这就是「坐/站段假周期」")
    print("- **桌上假周期**：设备没穿、被手摆弄时被接受的周期（展位上穿脱设备时会遇到）")
    print("- **覆盖率** = 走路段里被接受周期的时长之和 / (走路时长 × 2 腿)；1.0 = 一步不漏")
    print("- **稳** = 这一档和网格上所有相邻档的穿戴假周期都是 0（门限偏一格也不出事）\n")
    print("| 门限 | 穿戴假周期 | 桌上假周期 | 边界 | 走路接受 | 覆盖率 | 步频中位 | P10 | P90 | 稳 |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    ranked = sorted(results, key=lambda x: (not x["plateau"], x["table"] > old["table"], -(x["cov"] or 0)))
    show = ranked[:15] + [cur, old] + sorted(results, key=lambda x: -(x["cov"] or 0))[:3]
    seen = set()
    for x in show:
        k = cfg_name(x["cfg"])
        if k in seen:
            continue
        seen.add(k)
        tag = "（现默认）" if x is cur else ("（9/23 前默认）" if x is old else "")
        print(f"| {k}{tag} | {x['worn']} | {x['table']} | {x['edge']} | {x['walk']} | {fmt(x['cov'])} | "
              f"{fmt(pct(x['cad'], .5), 0)} | {fmt(pct(x['cad'], .1), 0)} | {fmt(pct(x['cad'], .9), 0)} | "
              f"{'✓' if x.get('plateau') else ''} |")

    print("\n### 单维度扫描（其余门限 = 现默认）\n")
    print("| 维度 | 值 | 穿戴假周期 | 桌上假周期 | 覆盖率 | 步频中位 |")
    print("|---|---|---|---|---|---|")
    for k in keys:
        for v in GRID[k]:
            x = summary(use, dict(cur_cfg, **{k: v}))
            print(f"| {k} | {v} | {x['worn']} | {x['table']} | {fmt(x['cov'])} | {fmt(pct(x['cad'], .5), 0)} |")

    if best is None:
        verdict, rec_cfg = "没有任何一档同时做到「穿戴 0 假周期且邻档稳」和「桌上不比以前多」→ 不改", cur_cfg
    elif cur.get("plateau") and cur["table"] <= old["table"] and (best["cov"] or 0) - (cur["cov"] or 0) < 0.03:
        verdict, rec_cfg = f"现默认已在稳区，覆盖率 {fmt(cur['cov'])} 与最优 {fmt(best['cov'])} 差 <0.03 → 不改", cur_cfg
    else:
        verdict, rec_cfg = (f"建议 {cfg_name(best['cfg'])}：穿戴 0 假周期（邻档也 0）、桌上 {best['table']}、"
                            f"覆盖率 {fmt(best['cov'])}（现默认：穿戴 {cur['worn']}、桌上 {cur['table']}、覆盖率 {fmt(cur['cov'])}）"), best["cfg"]
    print(f"\n**脚本结论**：{verdict}\n")

    for label, cfg in ((("现默认", cur_cfg), ("脚本推荐", rec_cfg)) if rec_cfg != cur_cfg else (("现默认 = 脚本推荐", cur_cfg),)):
        print(f"### 每段录制明细：{label} {cfg_name(cfg)}\n")
        print("| 录制 | 接受 | 拒绝 | 走路里接受 | 走路里拒绝 | 坐/站假周期 | 桌上假周期 | 边界 | 覆盖率 | 步频中位 | P10 | P90 |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in use:
            e = evaluate(r, cfg)
            acc = e["walk"] + e["edge"] + e["still"] + e["table"]
            print(f"| {r['name']} | {acc} | {e['rej']} | {e['walk']} | {e['rej_walk']} | {e['still']} | {e['table']} | "
                  f"{e['edge']} | {fmt(e['coverage'])} | {fmt(pct(e['cad'], .5), 0)} | {fmt(pct(e['cad'], .1), 0)} | "
                  f"{fmt(pct(e['cad'], .9), 0)} |")
        print()
        bad = [(r["name"], c) for r in use for c in r["cands"] if c[7] in ("still", "table") and accept(c, cfg)]
        if bad:
            print("被接受的假周期（录制内时刻 s / 腿 / 周期 s / 最低conf / 活动度° / 与另一腿相位差）：\n")
            for name, c in bad[:30]:
                print(f"- {name} {c[1] - t0s[name]:.1f}s {c[0].upper()} {c[2]:.2f}s conf {c[3]:.2f} rom {c[4]:.0f} Δφ {c[5]:.2f} [{c[7]}]")
            print()

    print("## 走动中（决定地形脉冲给不给）：conf>0.5 连续保持 hold 秒；可选再要求最近 recent 秒内接受过周期\n")
    print(f"周期门限用：{cfg_name(rec_cfg)}\n")
    print("| hold s | recent s | 非走路段误判走动中 s（穿戴+桌上） | 误判次数 | 走路段里走动中占比 | 起步→走动中 中位 s |")
    print("|---|---|---|---|---|---|")
    for h, rc in itertools.product(HOLDS, RECENTS):
        st = [moving_stats(r, h, rc, rec_cfg) for r in use]
        on = [o for s in st for o in s["onsets"]]
        print(f"| {h} | {rc if rc is not None else '不要求'} | {sum(s['false_s'] for s in st):.1f} | "
              f"{sum(s['episodes'] for s in st)} | {fmt(sum(s['walk_s'] for s in st) / wsum if wsum else None)} | "
              f"{fmt(statistics.median(on) if on else None)} |")
    return rec_cfg, use


def stepping_report(use, rec_cfg):
    cfgs = [("现默认", {})]
    if rec_cfg != gates():
        cfgs.append(("脚本推荐", dict(rec_cfg)))
    cfgs.append(("踏步模式", {"stepping": True}))
    print("\n## 原地踏步（模拟）\n")
    print("sim.py 同款模型离线生成（左右反相正弦 + 0.3° 噪声），**摆幅 = 正弦幅值 ±A°，活动度 ≈ 2A**；"
          "「抖」组再加 ±8% 逐周期步频抖动 + 30% 二次谐波（波形不对称）。30 s，去掉头 3 s 缓升。")
    print("格子里 = 接受周期数 / 期望周期数（1.00 = 一步不漏）；括号里是走动中占比。\n")
    print(f"踏步模式 = GaitEstimator(stepping=True) = {STEPPING}\n")
    head = " | ".join(n for n, _ in cfgs)
    print(f"| ±A° | 步频 | 抖 | 活动度中位 ° | 周期最低conf中位 | {head} |")
    print("|---|---|---|---|---|" + "---|" * len(cfgs))
    for amp, cad, (jit, harm) in itertools.product((4, 6, 8, 10, 12), (90, 105, 120), ((0.0, 0.0), (0.08, 0.3))):
        fr = synth(cad, amp, 30.0, jitter=jit, harm=harm, seed=int(amp * 1000 + cad))
        expect = 27.0 * cad / 120.0 * 2
        cells, info = [], None
        for _, kw in cfgs:
            x = sim_run(fr, **kw)
            info = info or x
            cells.append(f"{min(1.0, x['acc'] / expect):.2f} ({x['moving']:.2f})")
        print(f"| {amp} | {cad} | {'抖' if jit else ''} | {info['rom']:.1f} | {info['minconf']:.2f} | {' | '.join(cells)} |")

    print("\n正常走路（±20°，sim 默认）作对照：\n")
    print(f"| 步频 | {head} |")
    print("|---|" + "---|" * len(cfgs))
    for cad in (60, 90, 110, 140):
        fr = synth(cad, 20.0, 30.0, seed=cad)
        expect = 27.0 * cad / 120.0 * 2
        cells = []
        for _, kw in cfgs:
            x = sim_run(fr, **kw)
            cells.append(f"{min(1.0, x['acc'] / expect):.2f}（步频 {x['cad']:.0f}）")
        print(f"| {cad} | {' | '.join(cells)} |")

    print("\n踏步模式在 9/22 真机录制上的代价（踏步模式改了置信度参考半径时要重跑估计器，这里就是重跑的）：\n")
    print("最长连续出力：地形强制 stairs_up，缺省 / width=20 / t_step=3 三档取最坏，任一腿 |τ|>0.05 且 conf≥0.5（Guard 门），括号里是录制@录制内时刻。\n")
    print("| 门限 | 穿戴假周期 | 桌上假周期 | 覆盖率 | 非走路误判走动中 s（穿戴 / 桌上） | 走路段里走动中占比 | 最长连续出力 s（穿戴 / 桌上） |")
    print("|---|---|---|---|---|---|---|")
    wsum = sum(r["walk_s"] for r in use)
    for n, kw in cfgs:
        g = gates(**kw)
        tot = {"still": 0, "table": 0, "cov_s": 0.0, "fw": 0.0, "ft": 0.0, "wm": 0.0, "ow": (0.0, ""), "ot": (0.0, "")}
        for r in use:
            rr = r
            if kw.get("stepping"):
                c, s = run(r["frames"], r["walk"], r["table"], stepping=True)
                rr = dict(r, cands=c, series=s)
            e = evaluate(rr, g)
            m = moving_stats(rr, 0.3, None, g)
            for k in ("still", "table", "cov_s"):
                tot[k] += e[k]
            tot["ft" if r["table"] else "fw"] += m["false_s"]
            tot["wm"] += m["walk_s"]
            est = {"stepping": True} if kw.get("stepping") else {k: v for k, v in kw.items() if k in GATES}
            for pp in OUT_PARAMS:
                d, t = longest_output(r["frames"], params=pp, **est)
                k = "ot" if r["table"] else "ow"
                tot[k] = max(tot[k], (d, "%s@%.0fs" % (r["name"][5:11], t - r["frames"][0].t_host) if d else ""))
        extra = "·" + str({k: v for k, v in STEPPING.items() if k not in GATES}) if kw.get("stepping") else ""
        print(f"| {n} {cfg_name(g)}{extra} | {tot['still']} | {tot['table']} | {fmt(tot['cov_s'] / (2 * wsum) if wsum else None)} | "
              f"{tot['fw']:.0f} / {tot['ft']:.0f} | {fmt(tot['wm'] / wsum if wsum else None)} | "
              f"{tot['ow'][0]:.2f}（{tot['ow'][1]}） / {tot['ot'][0]:.2f}（{tot['ot'][1]}） |")


# ---------- --hs：az 冲击 vs 估计器相位 ----------
def circ_mean(ph):
    if not ph:
        return float("nan"), 0.0
    c = sum(math.cos(2 * math.pi * p) for p in ph) / len(ph)
    s = sum(math.sin(2 * math.pi * p) for p in ph) / len(ph)
    return (math.atan2(s, c) / (2 * math.pi)) % 1.0, math.hypot(c, s)


def in_win(p, w):
    return ((p - w[0]) % 1.0) <= (w[1] - w[0])


def hs_analysis(rec, cfg=None, bins=40):
    """走路段（参考标签 + conf>0.5）里：
    ① 按每条腿自己的相位把 az 叠加平均，找峰；
    ② 每个被接受的周期里，分别在「前半周」（相位 0.25–0.75，本腿在前 / 髋屈）和「后半周」（0.75–0.25，本腿在后 / 髋伸）
       找 az 最大那一拍的相位 → 圆均值 + 集中度 R。一个周期里有两次触地冲击（本腿一次、对侧一次，相位差 ≈0.5），
       分两半找才不会把对侧腿的冲击算到本腿头上；哪一半是本腿的，要看步态：正常走路本腿触地时在前（前半周），
       原地踏步是抬腿再放回、放回到底才触地（后半周末尾）；
    ③ 运动学参照：髋角最屈（最小角）的相位；支撑平台占比（|角速度|<15°/s 的时间比例，踏步样步态 >0.3）。
    触地是左右对称事件：两条腿在同一半周上的峰相位必须对得上。"""
    cfg = cfg or gates()
    ts = [s[0] for s in rec["series"]]
    ok = [region(s[0], rec["walk"], False) == "walk" and s[1] > 0.5 for s in rec["series"]]
    res = {"n_ticks": sum(ok)}
    if res["n_ticks"] < 300:
        return res
    for li, leg in ((2, "l"), (3, "r")):
        ai = 5 if leg == "l" else 6
        acc, cnt = [0.0] * bins, [0] * bins
        flat = tot = 0
        prev = None
        for s, k in zip(rec["series"], ok):
            if k:
                b = int(s[li] * bins) % bins
                acc[b] += s[4]
                cnt[b] += 1
                if prev is not None and s[0] > prev[0]:
                    tot += 1
                    flat += abs(s[ai] - prev[ai]) / (s[0] - prev[0]) < 15.0
            prev = s
        prof = [acc[i] / cnt[i] if cnt[i] else float("nan") for i in range(bins)]
        base = statistics.median([p for p in prof if p == p])
        peaks = sorted(((prof[i] - base, (i + 0.5) / bins) for i in range(bins)
                        if prof[i] >= prof[i - 1] and prof[i] >= prof[(i + 1) % bins]), reverse=True)[:3]
        per = {"front": [], "back": []}
        flex = []
        for c in rec["cands"]:
            if c[0] != leg or c[7] != "walk" or not accept(c, cfg):
                continue
            i0, i1 = bisect.bisect_left(ts, c[1] - c[2]), bisect.bisect_left(ts, c[1])
            seg = [rec["series"][i] for i in range(i0, i1) if ok[i]]
            for name, w in HS_WINS.items():
                part = [x for x in seg if in_win(x[li], w)]
                if part:
                    per[name].append(max(part, key=lambda x: x[4])[li])
            if seg:
                flex.append(min(seg, key=lambda x: x[ai])[li])
        fm, fR = circ_mean(flex)
        res[leg] = {"profile": prof, "base": base, "peaks": peaks, "flex_mean": fm, "flex_R": fR,
                    "plateau": flat / tot if tot else 0.0,
                    "win": {name: dict(zip(("mean", "R"), circ_mean(v)), n=len(v)) for name, v in per.items()}}
    return res


def hs_verdict(h, min_n=20, max_lr=0.08, min_R=0.6, plateau_max=0.3):
    """腰部 az 是一个传感器，看不出冲击是哪条腿的：每条腿的周期里都有两次冲击（本腿、对侧），相位差 ≈0.5。
    所以先按步态类型选半周：支撑平台占比 < plateau_max = 向前走 → 本腿触地在前半周、且不早于髋最屈；
    ≥ plateau_max = 踏步样（抬腿放回）→ 触地在后半周。选定的半周要「左右一致 + 逐周期集中」才给数。
    返回 (建议值或 None, 说明)。"""
    if "l" not in h or "r" not in h:
        return None, "走路段太短"
    plat = min(h["l"]["plateau"], h["r"]["plateau"])
    name, label = ("front", "前半周") if plat < plateau_max else ("back", "后半周")
    kind = (f"支撑平台占比 {plat:.2f}" + ("（<%.1f，按向前走：看前半周）" % plateau_max if name == "front"
                                        else "（≥%.1f，髋角在支撑相停住，像原地踏步：看后半周）" % plateau_max))
    l, r = h["l"]["win"][name], h["r"]["win"][name]
    if l["n"] < min_n or r["n"] < min_n:
        return None, f"{kind}；接受周期太少（L {l['n']} / R {r['n']}，要 ≥{min_n}）"
    d = abs(((l["mean"] - r["mean"]) + 0.5) % 1.0 - 0.5)
    if d > max_lr:
        return None, f"{kind}；{label}左右相位差 {d:.2f} > {max_lr}（L {l['mean']:.2f} / R {r['mean']:.2f}），不对称"
    if min(l["R"], r["R"]) < min_R:
        return None, f"{kind}；{label}逐周期太散（R {l['R']:.2f}/{r['R']:.2f} < {min_R}）"
    m, _ = circ_mean([l["mean"], r["mean"]])
    fl, _ = circ_mean([h["l"]["flex_mean"], h["r"]["flex_mean"]])
    early = ((m - fl + 0.5) % 1.0) - 0.5
    if name == "front" and early < -0.03:
        return None, (f"{kind}；前半周左右一致（{m:.2f}），但早于髋角最屈（{fl:.2f}）{-early:.2f} 周期——"
                      "向前走时脚跟着地不会早于髋最屈，不像触地")
    return m, (f"{kind}；{label}左右差 {d:.2f}、R {l['R']:.2f}/{r['R']:.2f}、周期 {l['n']}/{r['n']}。"
               "置信度：低（1 段录制；az 峰比触地晚 0.02–0.05 周期，真值略小）")


def hs_report(recs, cfg=None):
    print("## HS_PHASE（脚跟着地在估计器相位里的位置；terrain.py 现在是 0.5）\n")
    print("估计器相位 0 = 髋角最大，0.5 = 髋角最小。只看参考走路段里 conf>0.5 的拍。")
    print("腰部 az 的冲击峰通常比脚跟着地晚 20–50 ms（≈0.02–0.05 周期），所以 az 峰相位是 HS 的**上界**。\n")
    any_ = False
    for r in recs:
        if "skip" in r or r["table"] or r["dup"] or r["walk_s"] < 20:
            continue
        any_ = True
        h = hs_analysis(r, cfg)
        print(f"### {r['name']}（参考走路 {r['walk_s']:.0f} s，{h['n_ticks']} 拍）\n")
        if "l" not in h:
            print("可用的走路拍太少，跳过\n")
            continue
        print("| 腿 | 叠加平均 az 峰（相位:高出中位 g） | 前半周 az 峰 圆均值（R，周期数） | 后半周 az 峰 圆均值（R，周期数） | 髋角最屈相位（R） | 支撑平台占比 |")
        print("|---|---|---|---|---|---|")
        for leg in ("l", "r"):
            x = h[leg]
            pk = "，".join(f"{p:.2f}:{v:+.3f}" for v, p in x["peaks"])
            f, b = x["win"]["front"], x["win"]["back"]
            print(f"| {leg.upper()} | {pk} | {fmt(f['mean'])}（{f['R']:.2f}，{f['n']}） | {fmt(b['mean'])}（{b['R']:.2f}，{b['n']}） | "
                  f"{fmt(x['flex_mean'])}（{x['flex_R']:.2f}） | {x['plateau']:.2f} |")
        print("\n叠加平均 az（40 格 = 一个周期，每格一个字，越高越冲）：\n")
        print("```")
        for leg in ("l", "r"):
            x = h[leg]
            line = "".join(" ▁▂▃▄▅▆▇█"[max(0, min(8, int((v - x['base']) / 0.012 + 3)))] if v == v else "?"
                           for v in x["profile"])
            print(f"{leg.upper()} 0|{line}|1")
        print("```")
        m, why = hs_verdict(h)
        print(f"\n**判定**：{'建议 HS_PHASE ≈ %.2f' % m if m is not None else '证据不够'}。{why}\n")
    if not any_:
        print("没有足够长的走路录制（≥20 s）。\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rec", nargs="*", help="录制 CSV（默认 data/recordings/ 全部真机录制）")
    ap.add_argument("--hs", action="store_true", help="估 HS_PHASE")
    ap.add_argument("--no-stepping", action="store_true", help="不跑原地踏步模拟")
    a = ap.parse_args()
    paths = a.rec or sorted(p for p in glob.glob(os.path.join(REC_DIR, "*.csv"))
                            if not p.endswith(".marks.csv") and "synthetic" not in p)
    print("# 步态审计（scripts/gait_audit.py 自动生成）\n")
    recs = recordings(paths, latch_compare=not a.hs)
    if a.hs:
        hs_report(recs)
        return
    rec_cfg, use = audit(recs)
    if not a.no_stepping:
        stepping_report(use, rec_cfg)


if __name__ == "__main__":
    main()
