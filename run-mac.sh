#!/bin/sh
# 在 MacBook 上（重）启动 ShellOS：先停旧的、等端口释放，再后台起新的，日志在 /tmp/shellos.log
# 端口跟 --http 走（没给就补 --http 8765）：只停同端口的那一个，别的线在 MacBook 上另开端口测试不会被误杀；非 8765 的日志在 /tmp/shellos-<端口>.log
PORT=8765
export LC_ALL=en_US.UTF-8   # nohup / launchd 起时没 LANG：bash 3.2 会把 $VAR 后面的中文吃掉、pgrep 遇到带中文的进程命令行报 illegal byte sequence
prev=; for a in "$@"; do [ "$prev" = "--http" ] && PORT=$a; prev=$a; done
case " $* " in *" --http "*) ;; *) set -- "$@" --http "$PORT" ;; esac
PAT="shellos.main.*--http $PORT"
LOG=/tmp/shellos.log; [ "$PORT" = 8765 ] || LOG=/tmp/shellos-$PORT.log
pkill -f "$PAT" 2>/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$PAT" >/dev/null || break; sleep 0.3; done
cd "$(dirname "$0")"
SDL_VIDEODRIVER=dummy nohup .venv/bin/python -m shellos.main "$@" > "$LOG" 2>&1 &
for i in $(seq 40); do curl -s -m 1 "localhost:$PORT/state" >/dev/null && break; pgrep -f "$PAT" >/dev/null || break; sleep 0.5; done   # 最多等 20 s（机器忙时 import 慢），进程死了就不等
curl -s -m 1 "localhost:$PORT/state" >/dev/null && echo "ShellOS up: http://localhost:$PORT" || { echo "FAILED:"; tr "\r" "\n" < "$LOG" | grep -a -v -E "avx2|Hello from|^$" | tail -8; }
