#!/bin/sh
# 在 MacBook 上（重）启动 ShellOS：先停旧的、等端口释放，再后台起新的，日志在 /tmp/shellos.log
PAT="shellos.main.*--http 8765"          # 只停展位这一个（别的线在 MacBook 上另开端口测试，别误杀）
pkill -f "$PAT" 2>/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$PAT" >/dev/null || break; sleep 0.3; done
cd "$(dirname "$0")"
SDL_VIDEODRIVER=dummy nohup .venv/bin/python -m shellos.main "$@" > /tmp/shellos.log 2>&1 &
sleep 4
curl -s localhost:8765/state >/dev/null && echo "ShellOS up: http://localhost:8765" || { echo "FAILED:"; tr "\r" "\n" < /tmp/shellos.log | grep -a -v -E "avx2|Hello from|^$" | tail -8; }
