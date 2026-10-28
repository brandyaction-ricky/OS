#!/bin/zsh
# 내 컴퓨터 영상 만들기 설치 · Mac (owner decisions 2026-10-27). The OS 「내 컴퓨터 연결」 shows this with the key:
#   curl -fsSL https://brandyaction-os.vercel.app/myin-local/install.sh | zsh -s -- <키>
# It installs node and ffmpeg with Homebrew, puts the runner in ~/myin-local and a 「내 컴퓨터 영상 만들기」 launcher on the desktop, and starts it.
set -euo pipefail
OS_URL="${OS_URL:-https://brandyaction-os.vercel.app}" HOME_DIR="$HOME/myin-local"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v brew >/dev/null || { echo "Homebrew가 필요해요. https://brew.sh 의 설치 명령을 먼저 실행한 뒤 이 명령을 다시 붙여 넣어 주세요."; exit 1; }
command -v node >/dev/null || brew install node
command -v ffmpeg >/dev/null || brew install ffmpeg
mkdir -p "$HOME_DIR"
curl -fsSL "$OS_URL/myin-local/myin-local.mjs" -o "$HOME_DIR/myin-local.mjs"
LAUNCHER="$HOME/Desktop/내 컴퓨터 영상 만들기.command"
printf '#!/bin/zsh\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nexec node "$HOME/myin-local/myin-local.mjs"\n' > "$LAUNCHER"
chmod +x "$LAUNCHER"
echo "설치했어요. 다음부터는 바탕화면의 「내 컴퓨터 영상 만들기」를 두 번 누르면 켜져요."
exec node "$HOME_DIR/myin-local.mjs" "$@"
