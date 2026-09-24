#!/usr/bin/env python3
"""蜂群拆解视频的图卡 / 字幕 / 连拍合成（scripts/cut_swarm.sh 调用）。只用 PIL + ffmpeg；美术范式同 cut_demo.sh 的 png.py：深底、霓虹紫、不用纯白。

  swarm_png.py spec <spec.json> <out.png>          图卡：kind = panel | table | flow | cards | stack2（见各函数）
  swarm_png.py sub  <out.png> <文字>                字幕条（透明底 1920×1080，底部居中，超长自动折两行）
  swarm_png.py rec  <frames目录> <起秒> <止秒> <out.mp4> <秒> [crop x:y:w:h] [bg.png box x:y:w:h]
                                                    连拍（f%04d.jpg + times.txt）→ 30 fps；可裁切后放进图卡的框里
  swarm_png.py lines <md> <out.tsv>                 从 docs/蜂群-拆解.md 的「旁白全文」表抽 id / 声音 / 文字
"""
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

F = '/System/Library/Fonts/PingFang.ttc'          # index 2 = SC Regular, 5 = SC Medium, 8 = SC Semibold
def font(sz, idx=8): return ImageFont.truetype(F, sz, index=idx)
W, H = 1920, 1080
INK = (232, 229, 245); DIM = (168, 162, 196); FAINT = (110, 102, 140); NEON = (177, 118, 255); NEON2 = (140, 80, 230); BG = (12, 9, 22)
ROLE = {'教练': (96, 165, 250), '地形导演': (167, 139, 250), '记忆员': (244, 114, 182), '安全员': (248, 113, 113), '峰哥': (251, 146, 60),
        '大模型': (96, 165, 250), '代码': (244, 114, 182), '硬代码': (248, 113, 113), '未实现': (251, 191, 36),
        '我们': NEON, 'EvoMap': (52, 211, 153), 'Hermes': (251, 191, 36)}


def hexc(s): return tuple(int(s.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)) if isinstance(s, str) else tuple(s)


LAYER = [False]                                        # True：图卡先画在透明层上，最后整体竖直居中再铺到底图


def backdrop():
    if LAYER[0]:
        return Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im = Image.new('RGB', (W, H), BG); g = Image.new('RGB', (W, H), BG); gd = ImageDraw.Draw(g)
    gd.ellipse((-W // 4, H // 2, W // 3, H + H // 3), fill=(52, 24, 96)); gd.ellipse((W * 2 // 3, -H // 3, W + W // 4, H // 2), fill=(38, 18, 72))
    im = Image.blend(im, g.filter(ImageFilter.GaussianBlur(H // 6)), 0.9).convert('RGBA')
    ImageDraw.Draw(im).rectangle((W // 2 - 60, 0, W // 2 + 60, 4), fill=NEON)
    return im


def glow(im, box, color, r=18, a=110):
    g = Image.new('RGBA', im.size, (0, 0, 0, 0)); ImageDraw.Draw(g).rounded_rectangle(box, radius=16, fill=tuple(color) + (a,))
    return Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(r)))


def wrap(d, text, f, width):
    """按像素宽折行（中文逐字，英文单词不拆）。"""
    out, line = [], ''
    for tok in re.findall(r'[A-Za-z0-9_./%+\-]+|\s|.', text):
        if d.textlength(line + tok, font=f) <= width or not line or tok in '，。、：；）」』·！？':   # 标点不落行首
            line += tok
        else:
            out.append(line.rstrip()); line = tok.lstrip()
    if line: out.append(line)
    return out


def rich(d, x, y, text, f, fill, width, lh):
    """一段文字：「角色名：」前缀按角色色着色；返回新的 y。"""
    m = re.match(r'^(教练|地形导演|记忆员|安全员|峰哥|大模型|我们|EvoMap|Hermes)[：:]', text)
    pre = m.group(0) if m else ''
    lines = wrap(d, text, f, width)
    for i, ln in enumerate(lines):
        if i == 0 and pre:
            d.text((x, y), pre, font=f, fill=ROLE[m.group(1)]); d.text((x + d.textlength(pre, font=f), y), ln[len(pre):], font=f, fill=fill)
        else:
            d.text((x, y), ln, font=f, fill=fill)
        y += lh
    return y


def tag(d, x, y, text, color, f=None):
    f = f or font(24, 5); tw = d.textlength(text, font=f)
    bgc = tuple(int(c * 0.22 + b * 0.78) for c, b in zip(color, (22, 17, 40)))      # RGBA 图上直接写半透明会变实色，先和底色混好
    d.rounded_rectangle((x, y, x + tw + 24, y + 38), radius=8, fill=bgc, outline=tuple(color), width=2)
    d.text((x + 12, y + 4), text, font=f, fill=tuple(color)); return x + tw + 24


def header(d, s, x=90, y=70):
    if s.get('kicker'):
        tag(d, x, y, s['kicker'], hexc(s.get('kcolor', NEON))); y += 58
    d.text((x, y), s['title'], font=font(s.get('tsize', 58)), fill=INK); y += s.get('tsize', 58) + 22
    if s.get('sub'):
        y = rich(d, x, y, s['sub'], font(30, 5), DIM, s.get('subw', 1700), 44) + 6
    return y


def panel(s):
    """左文右框：左列 kicker / 标题 / 要点；右边 box 留给视频（画描边 + 光晕），框下一行来源说明。"""
    im = backdrop(); bx, by, bw, bh = s['box']
    im = glow(im, (bx - 6, by - 6, bx + bw + 6, by + bh + 6), NEON, 26, 90); d = ImageDraw.Draw(im)
    d.rounded_rectangle((bx - 8, by - 8, bx + bw + 8, by + bh + 8), radius=14, fill=(8, 6, 16), outline=NEON2, width=3)
    tw = bx - 90 - 70
    y = header(d, dict(s, subw=tw), 90, 80)
    y += 10; f = font(s.get('bsize', 32), 5)
    hi = s.get('hi')                                   # 高亮第几条（其余压暗）
    for i, b in enumerate(s.get('bullets', [])):
        on = hi is None or i == hi
        d.ellipse((90, y + 12, 106, y + 28) if i == hi else (92, y + 14, 104, y + 26), fill=NEON if on else FAINT)
        y = rich(d, 124, y, b, f, INK if on else FAINT, tw - 34, int(s.get('bsize', 32) * 1.5)) + 18
    if s.get('label'):
        lf = font(22, 2); lw = d.textlength(s['label'], font=lf)
        d.text((bx + bw - lw, by - 42), s['label'], font=lf, fill=FAINT)          # 放框上方：框下面是字幕区
    return im


def table(s):
    """对比表：cols = 表头（第 0 列是行名），rows = [[行名, 格…]]；hl = 高亮列号。"""
    im = backdrop(); d = ImageDraw.Draw(im)
    y0 = header(d, s, 90, 60) + 12
    cols, rows = s['cols'], s['rows']; x0, x1 = 90, W - 90
    cw0 = s.get('c0', 230); cw = (x1 - x0 - cw0) // (len(cols) - 1)
    xs = [x0] + [x0 + cw0 + i * cw for i in range(len(cols) - 1)] + [x1]
    fh, fc = font(32), font(s.get('csize', 25), 5); lh = int(s.get('csize', 25) * 1.42)
    hl = s.get('hl')
    heights = []
    for r in rows:
        heights.append(max(len(wrap(d, c, fc, cw - 40)) for c in r[1:]) * lh + 26)
    total = 64 + sum(heights)
    if hl is not None:
        im = glow(im, (xs[hl] + 4, y0 - 6, xs[hl + 1] - 4, y0 + total + 6), NEON, 24, 70); d = ImageDraw.Draw(im)
        d.rounded_rectangle((xs[hl] + 4, y0 - 6, xs[hl + 1] - 4, y0 + total + 6), radius=14, fill=(40, 22, 76), outline=NEON2, width=2)
    for i, c in enumerate(cols):
        if i == 0: continue
        col = ROLE.get(c.split(' ')[0], INK)
        d.text((xs[i] + 20, y0 + 10), c, font=fh, fill=col)
    y = y0 + 64
    for r, hgt in zip(rows, heights):
        d.line((x0, y, x1, y), fill=(60, 50, 96), width=2)
        d.text((x0 + 4, y + 13), r[0], font=font(26), fill=DIM)
        for i, c in enumerate(r[1:], 1):
            yy = y + 13
            for ln in wrap(d, c, fc, cw - 40):
                d.text((xs[i] + 20, yy), ln, font=fc, fill=INK if i == hl else (205, 200, 225)); yy += lh
        y += hgt
    d.line((x0, y, x1, y), fill=(60, 50, 96), width=2)
    if s.get('foot'):
        rich(d, x0, y + 18, s['foot'], font(24, 2), FAINT, x1 - x0, 34)
    return im


def flow(s):
    """泳道图：lanes = [{name, tag, color}]；nodes = [{lane, col, text, verdict?}]，按顺序连箭头；ncols 列。"""
    im = backdrop(); d = ImageDraw.Draw(im)
    y0 = header(d, s, 90, 60) + 16
    lanes, nodes = s['lanes'], s['nodes']; ncol = s.get('ncols', 6)
    lx, x0, x1 = 90, s.get('x0', 420), W - 80; lh = min(s.get('lh', 210), (H - y0 - 190) // len(lanes))        # 底部 ~150 px 留给字幕
    cwid = (x1 - x0) / ncol
    for i, ln in enumerate(lanes):
        y = y0 + i * lh; c = hexc(ln['color'])
        d.rounded_rectangle((lx, y + 8, x1, y + lh - 8), radius=14, fill=(20, 15, 36), outline=(50, 40, 80), width=1)
        d.text((lx + 24, y + lh // 2 - 40), ln['name'], font=font(38), fill=c)
        tag(d, lx + 24, y + lh // 2 + 8, ln['tag'], hexc(ln.get('tcolor', c)), font(22, 5))
    centers = []
    fn = font(s.get('nsize', 24), 5); nlh = int(s.get('nsize', 24) * 1.34)
    for n in nodes:
        cx = x0 + (n['col'] + 0.5) * cwid; y = y0 + n['lane'] * lh
        c = hexc(lanes[n['lane']]['color']); lines = wrap(d, n['text'], fn, cwid - 56)
        bh = len(lines) * nlh + 22; by = y + (lh - bh) // 2
        box = (cx - cwid / 2 + 16, by, cx + cwid / 2 - 16, by + bh)
        im = glow(im, box, c, 12, 60); d = ImageDraw.Draw(im)
        d.rounded_rectangle(box, radius=12, fill=(30, 22, 52), outline=c, width=2)
        yy = by + 11
        for l in lines:
            d.text((cx - d.textlength(l, font=fn) / 2, yy), l, font=fn, fill=INK); yy += nlh
        if n.get('verdict'):
            tag(d, box[0] - 6, box[1] - 44, n['verdict'], hexc(n.get('vcolor', c)), font(20, 5))
        centers.append((box, c))
    import math
    for (a, _), (b, c) in zip(centers, centers[1:]):      # 肘形箭头：右边中点 → 两框之间的竖线 → 左边中点
        ay, by_ = (a[1] + a[3]) / 2, (b[1] + b[3]) / 2
        if b[0] > a[2]:
            mx = (a[2] + b[0]) / 2; pts = [(a[2], ay), (mx, ay), (mx, by_), (b[0], by_)]
        else:                                             # 同一列上下
            mx = (a[0] + a[2]) / 2; pts = [(mx, a[3] if b[1] > a[3] else a[1]), (mx, b[1] if b[1] > a[3] else b[3])]
        d.line(pts, fill=NEON, width=3, joint='curve')
        (x0_, y0_), (x1_, y1_) = pts[-2], pts[-1]; ang = math.atan2(y1_ - y0_, x1_ - x0_); L = 16
        d.polygon([(x1_, y1_), (x1_ - L * math.cos(ang - 0.45), y1_ - L * math.sin(ang - 0.45)), (x1_ - L * math.cos(ang + 0.45), y1_ - L * math.sin(ang + 0.45))], fill=NEON)
    if s.get('foot'):
        rich(d, lx, y0 + len(lanes) * lh + 12, s['foot'], font(24, 2), DIM, x1 - lx, 34)
    return im


def cards(s):
    """并排卡片：items = [{name, tag, color, lines[], foot?}]。"""
    im = backdrop(); d = ImageDraw.Draw(im)
    y0 = header(d, s, 90, 60) + 20
    items = s['items']; n = len(items); gap = 28; x0 = 90; cw = (W - 180 - gap * (n - 1)) // n
    ls, ns = s.get('lsize', 32), s.get('nsize', 44); f = font(ls, 5)
    def need(it):                                       # 卡片内容实际要多高（标题 + 标签 + 各行 + 脚注）
        h = 26 + ns + 20 + (60 if it.get('tag') else 0)
        h += sum(len(wrap(d, l, f, cw - 80)) * int(ls * 1.45) + 12 for l in it.get('lines', []))
        return h + (40 + 32 * len(wrap(d, it['foot'], font(22, 2), cw - 56)) if it.get('foot') else 0) + 36
    bh = s.get('bh') or min(H - y0 - 190, max(need(it) for it in items) + 40)
    for i, it in enumerate(items):
        x = x0 + i * (cw + gap); c = hexc(it['color']); box = (x, y0, x + cw, y0 + bh)
        im = glow(im, box, c, 20, 50); d = ImageDraw.Draw(im)
        d.rounded_rectangle(box, radius=16, fill=(22, 17, 40), outline=c, width=3)
        d.text((x + 28, y0 + 26), it['name'], font=font(ns), fill=c)
        yy = y0 + 26 + ns + 20
        if it.get('tag'):
            tag(d, x + 28, yy, it['tag'], hexc(it.get('tcolor', c)), font(24, 5)); yy += 60
        for l in it.get('lines', []):
            d.ellipse((x + 30, yy + ls // 2 - 3, x + 40, yy + ls // 2 + 7), fill=c)
            yy = rich(d, x + 54, yy, l, f, INK, cw - 80, int(ls * 1.45)) + 12
        if it.get('foot'):
            fl = wrap(d, it['foot'], font(22, 2), cw - 56)
            fy = y0 + bh - 24 - 32 * len(fl)
            for l in fl:
                d.text((x + 28, fy), l, font=font(22, 2), fill=DIM); fy += 32
    if s.get('foot'):
        rich(d, x0, y0 + bh + 18, s['foot'], font(24, 2), FAINT, W - 180, 34)
    return im


def sub(out, text):
    """字幕：底部居中，深色半透明底条 + 细紫边；一行放不下折两行。"""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); f = font(40, 5)
    lines = wrap(d, text, f, 1560)
    if len(lines) == 2:                                # 两行时上下对半分，别让一两个字单独掉到第二行
        lines = wrap(d, text, f, d.textlength(text, font=f) / 2 + 60)
    if len(lines) > 2:
        f = font(34, 5); lines = wrap(d, text, f, 1640)
    lh = int(f.size * 1.45); th = lh * len(lines); tw = max(d.textlength(l, font=f) for l in lines)
    y = H - 44 - th; box = (W / 2 - tw / 2 - 30, y - 14, W / 2 + tw / 2 + 30, y + th + 8)
    d.rounded_rectangle(box, radius=12, fill=(10, 7, 20, 200), outline=NEON2 + (160,), width=1)
    for l in lines:
        d.text((W / 2 - d.textlength(l, font=f) / 2, y), l, font=f, fill=INK + (255,), stroke_width=1, stroke_fill=(8, 6, 16, 255)); y += lh
    im.save(out)


def rec(frames, a, b, out, secs, crop='', bg='', box=''):
    """连拍按真实间隔排成 30 fps（DOM 画面不补帧，逐帧保持）；crop 后按 box 等比放进图卡框，或铺满 1920×1080。"""
    a, b, secs = float(a), float(b), float(secs)
    ts = [int(x) / 1000 for x in open(os.path.join(frames, 'times.txt')).read().split()]
    idx = [i for i, t in enumerate(ts) if a <= t < b]
    if not idx: sys.exit(f'{frames}: {a}-{b} 没有帧')
    lst = out + '.txt'
    with open(lst, 'w') as fh:
        for k, i in enumerate(idx):
            nxt = ts[idx[k + 1]] if k + 1 < len(idx) else b
            fh.write(f"file '{os.path.join(frames, f'f{i:04d}.jpg')}'\nduration {max(0.02, nxt - ts[i]):.4f}\n")
        fh.write(f"file '{os.path.join(frames, f'f{idx[-1]:04d}.jpg')}'\n")
    pre = ''
    if crop:
        x, y, w, h = crop.split(':'); pre = f'crop={w}:{h}:{x}:{y},'
    if bg:
        bx, by, bw, bh = box.split(':')
        fc = f'[0:v]{pre}scale={bw}:{bh}:force_original_aspect_ratio=decrease:flags=lanczos,fps=30[v];[1:v][v]overlay=x={bx}+({bw}-overlay_w)/2:y={by}+({bh}-overlay_h)/2,format=yuv420p[o]'
        inp = ['-f', 'concat', '-safe', '0', '-i', lst, '-loop', '1', '-framerate', '30', '-i', bg]
    else:
        fc = f'[0:v]{pre}scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=#0c0916,fps=30,format=yuv420p[o]'
        inp = ['-f', 'concat', '-safe', '0', '-i', lst]
    fc += f';[o]tpad=stop_mode=clone:stop_duration={secs}[p]'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *inp, '-filter_complex', fc, '-map', '[p]', '-t', f'{secs:.3f}',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-an', out], check=True)


def lines(md, out):
    """旁白全文表：| id | 声音 | 旁白 |（声音 = 讲解 / 峰哥）。"""
    rows = []
    for ln in open(md, encoding='utf-8'):
        m = re.match(r'^\|\s*(sw\d+[a-z]?)\s*\|\s*(讲解|峰哥)\s*\|\s*(.+?)\s*\|\s*$', ln)
        if m: rows.append('\t'.join(m.groups()))
    open(out, 'w', encoding='utf-8').write('\n'.join(rows) + '\n')
    print(f'{len(rows)} 句')


if __name__ == '__main__':
    cmd, *a = sys.argv[1:]
    if cmd == 'spec':
        s = json.load(open(a[0], encoding='utf-8'))
        if s['kind'] == 'panel':                         # 左文右框：框的位置和录屏裁切对应，不挪
            im = panel(s)
        else:                                            # 其余：内容整体在字幕条上方的区域里竖直居中
            LAYER[0] = True; layer = {'table': table, 'flow': flow, 'cards': cards}[s['kind']](s); LAYER[0] = False
            top, bot = layer.getbbox()[1], layer.getbbox()[3]
            dy = max(40 - top, (40 + H - 170) // 2 - (top + bot) // 2)
            im = backdrop(); shifted = Image.new('RGBA', (W, H), (0, 0, 0, 0)); shifted.paste(layer, (0, dy)); im = Image.alpha_composite(im, shifted)
        im.convert('RGB').save(a[1])
    elif cmd == 'sub': sub(*a)
    elif cmd == 'rec': rec(*a)
    elif cmd == 'lines': lines(*a)
    else: sys.exit(__doc__)
