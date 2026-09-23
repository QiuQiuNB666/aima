#!/bin/bash
# 一键：本机大脑（Claude，8790）+ 峰哥语音（MiniMax，8791）+ SSH 反向隧道到展位 MacBook（断了 3 s 后自动重连）。Ctrl-C 一起退。
#   export ANTHROPIC_API_KEY=...   （或 ant auth login）
#   brain/run.sh                   # 只要大脑不要隧道：MAC= brain/run.sh
# 可改：BRAIN_PY（默认 brain/.venv/bin/python）、MAC（默认 zhongrenfei@100.112.252.66）、SHELLOS_BRAIN_PORT（默认 8790）
cd "$(dirname "$0")/.."
PY=${BRAIN_PY:-brain/.venv/bin/python}
MAC=${MAC-zhongrenfei@100.112.252.66}
PORT=${SHELLOS_BRAIN_PORT:-8790}
[ -x "$PY" ] || { echo "没找到 $PY：python3 -m venv brain/.venv && brain/.venv/bin/pip install anthropic"; exit 1; }

set -m                                               # 每个后台任务单独一个进程组，退出时整组杀（含隧道里的 ssh）
"$PY" -u brain/claude_brain.py &
PIDS="-$!"
TTS_PORT=${SHELLOS_TTS_PORT:-8791}
"$PY" -u brain/tts.py &                              # 峰哥语音：key 从 brain/.env 读；没配就用 say
PIDS="$PIDS -$!"
trap 'trap - INT TERM EXIT; kill -- $PIDS 2>/dev/null; exit' INT TERM EXIT
for i in $(seq 240); do curl -s -m 1 "127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.5; done   # 冷启动 import anthropic 要好几秒
curl -s -m 1 "127.0.0.1:$PORT/health" || { echo "大脑没起来"; exit 1; }
echo

if [ -n "$MAC" ]; then
  while true; do
    echo "[tunnel] $(date +%T) 连 $MAC（远端 127.0.0.1:$PORT → 本机大脑，:$TTS_PORT → 峰哥语音）"
    # ExitOnForwardFailure：远端端口被旧隧道占着就立刻失败重试，不假装连上
    ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=5 -o ServerAliveCountMax=2 \
        -o ConnectTimeout=5 -o BatchMode=yes -R "$PORT:127.0.0.1:$PORT" -R "$TTS_PORT:127.0.0.1:$TTS_PORT" "$MAC"
    echo "[tunnel] $(date +%T) 断了（退出码 $?），3 s 后重连"
    sleep 3
  done &
  PIDS="$PIDS -$!"
fi
wait
