#!/bin/bash
# 展位一键起全套（MacBook 上跑）：查串口 / 手柄 → 起 ShellOS 真机模式 → 等健康 → 起看门狗 → 开大屏 Chrome（/game 亭模式）+ 仪表盘窗口 → 打印绿灯清单
#   scripts/booth_up.sh                       # 真机：--ctl terrain --stepping --cap 4 --strength 3.0 --width 16 --http 8765
#   scripts/booth_up.sh --sim                 # 模拟外骨骼（排练）
#   scripts/booth_up.sh --cap 3 --strength 2.5 --http 8777 --no-chrome     # 其它参数原样透传给 shellos.main（如 --no-record）
#   scripts/booth_up.sh --chrome              # 只（重）开两个 Chrome 窗口
#   scripts/booth_up.sh --down                # 停：只停这个端口的 ShellOS + 看门狗 + 展位 Chrome，别的端口不碰
# 看门狗（booth_up 自己 nohup 起，日志 /tmp/booth-<端口>.watchdog.log）：每秒看进程 + /state；进程没了立刻、5 s 没响应就
# `booth_recover.sh shellos` 重起并恢复世界 + 穿戴者（每秒快照到 data/booth_<端口>.json）。影子在 ShellOS 内存里，重起会丢。
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8   # nohup / launchd 起时没 LANG：bash 3.2 会把 $VAR 后面的中文吃掉、pgrep 遇到带中文的进程命令行报 illegal byte sequence
PORT=8765 CAP=4 STRENGTH=3.0 SIM= CHROME=1 MODE=up EXTRA=
while [ $# -gt 0 ]; do
  case "$1" in
    --sim) SIM=--sim ;;
    --cap) CAP=$2; shift ;;
    --strength) STRENGTH=$2; shift ;;
    --http) PORT=$2; shift ;;
    --no-chrome) CHROME= ;;
    --down|--chrome|--watchdog) MODE=${1#--} ;;
    *) EXTRA="$EXTRA $1" ;;
  esac
  shift
done
RUN=/tmp/booth-$PORT                 # $RUN.args = 上次的 ShellOS 参数（run-mac.sh 写，重起沿用）；$RUN.watchdog.pid / .log
LAST=data/booth_$PORT.json           # 看门狗快照：世界 + 穿戴者
CHROME_DIR=$HOME/.booth-chrome-$PORT # 展位专用 Chrome 配置目录：亭模式 / 自动播放参数只对新进程生效，不碰你自己开着的 Chrome
PAT="shellos.main.*--http $PORT"
state() { curl -s --noproxy '*' -m 2 "127.0.0.1:$PORT/state"; }
up() { state | grep -q '"safety"'; }
log() { echo "[$(date +%T)] $*"; }

kill_chrome() {   # 旧窗口没死透就 open，同一配置目录会交给旧进程，亭模式参数不生效；实测机器忙时 SIGTERM 4 s 还没死
  pkill -f "$CHROME_DIR" 2>/dev/null
  for i in 1 2 3 4 5 6; do pgrep -f "$CHROME_DIR" >/dev/null || return 0; sleep 0.5; done; pkill -9 -f "$CHROME_DIR" 2>/dev/null
}

open_chrome() {
  [ -d "/Applications/Google Chrome.app" ] || { echo "没装 Google Chrome，手动开 http://localhost:$PORT/game"; return 1; }
  kill_chrome
  # BOOTH_CHROME_EXTRA：彩排在开发机上用 --headless=new（外面套 with_chrome.sh），展位不设
  open -na "Google Chrome" --args --user-data-dir="$CHROME_DIR/game" --no-first-run --autoplay-policy=no-user-gesture-required \
       $BOOTH_CHROME_EXTRA --kiosk "http://localhost:$PORT/game"
  sleep 1.5
  open -na "Google Chrome" --args --user-data-dir="$CHROME_DIR/dash" --no-first-run --autoplay-policy=no-user-gesture-required \
       $BOOTH_CHROME_EXTRA --new-window --window-size=1280,900 "http://localhost:$PORT/"
  echo "Chrome：大屏 /game（亭模式，退出按 Cmd+Q）+ 仪表盘 /（普通窗口，拖到操作台屏）"
}

snapshot() {   # /state → data/booth_<端口>.json，内容没变不写盘
  state | python3 -c '
import json, sys, time
d = json.load(sys.stdin); t = d.get("terrain") or {}
new = {"wearer": d.get("wearer"), "world": t.get("preset"), "ctl": d["ctl"]["name"]}
try: old = json.load(open(sys.argv[1]))
except Exception: old = {}
if {k: old.get(k) for k in new} != new:
    json.dump({**new, "t": time.time()}, open(sys.argv[1], "w"), ensure_ascii=False)' "$LAST" 2>/dev/null
}

case $MODE in
  watchdog)
    fails=0
    log "看门狗起：端口 ${PORT}，参数 $(cat $RUN.args 2>/dev/null)"
    while :; do
      why=
      if [ -n "$(find $RUN.starting -mtime -30s 2>/dev/null)" ]; then fails=0   # run-mac.sh 正在起（手动换参数 / 手动 recover），别抢；30 s 兜底防残留
      elif ! pgrep -f "$PAT" >/dev/null; then why="进程没了"
      elif up; then fails=0; snapshot
      else fails=$((fails + 1)); [ $fails -ge 5 ] && why="$fails s 没响应"; fi
      if [ -n "$why" ]; then
        log "$why → 重起"
        scripts/booth_recover.sh shellos --http "$PORT" 2>&1 | sed 's/^/    /'
        fails=0
      fi
      sleep 1
    done ;;
  chrome) open_chrome ;;
  down)
    [ -f $RUN.watchdog.pid ] && kill "$(cat $RUN.watchdog.pid)" 2>/dev/null; rm -f $RUN.watchdog.pid
    pkill -f "$PAT" 2>/dev/null; kill_chrome
    echo "已停：端口 $PORT 的 ShellOS + 看门狗 + 展位 Chrome" ;;
  up)
    echo "== 1/5 硬件 =="
    ports=$(ls /dev/cu.usbserial* /dev/cu.usbmodem* 2>/dev/null)
    [ -n "$ports" ] && echo "  串口：$ports" || echo "  串口：没看到 /dev/cu.usbserial*（真机模式会等它插上，插上自动连；排练用 --sim）"
    if ioreg -r -c IOHIDDevice -l 2>/dev/null | grep -qE '"Product" = "(DualSense|Wireless Controller)'; then echo "  手柄：在（DualSense）"
    else echo "  手柄：没看到 DualSense（按 PS 键 / 插 USB；没手柄也能起，起来后仪表盘看 pad）"; fi
    echo "== 2/5 起 ShellOS（$([ -n "$SIM" ] && echo 模拟 || echo 真机)，软限 $CAP Nm，强度 ${STRENGTH}，端口 ${PORT}）=="
    [ -f $RUN.watchdog.pid ] && kill "$(cat $RUN.watchdog.pid)" 2>/dev/null   # 先停旧看门狗：否则它看到旧进程被 run-mac.sh 停掉，会按旧参数抢着重起
    ./run-mac.sh --ctl terrain --stepping --cap $CAP --strength $STRENGTH --width 16 --http $PORT $SIM$EXTRA
    for i in $(seq 30); do up && break; sleep 1; done
    up || { echo "ShellOS 30 s 没起来，看日志：tr '\\r' '\\n' < /tmp/shellos$([ "$PORT" = 8765 ] || echo -$PORT).log | tail -20"; exit 1; }
    echo "== 3/5 看门狗 =="
    nohup bash scripts/booth_up.sh --watchdog --http "$PORT" > $RUN.watchdog.log 2>&1 &
    echo $! > $RUN.watchdog.pid
    echo "  pid $(cat $RUN.watchdog.pid)，日志 $RUN.watchdog.log"
    echo "== 4/5 Chrome =="
    [ -n "$CHROME" ] && open_chrome || echo "  跳过（--no-chrome）"
    echo "== 5/5 绿灯清单 =="
    scripts/booth_check.sh --http "$PORT" $([ -z "$CHROME" ] && echo --skip chrome) ;;
esac
