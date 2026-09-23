"""游戏 lod.js 的回归检查（node 跑；没装 node 就跳过）：顶点聚类减面后面数明显少、外形大小不变、顶点色跟着走。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static")

CHECK = r"""
import * as THREE from '../vendor/three.module.js';
import { simplify } from './lod.js';
const g = new THREE.SphereGeometry(0.5, 128, 96);                 // 约 2.4 万三角，直径 1 m
const c = new Float32Array(g.attributes.position.count * 3).fill(0.5);
g.setAttribute('color', new THREE.BufferAttribute(c, 3));
const lo = simplify(g, 0.05);
g.computeBoundingBox();
const s0 = g.boundingBox.getSize(new THREE.Vector3()), s1 = lo.boundingBox.getSize(new THREE.Vector3());
console.log(JSON.stringify({ hi: g.index.count / 3, lo: lo.index.count / 3, s0: s0.toArray(), s1: s1.toArray(),
  col: lo.attributes.color.getX(0), nrm: !!lo.attributes.normal }));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="没装 node")
def test_simplify_cuts_faces_keeps_shape():
    game = os.path.join(STATIC, "game")
    r = subprocess.run(["node", "--input-type=module", "-e", CHECK], cwd=game, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    d = json.loads(r.stdout.strip().splitlines()[-1])
    assert d["lo"] < d["hi"] / 5                       # 5 cm 格子：面数至少降到 1/5
    assert d["lo"] > 200                               # 但没塌没了
    for a, b in zip(d["s0"], d["s1"]):
        assert abs(a - b) < 0.1                        # 外形大小差不到 10 cm（格子 5 cm）
    assert abs(d["col"] - 0.5) < 1e-6 and d["nrm"]
