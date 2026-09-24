#!/usr/bin/env python3
"""MacBook 上把连拍 jpg 按 times.txt 的真实间隔编成 30 fps mp4（网络太慢，不传 jpg 传 mp4；mp4 时间轴 = times.txt 的毫秒，events.jsonl 直接对得上）。
    python3 mac_encode.py /tmp/v3f lap summit …   → /tmp/v3f/<name>/<name>.mp4"""
import os, subprocess, sys
root, *names = sys.argv[1:]
FF = '/opt/homebrew/bin/ffmpeg'
for n in names:
    d = os.path.join(root, n); ts = [int(x) / 1000 for x in open(os.path.join(d, 'times.txt')).read().split()]
    lst = os.path.join(d, 'list.txt')
    with open(lst, 'w') as f:
        for i, t in enumerate(ts):
            nxt = ts[i + 1] if i + 1 < len(ts) else t + 1 / 30
            f.write(f"file 'f{i:04d}.jpg'\nduration {max(0.001, nxt - t):.4f}\n")
        f.write(f"file 'f{len(ts) - 1:04d}.jpg'\n")
    out = os.path.join(d, n + '.mp4')
    r = subprocess.run([FF, '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', 'scale=1920:1080,fps=30,format=yuv420p',
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', out])
    print(n, r.returncode, os.path.getsize(out) // 1024 // 1024 if os.path.exists(out) else '-', 'MB', f'{ts[-1]:.1f} s', flush=True)
