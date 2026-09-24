#!/bin/bash
# 按症状恢复（目标 30 s 内），MacBook 上跑：
#   scripts/booth_recover.sh exo       外骨骼没帧：提示重新上电，等串口自动重连 + 自动重新 ENABLE
#   scripts/booth_recover.sh pad       手柄断：提示按 PS 键，等 pygame 重新认到
#   scripts/booth_recover.sh brain     大脑断：先查底层端口，给开发机重起隧道的命令；确认 ShellOS 已自动降级
#   scripts/booth_recover.sh shellos   ShellOS 崩 / 卡：按上次参数重起，恢复上一个世界 + 穿戴者（data/booth_<端口>.json）
#   scripts/booth_recover.sh chrome    Chrome 卡：只重开展位的两个窗口，ShellOS 不动
#   scripts/booth_recover.sh           不带症状：自动判断
# 可加 --http <端口>（默认 8765）
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8   # nohup / launchd 起时没 LANG：bash 3.2 会把 $VAR 后面的中文吃掉、pgrep 遇到带中文的进程命令行报 illegal byte sequence
PORT=8765 WHAT=
while [ $# -gt 0 ]; do case "$1" in --http) PORT=$2; shift ;; *) WHAT=$1 ;; esac; shift; done
BRAIN=${SHELLOS_BRAIN_PORT:-8790} TTS=${SHELLOS_TTS_PORT:-8791}
RUN=/tmp/booth-$PORT LAST=data/booth_$PORT.json PAT="shellos.main.*--http $PORT"
PY=.venv/bin/python; [ -x $PY ] || PY=python3
DEFAULT_ARGS="--ctl terrain --stepping --cap 4 --strength 3.0 --width 16 --http $PORT"
state() { curl -s --noproxy '*' -m 2 "127.0.0.1:$PORT/state"; }
f() { state | $PY -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1" 2>/dev/null; }
post() { curl -s --noproxy '*' -m 3 -X POST -H 'Content-Type: application/json' -d "$2" "127.0.0.1:$PORT$1"; echo; }
wait_for() {   # wait_for 秒数 表达式（对 /state 的 d 求值为 True 就算好）
  for i in $(seq "$1"); do [ "$(f "$2")" = True ] && return 0; sleep 1; done; return 1
}

case ${WHAT:-auto} in
  auto)
    if ! pgrep -f "$PAT" >/dev/null || ! state | grep -q '"safety"'; then WHAT=shellos
    elif [ "$(f 'd["link"]["age_ms"] < 500')" != True ]; then WHAT=exo
    elif [ "$(f 'd["safety"]["state"] in ("ARMED","ACTIVE")')" != True ]; then
      echo "判断：安全状态 $(f 'd["safety"]["state"]')（$(f 'd["safety"]["reason"]')）。先确认穿戴者站稳 → 手柄 ○ 或仪表盘「重新上膛」；反复掉：scripts/booth_check.sh 看控制环"; exit 1
    elif [ "$(f 'd["pad"]["connected"] or d["sim"]["on"]')" != True ]; then WHAT=pad
    elif [ "$(f 'd["brain"]["up"]')" != True ]; then WHAT=brain
    elif ! pgrep -f ".booth-chrome-$PORT/game" >/dev/null; then WHAT=chrome
    else echo "看起来都正常；细节：scripts/booth_check.sh --http $PORT"; exit 0; fi
    echo "判断：$WHAT"; exec "$0" "$WHAT" --http "$PORT" ;;
  exo)
    echo "外骨骼没帧。做：外骨骼关机 → 数 3 秒 → 开机进入工作态。串口线不用拔（serial_link 每秒重试 /dev/cu.usbserial*，连上后 ShellOS 2 s 内自动重新 ENABLE）"
    n0=$(f 'd["link"]["n"]')
    if wait_for 40 "d['link']['n'] > $n0 and d['link']['age_ms'] < 500"; then
      sleep 2; echo "帧回来了：$(f 'd["link"]["port"]')  安全状态 $(f 'd["safety"]["state"]')  $(f 'd["safety"]["reason"]')"
      [ "$(f 'd["safety"]["state"] in ("ARMED","ACTIVE")')" = True ] || echo "→ 还是 $(f 'd["safety"]["state"]')：按手柄 ○（或仪表盘「重新上膛」）"
    else echo "40 s 还没帧：换根 Type-C 线 / 换 USB 口；ls /dev/cu.usbserial* 看设备在不在；还不行 scripts/booth_recover.sh shellos"; exit 1; fi ;;
  pad)
    [ "$(f 'd["sim"]["on"]')" = True ] && { echo "模拟模式：不认手柄，用网页「按住助力」按钮（或 --force-deadman）代替 R2"; exit 0; }
    echo "手柄断了。做：按 PS 键（蓝牙）或直接插 USB 线；ShellOS 的手柄线程自动重扫"
    if wait_for 30 "d['pad']['connected']"; then echo "手柄回来了。让玩家按住 R2 试一下力"
    else echo "30 s 没认到：手柄长按 PS 10 s 硬重启，或系统设置 → 蓝牙里断开再连；实在不行仪表盘的死人开关按钮代替 R2"; exit 1; fi ;;
  brain)
    echo "先查底层：本机 127.0.0.1:$BRAIN 有没有人听（隧道）"
    if curl -sI --noproxy '*' -m 2 "127.0.0.1:$BRAIN/health" >/dev/null; then
      code=$(curl -s --noproxy '*' -m 3 -o /dev/null -w '%{http_code}' "127.0.0.1:$BRAIN/health")
      [ "$code" = 200 ] && echo "端口通、/health 200：大脑其实在。ShellOS 心跳 10 s 一次，等一下再看仪表盘" \
                        || echo "端口通但 /health 回 ${code}：隧道在、开发机上的大脑进程没起 → 开发机重起 brain/run.sh"
    else
      echo "端口没人听 = 隧道断。开发机上跑（自带 3 s 重连，不用管）："
      echo "    cd ~/aima && brain/run.sh"
      echo "  只要隧道不要大脑："
      echo "    ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=5 -R $BRAIN:127.0.0.1:$BRAIN -R $TTS:127.0.0.1:$TTS zhongrenfei@100.112.252.66"
      echo "  报 remote port forwarding failed = 本机旧隧道占着端口：lsof -i :$BRAIN 找到 sshd 的 pid，kill 它"
      echo "  开发机连不上本机：本机 ping 100.112.252.66 / Tailscale 在不在"
    fi
    case $(f 'd["brain"]["up"]') in
      False) echo "ShellOS 已自动降级：教练 / 地形导演 / 峰哥走规则兜底（蜂群卡片标 rule / canned），导游语音用本地缓存 → 演示照常，不用重起 ShellOS" ;;
      True)  echo "ShellOS 看大脑是通的（brain.up=true）" ;;
      *)     echo "ShellOS 不通，先 scripts/booth_recover.sh shellos" ;;
    esac ;;
  shellos)
    ARGS=$(cat $RUN.args 2>/dev/null); ARGS=${ARGS:-$DEFAULT_ARGS}
    echo "重起 ShellOS：$ARGS"
    ./run-mac.sh $ARGS
    for i in $(seq 30); do state | grep -q '"safety"' && break; sleep 1; done
    state | grep -q '"safety"' || { echo "30 s 没起来：tr '\\r' '\\n' < /tmp/shellos$([ "$PORT" = 8765 ] || echo -$PORT).log | tail -20"; exit 1; }
    if [ -f "$LAST" ]; then
      IFS='|' read -r w who < <($PY -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("world") or "", d.get("wearer") or "", sep="|")' "$LAST")   # 一次 python（| 不是空白，空世界不会把穿戴者挤到前面）：机器忙时每起一个进程都要几百 ms
      [ -n "$who" ] && [ "$who" != anon ] && post /wearer "{\"name\":\"$who\"}" >/dev/null
      [ -n "$w" ] && post /terrain "{\"preset\":\"$w\"}" >/dev/null
      echo "恢复：世界 $(f '(d.get("terrain") or {}).get("preset")')  穿戴者 $(f 'd["wearer"]')（影子在内存里，重起后要再爬一圈）"
    fi
    if pgrep -f ".booth-chrome-$PORT/game" >/dev/null; then echo "Chrome 会自己重连 /state，不用动"; fi ;;   # 用 if：&& 在 Chrome 不在时让整个脚本退出码变 1
  chrome)
    scripts/booth_up.sh --chrome --http "$PORT" ;;
  *) echo "不认识：${WHAT}（exo | pad | brain | shellos | chrome）"; exit 2 ;;
esac
