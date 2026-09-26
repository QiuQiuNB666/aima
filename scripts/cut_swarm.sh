#!/bin/bash
# 工作流拆解视频（约 4 分 46 秒，1080p30 H.264 + AAC）：球球怎么同时指挥二十条 Claude Code 线（总指挥 + 线 + 指挥板），对照 EvoMap / Hermes Agent。
# 说明 / 数字口径 / 分镜 / 旁白全文：docs/蜂群-拆解.md。
#   scripts/cut_swarm.sh              # → $MAT/swarm_breakdown.mp4（约 18 MB）+ _720p.mp4，同时拷到 docs/提交/视频素材/
#   ONLY="W05 W06" scripts/cut_swarm.sh   # 只重录这几个片段的画面（其余沿用上次），再拼接混音
# 画面：scripts/video_tools/wf/（index.html + lib.js + theme.css + 每个场景一个 s_*.js），rec_seek.mjs 逐帧调 seek(t) 录 30 fps；
#       字幕也由场景页画（lib.js），不再叠 PNG。片段表：wf/segments.txt（片段 | 场景 | 章节 | 旁白）。
#       动画数据由 workflow_data.py 从 $MAT/workflow_data/（会话记录、git、token 挖出来的数据集，不进 git）生成。
# 旁白：文档第 7 节表格 → brain/tts.py（127.0.0.1:8791），MiniMax 预设 presenter_male，语速 1.1。
# 配乐：Meditation Impromptu 02（Kevin MacLeod，CC BY 4.0，见 docs/提交/素材授权.md）；比片子短，接缝处交叉淡化 6 s 再垫底。
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/cut_demo.sh" lib
export WIND=${WIND:-0} MUSICVOL=${MUSICVOL:-0.8}      # 钢琴曲本身 −23 LUFS，比原配乐轻 5 dB；旁白处 final() 再压 −12 dB
OUT=$MAT/swarm_breakdown.mp4
S=$B/wf; mkdir -p "$S"
WFD=$ROOT/scripts/video_tools/wf
DATA=${DATA:-$MAT/workflow_data}
CHROME=${CHROME:-/private/tmp/claude-502/-Users-qiu----/c4d962c4-a058-4292-a7ea-7fb7af599db1/scratchpad/with_chrome.sh}
[ -x "$CHROME" ] || CHROME=""
at() { python3 -c "print(round($1,3))"; }

# ---------- 1. 旁白 ----------
echo "== 旁白"
python3 "$ROOT/scripts/video_tools/swarm_png.py" lines "$ROOT/docs/蜂群-拆解.md" "$S/lines.tsv"
while IFS=$'\t' read -r id who text; do
  f=$MAT/vo/$id.wav; [ -s "$f" ] && continue
  body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "voice": {"voice_id": "presenter_male", "speed": 1.1}}))' "$text")
  h=$(curl -s --noproxy '*' -m 90 -D - -X POST "$TTS/tts" -H 'Content-Type: application/json' --data "$body" -o "$f.tmp" | tr -d '\r')
  if grep -qi 'no-store' <<< "$h" || [ ! -s "$f.tmp" ]; then echo "  ! $id 合成失败 / say 兜底，没存"; rm -f "$f.tmp"; exit 1; fi
  mv "$f.tmp" "$f"; echo "  + $id $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f") s"
done < "$S/lines.tsv"

# ---------- 2. 节拍 + 动画数据 ----------
echo "== 节拍 / 动画数据"
python3 "$WFD/segs.py" "$WFD/segments.txt" "$MAT/vo" "$S/segs.json"
python3 "$ROOT/scripts/video_tools/workflow_data.py" "$DATA" "$ROOT/docs/指挥板.md" "$S/segs.json" "$S/lines.tsv" "$WFD/data.js"

# ---------- 3. 片段：场景逐帧录 → mp4（淡入淡出），旁白偏移写进 meta 给 final；3 个片段并行（= 全机 Chrome 信号量上限） ----------
echo "== 片段"
IDS=(); JOBS=()
rec_one() {   # rec_one <片段> <场景> <秒>
  local id=$1 scene=$2 d=$3 fr=$S/frames/$1; rm -rf "$fr"
  $CHROME node "$ROOT/scripts/video_tools/rec_seek.mjs" "file://$WFD/index.html?scene=$scene&id=$id" "$fr" "$d" 30 | sed "s/^/  $id /"
  ffmpeg -y -v error -framerate 30 -i "$fr/f%05d.jpg" -vf "fade=t=in:d=$FADE:c=0xF1F1EC,fade=t=out:st=$(at "max(0,$d-$FADE)"):d=$FADE:c=0xF1F1EC,format=yuv420p" -t "$d" "${ENC[@]}" "$B/seg/$id.mp4"
  rm -rf "$fr"; echo "  > $id $d s"
}
while IFS='|' read -r id scene chap vos; do
  case $id in ''|\#*) continue ;; esac
  IDS+=("$id")
  d=$(python3 -c "import json; print(json.load(open('$S/segs.json'))['$id']['_dur'])")
  echo "$d" > "$B/meta/$id.dur"; : > "$B/meta/$id.sync"
  python3 -c "
import json; s = json.load(open('$S/segs.json'))['$id']
print(' '.join(f'{k}@{v[0]}' for k, v in s.items() if not k.startswith('_')))" > "$B/meta/$id.vo"
  if [ -n "${ONLY:-}" ] && ! grep -qw "$id" <<< "$ONLY" && [ -s "$B/seg/$id.mp4" ]; then echo "  = $id（沿用）"; continue; fi
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-3}" ]; do sleep 1; done
  rec_one "$id" "$scene" "$d" < /dev/null & JOBS+=($!)
done < "$WFD/segments.txt"
for j in "${JOBS[@]}"; do wait "$j" || { echo "  ! 有片段没录成"; exit 1; }; done

# ---------- 4. 配乐垫底：接缝交叉淡化，长度够整片 ----------
PIANO=$MAT/music/Meditation\ Impromptu\ 02.mp3
ffmpeg -y -v error -i "$PIANO" -i "$PIANO" -filter_complex "[0:a][1:a]acrossfade=d=6:c1=tri:c2=tri" -ar 48000 "$S/music_bed.wav"
export MUSIC=$S/music_bed.wav

echo "== 拼接 + 混音"
final "$OUT" "${IDS[@]}"
ffmpeg -y -v error -i "$OUT" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 23 -maxrate 2M -bufsize 4M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${OUT%.mp4}_720p.mp4"
cp "${OUT%.mp4}_720p.mp4" "$ROOT/docs/提交/视频素材/"
# 这种纸面动画压缩率很高，1080p 成片本身约 18 MB，已经小于 20 MB，不另出分享版
for f in "$OUT" "${OUT%.mp4}_720p.mp4"; do echo "$f $(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f")"; done
