"""峰哥声道仲裁 voice_bus.js（node + 假 <audio> 跑；没装 node 就跳过）：
解锁前不出声（导游被拒、事件静默丢掉）→ 按键解锁；高优先级打断低的；低的排队、放完接上、过期丢；导游占住声道时别的一律丢；
解锁时把登记过的片段都「预热」一遍（Safari / 严格策略下之后才能不靠手势播放）。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "game")

CHECK = r"""
let now = 0, allow = false; const played = [], L = {};
Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
globalThis.window = globalThis;
const dom = { shown: 0, removed: 0 };
globalThis.document = { body: { append() { dom.shown++; } }, createElement: () => ({ style: {}, remove() { dom.removed++; } }) };
globalThis.addEventListener = (t, f) => (L[t] ||= []).push(f);
globalThis.removeEventListener = (t, f) => { L[t] = (L[t] || []).filter(g => g !== f); };
class M {
  constructor(src = '') { this.src = src; this.ls = {}; this.paused = true; this.muted = false; this.currentTime = 0; }
  addEventListener(t, f) { (this.ls[t] ||= []).push(f); }
  fire(t) { (this.ls[t] || []).forEach(f => f()); }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause'); } }
  end() { this.paused = true; this.fire('ended'); }
}
M.prototype.play = function () {
  if (!allow) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  this.paused = false; if (!this.muted && !this.src.startsWith('data:')) played.push(this.src.split('/').slice(-2).join('/')); return Promise.resolve();
};
globalThis.HTMLMediaElement = M; globalThis.Audio = M;
const tick = () => new Promise(r => setTimeout(r, 0));
const { bus } = await import('./voice_bus.js');
const out = {};
const g0 = new M('/guide/tokyo_night/0.wav'), ev = t => new M('/voice/last.wav?_=' + t), map = new M('/guide/everest_north_fx/1.wav');
bus.bless([g0]);
out.lockedGuide = await g0.play().then(() => 'ok', e => e.name);             // 解锁前：导游被拒（guide.js 会等解锁再开讲）
out.lockedEvent = await ev(1).play().then(() => 'ok', e => e.name);          // 事件：静默丢掉，不让 voice.js 弹按钮
out.hint = dom.shown;                                                          // 想出声但没解锁：出「按任意键」提示
let woke = 0; bus.onUnlock(() => woke++);
allow = true; L.keydown.forEach(f => f({ type: 'keydown' })); await tick(); await tick();
out.unlocked = bus.unlocked(); out.woke = woke; out.hintGone = dom.removed; out.blessed = g0.paused && g0.muted === false;
const e2 = ev(2); await e2.play(); out.curEvent = bus.state().cur;
await map.play(); out.mapCutsEvent = [e2.paused, bus.state().cur];            // 地标打断事件
const e3 = ev(3); await e3.play(); out.queued = bus.state().queue;             // 事件排队
map.end(); await tick(); out.afterMap = [bus.state().cur, e3.paused];         // 地标放完 → 排着的事件接上
e3.end();
const e4 = ev(4); await map.play(); now = 0; await e4.play(); now = 7000; map.end(); await tick();
out.expired = [bus.state().cur, e4.paused];                                    // 排了 7 s 的事件过期丢掉
bus.hold('guide'); const e5 = ev(5); await e5.play(); await g0.play();
out.held = [e5.paused, bus.state().cur];                                       // 导游占着：事件丢，导游放
const g1 = new M('/guide/tokyo_night/1.wav'); g0.end(); await tick(); const m2 = new M('/guide/everest_north_fx/2.wav'); await m2.play();
out.gap = [m2.paused, bus.state().queue.length];                               // 句缝里来的地标台词也丢
await g1.play(); bus.release('guide'); g1.end(); await tick();
out.released = bus.state();
out.played = played;
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="没装 node")
def test_voice_bus(tmp_path):
    p = os.path.join(STATIC, "_test_voice_bus.mjs")
    open(p, "w").write(CHECK)
    try:
        r = subprocess.run(["node", p], capture_output=True, text=True, timeout=30)
    finally:
        os.remove(p)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout.strip().splitlines()[-1])
    assert o["lockedGuide"] == "NotAllowedError" and o["lockedEvent"] == "ok"
    assert o["hint"] == 1 and o["hintGone"] == 1
    assert o["unlocked"] and o["woke"] == 1 and o["blessed"]
    assert o["curEvent"] == "event" and o["mapCutsEvent"] == [True, "map"]
    assert o["queued"] == ["event"] and o["afterMap"] == ["event", False]
    assert o["expired"] == [None, True]
    assert o["held"] == [True, "guide"] and o["gap"] == [True, 0]
    assert o["released"] == {"unlocked": True, "held": None, "cur": None, "queue": []}
    # 真正出声的顺序：事件 2 → 地标 1 → 事件 3 → 地标 1 → 导游 0 → 导游 1；解锁前那两句、过期的 4、导游期间的 5 和地标 2 都没出声
    assert o["played"] == ["voice/last.wav?_=2", "everest_north_fx/1.wav", "voice/last.wav?_=3", "everest_north_fx/1.wav",
                           "tokyo_night/0.wav", "tokyo_night/1.wav"]
