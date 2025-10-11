#!/bin/bash

APP_DIR="/root/Discordbot"
BRANCH="main"
PROCESS_NAME="bun run start"

cd "$APP_DIR"

# 既存プロセス停止
pkill -f "$PROCESS_NAME"

# Git更新チェック
git fetch origin "$BRANCH"
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/"$BRANCH")

if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
  echo "🔄 Git更新あり → pull"
  git reset --hard origin/"$BRANCH"
else
  echo "✅ Git更新なし"
fi

# Bun起動
echo "🚀 起動: bun run start"
bun run start