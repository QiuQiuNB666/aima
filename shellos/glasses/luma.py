"""Luma 眼镜：包一层 luma-core 的命令行（Rust，`luma` 可执行文件），不自己碰蓝牙。

  luma info                 → 握手，打印电量/版本
  luma photo --ai out.jpg   → 拍照，约 1 秒后经蓝牙收到 ~11 KB 小图
每次调用都是一次独立的蓝牙连接（几秒）。够做"看一眼→问模型"的演示；要常连再改成常驻进程。
所有调用都在后台线程里跑，不碰控制循环。
"""
from __future__ import annotations
import os
import re
import shutil
import subprocess
import threading
import time

DEFAULT_BIN = os.path.expanduser("~/luma-core/target/release/examples/luma")


class Glasses:
    def __init__(self, binary: str | None = None, shots_dir: str = "data/shots", on_event=None):
        self.bin = binary or os.environ.get("LUMA_BIN") or DEFAULT_BIN
        self.shots_dir = shots_dir
        os.makedirs(shots_dir, exist_ok=True)
        self.on_event = on_event or (lambda s: None)
        self.available = os.path.isfile(self.bin) and os.access(self.bin, os.X_OK)
        self.busy = False
        self.last_info = ""
        self.last_shot = ""          # 最近一张小图的路径
        self.last_answer = ""
        self.last_error = ""
        self._lock = threading.Lock()

    # ---- 底层 ----
    def _run(self, *args, timeout=40):
        p = subprocess.run([self.bin, *args], capture_output=True, text=True, timeout=timeout)
        out = (p.stdout + p.stderr).strip()
        if p.returncode != 0:
            raise RuntimeError(out[-400:] or f"exit {p.returncode}")
        return out

    def _bg(self, fn, name):
        if self.busy:
            self.on_event(f"眼镜：上一个操作还没完成（{name}）")
            return False
        def w():
            self.busy = True
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                self.last_error = str(e)
                self.on_event(f"眼镜 {name} 失败：{str(e)[-160:]}")
            finally:
                self.busy = False
        threading.Thread(target=w, name=f"glasses-{name}", daemon=True).start()
        return True

    # ---- 动作 ----
    def info(self):
        def go():
            self.on_event("眼镜：连接中…")
            out = self._run("info")
            self.last_info = out[-600:]
            m = re.search(r"battery\D*(\d+)", out, re.I)
            self.on_event("眼镜已连接" + (f"，电量 {m.group(1)}%" if m else ""))
        return self._bg(go, "info")

    def photo(self, then=None):
        """拍照拿小图；then(path) 在拿到图后调用（例如喂视觉模型）。"""
        def go():
            self.on_event("眼镜：拍照中…")
            path = os.path.join(self.shots_dir, time.strftime("%H%M%S") + ".jpg")
            self._run("photo", "--ai", path)
            if not os.path.isfile(path) or os.path.getsize(path) < 500:
                raise RuntimeError("没有收到图片")
            self.last_shot = path
            shutil.copyfile(path, os.path.join(self.shots_dir, "latest.jpg"))
            self.on_event(f"眼镜：收到小图 {os.path.getsize(path)//1024} KB")
            if then:
                then(path)
        return self._bg(go, "photo")
