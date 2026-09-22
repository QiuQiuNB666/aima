"""装配：设备(串口/回放) → Guard → 控制律 → 100 Hz 循环 → 手柄/键盘/网页。

  python -m shellos.main                       # 串口，transparent，只读数据
  python -m shellos.main --ctl dofc --cap 2    # DOFC，软限 2 Nm
  python -m shellos.main --replay data/recordings/xxx.csv --ctl phase --force-deadman
仪表盘 http://localhost:8765 。
手柄：按住 R2 才有力（按多深力多大）· × 急停 · ○ 重新上膛 · 方向键上下=第 1 个参数± 左右=第 2 个参数± · L1/R1 切换控制律 · △ 打标记
键盘：空格 / Esc / R；网页：大按钮 / 急停 / 重新上膛。
"""
from __future__ import annotations
import argparse
import signal
import sys
import time
from datetime import datetime

from .control.base import Transparent
from .control.dofc import DOFC
from .control.constant import Constant
from .control.terrain import Terrain
from .control.puppet import Puppet
from .control.phase_profile import PhaseProfile
from .gait.estimator import GaitEstimator
from .device.recorder import Recorder
from .safety.guard import Guard

CTLS = {"transparent": Transparent, "constant": Constant, "dofc": DOFC, "phase": PhaseProfile, "terrain": Terrain, "puppet": Puppet}
LOOP_HZ = 100


class App:
    """仪表盘和 Agent 层看到的东西都挂在这上面。"""

    def __init__(self, link, guard, ctl_name, rec=None):
        self.link, self.guard, self.rec = link, guard, rec
        self.ctls = CTLS
        self.ctl = CTLS[ctl_name]()
        self.gait = GaitEstimator()
        self.events: list = []
        self.loop_ms = 0
        from .glasses.luma import Glasses
        self.glasses = Glasses(on_event=self.log)
        self.terrain = {}            # 最近一次"看路"的结果
        from .memory.store import Store
        self.store = Store()
        self.wearer = "anon"
        self.applied: list = []      # 本次穿戴已经套用的经验 id
        self.recalled = False        # 本次穿戴是否已做过检索
        self.min_strides = 6

    # ---- 记忆层 ----
    def ctl_key(self):
        return next((k for k, c in CTLS.items() if isinstance(self.ctl, c)), self.ctl.name)

    def profile(self):
        st = self.gait.state
        return {"wearer": self.wearer, "cadence": round(st.cadence), "symmetry": round(st.symmetry, 2),
                "rom": round((st.l.rom + st.r.rom) / 2), "controller": self.ctl_key()}

    def set_wearer(self, name):
        self.wearer = name or "anon"
        self.demo_reset(keep_wearer=True)
        if hasattr(self.ctl, "wearer"):
            self.ctl.wearer = self.wearer
        self.log(f"换人：{self.wearer}。参数回缺省，走 {self.min_strides} 步后自动检索经验")

    def demo_reset(self, keep_wearer=False):
        old = self.ctl
        self.ctl = CTLS[self.ctl_key()]()
        if hasattr(old, "ghost") and hasattr(self.ctl, "ghost"):   # 换人/复位不丢「山的记忆」
            self.ctl.set_preset(old.preset)
            self.ctl.ghost, self.ctl.ghost_who, self.ctl.best = old.ghost, old.ghost_who, old.best
            if old.lap_steps and not old.ghost:                        # 上一位没爬完也留作影子
                self.ctl.ghost, self.ctl.ghost_who = old.lap_steps, old.wearer
            self.ctl.wearer = self.wearer
        self.gait = GaitEstimator()
        self.applied, self.recalled = [], False
        if not keep_wearer:
            self.log("演示复位：参数回缺省、步态重新估计，经验库不动")

    def auto_recall(self):
        """走够步数后检索一次经验并套用。主循环每 0.5 s 调一次。"""
        st = self.gait.state
        if self.recalled or (st.l.n_strides + st.r.n_strides) < self.min_strides or st.cadence <= 0:
            return
        self.recalled = True
        hits = self.store.retrieve(self.ctl_key(), st.cadence)
        if not hits:
            self.log(f"检索经验：步频 {st.cadence:.0f}，0 命中，用缺省参数")
            return
        delta = self.store.merged_delta(hits)
        out = self.ctl.set_params(delta)
        self.applied = [h["id"] for h in hits]
        self.store.bump(self.applied)
        self.log(f"命中经验 {', '.join('#%d' % i for i in self.applied)}（步频 {st.cadence:.0f}）→ {out}")

    def feedback(self, quote):
        """评委一句话 → 参数差值 → 立即生效 → 存成经验卡。"""
        from .agent.interpret import interpret
        quote = (quote or "").strip()
        if not quote:
            return None
        if self.ctl_key() == "transparent":
            self.log(f"评委：「{quote}」——当前是透明模式，没有参数可调，先切到 dofc 或 phase")
            return None
        r = interpret(quote, self.ctl_key(), self.ctl.params, self.gait.state.cadence, self.profile())
        if not r:
            self.log(f"评委：「{quote}」——没听懂，参数不变")
            return None
        out = self.ctl.set_params(r["delta"])
        it = self.store.add(self.wearer, self.ctl_key(), r["trigger"], r["delta"], quote, r["confidence"], r["source"])
        self.applied.append(it["id"])
        self.log(f"评委：「{quote}」→ 经验卡 #{it['id']} {r['delta']}（{r['source']}，{r.get('why', '')}）→ 现在 {out}")
        return it

    def delete_exp(self, id_):
        it = self.store.set_enabled(int(id_), False)
        if not it:
            return None
        if it["id"] in self.applied:
            out = self.ctl.set_params({k: -float(v) for k, v in it["delta"].items()})
            self.applied.remove(it["id"])
            self.log(f"删除经验卡 #{it['id']} → 参数回退 {out}")
        else:
            self.log(f"停用经验卡 #{it['id']}")
        return it

    def set_terrain(self, preset):
        if self.ctl_key() != "terrain":
            self.ctl = Terrain(preset)
        else:
            self.ctl.set_preset(preset)
        self.ctl.reset()
        self.log(f"地形：{preset}（{self.ctl.total} 步一圈）")

    def enable_exp(self, id_):
        it = self.store.set_enabled(int(id_), True)
        if it:
            self.log(f"恢复经验卡 #{it['id']}（下次检索生效）")
        return it

    def look(self):
        """眼镜拍一张 → 视觉模型判地形 → 记事件。手柄 □ / 网页按钮都走这里。"""
        from .agent import vision
        def then(path):
            if not vision.configured():
                self.log("眼镜：小图已到，未配视觉模型（SHELLOS_LLM_*），只显示图")
                return
            r = vision.look(path)
            if r:
                self.terrain = r
                self.log(f"看路：{r.get('terrain')} ({float(r.get('confidence', 0)):.0%}) — {r.get('say', '')}")
        return self.glasses.photo(then=then)

    def set_ctl(self, name):
        self.ctl = CTLS[name]()          # 新控制律从 0 起，Guard 的斜率限负责平滑

    @staticmethod
    def _step(lo, hi):
        r = hi - lo
        return 5 if r >= 50 else 0.5 if r >= 3 else 0.1 if r >= 1 else 0.02 if r >= 0.5 else 0.01

    def nudge(self, index, sign):
        """调第 index 个参数一档。手柄：上下调第 0 个（一般是峰值/增益），左右调第 1 个（峰时/延迟）。"""
        names = list(self.ctl.params)
        if index >= len(names):
            return
        k = names[index]
        _, lo, hi = self.ctl.params[k]
        out = self.ctl.set_params({k: sign * self._step(lo, hi)})
        self.log(f"手柄 {k} {'+' if sign > 0 else '-'} → {out[k]:g}")

    def cycle_ctl(self, d):
        keys = list(CTLS)
        cur = next((i for i, c in enumerate(CTLS.values()) if isinstance(self.ctl, c)), 0)
        name = keys[(cur + d) % len(keys)]
        self.set_ctl(name)
        self.log(f"手柄切换控制律 → {name}")

    def on_button(self, b):
        from .input.gamepad import BTN
        if b == BTN["up"]:      self.nudge(0, +1)
        elif b == BTN["down"]:  self.nudge(0, -1)
        elif b == BTN["right"]: self.nudge(1, +1)
        elif b == BTN["left"]:  self.nudge(1, -1)
        elif b == BTN["r1"]:    self.cycle_ctl(+1)
        elif b == BTN["l1"]:    self.cycle_ctl(-1)
        elif b == BTN["triangle"]: self.log("△ 标记：评委反馈点")
        elif b == BTN["square"]:   self.look()
        elif b == BTN["options"]:  self.demo_reset()

    def mark(self, label):
        if self.rec:
            self.rec.mark(label)
        self.log(f"▶ {label}")

    def log(self, text):
        self.events.append({"t": datetime.now().strftime("%H:%M:%S"), "text": text})
        print(f"\n[{self.events[-1]['t']}] {text}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port")
    ap.add_argument("--replay", help="录制 CSV，替代串口")
    ap.add_argument("--sim", action="store_true", help="模拟外骨骼：按住空格/网页按钮走路")
    ap.add_argument("--ctl", default="transparent", choices=CTLS)
    ap.add_argument("--cap", type=float, default=3.0, help="软限 Nm")
    ap.add_argument("--wearer", default="anon")
    ap.add_argument("--no-record", action="store_true")
    ap.add_argument("--no-input", action="store_true", help="不起手柄/键盘线程（诊断用）")
    ap.add_argument("--http", type=int, default=8765, help="仪表盘端口，0 = 不起")
    ap.add_argument("--force-deadman", action="store_true",
                    help="回放时没手柄也给力（只允许配合 --replay）")
    a = ap.parse_args()
    if a.force_deadman and not (a.replay or a.sim):
        ap.error("--force-deadman 只允许配合 --replay；真机必须用手柄/键盘/网页按钮")

    rec = None if a.no_record else Recorder(a.wearer)
    on_frame = rec.frame if rec else None
    if a.sim:
        from .device.sim import SimLink
        link = SimLink(on_frame=on_frame)
    elif a.replay:
        from .device.replay import ReplayLink
        link = ReplayLink(a.replay, on_frame=on_frame)
    else:
        from .device.serial_link import SerialLink
        link = SerialLink(a.port, on_frame=on_frame)
    print(f"[link] {link.port}")

    guard = Guard(link, soft_cap=a.cap, on_sent=(rec.torque if rec else None))
    ver = link.handshake()
    guard.arm()
    print(f"[handshake] firmware {ver}  state {guard.state}  cap {guard.soft_cap} Nm")

    app = App(link, guard, a.ctl, rec)
    app.log(f"启动：{link.port} 固件 {ver}，控制律 {a.ctl}，软限 {a.cap} Nm")

    pad = None
    if not a.no_input:
        from .input.gamepad import Gamepad
        from .input.hotkeys import Hotkeys
        pad = Gamepad(guard, on_button=app.on_button)
        app.pad = pad
        Hotkeys(guard)
    if a.force_deadman:
        guard.set_deadman(1.0, "forced")
    if a.http:
        from .ui.server import Dashboard
        Dashboard(app, a.http)
        print(f"[ui] http://localhost:{a.http}")

    def stop(*_):
        guard.shutdown()
        link.close()
        if rec:
            rec.close()
            print(f"\n[rec] {rec.path} ({rec.n} frames)")
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    period = 1.0 / LOOP_HZ
    next_t = time.monotonic()
    last_print = 0.0
    last_recover = 0.0
    seen_reboots = 0
    st = None
    max_gap = 0.0
    prev_t = time.monotonic()
    while True:
        next_t += period
        now0 = time.monotonic()
        max_gap = max(max_gap, now0 - prev_t)
        prev_t = now0
        f = link.latest()
        if f is not None:
            st = app.gait.update(f)
            ctl = app.ctl
            if ctl.name == "puppet" and pad is not None:
                ctl.sticks = pad.sticks
            tl, tr = ctl.step(f, st)
            guard.submit(tl, tr, confidence=st.conf if ctl.name in ("phase", "terrain") else 1.0)
        now = time.monotonic()
        if (not a.replay and now - last_recover > 2.0 and guard.state in ("ARMED", "ACTIVE")
                and link.needs_recovery()):
            last_recover = now
            if link.reboots != seen_reboots:
                seen_reboots = link.reboots
                app.log(f"设备复位了（第 {link.reboots} 次）——重新 ENABLE")
            ok = link.recover()
            guard.arm()                      # 力矩从 0 重新爬
            app.log("重新 ENABLE " + ("成功" if ok else "失败，2 秒后再试"))
        if now - last_print > 0.5:
            last_print = now
            app.auto_recall()
            app.loop_ms, max_gap = round(max_gap * 1000), 0.0
            gs = guard.state
            fr = (f"L{f.l_deg:6.1f}° R{f.r_deg:6.1f}° φ{st.l.phase:.2f}/{st.r.phase:.2f} "
                  f"conf{st.conf:.2f} {st.cadence:4.0f}spm sym{st.symmetry:.2f}") if st else "no frames"
            pc = 'Y' if (pad and pad.connected) else 'n'
            print(f"\r[{gs:10s}] pad={pc} dm={guard.deadman:.2f} "
                  f"sent=({guard.last_sent[0]:+.2f},{guard.last_sent[1]:+.2f}) {guard.last_reason:22s} "
                  f"{fr}  n={link.n_frames} bad={link.n_bad} age={link.stream_age()*1000:5.0f}ms loop{app.loop_ms:4d}ms   ",
                  end="", flush=True)
        time.sleep(max(0.0, next_t - time.monotonic()))


if __name__ == "__main__":
    main()
