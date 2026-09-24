#!/bin/bash
# 展位体检（≤10 s）：ShellOS · 串口帧率 · 手柄 · 安全状态 · 控制环 · 大脑（隧道）· TTS · 导游语音缓存 · 磁盘 · Chrome。每项红绿，红的给一行处置。
#   scripts/booth_check.sh [--http 8765] [--skip voice,chrome]      退出码 = 红灯数
# 环境：SHELLOS_BRAIN_PORT（默认 8790）、SHELLOS_TTS_PORT（8791）、BOOTH_SKIP（同 --skip）
# 网络类失败先看底层再猜应用层：端口没人听 = 隧道没起；端口通但 /health 不对 = 隧道在、大脑进程没起。
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8   # nohup / launchd 起时没 LANG：bash 3.2 会把 $VAR 后面的中文吃掉、pgrep 遇到带中文的进程命令行报 illegal byte sequence
PORT=8765 SKIP=${BOOTH_SKIP:-}
while [ $# -gt 0 ]; do case "$1" in --http) PORT=$2; shift ;; --skip) SKIP=$SKIP,$2; shift ;; esac; shift; done
BRAIN=${SHELLOS_BRAIN_PORT:-8790} TTS=${SHELLOS_TTS_PORT:-8791}
PY=.venv/bin/python; [ -x $PY ] || PY=python3
RED=0
if [ -t 1 ]; then G=$'\e[32m' R=$'\e[31m' D=$'\e[90m' N=$'\e[0m'; else G= R= D= N=; fi
ok()   { printf "  ${G}[OK]${N} %-8s %s\n" "$1" "$2"; }
bad()  { printf "  ${R}[!!]${N} %-8s %s\n       → %s\n" "$1" "$2" "$3"; RED=$((RED + 1)); }
skip() { printf "  ${D}[--]${N} %-8s 跳过：%s\n" "$1" "$2"; }
skipped() { case ",$SKIP," in *",$1,"*) return 0 ;; esac; return 1; }
# /state 取两次（隔 1 s 算帧率），一次 python 把要看的字段吐成 shell 变量（机器忙时少起几个进程）
# python 源码先 heredoc 进变量再传：bash 3.2 在 "$( ... )" 里会对单引号内的 {a,b} 做花括号展开，直接内联 f-string 会被拆坏
read -r -d '' PYSNIP <<'EOF'
import json, sys, time, urllib.request
op = urllib.request.build_opener(urllib.request.ProxyHandler({})).open
def st():
    try: return json.load(op(f"http://127.0.0.1:{sys.argv[1]}/state", timeout=2))
    except Exception: return None
d0 = st(); time.sleep(1); d = st() if d0 else None
if not d: print("UP=0"); sys.exit()
def q(k, v): print(k + "=" + json.dumps(str(v), ensure_ascii=False))
q("UP", 1); q("PORT_", d["link"]["port"]); q("CTL", d["ctl"]["name"]); q("WORLD", (d.get("terrain") or {}).get("preset")); q("WHO", d["wearer"])
q("SIM", d["sim"]["on"]); q("HZ", d["link"]["n"] - d0["link"]["n"]); q("AGE", d["link"]["age_ms"]); q("BAD", d["link"]["bad"]); q("ERR", d["link"]["last_err"])
q("PAD", d["pad"]["connected"]); q("R2", d["pad"]["r2"]); q("GS", d["safety"]["state"]); q("CAP", d["safety"]["cap"]); q("WHY", d["safety"]["reason"])
q("LOOP", d.get("loop_ms", 0)); q("BRAIN_UP", d["brain"].get("up"))
EOF
eval "$($PY -c "$PYSNIP" "$PORT")"
# 底层先行：TCP 通不通（curl 退出码 7 = 拒绝连接 / 没人听），再看 /health
health() {   # health <端口> → 打印 tcp|code|body
  local body code rc
  body=$(curl -s --noproxy '*' -m 2 -w '\n%{http_code}' "127.0.0.1:$1/health"); rc=$?
  code=${body##*$'\n'}; body=${body%$'\n'*}
  [ $rc = 7 ] && echo "down||" || echo "up|$code|$body"
}

echo "展位体检 端口 $PORT  $(date +%T)"
if [ "$UP" = 1 ]; then
  ok ShellOS "$PORT_  控制律 $CTL  世界 $WORLD  穿戴者 $WHO"
  if [ "$HZ" -ge 30 ] && [ "$AGE" -lt 500 ]; then ok 串口帧率 "$HZ Hz  坏帧 $BAD  age $AGE ms$([ "$SIM" = True ] && echo '  （模拟）')"
  else bad 串口帧率 "$HZ Hz  age $AGE ms  ${ERR:-没帧}" "外骨骼重新上电，等自动重连：scripts/booth_recover.sh exo"; fi
  if [ "$PAD" = True ]; then ok 手柄 "在  R2 $R2"
  elif [ "$SIM" = True ]; then ok 手柄 "不在（模拟模式：网页按钮 / --force-deadman 代替）"
  else bad 手柄 "不在" "按手柄 PS 键（或插 USB 线），pygame 自动重认：scripts/booth_recover.sh pad"; fi
  case $GS in ARMED|ACTIVE) ok 安全 "$GS  软限 $CAP Nm  $WHY" ;;
    *) bad 安全 "$GS  $WHY" "按手柄 ○ 或仪表盘「重新上膛」；串口刚断过就先 scripts/booth_recover.sh exo" ;; esac
  [ "$LOOP" -le 60 ] && ok 控制环 "最大间隔 $LOOP ms（100 Hz 环；Guard >100 ms 清零力矩）" || bad 控制环 "最大间隔 $LOOP ms（>100 ms Guard 清零力矩，>1 s DISARM）" "别在本机跑截图 / 录屏以外的重活；持续这样就 scripts/booth_recover.sh shellos"
else
  bad ShellOS "127.0.0.1:$PORT/state 不通" "scripts/booth_recover.sh shellos（重起 + 恢复上一个世界）"
  for k in 串口帧率 手柄 安全 控制环; do skip $k "ShellOS 没起"; done
fi

h=$(health $BRAIN); IFS='|' read -r tcp code body <<< "$h"
if [ "$tcp" = down ]; then bad 大脑 "127.0.0.1:$BRAIN 没人听（隧道没起）" "开发机：cd ~/aima && brain/run.sh（起大脑 + 隧道，自动重连）；ShellOS 已规则兜底，演示照常"
elif [ "$code" != 200 ]; then bad 大脑 "端口通、/health 回 ${code:-空}（隧道在，大脑进程没起）" "开发机重起 brain/run.sh；本机 lsof -i :$BRAIN 看是不是旧隧道占着"
elif echo "$body" | grep -q '"key": *false'; then bad 大脑 "在，但没 key" "开发机 export ANTHROPIC_API_KEY=…（或 brain/.env 写 MINIMAX_API_KEY）后重起 brain/run.sh"
else ok 大脑 "$(echo "$body" | $PY -c 'import json,sys; d=json.load(sys.stdin); print(d.get("model",""), d.get("backend",""))')  ShellOS 心跳 ${BRAIN_UP:-?}"; fi
h=$(health $TTS); IFS='|' read -r tcp code body <<< "$h"
if [ "$tcp" = down ]; then bad TTS "127.0.0.1:$TTS 没人听（隧道没起）" "和大脑同一条隧道：开发机 brain/run.sh；缺的语音只出气泡不出声"
elif [ "$code" != 200 ]; then bad TTS "端口通、/health 回 ${code:-空}" "开发机重起 brain/run.sh（tts.py 一起起）"
else ok TTS "$(echo "$body" | cut -c1-70)"; fi

if skipped voice; then skip 导游语音 "--skip voice"
else
  v=$($PY -m shellos.agent.guide --check 2>/dev/null | head -1)
  case $v in *齐全*) ok 导游语音 "${v#*] }" ;;
    *) bad 导游语音 "${v#*] }" "开发机主工作区：python3 -m shellos.agent.guide --tts && ./deploy.sh；隧道通着 ShellOS 也会后台补" ;; esac
fi
avail=$(df -g . | awk 'NR==2{print $4}')
[ "$avail" -ge 2 ] && ok 磁盘 "剩 $avail GB" || bad 磁盘 "只剩 $avail GB" "清 data/recordings/ 或 ~/Downloads；录制会写盘"
if skipped chrome; then skip Chrome "--skip chrome"
elif pgrep -f ".booth-chrome-$PORT/game" >/dev/null; then ok Chrome "大屏 /game 在$(pgrep -f ".booth-chrome-$PORT/dash" >/dev/null && echo '，仪表盘在' || echo '；仪表盘窗口没开')"
else bad Chrome "展位大屏窗口不在（自己手动开的不算）" "scripts/booth_up.sh --chrome --http ${PORT}（只重开两个窗口）"; fi

[ $RED = 0 ] && echo "全绿 ✓" || echo "$RED 项红：按 → 处理，再跑一次"
exit $RED
