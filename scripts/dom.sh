#!/bin/sh
# 无头 Chrome --dump-dom 自检游戏页：打印 data-ready、预算（当前视角绘制次数/三角形、全场景三角形/对象数）和 <pre id="errlog"> 里的报错。
# 用法：scripts/dom.sh "<url>" [等待毫秒：node 版 = 最长等待，缺省 60000；dump-dom 版 = 虚拟时间预算，缺省 8000]
# 例：  scripts/dom.sh "http://localhost:8801/game?preview=tokyo_night&pos=0"
# 退出码：0 = 就绪且无报错；1 = 没就绪或有报错；2 = Chrome 没输出。和 shot.sh 一样吃 CPU（swiftshader），展位机别跑。
URL="$1"; WAIT="${2:-8000}"
[ -n "$URL" ] || { echo "用法：$0 <url> [等待毫秒]" >&2; exit 2; }
# 有 node（≥22，自带 WebSocket）就走 DevTools 协议按真实时间等就绪（scripts/dom.mjs，可靠）；没有才退回 --dump-dom + 虚拟时间
if command -v node >/dev/null 2>&1; then exec node "$(dirname "$0")/dom.mjs" "$URL" "${2:-60000}"; fi
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# 虚拟时间预算有时在 glb 贴图解码时就用完了（页面停在「加载中」，errlog 也空）——这种情况自动重试，最多 3 次
for TRY in 1 2 3; do
  DOM=$("$C" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
    --window-size=1920,1080 --virtual-time-budget="$WAIT" --dump-dom "$URL" 2>/dev/null)
  printf '%s' "$DOM" | grep -q 'data-ready="1"' && break
  printf '%s' "$DOM" | grep -q '<pre id="errlog" hidden="">[^<]' && break
  [ "$TRY" -lt 3 ] && echo "（第 $TRY 次没等到就绪，重试）" >&2
done
[ -n "$DOM" ] || { echo "dom failed: $URL" >&2; exit 2; }
printf '%s' "$DOM" | python3 -c '
import html, re, sys
d = sys.stdin.read()
body = re.search(r"<body([^>]*)>", d)
attrs = dict(re.findall(r"data-([\w-]+)=\"([^\"]*)\"", body.group(1) if body else ""))
m = re.search(r"<pre id=\"errlog\" hidden[^>]*>(.*?)</pre>", d, re.S)
log = html.unescape(m.group(1)).strip() if m else "(页面里没有 errlog)"
ready = attrs.get("ready") == "1"
print("ready=%s  calls=%s  tris=%s  scene-tris=%s  scene-objs=%s" % (attrs.get("ready", "0"), attrs.get("calls", "?"), attrs.get("tris", "?"), attrs.get("scene-tris", "?"), attrs.get("scene-objs", "?")))
print("errlog:", log if log else "(空)")
sys.exit(0 if ready and not log else 1)
'
