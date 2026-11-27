#!/bin/zsh
# 나눠 그리기 도우미 (대표 2026-11-25 「새 영상 먼저, 쉬는 컴퓨터는 거들기」): 다른 영상 컴퓨터가 SSH로 부른다.
#   myin_help_pieces.sh --probe                      → "idle <지문>" 또는 "busy <지문>"
#   myin_help_pieces.sh <run> <procs> [KEY=VAL ...]  → 표준 입력의 조각 번호를 그려 "ready N F" · "done i"를 찍는다
# 그리는 폴더는 ~/myin/help/<run> (맡긴 컴퓨터가 rsync로 보낸 그 영상 폴더), 도식 · 글꼴은 ~/myin/help/_shared.
# 이 컴퓨터가 자기 영상을 그리기 시작하면(work-prod 아래 렌더 · 미리보기 · 음성) 거들기를 멈춘다 — 맡은 조각은 맡긴 쪽이 다시 나눈다.
set -u
set -a; source ~/render/worker.prod.env; [ -f ~/render/render-paths.env ] && source ~/render/render-paths.env; set +a
export PATH="/opt/homebrew/bin:$PATH" PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1
OWN='myin/work-prod/.*(render_myin|myin_v0)|stage_voice.py|stage_words.py'
fingerprint() {
  print -r -- "$("$MYIN_PYTHON" -c 'import sys, PIL, numpy; print(sys.version.split()[0], PIL.__version__, numpy.__version__)') $(ffmpeg -version | head -1 | cut -d' ' -f3)"
}
if [ "${1:-}" = "--probe" ]; then
  if pgrep -f "render_myin.py|myin_v0.py|stage_voice.py|stage_words.py" >/dev/null; then print -r -- "busy $(fingerprint)"; else print -r -- "idle $(fingerprint)"; fi
  exit 0
fi
run=$1; procs=$2; shift 2
S=~/myin/help/_shared
export MYIN_DIAGRAM_DIR=$S/diagrams MYIN_FONT_DIR=$S/fonts WIN_FONT_DIR=$S/winfonts PYTHONPATH="$S/diagrams:$S/diagrams-base"
for kv in "$@"; do export "$kv"; done
cd ~/myin/help/$run/tools/myin_pipeline || exit 3
exec 3<&0
"$MYIN_PYTHON" render_myin.py os_myin pieces $procs <&3 &
py=$!
( while kill -0 $py 2>/dev/null; do sleep 10; if pgrep -f "$OWN" >/dev/null; then print -u2 "own work started: stop helping"; kill $py; fi; done ) &
wait $py
