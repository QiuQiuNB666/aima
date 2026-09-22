"""DualSense（USB）→ Guard。R2 扳机深度 = deadman；× = 急停；○ = 重新上膛。
pygame 的轴号在 macOS 上：R2 是 axis 5（-1 松开 → +1 按满）；× 是 button 0，○ 是 button 1。
没插手柄时线程直接退出，Guard 的 deadman 保持 0——也就是没有手柄就没有力。
"""
from __future__ import annotations
import os
import threading
import time

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

R2_AXIS, BTN_CROSS, BTN_CIRCLE = 5, 0, 1
LY_AXIS, RY_AXIS = 1, 3        # 摇杆上下；SDL 标准映射，未逐个验证
# 9/22 在 MacBook 上实测：R2=轴5、×=0；其余按 SDL 对 DualSense 的标准映射（未逐个验证）
BTN = {"cross": 0, "circle": 1, "square": 2, "triangle": 3, "share": 4, "ps": 5, "options": 6,
       "l3": 7, "r3": 8, "l1": 9, "r1": 10, "up": 11, "down": 12, "left": 13, "right": 14, "touchpad": 15}


class Gamepad:
    def __init__(self, guard, on_button=None):
        self.guard = guard
        self.on_button = on_button
        self.connected = False
        self.r2 = 0.0
        self.sticks = [0.0, 0.0]        # 左/右摇杆上下，上为正，死区 0.1
        threading.Thread(target=self._run, name="gamepad", daemon=True).start()

    def _run(self):
        import pygame
        pygame.init()
        pygame.joystick.init()
        if pygame.joystick.get_count() == 0:
            return
        js = pygame.joystick.Joystick(0)
        js.init()
        self.connected = True
        clock = pygame.time.Clock()
        seen_r2 = False
        last_btn = {}            # 防抖：同一键 250 ms 内只算一次          # SDL 在第一个事件之前把扳机读成 0（=按一半），必须等到真实事件
        while True:
            for ev in pygame.event.get():
                if ev.type == pygame.JOYAXISMOTION and ev.axis == R2_AXIS:
                    seen_r2 = True
                if ev.type == pygame.JOYBUTTONDOWN:
                    now = time.monotonic()
                    if now - last_btn.get(ev.button, 0) < 0.25:
                        continue
                    last_btn[ev.button] = now
                    if ev.button == BTN_CROSS:
                        self.guard.trigger_estop("gamepad ×")
                    elif ev.button == BTN_CIRCLE:
                        self.guard.rearm()
                    if self.on_button:
                        self.on_button(ev.button)
                elif ev.type == pygame.JOYDEVICEREMOVED:
                    self.connected = False
                    self.guard.set_deadman(0.0, "gamepad")
                    return
            self.r2 = (js.get_axis(R2_AXIS) + 1.0) / 2.0 if seen_r2 else 0.0     # → 0..1
            self.guard.set_deadman(self.r2 if self.r2 > 0.05 else 0.0, "gamepad")
            ly, ry = -js.get_axis(LY_AXIS), -js.get_axis(RY_AXIS)
            self.sticks = [ly if abs(ly) > 0.1 else 0.0, ry if abs(ry) > 0.1 else 0.0]
            clock.tick(100)
