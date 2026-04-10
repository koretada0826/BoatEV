#!/bin/bash
cd "$(dirname "$0")"
while true; do
  if ! pgrep -f "run_collect.sh" > /dev/null; then
    echo "[$(date)] run_collect.sh が停止 → 再起動"
    nohup bash run_collect.sh >> collect.log 2>&1 &
  fi
  sleep 60
done
