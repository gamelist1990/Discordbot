#!/bin/bash

# Chromiumを使用してプロファイルページのスクリーンショットを取得

VITE_URL="http://localhost:5173/profile"
OUTPUT_DIR="test-results"

echo "=========================================="
echo "Chromiumを使用したスクリーンショットテスト"
echo "=========================================="
echo ""

# 出力ディレクトリを作成
mkdir -p "$OUTPUT_DIR"

# Chromiumがインストールされているか確認
if ! command -v chromium &> /dev/null; then
    echo "❌ Chromiumが見つかりません"
    exit 1
fi

echo "✅ Chromium found: $(which chromium)"
echo "📝 URL: $VITE_URL"
echo ""

# 各ビューポートでスクリーンショットを取得
declare -A viewports=(
    ["desktop"]="1920,1080"
    ["laptop"]="1366,768"
    ["tablet"]="768,1024"
    ["mobile"]="375,667"
)

declare -A breakpoints=(
    ["above-900"]="901,800"
    ["below-900"]="899,800"
    ["above-600"]="601,800"
    ["below-600"]="599,800"
)

echo "📱 標準ビューポートのスクリーンショット取得..."
echo ""

for name in "${!viewports[@]}"; do
    size="${viewports[$name]}"
    width=$(echo $size | cut -d',' -f1)
    height=$(echo $size | cut -d',' -f2)
    
    echo "Testing $name (${width}x${height})..."
    
    chromium \
        --headless \
        --disable-gpu \
        --no-sandbox \
        --disable-dev-shm-usage \
        --window-size=${width},${height} \
        --screenshot="${OUTPUT_DIR}/chrome-${name}.png" \
        --virtual-time-budget=5000 \
        "$VITE_URL" \
        2>/dev/null
    
    if [ -f "${OUTPUT_DIR}/chrome-${name}.png" ]; then
        size_kb=$(du -k "${OUTPUT_DIR}/chrome-${name}.png" | cut -f1)
        echo "  ✅ Screenshot saved (${size_kb}KB)"
    else
        echo "  ❌ Screenshot failed"
    fi
    echo ""
done

echo "🔍 ブレークポイント境界値のスクリーンショット取得..."
echo ""

for name in "${!breakpoints[@]}"; do
    size="${breakpoints[$name]}"
    width=$(echo $size | cut -d',' -f1)
    height=$(echo $size | cut -d',' -f2)
    
    echo "Testing $name (${width}x${height})..."
    
    chromium \
        --headless \
        --disable-gpu \
        --no-sandbox \
        --disable-dev-shm-usage \
        --window-size=${width},${height} \
        --screenshot="${OUTPUT_DIR}/chrome-bp-${name}.png" \
        --virtual-time-budget=5000 \
        "$VITE_URL" \
        2>/dev/null
    
    if [ -f "${OUTPUT_DIR}/chrome-bp-${name}.png" ]; then
        size_kb=$(du -k "${OUTPUT_DIR}/chrome-bp-${name}.png" | cut -f1)
        echo "  ✅ Screenshot saved (${size_kb}KB)"
    else
        echo "  ❌ Screenshot failed"
    fi
    echo ""
done

echo "=========================================="
echo "✅ スクリーンショット取得完了"
echo "=========================================="
echo ""
echo "保存場所: ${OUTPUT_DIR}/chrome-*.png"
echo ""

# スクリーンショットの一覧を表示
ls -lh "${OUTPUT_DIR}"/chrome-*.png 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

echo ""
