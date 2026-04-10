#!/bin/bash
# 永続データ収集ループ
# 使い方: bash run_collect.sh &
cd "$(dirname "$0")"

echo "=== 永続データ収集開始 ==="
while true; do
  echo "[$(date)] 2024-2026年バッチ開始"
  node dist/scraper/turbo_collect.js 2024-01-01 2026-04-09 2>&1 | tail -3

  echo "[$(date)] 2020-2023年バッチ開始"
  node dist/scraper/turbo_collect.js 2020-01-01 2023-12-31 2>&1 | tail -3

  echo "[$(date)] 2018-2019年バッチ開始"
  node dist/scraper/turbo_collect.js 2018-01-01 2019-12-31 2>&1 | tail -3

  echo "[$(date)] 1ラウンド完了、5秒後に次ラウンド"
  sleep 5
done
