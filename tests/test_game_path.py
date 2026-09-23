"""游戏 path.js 的回归检查（node 跑；没装 node 就跳过）：化身高度在台阶上不能低于方块顶面（9/23 审查：脚陷进踏面）。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

from shellos import worlds

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static")

CHECK = r"""
import { makeRoute } from './path.js';
const EDGE = 0.1;   // 台阶边缘最多 10% 的一步用来升降（以前是 30%，脚陷进去）
const W = JSON.parse(process.argv[2]); const bad = [];
for (const w of W) {
  const r = makeRoute(w.route, 1);
  r.steps.forEach((st, i) => {
    if (!st.kind.startsWith('stairs')) return;
    const top = Math.max(st.h0, st.h1), up = st.kind === 'stairs_up';
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const onTread = up ? f >= EDGE : f <= 1 - EDGE;
      const h = r.heightAt(i + Math.min(f, 0.9999));
      if (onTread && Math.abs(h - top) > 1e-9) bad.push([w.id, i, +f.toFixed(2), +(top - h).toFixed(3)]);
    }
  });
}
console.log(JSON.stringify(bad));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 node")
def test_avatar_never_sinks_into_stairs(tmp_path):
    shutil.copy(os.path.join(STATIC, "game", "path.js"), tmp_path / "path.js")
    three = tmp_path / "node_modules" / "three"
    three.mkdir(parents=True)
    shutil.copy(os.path.join(STATIC, "vendor", "three.module.js"), three / "three.module.js")
    (three / "package.json").write_text('{"name":"three","type":"module","main":"three.module.js"}')
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "check.js").write_text(CHECK)
    routes = [{"id": w["id"], "route": w["route"]} for w in worlds.summary()]
    out = subprocess.run(["node", "check.js", json.dumps(routes)], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    bad = json.loads(out.stdout.strip().splitlines()[-1])
    assert bad == [], f"化身低于台阶顶面（world, step, f, 深度）：{bad[:5]}"


KINK = r"""
import { makeRoute, ROAD_W } from './path.js';
const W = JSON.parse(process.argv[2]); const bad = [];
for (const w of W) {
  const r = makeRoute(w.route, 1);
  for (const sg of [1, -1]) {
    let prev = null, pd = null;
    for (let s = 0; s <= r.N; s += 1 / 16) {
      const a = r.at(s), x = a.pos.x + a.left.x * ROAD_W / 2 * sg, z = a.pos.z + a.left.z * ROAD_W / 2 * sg;
      if (prev) {
        const d = Math.atan2(z - prev[1], x - prev[0]);
        if (pd !== null) { const k = Math.abs(Math.atan2(Math.sin(d - pd), Math.cos(d - pd))); if (k > 0.3) bad.push([w.id, +s.toFixed(3), +k.toFixed(2)]); }
        pd = d;
      }
      prev = [x, z];
    }
  }
}
console.log(JSON.stringify(bad));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 node")
def test_road_edges_have_no_kinks(tmp_path):
    """路沿每 1/16 步转角 ≤0.3 rad（9/24 修：中心线折线 + 平滑朝向导致每个步边界路沿折 1.3 rad，Z 字坡最明显）。"""
    shutil.copy(os.path.join(STATIC, "game", "path.js"), tmp_path / "path.js")
    three = tmp_path / "node_modules" / "three"
    three.mkdir(parents=True)
    shutil.copy(os.path.join(STATIC, "vendor", "three.module.js"), three / "three.module.js")
    (three / "package.json").write_text('{"name":"three","type":"module","main":"three.module.js"}')
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "check.js").write_text(KINK)
    routes = [{"id": w["id"], "route": w["route"]} for w in worlds.summary()]
    out = subprocess.run(["node", "check.js", json.dumps(routes)], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    bad = json.loads(out.stdout.strip().splitlines()[-1])
    assert bad == [], f"路沿折角（world, s, rad）：{bad[:5]}"
