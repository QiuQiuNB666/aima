from __future__ import annotations

# 仪表盘「腿部 3D」：CesiumMan 腿骨局部 Y = 人体左右轴。9/23 发现绕 X 转是左右剪刀开合。
# 真 WebGL 测不了，这里只钉住映射，防止有人按旧注释改回 axisX。浏览器实测见指挥板 D 节。
import os
import re

STATIC = os.path.join(os.path.dirname(__file__), "..", "shellos", "ui", "static")


def _read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


def test_leg_joints_rotate_about_local_y():
    src = _read("body3d.js")
    for bone in ("hipL", "hipR", "kneeL", "kneeR"):
        calls = re.findall(r"setJoint\(%s,\s*(\w+)" % bone, src)
        assert calls == ["axisY"], (bone, calls)
    # 屈曲（fl>0）= 髋绕 Y 负转前抬、膝绕 Y 正转后屈
    assert "setJoint(hipL, axisY, -fl)" in src
    assert "setJoint(kneeL, axisY, Math.max(0, fl) * 0.6)" in src


def test_canvas_follows_container_not_window():
    # h2 里浮动的 #c3info 会把 overflow:hidden 的 #c3 挤窄，要 clear
    assert re.search(r'id="c3" style="clear:both;', _read("index.html"))
    assert "ResizeObserver" in _read("body3d.js")
