"""捷风真人录音 → 游戏台词。配音演员本人当面同意、现场新录（台词单 docs/提交/捷风录音台词单.md）；不碰任何游戏素材。

  python3 brain/npc_intake.py                 # 处理 data/voice/npc_raw/ 里的全部录音
  python3 brain/npc_intake.py --use 09 <wav>  # 手动指定某句用哪一段（自动挑的不满意时，从 data/voice/npc_takes/ 里挑）

录音怎么放（二选一，m4a / wav / mp3 都行）：
  01.m4a … 11.m4a  一句一个文件，编号 = voice.NPC_LINES 的顺序；一个文件里录了几遍就按停顿切开，默认用最后一遍
  其他名字          整段一口气念：按停顿切，切出 11 段或 22 段（每句 2 遍）就按顺序对上，对不上就只切段、打印时长，人工用 --use 指定
  free.*           自由说话 → data/voice/ref/jifeng_ref.m4a（快速复刻用的参考音频；复刻要 9.9 元，球球确认后才跑 tts.py --clone-npc）
输出：data/voice/npc/real/<key>.wav（24 kHz 单声道 16 bit，去掉首尾静音，响度归一），/voice/npc.wav 优先放这个；每段都另存一份到 data/voice/npc_takes/。
需要 ffmpeg（解码、转采样率）。只用标准库。
"""
from __future__ import annotations

import glob
import math
import os
import re
import shutil
import subprocess
import sys
import wave
from array import array

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from shellos.agent import voice  # noqa: E402

SR = 24000
FRAME = SR // 50                  # 20 ms 一帧
SIL_DB = -42.0                    # 低于这个就算静音（相对满幅）
GAP_S = 0.9                       # 静音超过这么久算两段（句子里的逗号停顿一般 < 0.6 s）
MIN_S = 0.3                       # 比这短的段当噪声丢掉
PAD_S = 0.06                      # 切出来的段首尾各留一点
TARGET_DB, PEAK = -18.0, 0.89     # 响度归一：RMS −18 dBFS，峰值不超过 −1 dBFS


def decode(path) -> array:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         check=True, capture_output=True).stdout
    a = array("h"); a.frombytes(raw)
    return a


def _db(x) -> float:
    if not x:
        return -120.0
    return 20 * math.log10(max(1e-9, math.sqrt(sum(v * v for v in x) / len(x)) / 32768))


def segments(a, gap_s=GAP_S):
    """按静音切段 → [(起, 止)]（采样下标，含首尾留白）。"""
    loud = [_db(a[i:i + FRAME]) > SIL_DB for i in range(0, len(a), FRAME)]
    out, start, quiet = [], None, 0
    for k, on in enumerate(loud + [False] * int(gap_s * 50 + 1)):
        if on:
            start = k if start is None else start
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet > gap_s * 50:
                end = k - quiet + 1
                if (end - start) * FRAME >= MIN_S * SR:
                    pad = int(PAD_S * SR)
                    out.append((max(0, start * FRAME - pad), min(len(a), end * FRAME + pad)))
                start, quiet = None, 0
    return out


def normalize(x) -> array:
    rms_db = _db(x)
    g = 10 ** ((TARGET_DB - rms_db) / 20)
    peak = max(1, max(abs(v) for v in x)) / 32768
    g = min(g, PEAK / peak)
    return array("h", (max(-32768, min(32767, int(v * g))) for v in x))


def write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path + ".tmp", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(x.tobytes())
    os.replace(path + ".tmp", path)


def real_path(n):                  # n 从 1 开始，对应 voice.NPC_LINES
    return voice.real_path(voice.NPC_LINES[n - 1])


def take_dir():
    return os.path.join(voice.DIR, "npc_takes")


def use(n, x, why):
    write(real_path(n), normalize(x))
    print(f"{n:02d} {len(x) / SR:4.1f}s {why}  {voice.NPC_LINES[n - 1]}")


def process(path):
    name = os.path.splitext(os.path.basename(path))[0]
    a = decode(path)
    if name.lower().startswith("free"):
        ref = os.path.join(voice.DIR, "ref", "jifeng_ref.m4a")
        os.makedirs(os.path.dirname(ref), exist_ok=True)
        wav = os.path.join(take_dir(), "free.wav")
        segs = segments(a, gap_s=3.0)
        write(wav, normalize(a[segs[0][0]:segs[-1][1]] if segs else a))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "32k", ref], check=True)   # 开发机上行慢，传 m4a
        print(f"参考音频 {len(a) / SR:.0f} s → {ref}（MiniMax 要 10 s–5 min）")
        return
    segs = segments(a)
    for k, (s, e) in enumerate(segs, 1):
        write(os.path.join(take_dir(), f"{name}_{k}.wav"), normalize(a[s:e]))
    m = re.fullmatch(r"0*(\d+)", name)
    if m and 1 <= int(m.group(1)) <= len(voice.NPC_LINES):
        if not segs:
            print(f"{name}: 没切出声音，检查录音"); return
        s, e = segs[-1]
        use(int(m.group(1)), a[s:e], f"（{len(segs)} 遍，用最后一遍）")
        return
    n = len(voice.NPC_LINES)
    if len(segs) in (n, 2 * n):
        per = len(segs) // n
        for i in range(n):
            s, e = segs[i * per + per - 1]
            use(i + 1, a[s:e], f"（整段第 {i * per + per} 段）")
        return
    print(f"{name}: 切出 {len(segs)} 段，对不上 {n} 句（或 {2 * n} 段），段落在 {take_dir()}/{name}_*.wav：")
    for k, (s, e) in enumerate(segs, 1):
        print(f"  {name}_{k}.wav  {s / SR:6.1f}s  {(e - s) / SR:4.1f}s")
    print("  用 --use <句号> <文件> 逐句指定")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--use"]:
        n, src = int(sys.argv[2]), sys.argv[3]
        use(n, decode(src), f"（手动：{os.path.basename(src)}）")
        sys.exit(0)
    raw = sorted(glob.glob(os.path.join(voice.DIR, "npc_raw", "*")))
    if not raw:
        sys.exit(f"{voice.DIR}/npc_raw/ 是空的")
    for p in raw:
        process(p)
    have = [i + 1 for i, t in enumerate(voice.NPC_LINES) if os.path.isfile(voice.real_path(t))]
    miss = [i + 1 for i in range(len(voice.NPC_LINES)) if i + 1 not in have]
    print(f"真人录音 {len(have)}/{len(voice.NPC_LINES)} 句" + (f"，缺 {miss}（游戏里这几句走合成）" if miss else ""))
    if shutil.which("afplay") and have:                  # 按台词顺序播
        print("试听：for f in " + " ".join(f'"{voice.real_path(voice.NPC_LINES[i - 1])}"' for i in have) + '; do afplay "$f"; done')
