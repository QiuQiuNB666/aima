"""键盘备份：按住空格 = deadman 1.0，Esc = 急停，R = 重新上膛。需要 pynput 和 macOS 辅助功能权限。
没权限就静默失效——手柄仍是主路径。
"""
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
                self.guard.set_deadman(1.0)
            elif k == keyboard.Key.esc:
                self.guard.trigger_estop("keyboard esc")
            elif getattr(k, "char", None) in ("r", "R"):
                self.guard.rearm()

        def on_release(k):
            if k == keyboard.Key.space:
                self.guard.set_deadman(0.0)

        try:
            with keyboard.Listener(on_press=on_press, on_release=on_release) as l:
                self.ok = True
                l.join()
        except Exception:
            self.ok = False
