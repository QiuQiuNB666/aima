#!/bin/bash
# V3 演示视频：素材 → v${V}_60s.mp4 / v${V}_90s.mp4（1920×1080、30 fps、H.264、≤ 50 MB）。只用 ffmpeg + 系统 python3（PIL 出字幕 PNG；这台机器的 ffmpeg 没编 drawtext）。
#
#   V=1 scripts/cut_demo.sh            # 全部：建片段 → 60 s → 90 s（缺省 V=3）
#   scripts/cut_demo.sh 60 | 90        # 只出一版（片段已建的直接复用；FORCE=1 强制重建）
#   scripts/cut_demo.sh clean          # 删掉 build/ 重来
#   MAT=<素材根> scripts/cut_demo.sh   # 缺省 ~/黑客松-EvoTavern/视频素材；成片另拷一份到 docs/提交/视频素材/（≤ 50 MB 进 git）
#
# 每个镜头 id 的画面来源，按优先级：
#   1. $MAT/raw/<id>.{mov,mp4}      手机实拍（B01–B06）——丢进去重跑即可，占位卡自动消失
#   2. 来源项 clip|<frames 目录>|<起秒>|<止秒>[|倍速]   无头 Chrome 连拍（scratchpad/rec2.mjs：f%04d.jpg + times.txt + events.jsonl）按时间窗切片段，
#                                                   气泡文字出现的那一毫秒 → 同一句峰哥克隆声 wav（tts 缓存）作为同期声，和画面对上
#   3. img|秒|截图名|cover/fit|in/out  docs/提交/截图 静帧 Ken Burns（兜底）；ph|秒|一句话|副行 占位卡（明早实拍替换）
# 旁白：$MAT/vo/<id>.wav（峰哥克隆声，brain/tts.py）。配乐：$MAT/music/*.mp3（CC BY，见 docs/提交/素材授权.md），旁白 / 同期声处按包络压 −12 dB。
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MAT=${MAT:-$HOME/黑客松-EvoTavern/视频素材}
V=${V:-3}
SHOTS=$ROOT/docs/提交/截图
QR=$ROOT/docs/提交/海报A4/wx_qr.jpg
MUSIC=${MUSIC:-$MAT/music/Our Story Begins.mp3}
TTS=${TTS:-http://127.0.0.1:8791}
B=$MAT/build
W=1920; H=1080; FPS=30
FADE=${FADE:-0.3}          # 每段首尾淡入淡出秒数（0 = 硬切）
TAIL=${TAIL:-2}            # 登顶后留白秒数（V ≥ 3）
LUMA=${LUMA:-}             # 游戏段亮度对齐目标（YAVG，V=3 用 95；空 = 不动）
MI=${MI:-mci}              # 连拍补帧：mci（运动补偿）| blend（叠化，快）| dup（不补）
ENC=(-c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -r $FPS -an)
REPO_URL="github.com/QiuQiuNB666/aima"

[ "${1:-}" = clean ] && { rm -rf "$B"; echo "已清 $B"; exit 0; }
mkdir -p "$B/cap" "$B/src" "$B/seg" "$B/meta" "$MAT/raw" "$MAT/frames" "$MAT/vo/game" "$MAT/music" "$MAT/片段"

# ---------- 字幕 / 卡片 PNG（PIL + 系统 PingFang SC；美术范式：深底、霓虹紫强调、不用纯白） ----------
cat > "$B/png.py" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
F = '/System/Library/Fonts/PingFang.ttc'          # index 2 = SC Regular, 5 = SC Medium, 8 = SC Semibold
def font(sz, idx=8): return ImageFont.truetype(F, sz, index=idx)
INK = (232, 229, 245, 255); DIM = (168, 162, 196, 255); NEON = (177, 118, 255, 255); NEON2 = (140, 80, 230, 255); BG = (12, 9, 22)
def center(d, y, text, f, fill, W, stroke=0):
    bb = d.textbbox((0, 0), text, font=f); tw = bb[2] - bb[0]
    d.text(((W - tw) // 2 - bb[0], y - bb[1]), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=(8, 6, 16, 255))
    return bb[3] - bb[1]
def glow(im, box, color, r=18):
    g = Image.new('RGBA', im.size, (0, 0, 0, 0)); ImageDraw.Draw(g).rounded_rectangle(box, radius=14, fill=color + (110,))
    return Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(r)))
kind, out, *a = sys.argv[1:]
if kind == 'cap':                                  # cap <out> <主行> [副行] [中心x]：底部深底 + 紫色左条 + 紫辉光，透明底 1920×1080（游戏画面上中心 1180，避开左下波形面板）
    W, H = 1920, 1080; im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    main, sub = a[0], (a[1] if len(a) > 1 else ''); CX = int(a[2]) if len(a) > 2 else W // 2
    if main:
        d = ImageDraw.Draw(im); f = font(50); bb = d.textbbox((0, 0), main, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        y = H - 78 - th - (50 if sub else 0); x = CX - tw // 2
        box = (x - 40, y - 18, x + tw + 40, y + th + 20)
        im = glow(im, box, NEON[:3]); d = ImageDraw.Draw(im)
        d.rounded_rectangle(box, radius=14, fill=(12, 9, 22, 215), outline=NEON2, width=2)
        d.rectangle((box[0], box[1] + 10, box[0] + 8, box[3] - 10), fill=NEON)
        d.text((x - bb[0] + 6, y - bb[1]), main, font=f, fill=INK)
        if sub: center(d, y + th + 34, sub, font(30, 5), NEON, CX * 2, stroke=2)
    im.save(out)
elif kind == 'badge':                              # badge <out> <文字> <tr|br>：角标，透明底
    W, H = 1920, 1080; im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    text, pos = a[0], a[1]; f = font(24, 5); bb = d.textbbox((0, 0), text, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = W - 24 - tw - 30; y = 24 if pos == 'tr' else H - 24 - th - 20
    d.rounded_rectangle((x, y, x + tw + 30, y + th + 20), radius=8, fill=(12, 9, 22, 170), outline=NEON2, width=1)
    d.text((x + 15 - bb[0], y + 10 - bb[1]), text, font=f, fill=DIM)
    im.save(out)
elif kind == 'card':                               # card <out> <W> <H> <标题> <副题> <小行1|小行2|…> <qr路径或-> <标题色hex>
    W, H = int(a[0]), int(a[1]); title, sub, lines, qr, col = a[2], a[3], [s for s in a[4].split('|') if s], a[5], a[6]
    im = Image.new('RGB', (W, H), BG)
    # 背景：左下 / 右上两团紫辉光 + 顶部细线
    g = Image.new('RGB', (W, H), BG); gd = ImageDraw.Draw(g)
    gd.ellipse((-W // 4, H // 2, W // 3, H + H // 3), fill=(52, 24, 96)); gd.ellipse((W * 2 // 3, -H // 3, W + W // 4, H // 2), fill=(38, 18, 72))
    im = Image.blend(im, g.filter(ImageFilter.GaussianBlur(min(W, H) // 6)), 0.9); d = ImageDraw.Draw(im)
    d.rectangle((W // 2 - 60, 0, W // 2 + 60, 4), fill=NEON[:3])
    big = font(min(104, W // 9)); small = font(min(46, W // 22), 5); tiny = font(min(30, W // 34), 2)
    hs = [d.textbbox((0, 0), title, font=big)[3]] + ([d.textbbox((0, 0), sub, font=small)[3]] if sub else []) + [d.textbbox((0, 0), l, font=tiny)[3] for l in lines]
    gap = 28; total = sum(hs) + gap * (len(hs) - 1) + (36 if sub else 0)
    qh = 0
    if qr != '-':
        q = Image.open(qr).convert('RGB'); qs = min(240, H // 4); q = q.resize((qs, qs)); qh = qs + 60
    y = (H - total - qh) // 2
    y += center(d, y, title, big, col, W) + gap + (36 if sub else 0)
    if sub: y += center(d, y, sub, small, INK[:3], W) + gap
    for l in lines: y += center(d, y, l, tiny, DIM[:3], W) + gap
    if qr != '-':
        d.rounded_rectangle(((W - qs) // 2 - 10, y + 10, (W + qs) // 2 + 10, y + 30 + qs), radius=10, fill=(236, 232, 246)); im.paste(q, ((W - qs) // 2, y + 20))
        center(d, y + 20 + qs + 16, '扫码进群 · 群码 9/30 前有效', tiny, DIM[:3], W)
    im.save(out)
PY
png() { python3 "$B/png.py" "$@"; }

# ---------- 连拍 → 片段（时间窗 + 倍速 + 同期声） ----------
cat > "$B/clip.py" <<'PY'
# clip.py <frames目录> <起秒> <止秒> <倍速> <出mp4> <同期声清单> [fps] [mi]
#   帧按 times.txt 的真实间隔排（concat duration），倍速 = 间隔除以倍速；补到 30 fps。
#   events.jsonl 里气泡文字变化的时刻 → 向 tts 要同一句的峰哥 wav（缓存 vo/game/<md5>.wav），写 "wav@偏移秒" 到清单。
import sys, os, json, subprocess, hashlib, urllib.request
d, a, b, sp, out, sync = sys.argv[1:7]; a, b, sp = float(a), float(b), float(sp)
fps = int(sys.argv[7]) if len(sys.argv) > 7 else 30; mi = sys.argv[8] if len(sys.argv) > 8 else 'mci'
W, H = 1920, 1080
ts = [int(x) / 1000 for x in open(os.path.join(d, 'times.txt')).read().split()]
crop = os.environ.get('CROP') or ''
pre = f'crop={crop},scale={W}:{H}:flags=lanczos,' if crop else ''
src = os.path.join(d, os.path.basename(d.rstrip('/')) + '.mp4')
if os.path.isfile(src):          # MacBook 上已按 times.txt 编好的 30 fps mp4（时间轴 = 连拍毫秒）：直接截时间窗，倍速丢帧即可
    if a >= ts[-1]: sys.exit(f'{src}: 起点 {a} 超出 {ts[-1]:.1f} s')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', src, '-vf', f'{pre}setpts=PTS/{sp},fps={fps},scale={W}:{H},format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', str(fps), '-an', '-t', f'{(b - a) / sp:.3f}', out], check=True)
else:                            # 开发机低帧率连拍：按真实间隔排 + 补帧
    idx = [i for i, t in enumerate(ts) if a <= t < b]
    if not idx: sys.exit(f'{d}: {a}-{b} 没有帧（共 {len(ts)} 帧，{ts[-1]:.1f} s）')
    lst = out + '.txt'
    with open(lst, 'w') as f:
        for k, i in enumerate(idx):
            nxt = ts[idx[k + 1]] if k + 1 < len(idx) else min(b, ts[i] + (ts[i] - ts[i - 1] if i else 0.3))
            f.write(f"file '{os.path.join(d, f'f{i:04d}.jpg')}'\nduration {max(0.02, (nxt - ts[i]) / sp):.4f}\n")
        f.write(f"file '{os.path.join(d, f'f{idx[-1]:04d}.jpg')}'\n")
    vf = {'mci': f'minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1', 'blend': f'minterpolate=fps={fps}:mi_mode=blend', 'dup': f'fps={fps}'}[mi]
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', pre + f'{vf},scale={W}:{H},format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', str(fps), '-an', '-t', f'{(b - a) / sp:.3f}', out], check=True)
mat = os.environ.get('MAT'); tts = os.environ.get('TTS', 'http://127.0.0.1:8791'); lines = []
skip = os.environ.get('SKIP') or ''          # 同期声：all = 这段不要；其它 = 含这个词的句子不要。倍速 / 裁切的段自动不要（气泡看不见或挤在一起）
if sp != 1 or crop: skip = 'all'
ev = os.path.join(d, 'events.jsonl'); last_t = -9
if os.path.isfile(ev) and skip != 'all':
    prev = ''
    for ln in open(ev, encoding='utf-8'):
        try: e = json.loads(ln)
        except Exception: continue
        t, bub = e.get('t', 0) / 1000, (e.get('bub') or '').strip()
        if bub != prev and bub and a <= t < b and not (skip and skip in bub) and t - last_t >= 2.0:   # 2 s 内连出两句只留第一句
            last_t = t
            wav = os.path.join(mat, 'vo', 'game', hashlib.md5(bub.encode()).hexdigest()[:12] + '.wav')
            if not os.path.isfile(wav):
                try:
                    r = urllib.request.urlopen(urllib.request.Request(tts + '/tts', data=json.dumps({'text': bub}).encode(), headers={'Content-Type': 'application/json'}), timeout=90)
                    if 'no-store' not in (r.headers.get('Cache-Control') or ''): open(wav, 'wb').write(r.read())
                except Exception as x: print('  ! tts 失败', bub, x, file=sys.stderr)
            if os.path.isfile(wav): lines.append(f'{wav}@{(t - a) / sp:.2f}'); print(f'    同期声 {(t - a) / sp:5.2f}s {bub}')
        prev = bub
open(sync, 'w').write('\n'.join(lines) + ('\n' if lines else ''))
PY

# still <图> <秒> <出> [cover|fit] [in|out]：静帧 Ken Burns（先放大到 4K 再 zoompan，不抖）
still() {
  local img=$1 s=$2 out=$3 mode=${4:-cover} dir=${5:-in} n pre z
  n=$(python3 -c "print(int($s*$FPS))")
  if [ "$mode" = fit ]; then pre="scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=#0c0916"; else pre="scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160"; fi
  if [ "$dir" = in ]; then z="1+0.08*on/$n"; else z="1.08-0.08*on/$n"; fi
  ffmpeg -y -v error -loop 1 -framerate $FPS -i "$img" -t "$s" -vf "$pre,zoompan=z='$z':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=$FPS,format=yuv420p" "${ENC[@]}" "$out"
}
cardv() { ffmpeg -y -v error -loop 1 -framerate $FPS -i "$1" -t "$2" -vf "scale=$W:$H,format=yuv420p" "${ENC[@]}" "$3"; }
# clipv <源视频> <秒> <出> [倍速]：实拍 / 现成视频统一成 1080p30，不够长就定格补
clipv() {
  local sp=${4:-1}
  ffmpeg -y -v error -i "$1" -vf "setpts=PTS/$sp,scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,fps=$FPS,tpad=stop_mode=clone:stop_duration=$2,format=yuv420p" -t "$2" "${ENC[@]}" "$3"
}
concatv() { local out=$1 lst; shift; lst=$out.txt; : > "$lst"; for f in "$@"; do echo "file '$f'" >> "$lst"; done; ffmpeg -y -v error -f concat -safe 0 -i "$lst" -c copy "$out"; }
ph() { png card "$B/cap/ph_$1.png" $W $H "明早实拍" "$4" "${5:-}|镜头 $1 · 拍好放到 $MAT/raw/$1.mov 重跑 scripts/cut_demo.sh" - "#b176ff"; cardv "$B/cap/ph_$1.png" "$2" "$3"; }
# clip <frames名> <起> <止> <倍速> <出> <同期声清单>
clip() { MAT=$MAT TTS=$TTS CROP=${7:-} SKIP=${8:-} python3 "$B/clip.py" "$MAT/frames/$1" "$2" "$3" "$4" "$5" "$6" $FPS $MI; }
# 定长：源不够长就定格补到 s 秒，长了截断
fit() { ffmpeg -y -v error -i "$1" -vf "tpad=stop_mode=clone:stop_duration=$2,format=yuv420p" -t "$2" "${ENC[@]}" "$3"; }

# 叠字幕 / 角标 / 水印 / 淡入淡出 → seg
# luma <src>：平均亮度（signalstats YAVG，0–255）；LUMA=<目标> 时游戏段按它做 eq 亮度对齐（只动 ±0.08，别把雪山压灰）
luma() { ffmpeg -hide_banner -i "$1" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null /dev/null 2>/dev/null | grep -o "YAVG=[0-9.]*" | awk -F= '{s+=$2;n++} END{if(n)printf "%.1f", s/n; else print 0}'; }
overlay() {   # overlay <src> <id> <cap1> <cap2> <wm> <秒>
  local src=$1 id=$2 wm=$5 s=$6 fc in last pre="null"
  if [ -n "${LUMA:-}" ] && [ "$wm" = 1 ]; then
    local y; y=$(luma "$src"); pre=$(python3 -c "print('eq=brightness=%.3f' % max(-0.08, min(0.08, ($LUMA-$y)/255*0.6)))"); echo "    亮度 $y → $pre"
  fi
  png cap "$B/cap/c_$id.png" "$3" "$4" $([ "$wm" = 1 ] && echo 1180 || echo 960)
  in=(-i "$src" -i "$B/cap/c_$id.png" -i "$B/cap/tag.png"); fc="[0:v]$pre[p];[p][1:v]overlay=0:0[a];[a][2:v]overlay=0:0[b]"; last=b
  if [ "$wm" = 1 ]; then in+=(-i "$B/cap/wm.png"); fc="$fc;[b][3:v]overlay=0:0[c]"; last=c; fi
  if [ "$(python3 -c "print(1 if $FADE>0 else 0)")" = 1 ]; then fc="$fc;[$last]fade=t=in:d=$FADE,fade=t=out:st=$(python3 -c "print(max(0,$s-$FADE))"):d=$FADE[f]"; last=f; fi
  ffmpeg -y -v error "${in[@]}" -filter_complex "$fc" -map "[$last]" -t "$s" "${ENC[@]}" "$B/seg/$id.mp4"
}

# seg <id> <秒> <字幕主行> <字幕副行> <水印0/1> <旁白:"01@0.3 g_oxy@2.8"> <来源…>
#   来源项：clip|<frames>|起|止[|倍速[|裁切w:h:x:y[|不要的同期声 all/关键词]]]    img|秒|截图|cover/fit|in/out    ph|秒|一句话|副行   ；多项按顺序接起来
#   raw/<id>.* 存在时忽略来源项
seg() {
  local id=$1 s=$2 cap1=$3 cap2=$4 wm=$5 vo=$6; shift 6
  echo "$s" > "$B/meta/$id.dur"; echo "$vo" > "$B/meta/$id.vo"; : > "$B/meta/$id.sync"
  local src="$B/src/$id.mp4" out="$B/seg/$id.mp4"
  if [ -s "$out" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  local raw; raw=$(ls "$MAT/raw/$id".* 2>/dev/null | head -1 || true)
  if [ -n "$raw" ]; then echo "  > $id 实拍 $(basename "$raw")"; clipv "$raw" "$s" "$src"; wm=0
  else
    echo "  > ${id}：$*"; local parts=() i=0 it a b c d e p t=0
    for it in "$@"; do
      IFS='|' read -r a b c d e f g <<< "$it"; p="$B/src/$id.$i.mp4"
      case $a in
        clip) clip "$b" "$c" "$d" "${e:-1}" "$p" "$B/meta/$id.$i.sync" "${f:-}" "${g:-}"
              python3 -c "
for l in open('$B/meta/$id.$i.sync'): print(l.split('@')[0]+'@'+str(round(float(l.split('@')[1])+$t,2)))" >> "$B/meta/$id.sync"
              t=$(python3 -c "print($t+($d-$c)/${e:-1})") ;;
        img) still "$SHOTS/$c" "$b" "$p" "${d:-cover}" "${e:-in}"; t=$(python3 -c "print($t+$b)") ;;
        ph)  ph "$id" "$b" "$p" "$c" "${d:-}"; wm=0; t=$(python3 -c "print($t+$b)") ;;
      esac
      parts+=("$p"); i=$((i + 1))
    done
    if [ ${#parts[@]} -eq 1 ]; then fit "${parts[0]}" "$s" "$src"; else concatv "$src.cat.mp4" "${parts[@]}"; fit "$src.cat.mp4" "$s" "$src"; fi
  fi
  overlay "$src" "$id" "$cap1" "$cap2" "$wm" "$s"
}
# split <id> <秒> <字幕主行> <字幕副行> <旁白> <右半来源: clip|frames|起|止 或 img|截图>：左 = raw/B01（真人）或占位卡，右 = 游戏画面（各 960×1080）
split() {
  local id=$1 s=$2 cap1=$3 cap2=$4 vo=$5 rs=$6
  echo "$s" > "$B/meta/$id.dur"; echo "$vo" > "$B/meta/$id.vo"; : > "$B/meta/$id.sync"
  local src="$B/src/$id.mp4" out="$B/seg/$id.mp4" L="$B/src/$id.L.mp4" R="$B/src/$id.R.mp4" n wm=1
  if [ -s "$out" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  local raw; raw=$(ls "$MAT/raw/$id".* "$MAT/raw/B01".* 2>/dev/null | head -1 || true)
  if [ -n "$raw" ]; then echo "  > $id 实拍 $(basename "$raw") | 游戏"
    ffmpeg -y -v error -i "$raw" -vf "scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,fps=$FPS,tpad=stop_mode=clone:stop_duration=$s,format=yuv420p" -t "$s" "${ENC[@]}" "$L"
  else echo "  > $id 占位 | 游戏"
    png card "$B/cap/ph_$id.png" 960 1080 "明早实拍" "真人穿外骨骼原地踏步" "腰到脚特写 · 背景大屏|镜头 B01 · 放到 raw/B01.mov 重跑" - "#b176ff"
    ffmpeg -y -v error -loop 1 -framerate $FPS -i "$B/cap/ph_$id.png" -t "$s" -vf "format=yuv420p" "${ENC[@]}" "$L"
  fi
  local a b c d e; IFS='|' read -r a b c d e <<< "$rs"
  if [ "$a" = clip ]; then clip "$b" "$c" "$d" "${e:-1}" "$R.full.mp4" "$B/meta/$id.sync" "" all
    ffmpeg -y -v error -i "$R.full.mp4" -vf "scale=1920:1080,crop=960:1080:480:0,tpad=stop_mode=clone:stop_duration=$s" -t "$s" "${ENC[@]}" "$R"
  else n=$(python3 -c "print(int($s*$FPS))")
    ffmpeg -y -v error -loop 1 -framerate $FPS -i "$SHOTS/$b" -t "$s" -vf "scale=1920:2160:force_original_aspect_ratio=increase,crop=1920:2160,zoompan=z='1+0.08*on/$n':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=960x1080:fps=$FPS,format=yuv420p" "${ENC[@]}" "$R"
  fi
  ffmpeg -y -v error -i "$L" -i "$R" -filter_complex "[0:v][1:v]hstack" "${ENC[@]}" "$src"
  overlay "$src" "$id" "$cap1" "$cap2" "$wm" "$s"
}
# card_seg <id> <秒> <标题> <副题> <小行…> <qr|-> <旁白>
card_seg() {
  local id=$1 s=$2; echo "$s" > "$B/meta/$id.dur"; echo "$7" > "$B/meta/$id.vo"; : > "$B/meta/$id.sync"
  if [ -s "$B/seg/$id.mp4" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  echo "  > $id 卡片"; png card "$B/cap/$id.png" $W $H "$3" "$4" "$5" "$6" "#e8e5f5"; cardv "$B/cap/$id.png" "$s" "$B/src/$id.mp4"
  local fc="null"; [ "$(python3 -c "print(1 if $FADE>0 else 0)")" = 1 ] && fc="fade=t=in:d=$FADE,fade=t=out:st=$(python3 -c "print(max(0,$s-$FADE))"):d=$FADE"
  ffmpeg -y -v error -i "$B/src/$id.mp4" -vf "$fc" "${ENC[@]}" "$B/seg/$id.mp4"
}

# ---------- 拼接 + 混音 ----------
# final <出mp4> <id…>：按顺序拼接；旁白 / 同期声按镜头起点 + 偏移摆位；配乐按旁白起止包络闪避 −12 dB；风声垫底；loudnorm
final() {
  local out=$1; shift
  local lst="$B/${out##*/}.txt" t=0 k=0 in=() fc="" mix="" dur vo v name off ms sync spans=""
  : > "$lst"
  in=(-f concat -safe 0 -i "$lst")
  for id in "$@"; do
    echo "file '$B/seg/$id.mp4'" >> "$lst"
    dur=$(cat "$B/meta/$id.dur"); vo=$(cat "$B/meta/$id.vo"); sync=$(cat "$B/meta/$id.sync" 2>/dev/null || true)
    for v in $vo $sync; do
      name=${v%@*}; off=${v#*@}
      case $name in /*) ;; *) name="$MAT/vo/$name.wav" ;; esac
      [ -s "$name" ] || { echo "  ! 缺旁白 $name"; continue; }
      ms=$(python3 -c "print(int(($t+$off)*1000))"); k=$((k + 1))
      in+=(-i "$name"); fc="$fc[$k:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v$k];"; mix="$mix[v$k]"
      spans="$spans $(python3 -c "print('%.2f:%.2f' % ($t+$off, $t+$off+$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$name")))")"
    done
    t=$(python3 -c "print($t+$dur)")
  done
  local fo; fo=$(python3 -c "print(max(0,$t-1.5))")
  fc="${fc}${mix}amix=inputs=$k:normalize=0:dropout_transition=0,volume=1.0[voice];"
  # 配乐闪避：按每句旁白 / 同期声的起止（上面 spans）生成增益包络，说话时 −12 dB（×0.25），前后 0.25 s 斜坡；确定性的，比 sidechain 好核对
  local duck; duck=$(python3 - "$spans" <<'PYE'
import sys
r = 0.25; terms = []
for sp in sys.argv[1].split():
    a, b = sp.split(':'); terms.append(f"min(1,max(0,(t-{float(a)-r:.2f})/{r}))*min(1,max(0,({float(b)+r:.2f}-t)/{r}))")
e = terms[0] if len(terms) == 1 else terms[0]
for x in terms[1:]: e = f"max({e},{x})"
print(f"1-0.75*({e})" if terms else "1")
PYE
)
  local m=$((k + 1)); in+=(-i "$MUSIC")
  fc="${fc}[$m:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:$t,volume=0.55,afade=t=in:d=1.5,afade=t=out:st=$fo:d=1.5,volume='$duck':eval=frame[md];"
  fc="${fc}anoisesrc=c=brown:r=48000:a=0.5:d=$t,lowpass=f=320,volume=0.07,aformat=channel_layouts=stereo[wind];"
  fc="${fc}[md][voice][wind]amix=inputs=3:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.3,afade=t=out:st=$fo:d=1.5[a];[0:v]fade=t=in:d=0.5,fade=t=out:st=$fo:d=1.5[v]"
  ffmpeg -y -v error "${in[@]}" -filter_complex "$fc" -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 21 -maxrate 4M -bufsize 8M -pix_fmt yuv420p -r $FPS -c:a aac -b:a 160k -movflags +faststart -t "$t" "$out"
  cp "$out" "$ROOT/docs/提交/视频素材/$(basename "$out")"
  echo "  => $out  $(python3 -c "print(round($t,1))") s  $(du -h "$out" | cut -f1)"
}

# ---------- 镜头表（画面 / 字幕 / 旁白，见 docs/提交/演示视频-制作说明.md 分镜表；连拍时间窗见 build/shots.env） ----------
# shots.env 由 scripts/shot_windows.py 从 frames/*/events.jsonl 算出（直升机落地 / 牦牛 / 吸氧 / 横梯 / 刀脊 / 登顶各在连拍的第几秒）
[ -f "$B/shots.env" ] && . "$B/shots.env"
[ "$V" -ge 3 ] && [ -z "$LUMA" ] && LUMA=95
build_segs() {
  echo "== 片段（V=$V FADE=$FADE MI=${MI}）"
  png badge "$B/cap/tag.png" "峰哥 · AI 复刻音色 · 本人授权" tr
  png badge "$B/cap/wm.png"  "模拟外骨骼演示" br
  local T=${TAIL:-0}; [ "$V" -ge 3 ] || T=0
  # 口径（9/24 球球）：VR / 体感游戏只有视觉反馈；我们做登山走路的物理反馈——屏幕上的坡和台阶，真变成腿上的阻力和助力。前 10 s 和结尾都要说到。
  card_seg T00 2 "峰哥亡命天涯" "屏幕上的坡，真变成腿上的力" "消费级髋外骨骼 × 大模型蜂群 · 团队 PRX" - ""
  split S01 5 "VR 只有视觉反馈 · 我们做腿上的物理反馈" "消费级髋外骨骼 · 原地迈步 · 腿上爬珠峰" "00@0.2" "clip|lap|$(python3 -c "print(${T_WALK:-9}+0.7)")|$(python3 -c "print(${T_WALK:-9}+5.7)")"
  seg B05 5 "共驾：摇杆 → 队友的腿 · 满杆 2 Nm" "" 0 "1b1@0.3 1b2@2.6" "ph|5|共驾：一人推摇杆，队友穿外骨骼腿被推动|手柄和腿同框"
  seg B06 3 "穿戴 ≈ 30 s（实测回填）" "" 0 "1c@0.2" "ph|3|anni 帮评委穿戴，掐表|加速到 3 s"
  seg R02 5 "峰哥导游：进山先讲一段" "固定话术 · 峰哥克隆声 · 本人授权" 1 "" "clip|lap|${T_GUIDE:-1}|$(python3 -c "print(${T_GUIDE:-1}+5)")|1||先顺着"
  seg R03 7 "屏幕上的坡 → 腿上的助力 / 阻力" "珠峰北坡 · 大本营 5200 m · ShellOS 控制 Hypershell" 1 "02b@0.2" "clip|lap|${T_HELI:-14}|$(python3 -c "print(${T_HELI:-14}+7)")|1||牦牛"
  seg R04 4 "冰川上坡 · 牦牛让路 · 经幡猛风" "上坡 = 绿脉冲，有人在后面推" 1 "" "clip|${SUMMIT_DIR:-summit}|${Y_A:-1.5}|$(python3 -c "print(${Y_A:-1.5}+4)")"
  seg R05 7 "台阶 = 支撑期阻力脉冲 · 软限 4 Nm" "北坳吸氧：站定才放行" 1 "03@0.2" "clip|lap|${T_OXY:-30}|$(python3 -c "print(${T_OXY:-30}+7)")"
  seg R05b 4 "腿上的力 · 一步一个脉冲 · 摆动期为 0" "实时 Nm · 绿 = 上坡 · 黄 = 台阶 · 蓝 = 下坡" 0 "03b@0.2" "clip|lap|${T_PULSE:-${T_OXY:-30}}|$(python3 -c "print(${T_PULSE:-${T_OXY:-30}}+4)")|1|820:300:20:760"
  seg R06 2 "髋相位力矩脉冲 · 摆动期为 0 · 软限 4 Nm" "" 0 "" "img|2|脉冲-上台阶-阻力.png|fit|in"
  seg B02 3 "评委说：「太陡了」" "" 0 "05@0.3" "ph|3|评委对操作员说「太陡了」→ 摇到 MacBook|先拍说话的人 2 s，再摇到屏幕"
  seg R07 6.5 "教练 → 记忆员 → 安全员 → 生效" "强度 3.0 → 2.5 · 删卡 = 回退" 1 "06a@0.3 06b@3.9" "clip|dash|${D_A:-7}|$(python3 -c "print(${D_A:-7}+6.5)")"
  seg R07L 8 "教练 → 记忆员 → 安全员 → 生效" "强度 3.0 → 2.5 · 删卡 = 回退 · 恢复" 1 "06a@0.3 06c@3.9" "clip|dash|${D_A:-7}|$(python3 -c "print(${D_A:-7}+8)")"
  seg R13 3 "蜂群：教练 / 记忆员 / 安全员 / 地形导演" "旁白只说「大模型」· 模型名以时间线为准" 1 "06d@0.2" "img|3|仪表盘-蜂群.png|fit|in"
  seg R08 8 "一句话 → 大模型出路线 → 安全员裁剪" "台阶不过半 · 红灯 ≤ 2 · 起步平地" 1 "07a@0.3 07b@2.3 07c@5.8" "clip|forge|${F_A:-0}|$(python3 -c "print(${F_A:-0}+8)")"
  seg R08L 11 "一句话 → 大模型出路线 → 安全员裁剪" "台阶不过半 · 红灯 ≤ 2 · 起步平地 · 裁完马上能爬" 1 "07a@0.3 07b@2.3 07c@5.8 07d@8.2" "clip|forge|${F_A:-0}|$(python3 -c "print(${F_A:-0}+11)")"
  seg R11 4 "横梯 · 刀脊 · 横切：三段悬崖" "×2 · 松手 = 零力 · 掉下去 = 弹回来" 1 "" "clip|lap|${T_LAD:-40}|$(python3 -c "print(${T_LAD:-40}+8)")|2"
  seg R09 4 "×4 · 旁边的影子是上一位" "" 1 "08@0.3" "clip|lap|${T_RIDGE:-48}|$(python3 -c "print(${T_RIDGE:-48}+16)")|4"
  seg R09L 5 "×4 · 旁边的影子是上一位" "" 1 "08@0.3 08b@2.6" "clip|lap|${T_RIDGE:-48}|$(python3 -c "print(${T_RIDGE:-48}+20)")|4"
  seg B03 1.5 "峰哥本人 · 肖像与音色已授权" "" 0 "" "ph|1.5|峰哥本人在展位看大屏 / 一句原声|3–5 s，不愿出镜就拍背影"
  seg R10 $(python3 -c "print(6+$T)") "登顶 8848.86 m · 你是下一位的影子" "" 1 "g_summit@${S_G:-3.2}" "clip|${SUMMIT_DIR:-summit}|${S_A:-0}|$(python3 -c "print(${S_A:-0}+6+$T)")|1||all"
  seg X01 3 "跑酷 · 东京彩蛋 · 六座山" "" 1 "" "clip|parkour|1|2.5" "clip|tokyo|${K_A:-1}|$(python3 -c "print(${K_A:-1}+1.5)")"
  seg B04 3 "松手 = 零力 · 死人开关 · 看门狗" "" 0 "10@0.3" "ph|3|真人松开扳机 → 仪表盘灯灭|从手指松开开始拍 4 s"
  card_seg T99 6 "峰哥亡命天涯" "骗腿，不骗眼睛 · AI 出主意，硬代码说了算" "团队 PRX · $REPO_URL|峰哥 · AI 复刻音色（本人授权）· 软限 4 Nm · 死人开关 · 看门狗|配乐 Our Story Begins · Kevin MacLeod (incompetech.com) · CC BY 4.0" "$QR" "11b@0.2 11@3.2"
  rm -rf "$MAT/片段/字幕版" "$MAT/片段/干净版"; mkdir -p "$MAT/片段/字幕版" "$MAT/片段/干净版"
  cp "$B"/seg/*.mp4 "$MAT/片段/字幕版/"; for f in "$B"/src/[A-Z][0-9]*.mp4; do case $f in *.L.mp4|*.R.mp4|*.R.full.mp4|*.[0-9].mp4|*.cat.mp4) ;; *) cp "$f" "$MAT/片段/干净版/";; esac; done
}
# V ≥ 2：前 5 秒先给结果（S01 真人踏步 | 游戏在爬），片名卡放第二；V=1 片名卡开头
if [ "$V" -ge 2 ]; then
  V60=(S01 T00 R03 R05 R05b B02 R07 R08 R09 R10 B04 T99)
  V90=(S01 T00 B05 B06 R02 R03 R04 R05 R05b B02 R07L R08L R11 R09L B03 R10 X01 B04 T99)
else
  V60=(T00 S01 R03 R05 R05b B02 R07 R08 R09 R10 B04 T99)
  V90=(T00 S01 B05 B06 R02 R03 R04 R05 R05b B02 R07L R08L R11 R09L B03 R10 X01 B04 T99)
fi

case ${1:-all} in
  all) build_segs; echo "== 60 s"; final "$MAT/v${V}_60s.mp4" "${V60[@]}"; echo "== 90 s"; final "$MAT/v${V}_90s.mp4" "${V90[@]}" ;;
  60)  build_segs; final "$MAT/v${V}_60s.mp4" "${V60[@]}" ;;
  90)  build_segs; final "$MAT/v${V}_90s.mp4" "${V90[@]}" ;;
  segs) build_segs ;;
  lib) : ;;      # source scripts/cut_demo.sh lib：只加载函数（调试单个镜头）
  *) echo "用法：$0 [all|60|90|segs|clean]"; exit 1 ;;
esac
