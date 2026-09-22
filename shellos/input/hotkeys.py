"""键盘备份：按住空格 = deadman 1.0，Esc = 急停。需要 pynput 和 macOS 辅助功能权限。
没权限就静默失效——手柄仍是主路径。

全局监听（任何窗口里的按键都算，包括游戏页的「空格走」），所以默认不起，main --hotkeys 才打开。
不再有 R = 重新上膛：游戏页 R 是「回山脚」，全局 R 会顺手把急停清掉。重新上膛用手柄 ○ 或网页按钮。
"""
from __future__ import annotations
import threading


class Hotkeys:
    def __init__(self, guard):
        self.guard = guard
        self.ok = False
        threading.Thread(target=self._run, name="hotkeys", daemon=True).start()

    def _run(self):
        try:
            from pynput import keyboard
        except Exception:
            return

        def on_press(k):
            if k == keyboard.Key.space:
                self.guard.set_deadman(1.0, "keyboard")
            elif k == keyboard.Key.esc:
                self.guard.trigger_estop("keyboard esc")

        def on_release(k):
            if k == keyboard.Key.space:
                self.guard.set_deadman(0.0, "keyboard")

        try:
            with keyboard.Listener(on_press=on_press, on_release=on_release) as l:
                self.ok = True
                l.join()
        except Exception:
            self.ok = False
