#!/bin/sh
# 无头 Chrome 截图（支持 WebGL）：scripts/shot.sh <url> <out.png> [宽 高] [等待毫秒]
# 例：scripts/shot.sh "http://localhost:8801/game?preview=taishan_18pan&pos=20" /tmp/tai.png 1920 1080 6000
# 宽 < 500：无头 Chrome 窗口最窄约 500，直接拍会按 ~490 排版再裁掉右边。这里改成把页面放进一个
#   宽 W 的 iframe、居中摆在 500 宽窗口里拍，再用 sips 从中间裁回 W×H——排版宽度就是真的 W。
# ⚠ swiftshader 软件渲染约吃 200% CPU，连拍时主循环 loop_ms 冲到 300 ms 以上。展位机、有人穿着时别跑。
URL="$1"; OUT="$2"; W="${3:-1920}"; H="${4:-1080}"; WAIT="${5:-6000}"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WW="$W"; SRC="$URL"; TMP=""
if [ "$W" -lt 500 ]; then
  WW=500
  TMP="${TMPDIR:-/tmp}/shot-$$.html"
  L=$(( (500 - W) / 2 ))
  printf '<!doctype html><html><body style="margin:0;background:#000"><iframe src="%s" style="position:absolute;left:%spx;top:0;width:%spx;height:%spx;border:0"></iframe></body></html>' \
    "$URL" "$L" "$W" "$H" > "$TMP"
  SRC="file://$TMP"
fi
"$C" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size="$WW,$H" --virtual-time-budget="$WAIT" --screenshot="$OUT" "$SRC" >/dev/null 2>&1
[ -n "$TMP" ] && rm -f "$TMP" && [ -s "$OUT" ] && sips -c "$H" "$W" "$OUT" >/dev/null 2>&1
[ -s "$OUT" ] && echo "$OUT" || { echo "shot failed: $URL" >&2; exit 1; }
