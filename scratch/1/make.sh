#!/bin/bash
# Trainer Center "Photo Check" reel — one-shot build.
# Usage:  ./make.sh [output_name.mp4]
# See TEMPLATE.md for how to make a new reel.
set -e
cd "$(dirname "$0")"
NODE_MODULES="$HOME/Apps/trainercenter/node_modules"
OUT="${1:-trainer_gallery_reel.mp4}"
DUR=32   # keep in sync with capture.js DUR and the music length

# 1. Convert raw card photos -> display/. Put new photos (any format/name) in raw/.
#    If raw/ is empty, the existing display/ cards are reused.
if ls raw/* >/dev/null 2>&1; then
  echo "==> converting raw/ photos to display/"
  rm -f display/card_*.jpg
  i=1
  for f in $(ls raw/* | sort); do
    out=$(printf "display/card_%02d.jpg" "$i")
    sips -Z 760 -s format jpeg "$f" --out "$out" >/dev/null 2>&1 && i=$((i+1))
  done
  echo "    display cards: $(( i - 1 ))"
fi

# 2. Build the audio mix (music bed ducked under Oak's voice + photo clicks + drop kick)
echo "==> building audio"
node build_audio.js >/dev/null

# 3. Render frames deterministically (render.html driven by a time value)
echo "==> rendering frames"
NODE_PATH="$NODE_MODULES" node capture.js | tail -1

# 4. Mux frames + audio into the final vertical mp4
echo "==> assembling $OUT"
ffmpeg -y -loglevel error -framerate 30 -i frames/f_%05d.jpg -i audio_out/mix.mp3 \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -t "$DUR" "$OUT"

echo "DONE -> $OUT  ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s)"
open "$OUT"
