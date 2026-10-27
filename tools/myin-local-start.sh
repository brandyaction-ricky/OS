#!/bin/zsh
# 내 컴퓨터로 시안 (owner decision 2026-10-27): run the worker on this Mac for the ③ drafts sent to it.
# First time: ~/myin-local/start.sh <키>  (the OS 「내 컴퓨터 연결」 command; the key is kept in this Mac's Keychain)
# After that: ~/myin-local/start.sh       (keep the window open; the Mac stays awake while it runs; Ctrl+C stops it)
set -euo pipefail
HOME_DIR="$HOME/myin-local"; SERVICE="brandy-os-local-render"
[[ -f "$HOME_DIR/env" ]] || { echo "먼저 엔진 묶음의 myin-local-setup.sh를 실행해 주세요." >&2; exit 1; }
if [[ $# -ge 1 ]]; then
  [[ "$1" == bos_pat_* ]] || { echo "OS에서 만든 시작 명령을 그대로 붙여 넣어 주세요." >&2; exit 1; }
  security add-generic-password -U -s "$SERVICE" -a "$USER" -w "$1" >/dev/null
fi
KEY="$(security find-generic-password -s "$SERVICE" -a "$USER" -w 2>/dev/null || true)"
[[ -n "$KEY" ]] || { echo "연결 키가 없어요. OS의 「내 컴퓨터 연결」에서 시작 명령을 만들어 주세요." >&2; exit 1; }
set -a; source "$HOME_DIR/env"; set +a
export MYIN_LOCAL_KEY="$KEY" PATH="/opt/homebrew/bin:$PATH"
echo "내 컴퓨터 렌더를 켰어요. 이 창을 열어 두면 OS에서 「내 컴퓨터」로 고른 시안을 만들어요."
exec caffeinate -i node "$MYIN_TOOLS/youtube-media-worker.mjs" --local
