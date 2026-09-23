#!/bin/sh
# 把本机工作副本同步到 MacBook Pro（不含 venv 和录制数据）
rsync -a --delete --exclude .git --exclude .claude --exclude brain/.env --exclude data/experiences.jsonl --exclude 'brain/.venv' --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude 'data/recordings/*' \
  "$(dirname "$0")/" zhongrenfei@100.112.252.66:~/aima/
