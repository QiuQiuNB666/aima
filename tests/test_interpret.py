"""规则表：评委常说的话 → 方向对不对。LLM 没配时走的就是这张表。"""
from __future__ import annotations
import pytest

from shellos.agent.interpret import by_rule
from shellos.control.terrain import Terrain

P = Terrain().params
MORE, LESS = +0.5, -0.5


@pytest.mark.parametrize("q,want", [
    ("不太明显", MORE), ("不明显", MORE), ("更明显一点", MORE), ("再明显一点", MORE), ("还可以再强", MORE),
    ("没什么感觉", MORE), ("没感觉", MORE), ("感觉不到", MORE), ("好像没有力", MORE), ("不够", MORE),
    ("重一点", MORE), ("再来", MORE),
    ("太陡了", LESS), ("太累了", LESS), ("轻一点", LESS), ("太明显了", LESS), ("有点重", LESS),
])
def test_strength_direction(q, want):
    assert by_rule(q, "terrain", P, 110)["delta"] == {"strength": want}


@pytest.mark.parametrize("q,want", [("早一点", -5), ("晚一点", +5), ("推得太早了", +5), ("太晚了", -5), ("晚了", -5)])
def test_timing_direction_all_pulses(q, want):
    assert by_rule(q, "terrain", P, 110)["delta"] == {"t_push": want, "t_step": want, "t_brake": want}


def test_unknown_is_none():
    assert by_rule("今天天气不错", "terrain", P, 110) is None
