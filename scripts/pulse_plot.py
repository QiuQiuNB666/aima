"""画每种路段一个步态周期内左右腿的力矩曲线（SVG，纯标准库），并核对脉冲设计。

横轴 = 文献相位（左脚跟着地 = 0%），右腿晚半个周期。直接调 Terrain.pulse()，所以画的就是真在跑的控制律。
核对（CHECKS）：梯形（有平台、有斜坡、非方波）· 底宽 10–20% · 30–60%（规格口径的摆动中段）和 60–90%（文献摆动中段）
不出伸展（抗屈）力矩 · 无方向突变（正负之间必经 0）· 峰值 ≤ 软限 3 Nm。参数扫到边界（强度 0.5–3、宽 10–20、中心 0–20）也要过。

  .venv/bin/python scripts/pulse_plot.py              # 出图到 docs/报告/脉冲/，打印核对表，有不过的退出码 1
  .venv/bin/python scripts/pulse_plot.py --hs 0.45    # 看 HS_PHASE 改了以后（曲线不变，只是估计器相位平移）
"""
from __future__ import annotations
import argparse
import itertools
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shellos.control import terrain as T  # noqa: E402

KINDS = ["up", "down", "stairs_up", "stairs_down", "wait"]
NAMES = {"up": "上坡", "down": "下坡", "stairs_up": "上台阶", "stairs_down": "下台阶", "wait": "红灯（走着时）"}
N = 1000                     # 每周期采样点，0.1% 分辨率
SPEC_SWING = (30.0, 60.0)    # 任务/架构 v2 写的「摆动中段」
LIT_SWING = (60.0, 90.0)     # 文献：离地 ≈60%，摆动中段 ≈70–85%
CADENCE = 110                # 步/分，算斜率用
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "报告", "脉冲")


def curve(ctl, kind, shift=0.0):
    """文献相位 0..100% 上的力矩；shift=50 给右腿。"""
    return [ctl.pulse(kind, ((i * 100.0 / N + shift) / 100.0 + T.HS_PHASE) % 1.0) for i in range(N)]


def regions(y):
    """环形数组里连续非零的段 → [(起点下标, 长度, 符号)]。"""
    if all(v == 0 for v in y):
        return []
    z = next(i for i, v in enumerate(y) if v == 0) if any(v == 0 for v in y) else 0
    out, start = [], None
    for k in range(N + 1):
        i = (z + k) % N
        v = y[i] if k < N else 0.0
        if v != 0 and start is None:
            start = k
        if v == 0 and start is not None:
            out.append(((z + start) % N, k - start, 1 if y[(z + start) % N] > 0 else -1))
            start = None
    return out


def check(ctl, kind):
    y = curve(ctl, kind)
    reg = regions(y)
    probs = []
    peak = max((abs(v) for v in y), default=0.0)
    if peak > T.CAP + 1e-9:
        probs.append(f"峰值 {peak:.2f} > 软限 {T.CAP}")
    widths = [n * 100.0 / N for _, n, _ in reg]
    for i0, n, sg in reg:
        w = (n + 1) * 100.0 / N               # 两端各有一个 0 点，底宽 ≈ 非零段 + 1 格
        if not (10.0 - 0.2 <= w <= 20.0 + 0.2):
            probs.append(f"底宽 {w:.1f}% 不在 10–20%")
        seg = [abs(y[(i0 + k) % N]) for k in range(n)]
        top = max(seg)
        flat = sum(1 for v in seg if v >= top - 1e-9) / n
        if not (0.2 <= flat <= 0.8):
            probs.append(f"不是梯形（平台占 {flat:.0%}）")
    for lo, hi, tag in ((*SPEC_SWING, "30–60%"), (*LIT_SWING, "60–90%")):
        ext = max((v for i, v in enumerate(y) if lo <= i * 100.0 / N <= hi), default=0.0)
        if ext > 0:
            probs.append(f"{tag} 有伸展（抗屈）力矩 {ext:.2f}")
    for i in range(N):                         # 方向突变：相邻两点一正一负，中间没经过 0
        if y[i] * y[(i + 1) % N] < 0:
            probs.append(f"{i * 100.0 / N:.1f}% 方向突变")
            break
    cyc = 120.0 / CADENCE
    slope = max(abs(y[(i + 1) % N] - y[i]) for i in range(N)) / (cyc / N)
    return {"kind": kind, "peak": peak, "widths": widths, "slope": slope, "problems": probs, "y": y}


def sweep(kind):
    """参数扫到边界：返回所有不过的组合。"""
    bad = []
    for s, w, c in itertools.product((0.5, 1.5, 3.0), (10.0, 12.0, 20.0), (0.0, None, 20.0)):
        ctl = T.Terrain()
        ctl.params["strength"][0], ctl.params["width"][0] = s, w
        if c is not None:
            for k in ("t_push", "t_brake", "t_step"):
                ctl.params[k][0] = c
        r = check(ctl, kind)
        if r["problems"]:
            bad.append(((s, w, c), r["problems"]))
    return bad


def svg(kind, ctl, r_default, ctl_max):
    W, H, L, R, TP, B = 960, 470, 70, 20, 50, 120
    pw, ph = W - L - R, H - TP - B
    ymax = 3.5
    X = lambda p: L + p / 100.0 * pw
    Y = lambda v: TP + (ymax - v) / (2 * ymax) * ph
    poly = lambda ys: " ".join(f"{X(i * 100.0 / N):.1f},{Y(v):.1f}" for i, v in enumerate(ys + ys[:1]))
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         f'font-family="-apple-system,PingFang SC,Helvetica,sans-serif" font-size="12">',
         f'<rect width="{W}" height="{H}" fill="#fff"/>']
    for row, (leg, sh, col) in enumerate((("左", 0, "#2563eb"), ("右", 50, "#ea580c"))):   # 每条腿自己的禁区带
        yb = TP + ph + 26 + row * 14
        o.append(f'<text x="{L - 8}" y="{yb + 9}" text-anchor="end" fill="{col}">{leg}腿</text>')
        for (lo, hi), fill in ((SPEC_SWING, "#f59e0b"), (LIT_SWING, "#818cf8")):
            a0, a1 = (lo + sh) % 100, (hi + sh) % 100
            for u, v in ([(a0, a1)] if a0 < a1 else [(a0, 100), (0, a1)]):
                o.append(f'<rect x="{X(u):.1f}" y="{yb}" width="{X(v) - X(u):.1f}" height="10" fill="{fill}" opacity=".7"/>')
    o.append(f'<text x="{L + pw}" y="{TP + ph + 64}" text-anchor="end" fill="#6b7280">'
             f'色带（按各自腿的周期）：橙 = 摆动中段 30–60%（规格口径）· 紫 = 文献摆动 60–90%（离地≈60%）；两段里都不许出伸展（抗屈）力矩</text>')
    for v in range(-3, 4):
        o.append(f'<line x1="{L}" x2="{L + pw}" y1="{Y(v)}" y2="{Y(v)}" stroke="#e5e7eb"/>'
                 f'<text x="{L - 8}" y="{Y(v) + 4}" text-anchor="end" fill="#6b7280">{v:+d}</text>')
    for p in range(0, 101, 10):
        o.append(f'<line x1="{X(p)}" x2="{X(p)}" y1="{TP + ph}" y2="{TP + ph + 5}" stroke="#6b7280"/>'
                 f'<text x="{X(p)}" y="{TP + ph + 18}" text-anchor="middle" fill="#6b7280">{p}%</text>')
    for v in (T.CAP, -T.CAP):
        o.append(f'<line x1="{L}" x2="{L + pw}" y1="{Y(v)}" y2="{Y(v)}" stroke="#dc2626" stroke-dasharray="6 4"/>')
    o.append(f'<text x="{L + pw - 4}" y="{Y(T.CAP) - 4}" text-anchor="end" fill="#dc2626">软限 ±{T.CAP} Nm</text>')
    o.append(f'<line x1="{L}" x2="{L + pw}" y1="{Y(0)}" y2="{Y(0)}" stroke="#374151"/>')
    for p, t in ((0, "左脚跟着地"), (50, "右脚跟着地")):
        o.append(f'<line x1="{X(p)}" x2="{X(p)}" y1="{TP}" y2="{TP + ph}" stroke="#111827" stroke-width="1.5"/>'
                 f'<text x="{X(p) + 4}" y="{TP + ph - 6}" fill="#111827">{t}</text>')
    o.append(f'<polyline points="{poly(curve(ctl_max, kind))}" fill="none" stroke="#2563eb" stroke-width="1" opacity=".35"/>')
    o.append(f'<polyline points="{poly(curve(ctl_max, kind, 50))}" fill="none" stroke="#ea580c" stroke-width="1" opacity=".35"/>')
    o.append(f'<polyline points="{poly(r_default["y"])}" fill="none" stroke="#2563eb" stroke-width="2.5"/>')
    o.append(f'<polyline points="{poly(curve(ctl, kind, 50))}" fill="none" stroke="#ea580c" stroke-width="2.5" stroke-dasharray="7 4"/>')
    st, w = ctl.p("strength"), ctl.p("width")
    o.append(f'<text x="{L}" y="22" font-size="17" font-weight="600">{NAMES[kind]}（{kind}）· 强度 {st:g} · 底宽 {w:g}% · HS_PHASE {T.HS_PHASE:g}</text>')
    o.append(f'<text x="{L}" y="40" fill="#374151">蓝实线 = 左腿，橙虚线 = 右腿；淡线 = 强度 3.0。正 = 伸展。纵轴 Nm，横轴 = 周期相位（左脚跟着地 = 0%）</text>')
    ok = not r_default["problems"]
    msg = ("核对通过：" if ok else "不通过：" + "；".join(r_default["problems"]) + "  ") + \
        f"峰值 {r_default['peak']:.2f} Nm · 每个脉冲非零段 {', '.join('%.1f%%' % x for x in r_default['widths'])} · " \
        f"最大斜率 {r_default['slope']:.0f} Nm/s @{CADENCE} 步/分（Guard 斜率限 50）"
    o.append(f'<text x="{L}" y="{H - 14}" fill="{"#15803d" if ok else "#dc2626"}">{msg}</text>')
    o.append("</svg>")
    return "\n".join(o)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hs", type=float, help="临时改 HS_PHASE")
    ap.add_argument("--strength", type=float, default=1.5)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    if a.hs is not None:
        T.HS_PHASE = a.hs
    os.makedirs(a.out, exist_ok=True)
    fail = False
    print(f"{'路段':12s} {'峰值':>6s} {'非零段宽':>14s} {'斜率Nm/s':>9s}  默认参数        边界扫描（27 组）")
    for kind in KINDS:
        ctl = T.Terrain(strength=a.strength)
        ctl_max = T.Terrain(strength=3.0)
        r = check(ctl, kind)
        bad = sweep(kind)
        fail |= bool(r["problems"] or bad)
        with open(os.path.join(a.out, f"{kind}.svg"), "w", encoding="utf-8") as f:
            f.write(svg(kind, ctl, r, ctl_max))
        print(f"{kind:12s} {r['peak']:6.2f} {', '.join('%.1f' % x for x in r['widths']):>14s} {r['slope']:9.0f}  "
              f"{'OK' if not r['problems'] else '; '.join(r['problems']):14s}  "
              f"{'OK' if not bad else '%d 组不过，例 %s %s' % (len(bad), bad[0][0], bad[0][1])}")
    print(f"图：{os.path.normpath(a.out)}/<路段>.svg")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
