"""装配：设备(串口/回放) → Guard → 控制律 → 100 Hz 循环 → 手柄/键盘/网页。

  python -m shellos.main                       # 串口，transparent，只读数据
  python -m shellos.main --ctl dofc --cap 2    # DOFC，软限 2 Nm
  python -m shellos.main --replay data/recordings/xxx.csv --ctl phase --force-deadman
仪表盘 http://localhost:8765 。
手柄：按住 R2 才有力（按多深力多大）· × 急停 · ○ 重新上膛 · 方向键上下=第 1 个参数± 左右=第 2 个参数± · L1/R1 切换控制律 · △ 打标记
网页（只认本机）：大按钮 / 急停 / 重新上膛。键盘默认不起（--hotkeys 打开：空格 = 死人开关、Esc = 急停）。
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


def recover_tick(link, guard, now, rs, log=print):
    """断流 / 未使能 / 设备复位 → 重新 ENABLE。主循环每拍调；rs = {"last": 0.0, "reboots": 0}。
    正常每 2 s 至多试一次；刚检测到设备复位时立刻试（不等 2 s 节拍）。DISARMED / 急停时不动。"""
    reboot = link.reboots != rs["reboots"]
    if not ((now - rs["last"] > 2.0 or reboot) and guard.state in ("ARMED", "ACTIVE") and link.needs_recovery()):
        return None
    rs["last"] = now
    if reboot:
        rs["reboots"] = link.reboots
        log(f"设备复位了（第 {link.reboots} 次）——重新 ENABLE")
    ok = link.recover()
    armed = guard.arm()                  # 力矩从 0 重新爬；DISARMED 时 arm() 拒绝，返回 False
    log("重新 ENABLE " + ("成功" if ok and armed is not False else "失败，2 秒后再试"))
    return ok


def _model_label():
    """蜂群文案里的「谁造的」：大脑心跳报的模型名（MiniMax-M3 / claude-opus-5），没有就写「大模型」。"""
    from .agent import brain
    return brain.status.get("model") or "大模型"


class App:
    """仪表盘和 Agent 层看到的东西都挂在这上面。"""

    def __init__(self, link, guard, ctl_name, rec=None, stepping=False):
        self.link, self.guard, self.rec = link, guard, rec
        self.ctls = CTLS
        self.ctl = CTLS[ctl_name]()
        self.stepping = stepping     # 原地踏步模式（A 线）：rom≥8、r_ref=4，默认关
        self.gait = GaitEstimator(stepping=stepping)
        self._terrain = None         # 切到别的控制律时暂存 terrain：影子、最佳、世界不丢
        self.events: list = []
        self.loop_ms = 0
        from .glasses.luma import Glasses
        self.glasses = Glasses(on_event=self.log)
        self.terrain = {}            # 最近一次"看路"的结果
        from .memory.store import Store
        self.store = Store()
        self.wearer = "anon"
        self.min_strides = 6
        self.swarm: list = []        # 蜂群发言：教练 / 地形导演 / 记忆员 / 安全员，仪表盘按时间线显示
        self._recent_changes: list = []   # (t, 参数)：安全员防拉锯
        from .agent.fengge import Commentator
        self.fengge = Commentator(self.say)
        self._story = (None, 0, "")       # (世界, 圈数, 路段)：变了才解说

    # 已套用的经验 id / 是否检索过，挂在控制律实例上：差值就改在这个实例的参数里。
    # 切到新实例（缺省参数）自然清零；切回缓存的 terrain 仍记得；开场 puppet 的检索不占掉 terrain 的。
    @property
    def applied(self):
        return self.ctl.__dict__.setdefault("applied", [])

    @applied.setter
    def applied(self, v):
        self.ctl.applied = v

    @property
    def recalled(self):
        return self.ctl.__dict__.get("recalled", False)

    @recalled.setter
    def recalled(self, v):
        self.ctl.recalled = v

    def tick(self, f, sticks=None):
        """每拍：步态 → 控制律 → Guard。按相位出力的控制律带步态置信度（站着不动 → 归零）。"""
        st = self.gait.update(f)
        ctl = self.ctl
        if isinstance(ctl, Puppet) and sticks is not None:
            ctl.sticks = sticks
        tl, tr = ctl.step(f, st)
        self.guard.submit(tl, tr, confidence=st.conf if isinstance(ctl, (PhaseProfile, Terrain)) else 1.0)
        return st

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
            self.ctl.memory = old.memory                                  # 各世界的影子/最佳（修复 B）
            self.ctl.set_preset(old.preset)                               # 参数回缺省（经验卡检索再套用）
            self.ctl.ghost, self.ctl.ghost_who, self.ctl.best = old.ghost, old.ghost_who, old.best
            if old.lap_steps and not old.ghost:                        # 上一位没爬完也留作影子
                self.ctl.ghost, self.ctl.ghost_who = old.lap_steps, old.wearer
            self.ctl.wearer = self.wearer
        if self._terrain is not None:            # 缓存着的 terrain（当前在 puppet 等）也回缺省，否则切回来还是上一位的强度
            self._terrain.params = Terrain().params
            self._terrain.wearer = self.wearer
            self._terrain.applied, self._terrain.recalled = [], False
        self.gait = GaitEstimator(stepping=self.stepping)
        if not keep_wearer:
            self.log("演示复位：参数回缺省、步态重新估计，经验库不动")

    def auto_recall(self):
        """走够步数后检索一次经验并套用。主循环每 0.5 s 调一次。"""
        st = self.gait.state
        if self.recalled or (st.l.n_strides + st.r.n_strides) < self.min_strides or st.cadence <= 0:
            return
        self.recalled = True
        hits = [h for h in self.store.retrieve(self.ctl_key(), st.cadence) if h["id"] not in self.applied]   # 刚说的那张已经生效了
        if not hits:
            self.log(f"检索经验：步频 {st.cadence:.0f}，0 命中，用缺省参数")
            return
        delta = self.store.merged_delta(hits)
        out = self.ctl.set_params(delta)
        ids = [h["id"] for h in hits]
        self.applied += ids
        self.store.bump(ids)
        self.log(f"命中经验 {', '.join('#%d' % i for i in ids)}（步频 {st.cadence:.0f}）→ {out}")

    TORQUE_PARAMS = ("strength", "peak_ext", "peak_flex", "tl", "tr", "scale", "bias_l", "bias_r")

    def say(self, who, msg, verdict=""):
        """蜂群里某个角色发一句话。verdict：提议 / 同意 / 裁剪 / 否决 / 生效。"""
        self.swarm.append({"t": datetime.now().strftime("%H:%M:%S"), "who": who, "msg": msg, "verdict": verdict})
        del self.swarm[:-60]
        self.log(f"[{who}] {msg}")

    def safety_review(self, delta):
        """安全员：硬代码，不交给大模型。返回 (放行的差值, 备注)。"""
        cap = self.guard.soft_cap if self.guard else 3.0
        if self.guard and self.guard.estop:
            return {}, ["急停中，一律否决"]
        now, out, notes = time.monotonic(), {}, []
        self._recent_changes = [(t, k) for t, k in self._recent_changes if now - t < 30]
        for k, v in delta.items():
            if sum(1 for _, kk in self._recent_changes if kk == k) >= 3:
                notes.append(f"{k} 30 秒内已经改了 3 次，否决（防止几个人来回拉锯）")
                continue
            if k in self.TORQUE_PARAMS:
                cur = self.ctl.params[k][0]
                want = cur + v
                if abs(want) > cap:
                    v = max(-cap, min(cap, want)) - cur
                    notes.append(f"{k} 想到 {want:.2f} Nm，超过软限 {cap:g}，裁到 {cur + v:.2f}")
            if v:
                out[k] = v
        self._recent_changes += [(now, k) for k in out]
        return out, notes

    def feedback(self, quote):
        """评委一句话 → 教练提议 → 记忆员对照 → 安全员裁决 → 生效 + 存成经验卡。"""
        from .agent.interpret import interpret
        quote = (quote or "").strip()
        if not quote:
            return None
        if self.ctl_key() == "transparent":
            self.log(f"评委：「{quote}」——当前是透明模式，没有参数可调，先切到 dofc 或 phase")
            return None
        if self.gait.state.cadence <= 0:          # 没步频就没法写检索区间（以前写成 0–999，对谁都命中）
            self.log(f"评委：「{quote}」——还没估出步频，先走几步再说一次，参数不变")
            return None
        r = interpret(quote, self.ctl_key(), self.ctl.params, self.gait.state.cadence, self.profile())
        if not r or not any(float(v) for v in r["delta"].values()):   # 差值为 0 不存卡
            self.say("教练", f"「{quote}」——没听懂，参数不变", "否决")
            return None
        src = _model_label() if r["source"] == "claude" else "规则表"
        self.say("教练", f"「{quote}」→ 提议 {r['delta']}（{src}：{r.get('why', '')}）", "提议")
        same, opp = [], []
        for it in self.store.retrieve(self.ctl_key(), self.gait.state.cadence):
            for k, v in r["delta"].items():
                if float(it["delta"].get(k, 0)) * v > 0:
                    same.append(it["id"])
                elif float(it["delta"].get(k, 0)) * v < 0:
                    opp.append(it["id"])
        if same or opp:
            self.say("记忆员", (f"同步频段已有 {len(set(same))} 张卡同向 #{sorted(set(same))}" if same else "") +
                     ("；" if same and opp else "") +
                     (f"和 #{sorted(set(opp))} 方向相反：人跟人的腿不一样，新卡照写，检索时取平均" if opp else ""), "同意")
        else:
            self.say("记忆员", "这个步频段第一次有人这么说，记成新经验", "同意")
        delta, notes = self.safety_review(r["delta"])
        for n in notes:
            self.say("安全员", n, "否决" if "否决" in n else "裁剪")
        if not delta:
            return None
        if not notes:
            self.say("安全员", "幅度在软限以内，放行", "同意")
        out = self.ctl.set_params(delta)
        it = self.store.add(self.wearer, self.ctl_key(), r["trigger"], delta, quote, r["confidence"], r["source"])
        self.applied.append(it["id"])
        self.say("教练", f"经验卡 #{it['id']} 生效 → 现在 {out}", "生效")
        return it

    def story_tick(self):
        """0.5 s 一次（主循环打印处）：登顶 / 进红灯 → 峰哥解说。只看状态变化，不碰力矩。"""
        t = self.ctl
        if self.ctl_key() != "terrain":
            return
        seg = t.segment_at(t.pos)
        prev_w, prev_laps, prev_seg = self._story
        self._story = (t.preset, t.laps, seg)
        if prev_w != t.preset:
            return
        if t.laps > prev_laps and t.last_lap is not None:
            self.fengge.speak("summit", {"world": t.world["name"], "lap_s": round(t.last_lap, 1),
                                         "best_s": round(t.best, 1) if t.best is not None else None,
                                         "new_record": t.best == t.last_lap, "laps": t.laps, "who": self.wearer})
        elif seg == "wait" and prev_seg != "wait":
            self.fengge.speak("red", t.route[t.seg_index(t.pos)[0]]["label"])

    def make_world(self, text):
        """一句话造一座山：地形导演（大模型：Claude 或 MiniMax）出草稿，安全员裁剪，马上切过去。"""
        from .worlds import gen
        text = (text or "").strip()[:80]
        if not text:
            return None
        self.say("地形导演", f"「{text}」→ 在造…", "提议")
        w, source, notes = gen.generate(text)
        steps = sum(s["steps"] for s in w["route"])
        self.say("地形导演", f"{_model_label() if source == 'claude' else '大脑不在，规则模板'}造好「{w['name']}」：{w['subtitle']}（{steps} 步）", "提议")
        for n in notes:
            self.say("安全员", n, "裁剪")
        if not notes:
            self.say("安全员", "路线检查通过：起步平地、台阶不过半、红灯 ≤2", "同意")
        self.set_terrain(w["id"])
        self.say("地形导演", f"已切到「{w['name']}」", "生效")
        self.fengge.speak("world", {"name": w["name"], "subtitle": w["subtitle"], "steps": steps, "judge_said": text})
        return w

    def add_exp(self, delta, quote, source="ladder"):
        """直接写一张经验卡（强度阶梯等脚本用）。差值相对缺省参数；调用方已经用 /set 生效，这里只记为已套用。"""
        from .agent.interpret import _band
        delta = {k: float(v) for k, v in (delta or {}).items() if k in self.ctl.params and float(v)}
        if not delta:
            return None
        if self.gait.state.cadence <= 0:
            self.log(f"没写经验卡（{source}：{quote}）：还没估出步频")
            return None
        it = self.store.add(self.wearer, self.ctl_key(), {"cadence": _band(self.gait.state.cadence)},
                            delta, quote or source, 1.0, source)
        self.applied.append(it["id"])
        self.log(f"写入经验卡 #{it['id']} {delta}（{source}：{quote}）")
        return it

    def delete_exp(self, id_):
        it = self.store.set_enabled(int(id_), False)
        if not it:
            return None
        for c in (self.ctl, self._terrain):       # 套在缓存 terrain 上的卡也要回退
            if c is not None and it["id"] in c.__dict__.get("applied", []):
                out = c.set_params({k: -float(v) for k, v in it["delta"].items()})
                c.applied.remove(it["id"])
                self.log(f"删除经验卡 #{it['id']} → 参数回退 {out}")
                return it
        self.log(f"停用经验卡 #{it['id']}")
        return it

    def set_terrain(self, preset):
        if self.ctl_key() != "terrain":
            self.set_ctl("terrain")
        if self.ctl.preset != preset:
            self.ctl.set_preset(preset)
        self.ctl.reset()
        self.log(f"世界：{self.ctl.world['name']}（{self.ctl.total} 步）")

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
        """新控制律从 0 起，Guard 的斜率限负责平滑。terrain 例外：切走再切回沿用原实例（影子、最佳、世界）。"""
        if isinstance(self.ctl, Terrain):
            self._terrain = self.ctl
        if name == "terrain" and self._terrain is not None:
            self.ctl, self._terrain = self._terrain, None
            self.ctl.wearer = self.wearer
            self.ctl.reset()
        else:
            self.ctl = CTLS[name]()

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
        keys = [k] + (["t_step", "t_brake"] if k == "t_push" else [])   # terrain：台阶/下坡的时机一起挪
        out = self.ctl.set_params({x: sign * self._step(lo, hi) for x in keys})
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
    ap.add_argument("--no-input", action="store_true", help="不起手柄线程（诊断用）")
    ap.add_argument("--hotkeys", action="store_true",
                    help="起全局键盘备份（空格 = 死人开关、Esc = 急停）。全局监听：任何窗口里的空格都算，默认关")
    ap.add_argument("--http", type=int, default=8765, help="仪表盘端口，0 = 不起")
    ap.add_argument("--stepping", action="store_true", help="原地踏步模式：小摆幅也计步（展位没走廊时用）")
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
    from .control import terrain as _terrain
    _terrain.CAP = guard.soft_cap        # 地形控制律的自限跟着 --cap 走（以前写死 3，--cap 4 也只出 3）
    ver = link.handshake()
    guard.arm()
    print(f"[handshake] firmware {ver}  state {guard.state}  cap {guard.soft_cap} Nm")

    app = App(link, guard, a.ctl, rec, stepping=a.stepping)
    app.log(f"启动：{link.port} 固件 {ver}，控制律 {a.ctl}，软限 {a.cap} Nm")

    pad = None
    if not a.no_input:
        from .input.gamepad import Gamepad
        pad = Gamepad(guard, on_button=app.on_button)
        app.pad = pad
    if a.hotkeys:
        from .input.hotkeys import Hotkeys
        Hotkeys(guard)
    if a.force_deadman:
        guard.set_deadman(1.0, "forced")
    if a.http:
        from .ui.server import Dashboard
        Dashboard(app, a.http)
        from .agent import brain
        brain.watch()                    # 10 s 一次 GET /health：仪表盘马上知道大脑在不在、有没有 key
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
    rs = {"last": 0.0, "reboots": 0}
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
            st = app.tick(f, pad.sticks if pad is not None else None)
        now = time.monotonic()
        recover_tick(link, guard, now, rs, app.log)
        if now - last_print > 0.5:
            last_print = now
            app.auto_recall()
            app.story_tick()
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
