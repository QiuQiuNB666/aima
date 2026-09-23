#!/bin/bash
# V2 演示视频粗剪：素材 → v0_60s.mp4 / v0_90s.mp4（1920×1080、30 fps、H.264、≤ 50 MB）。只用 ffmpeg + 系统 python3（PIL 出字幕 PNG；这台机器的 ffmpeg 没编 drawtext）。
#
#   scripts/cut_demo.sh            # 全部：建片段 → 60 s → 90 s
#   scripts/cut_demo.sh 60 | 90    # 只出一版（片段已建的直接复用）
#   scripts/cut_demo.sh clean      # 删掉 build/ 重来
#   MAT=<素材根> scripts/cut_demo.sh   # 缺省 ~/黑客松-EvoTavern/视频素材（视频不进 git，仓库只放 docs/提交/视频素材/README.md）
#
# 每个镜头 id 的画面来源，按优先级：
#   1. $MAT/raw/<id>.{mov,mp4}   明早手机实拍（B01–B06）——丢进去重跑即可，占位卡自动消失
#   2. $MAT/seg/<id>.mp4         无头 Chrome 渲的游戏片段（scratchpad/rec.mjs 抓帧 → ffmpeg 合成）
#   3. docs/提交/截图 里的静帧做 Ken Burns（今晚的兜底；水印「模拟外骨骼演示」）
#   4. 占位卡（黑底白字「明早实拍：…」）
# 旁白：$MAT/vo/<id>.wav（峰哥克隆声，brain/tts.py 合成；见 docs/提交/演示视频-制作说明.md）。
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MAT=${MAT:-$HOME/黑客松-EvoTavern/视频素材}
SHOTS=$ROOT/docs/提交/截图
QR=$ROOT/docs/提交/海报A4/wx_qr.jpg
B=$MAT/build
W=1920; H=1080; FPS=30
ENC=(-c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -r $FPS -an)
REPO_URL="github.com/QiuQiuNB666/aima"

[ "${1:-}" = clean ] && { rm -rf "$B"; echo "已清 $B"; exit 0; }
mkdir -p "$B/cap" "$B/src" "$B/seg" "$B/meta" "$MAT/raw" "$MAT/seg" "$MAT/vo" "$MAT/片段"

# ---------- 字幕 / 卡片 PNG（PIL + 系统 PingFang SC） ----------
cat > "$B/png.py" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
F = '/System/Library/Fonts/PingFang.ttc'          # index 2 = SC Regular, 5 = SC Medium, 8 = SC Semibold
def font(sz, idx=8): return ImageFont.truetype(F, sz, index=idx)
def center(d, y, text, f, fill, W, stroke=0):
    bb = d.textbbox((0, 0), text, font=f); tw = bb[2] - bb[0]
    d.text(((W - tw) // 2 - bb[0], y - bb[1]), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    return bb[3] - bb[1]
kind, out, *a = sys.argv[1:]
if kind == 'cap':                                  # cap <out> <主行> [副行]：底部居中黑条白字，透明底 1920×1080
    W, H = 1920, 1080; im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    main, sub = a[0], (a[1] if len(a) > 1 else '')
    if main:
        f = font(52); bb = d.textbbox((0, 0), main, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        y = H - 72 - th - (52 if sub else 0); x = (W - tw) // 2
        d.rounded_rectangle((x - 34, y - 16, x + tw + 34, y + th + 18), radius=12, fill=(0, 0, 0, 190))
        d.text((x - bb[0], y - bb[1]), main, font=f, fill=(255, 255, 255, 255))
        if sub: center(d, y + th + 30, sub, font(32, 5), (255, 214, 107, 255), W, stroke=2)
    im.save(out)
elif kind == 'badge':                              # badge <out> <文字> <tr|br>：角标，透明底
    W, H = 1920, 1080; im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    text, pos = a[0], a[1]; f = font(26, 5); bb = d.textbbox((0, 0), text, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = W - 24 - tw - 28; y = 24 if pos == 'tr' else H - 24 - th - 20
    d.rounded_rectangle((x, y, x + tw + 28, y + th + 20), radius=8, fill=(0, 0, 0, 150))
    d.text((x + 14 - bb[0], y + 10 - bb[1]), text, font=f, fill=(255, 255, 255, 230))
    im.save(out)
elif kind == 'card':                               # card <out> <W> <H> <标题> <副题> <小行1|小行2|…> <qr路径或-> <标题色>
    W, H = int(a[0]), int(a[1]); title, sub, lines, qr, col = a[2], a[3], [s for s in a[4].split('|') if s], a[5], a[6]
    im = Image.new('RGB', (W, H), (8, 10, 14)); d = ImageDraw.Draw(im)
    big = font(min(104, W // 9)); small = font(min(46, W // 22), 5); tiny = font(min(30, W // 34), 2)
    hs = [d.textbbox((0, 0), title, font=big)[3]] + ([d.textbbox((0, 0), sub, font=small)[3]] if sub else []) + [d.textbbox((0, 0), l, font=tiny)[3] for l in lines]
    gap = 28; total = sum(hs) + gap * (len(hs) - 1) + (36 if sub else 0)
    qh = 0
    if qr != '-':
        q = Image.open(qr).convert('RGB'); qs = min(260, H // 4); q = q.resize((qs, qs)); qh = qs + 60
    y = (H - total - qh) // 2
    y += center(d, y, title, big, col, W) + gap + (36 if sub else 0)
    if sub: y += center(d, y, sub, small, (255, 255, 255), W) + gap
    for l in lines: y += center(d, y, l, tiny, (170, 178, 190), W) + gap
    if qr != '-':
        im.paste(q, ((W - qs) // 2, y + 20)); center(d, y + 20 + qs + 12, '扫码进群 · 群码 9/30 前有效', tiny, (170, 178, 190), W)
    im.save(out)
PY
png() { python3 "$B/png.py" "$@"; }

# ---------- 片段生产 ----------
# still <图> <秒> <出> [cover|fit] [in|out]：静帧 Ken Burns（先放大到 4K 再 zoompan，不抖）
still() {
  local img=$1 s=$2 out=$3 mode=${4:-cover} dir=${5:-in} n pre z
  n=$(python3 -c "print(int($s*$FPS))")
  if [ "$mode" = fit ]; then pre="scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=#080a0e"; else pre="scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160"; fi
  if [ "$dir" = in ]; then z="1+0.08*on/$n"; else z="1.08-0.08*on/$n"; fi
  ffmpeg -y -v error -loop 1 -framerate $FPS -i "$img" -t "$s" -vf "$pre,zoompan=z='$z':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=$FPS,format=yuv420p" "${ENC[@]}" "$out"
}
# cardv <png> <秒> <出>：静态卡
cardv() { ffmpeg -y -v error -loop 1 -framerate $FPS -i "$1" -t "$2" -vf "scale=$W:$H,format=yuv420p" "${ENC[@]}" "$3"; }
# clipv <源视频> <秒> <出> [倍速]：实拍 / 渲染片段统一成 1080p30，不够长就定格补
clipv() {
  local sp=${4:-1}
  ffmpeg -y -v error -i "$1" -vf "setpts=PTS/$sp,scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,fps=$FPS,tpad=stop_mode=clone:stop_duration=$2,format=yuv420p" -t "$2" "${ENC[@]}" "$3"
}
concatv() { local out=$1 lst; shift; lst=$out.txt; : > "$lst"; for f in "$@"; do echo "file '$f'" >> "$lst"; done; ffmpeg -y -v error -f concat -safe 0 -i "$lst" -c copy "$out"; }
# ph <id> <秒> <出> <一句话> [副行]：占位卡（明早实拍替换）
ph() { png card "$B/cap/ph_$1.png" $W $H "明早实拍" "$4" "${5:-}|镜头 $1 · 拍好放到 $MAT/raw/$1.mov 重跑 scripts/cut_demo.sh" - "#ffd66b"; cardv "$B/cap/ph_$1.png" "$2" "$3"; }

# seg <id> <秒> <字幕主行> <字幕副行> <水印0/1> <旁白:"01@0.3 g_oxy@2.8"> <来源…>
#   来源项：img|秒|文件名(截图目录里)|cover/fit|in/out    ph|秒|一句话|副行    ；多项按顺序接起来
#   raw/<id>.* 或 seg/<id>.mp4 存在时忽略来源项
seg() {
  local id=$1 s=$2 cap1=$3 cap2=$4 wm=$5 vo=$6; shift 6
  echo "$s" > "$B/meta/$id.dur"; echo "$vo" > "$B/meta/$id.vo"
  local src="$B/src/$id.mp4" out="$B/seg/$id.mp4"
  if [ -s "$out" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  local raw; raw=$(ls "$MAT/raw/$id".* 2>/dev/null | head -1 || true)
  if [ -n "$raw" ]; then echo "  > $id 实拍 $(basename "$raw")"; clipv "$raw" "$s" "$src"; wm=0
  elif [ -s "$MAT/seg/$id.mp4" ]; then echo "  > $id 渲染片段"; clipv "$MAT/seg/$id.mp4" "$s" "$src"
  else
    echo "  > $id 兜底：$*"; local parts=() i=0 it a b c d e
    for it in "$@"; do
      IFS='|' read -r a b c d e <<< "$it"; local p="$B/src/$id.$i.mp4"
      case $a in
        img) still "$SHOTS/$c" "$b" "$p" "${d:-cover}" "${e:-in}" ;;
        ph)  ph "$id" "$b" "$p" "$c" "${d:-}"; wm=0 ;;
      esac
      parts+=("$p"); i=$((i + 1))
    done
    if [ ${#parts[@]} -eq 1 ]; then mv "${parts[0]}" "$src"; else concatv "$src" "${parts[@]}"; fi
  fi
  png cap "$B/cap/c_$id.png" "$cap1" "$cap2"
  local fc="[0:v][1:v]overlay=0:0[a];[a][2:v]overlay=0:0[b]" in=(-i "$src" -i "$B/cap/c_$id.png" -i "$B/cap/tag.png") last=b
  if [ "$wm" = 1 ]; then in+=(-i "$B/cap/wm.png"); fc="$fc;[b][3:v]overlay=0:0[c]"; last=c; fi
  ffmpeg -y -v error "${in[@]}" -filter_complex "$fc" -map "[$last]" "${ENC[@]}" "$out"
}
# split <id> <秒> <字幕主行> <字幕副行> <旁白> <右半静帧>：左 = raw/<id>（真人）或占位卡，右 = 游戏画面（半屏各 960×1080）
split() {
  local id=$1 s=$2 cap1=$3 cap2=$4 vo=$5 img=$6
  echo "$s" > "$B/meta/$id.dur"; echo "$vo" > "$B/meta/$id.vo"
  local src="$B/src/$id.mp4" out="$B/seg/$id.mp4" L="$B/src/$id.L.mp4" R="$B/src/$id.R.mp4" n wm=0
  if [ -s "$out" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  local raw; raw=$(ls "$MAT/raw/$id".* "$MAT/raw/B01".* 2>/dev/null | head -1 || true)     # 左半屏 = 实拍清单里的 B01
  if [ -n "$raw" ]; then echo "  > $id 实拍 $(basename "$raw") | 游戏"
    ffmpeg -y -v error -i "$raw" -vf "scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,fps=$FPS,tpad=stop_mode=clone:stop_duration=$s,format=yuv420p" -t "$s" "${ENC[@]}" "$L"
  else echo "  > $id 占位 | 游戏"
    png card "$B/cap/ph_$id.png" 960 1080 "明早实拍" "真人穿外骨骼原地踏步" "腰到脚特写 · 背景大屏|镜头 B01 · 放到 raw/B01.mov 重跑" - "#ffd66b"
    ffmpeg -y -v error -loop 1 -framerate $FPS -i "$B/cap/ph_$id.png" -t "$s" -vf "format=yuv420p" "${ENC[@]}" "$L"
  fi
  n=$(python3 -c "print(int($s*$FPS))")
  ffmpeg -y -v error -loop 1 -framerate $FPS -i "$SHOTS/$img" -t "$s" -vf "scale=1920:2160:force_original_aspect_ratio=increase,crop=1920:2160,zoompan=z='1+0.08*on/$n':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=960x1080:fps=$FPS,format=yuv420p" "${ENC[@]}" "$R"
  ffmpeg -y -v error -i "$L" -i "$R" -filter_complex "[0:v][1:v]hstack" "${ENC[@]}" "$src"
  png cap "$B/cap/c_$id.png" "$cap1" "$cap2"
  ffmpeg -y -v error -i "$src" -i "$B/cap/c_$id.png" -i "$B/cap/tag.png" -i "$B/cap/wm.png" -filter_complex "[0:v][1:v]overlay[a];[a][2:v]overlay[b];[b][3:v]overlay=0:0" "${ENC[@]}" "$out"
}
# card_seg <id> <秒> <标题> <副题> <小行…> <qr|-> <旁白>
card_seg() {
  local id=$1 s=$2; echo "$s" > "$B/meta/$id.dur"; echo "$7" > "$B/meta/$id.vo"
  if [ -s "$B/seg/$id.mp4" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  echo "  > $id 卡片"; png card "$B/cap/$id.png" $W $H "$3" "$4" "$5" "$6" "#ffffff"; cardv "$B/cap/$id.png" "$s" "$B/seg/$id.mp4"
}

# ---------- 拼接 + 混音 ----------
# final <出mp4> <id…>：按顺序硬切拼接；旁白按镜头起点 + 偏移摆位；合成风声垫底；首尾淡入淡出；loudnorm
final() {
  local out=$1; shift
  local lst="$B/${out##*/}.txt" t=0 k=0 in=() fc="" mix="" dur vo v name off ms
  : > "$lst"
  in=(-f concat -safe 0 -i "$lst")
  for id in "$@"; do
    echo "file '$B/seg/$id.mp4'" >> "$lst"
    dur=$(cat "$B/meta/$id.dur"); vo=$(cat "$B/meta/$id.vo")
    for v in $vo; do
      name=${v%@*}; off=${v#*@}
      [ -s "$MAT/vo/$name.wav" ] || { echo "  ! 缺旁白 $MAT/vo/$name.wav"; continue; }
      ms=$(python3 -c "print(int(($t+$off)*1000))"); k=$((k + 1))
      in+=(-i "$MAT/vo/$name.wav"); fc="$fc[$k:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=1.0[v$k];"; mix="$mix[v$k]"
    done
    t=$(python3 -c "print($t+$dur)")
  done
  local fo; fo=$(python3 -c "print(max(0,$t-1.0))")
  fc="${fc}anoisesrc=c=brown:r=48000:a=0.5:d=$t,lowpass=f=320,volume=0.10,aformat=channel_layouts=stereo[wind];[wind]$mix amix=inputs=$((k + 1)):normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.5,afade=t=out:st=$fo:d=1[a];[0:v]fade=t=in:d=0.5,fade=t=out:st=$fo:d=1[v]"
  ffmpeg -y -v error "${in[@]}" -filter_complex "$fc" -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 21 -maxrate 4M -bufsize 8M -pix_fmt yuv420p -r $FPS -c:a aac -b:a 160k -movflags +faststart -t "$t" "$out"
  echo "  => $out  $(python3 -c "print(round($t,1))") s  $(du -h "$out" | cut -f1)"
}

# ---------- 镜头表（画面 / 字幕 / 旁白，见 docs/提交/演示视频-制作说明.md 分镜表） ----------
build_segs() {
  echo "== 片段"
  png badge "$B/cap/tag.png" "峰哥 · AI 复刻音色 · 本人授权" tr
  png badge "$B/cap/wm.png"  "模拟外骨骼演示" br
  card_seg T00 2 "峰哥亡命天涯" "原地迈步，腿上爬珠峰" "消费级髋外骨骼 × 大模型蜂群 · 团队 PRX" - ""
  split S01 5 "原地迈步，腿上爬珠峰" "消费级髋外骨骼 · 可走动" "01@0.3" map_interact_everest_flags.png
  seg B05 6 "共驾：摇杆 → 队友的腿 · 满杆 2 Nm" "" 0 "1b1@0.3 1b2@3.0" "ph|6|共驾：一人推摇杆，队友穿外骨骼腿被推动|手柄和腿同框"
  seg B06 4 "穿戴 ≈ 30 s（实测回填）" "" 0 "1c@0.3" "ph|4|anni 帮评委穿戴，掐表|加速到 4 s"
  seg R03 6 "珠峰北坡 · 大本营 5200 m" "ShellOS 控制 Hypershell" 1 "02@0.5" "img|3|everest_bc.png|cover|in" "img|3|everest_live_heli_land.png|cover|out"
  seg R04 4 "冰川上坡 · 牦牛让路 · 经幡猛风" "" 1 "g_yak@0.3" "img|2|everest_r04_yak_yield_live.jpg|cover|in" "img|2|everest_live_yaks.png|cover|out"
  seg R05 6 "上台阶：支撑期阻力脉冲 · 软限 4 Nm" "北坳吸氧：站定才放行" 1 "03@0.2 g_oxy@2.8" "img|3|everest_ladder.png|cover|in" "img|3|map_interact_everest_oxygen.png|cover|out"
  seg R06 2 "髋相位力矩脉冲 · 摆动期为 0 · 软限 4 Nm" "" 0 "" "img|2|脉冲-上台阶-阻力.png|fit|in"
  seg B02 4 "评委说：「太陡了」" "" 0 "05@0.3" "ph|4|评委对操作员说「太陡了」→ 摇到 MacBook|先拍说话的人 2 s，再摇到屏幕"
  seg R07 7 "教练 → 记忆员 → 安全员 → 生效" "强度 3.0 → 2.5 · 删卡 = 回退" 1 "06a@0.3 06b@4.0" "img|4|ui_ai_card.png|cover|in" "img|3|游戏-AI决策卡-软限4.jpg|cover|out"
  seg R07L 9 "教练 → 记忆员 → 安全员 → 生效" "强度 3.0 → 2.5 · 删卡 = 回退 · 恢复" 1 "06a@0.3 06c@4.2" "img|4|ui_ai_card.png|cover|in" "img|3|游戏-AI决策卡-软限4.jpg|cover|out" "img|2|AI决策卡-软限4.png|fit|in"
  seg R13 4 "蜂群：教练 / 记忆员 / 安全员 / 地形导演" "旁白只说「大模型」· 模型名以时间线为准" 1 "06d@0.3" "img|4|仪表盘-蜂群.png|fit|in"
  seg R08 10 "一句话 → 大模型出路线 → 安全员裁剪" "台阶不过半 · 红灯 ≤ 2 · 起步平地" 1 "07a@0.3 07b@3.5 07c@6.8" "img|2.5|选山-造山.jpg|fit|in" "img|2.5|ui_forge_wait.png|cover|in" "img|2.5|ui_forge_reveal.png|cover|out" "img|2.5|游戏-现场造山.jpg|cover|in"
  seg R08L 13 "一句话 → 大模型出路线 → 安全员裁剪" "台阶不过半 · 红灯 ≤ 2 · 起步平地 · 裁完马上能爬" 1 "07a@0.3 07b@3.5 07c@6.8 07d@10.2" "img|3.25|选山-造山.jpg|fit|in" "img|3.25|ui_forge_wait.png|cover|in" "img|3.25|ui_forge_reveal.png|cover|out" "img|3.25|游戏-现场造山.jpg|cover|in"
  seg R09 4.5 "×4 · 旁边的影子是上一位" "" 1 "08@0.3" "img|4.5|everest_r08_ridge_wind.jpg|cover|in"
  seg R09L 5.5 "×4 · 旁边的影子是上一位" "" 1 "08@0.3 08b@2.8" "img|5.5|everest_r08_ridge_wind.jpg|cover|in"
  seg B03 1.5 "峰哥本人 · 肖像与音色已授权" "" 0 "" "ph|1.5|峰哥本人在展位看大屏 / 一句原声|3–5 s，不愿出镜就拍背影"
  seg R10 6 "登顶 8848.86 m · 你是下一位的影子" "" 1 "g_summit@0.5" "img|3|everest_summit_front.png|cover|in" "img|3|everest_summit.png|cover|out"
  seg X01 4 "跑酷 · 东京彩蛋 · 六座山" "" 1 "" "img|2|parkour_02_jump.png|cover|in" "img|2|游戏-东京天桥-峰哥v2.jpg|cover|out"
  seg B04 3 "松手 = 零力 · 死人开关 · 看门狗" "" 0 "10@0.3" "ph|3|真人松开扳机 → 仪表盘灯灭|从手指松开开始拍 4 s"
  card_seg T99 4 "峰哥亡命天涯" "AI 出主意，硬代码说了算" "团队 PRX · $REPO_URL|峰哥 · AI 复刻音色（本人授权）· 软限 4 Nm · 死人开关 · 看门狗" "$QR" "11@0.3"
  rm -rf "$MAT/片段/字幕版" "$MAT/片段/干净版"; mkdir -p "$MAT/片段/字幕版" "$MAT/片段/干净版"
  cp "$B"/seg/*.mp4 "$MAT/片段/字幕版/"; for f in "$B"/src/[A-Z][0-9]*.mp4; do case $f in *.L.mp4|*.R.mp4|*.[0-9].mp4) ;; *) cp "$f" "$MAT/片段/干净版/";; esac; done
}
V60=(T00 S01 R03 R05 R06 B02 R07 R08 R09 B03 R10 B04 T99)
V90=(T00 S01 B05 B06 R03 R04 R05 R06 B02 R07L R13 R08L R09L B03 R10 X01 B04 T99)

case ${1:-all} in
  all) build_segs; echo "== 60 s"; final "$MAT/v0_60s.mp4" "${V60[@]}"; echo "== 90 s"; final "$MAT/v0_90s.mp4" "${V90[@]}" ;;
  60)  build_segs; final "$MAT/v0_60s.mp4" "${V60[@]}" ;;
  90)  build_segs; final "$MAT/v0_90s.mp4" "${V90[@]}" ;;
  segs) build_segs ;;
  *) echo "用法：$0 [all|60|90|segs|clean]"; exit 1 ;;
esac
