#!/usr/bin/env python3
"""连拍事件 → 分镜时间窗：读 $MAT/frames/<名>/events.jsonl（scratchpad/rec2.mjs 写的：每帧 t 毫秒、pos、seg、气泡文字 bub、登顶 summit），
按关键词找到「直升机 / 牦牛 / 吸氧 / 横梯 / 刀脊 / 登顶」各在连拍的第几秒，写成 build/shots.env 给 scripts/cut_demo.sh 用。
    python3 scripts/shot_windows.py [素材根]        # 缺省 ~/黑客松-EvoTavern/视频素材
"""
import json, os, sys
MAT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/黑客松-EvoTavern/视频素材')
def load(name):
    p = os.path.join(MAT, 'frames', name, 'events.jsonl')
    if not os.path.isfile(p): return []
    out = []
    for ln in open(p, encoding='utf-8'):
        try: out.append(json.loads(ln))
        except Exception: pass
    return out
def first(ev, pred):
    for e in ev:
        if pred(e): return e['t'] / 1000
    return None
def bub(ev, kw): return first(ev, lambda e: kw in (e.get('bub') or ''))
lap = load('lap'); env = {}
if lap:
    end = lap[-1]['t'] / 1000
    env['T_END'] = end
    env['T_GUIDE'] = first(lap, lambda e: e.get('bub')) or 0.5
    env['T_WALK'] = first(lap, lambda e: (e.get('pos') or 0) >= 1) or 9
    env['T_HELI'] = max(0, (bub(lap, '小飞机') or env['T_WALK'] + 2) - 4.6)      # 峰哥说「亡命小飞机」时直升机正落地：旁白 02b 先说 4.4 s，气泡 4.6 s 处出
    env['T_YAK'] = max(0, (bub(lap, '牦牛') or env['T_HELI'] + 8) - 1.0)
    env['T_OXY'] = max(0, (first(lap, lambda e: e.get('seg') == 'wait') or env['T_YAK'] + 8) - 3.5)   # 先看 3.5 s 上台阶，再站定吸氧
    env['T_PULSE'] = max(0, (first(lap, lambda e: (e.get('pos') or 0) >= 2 and e.get('seg') not in (None, 'flat', 'wait')) or env['T_WALK'] + 3) - 0.5)   # 腿上的力特写：第一段上坡 / 台阶
    env['T_LAD'] = max(0, (bub(lap, '一步一档') or (bub(lap, '过了，这是') or env['T_OXY'] + 12) - 3.0) - 1.0)   # 横梯：「一步一档」气泡，没有就用「过了」倒推 3 s
    env['T_RIDGE'] = max(0, (bub(lap, '悬崖') or env['T_LAD'] + 8) - 1.0)
    env['T_SUMMIT'] = first(lap, lambda e: e.get('summit')) or (bub(lap, '旗靠风') or end - 8)
    env['T_SUMMIT'] = max(0, env['T_SUMMIT'] - 2.0)
    env['T_CARD'] = first(lap, lambda e: e.get('x')) or 0     # 游戏屏右下决策卡（rec2 js= 记录）
sm = load('summit2') or load('summit')          # 正面机位单独跑一圈（summit2 = 登顶就停，留住旗子 / 环绕镜头）：登顶（body.summit）前 1 s 起
env['SUMMIT_DIR'] = 'summit2' if load('summit2') else 'summit'
if sm:
    env['Y_A'] = max(0, (bub(sm, '牦牛') or 2.5) - 1.0)      # 牦牛用正面机位那一圈
    env['S_A'] = max(0, (first(sm, lambda e: e.get('summit')) or bub(sm, '旗靠风') or sm[-1]['t'] / 1000 - 8) - 1.0)
if sm: env['S_G'] = round(max(0, (bub(sm, '旗靠风') or env['S_A'] + 3.2) - env['S_A']), 2)   # 「旗靠风」气泡在 R10 里第几秒 → g_summit.wav 摆这儿
if load('dash'): env['D_A'] = 7      # 仪表盘：第 9 s 喊「太陡了」，前面留 2 s
if load('forge'): env['F_A'] = 2      # 造山：第 2.5 s 发 POST，3 s 切世界、出「AI 造好了」卡，约 9.5 s 进新山
tk = load('tokyo')
if tk: env['K_A'] = max(0, (first(tk, lambda e: (e.get('pos') or 0) >= 2) or 2) - 1.0)
lines = [f'{k}={v:.2f}' if isinstance(v, float) else f'{k}={v}' for k, v in env.items()]
os.makedirs(os.path.join(MAT, 'build'), exist_ok=True)
open(os.path.join(MAT, 'build', 'shots.env'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
