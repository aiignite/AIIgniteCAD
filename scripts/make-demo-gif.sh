#!/bin/bash
# 把 README 演示帧合成为 30 秒 GIF（每帧 3 秒）
set -e

FRAME_DIR=".demo-frames"
OUT="docs/images/demo.gif"

if [ ! -d "$FRAME_DIR" ]; then
  echo "缺少 $FRAME_DIR，请先运行 npm run docs:frames"
  exit 1
fi

magick -delay 300 -loop 0 "$FRAME_DIR"/*.png -resize 1280x800 -layers Optimize "$OUT"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
