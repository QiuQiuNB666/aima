#!/bin/sh
# 无头 Chrome 截图（支持 WebGL）：scripts/shot.sh <url> <out.png> [宽 高] [等待毫秒]
# 例：scripts/shot.sh "http://localhost:8801/game?preview=taishan_18pan&pos=20" /tmp/tai.png 1920 1080 6000
URL="$1"; OUT="$2"; W="${3:-1920}"; H="${4:-1080}"; WAIT="${5:-6000}"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size="$W,$H" --virtual-time-budget="$WAIT" --screenshot="$OUT" "$URL" >/dev/null 2>&1
[ -s "$OUT" ] && echo "$OUT" || { echo "shot failed: $URL" >&2; exit 1; }
