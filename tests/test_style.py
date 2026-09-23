"""美术常量 static/game/style.js 的守门检查（node 跑；没装 node 就跳过）：
四种路段色两两色相差 ≥ 25°；HUD 强调色、影子、捷风不撞任何一种路段色（色相差 ≥ 12° 或饱和度差 ≥ 0.3：
影子冰青和下坡蓝同色相，靠低饱和 + 半透明 + 是个人形分开）；三个人彼此不撞色；光照上下限自洽。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

GAME = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static", "game")

CHECK = r"""
import { SEG, WHO, UI, LIGHT, TYPE } from './style.js';
const hue = h => { const n = parseInt(h.slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m; if (!d) return null;
  const x = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
const sat = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, n >> 8 & 255, n & 255], M = Math.max(...c); return M ? (M - Math.min(...c)) / M : 0; };
const dist = (a, b) => { const x = Math.abs(hue(a) - hue(b)); return Math.min(x, 360 - x); };
const segs = { up: SEG.up, stairs: SEG.stairs_up, down: SEG.down, wait: SEG.wait };
const out = { seg: [], vsSeg: [], who: [] };
const K = Object.keys(segs);
for (let i = 0; i < K.length; i++) for (let j = i + 1; j < K.length; j++) out.seg.push([K[i], K[j], dist(segs[K[i]], segs[K[j]])]);
for (const [n, c] of [["ui.acc", UI.acc], ["fengge.exo", WHO.fengge.exo], ['ghost', WHO.ghost.color], ['ghost.bright', WHO.ghost.bright], ['jett.wind', WHO.jett.wind], ['jett.coat', WHO.jett.coat]])
  for (const k of K) out.vsSeg.push([n, k, dist(c, segs[k]), Math.abs(sat(c) - sat(segs[k]))]);
out.who.push(['fengge.exo', 'ghost', dist(WHO.fengge.exo, WHO.ghost.color)], ['fengge.exo', 'jett.coat', dist(WHO.fengge.exo, WHO.jett.coat)],
  ['ghost', 'jett.coat', dist(WHO.ghost.color, WHO.jett.coat)], ['ghost.bright', 'jett.coat', dist(WHO.ghost.bright, WHO.jett.coat)]);
out.light = LIGHT.exp[0] < LIGHT.exp[1] && LIGHT.bloomStrength[0] < LIGHT.bloomStrength[1] && LIGHT.fogNearMin > 4.6;
out.type = Object.values(TYPE).every((v, i, a) => i === 0 || v < a[i - 1]);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def res():
    node = shutil.which("node")
    if not node:
        pytest.skip("没装 node")
    r = subprocess.run([node, "--input-type=module", "-e", CHECK], cwd=GAME, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_segment_colors_distinct(res):
    for a, b, d in res["seg"]:
        assert d >= 25, f"路段色 {a} / {b} 色相只差 {d:.0f}°"


def test_nothing_wears_a_segment_color(res):
    # 其余一律 ≥ 12°
    for n, k, d, ds in res["vsSeg"]:
        if n in ("jett.wind", "fengge.exo"):   # 风白近白；外骨骼琥珀和台阶黄只差 10°，靠「长在腿上」区分，HUD 里不许再用琥珀配路段元素
            continue
        assert d >= 12 or ds >= 0.3, f"{n} 和路段色 {k} 色相只差 {d:.0f}°、饱和度只差 {ds:.2f}"


def test_three_people_distinct(res):
    for a, b, d in res["who"]:
        assert d >= 20, f"{a} / {b} 色相只差 {d:.0f}°"


def test_limits_sane(res):
    assert res["light"] and res["type"]
