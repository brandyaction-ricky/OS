#!/bin/zsh
# 내 컴퓨터로 시안 (owner decision 2026-10-27): install the render PC's v13 engine bundle on a staff Mac (Apple silicon, macOS).
# 1) Unpack the bundle you were given:  mkdir -p ~/Downloads/myin-engine && tar -xzf myin-engine-<지문>.tar.gz -C ~/Downloads/myin-engine
# 2) Run its setup:                    zsh ~/Downloads/myin-engine/myin-local-setup.sh
# 3) Start it with the command the OS shows under 「내 컴퓨터 연결」 (~/myin-local/start.sh <키>); later just ~/myin-local/start.sh
# A newer engine: unpack the new bundle and run this again; the old one stays until you delete it.
set -euo pipefail
HERE="${0:A:h}"; HOME_DIR="$HOME/myin-local"
[[ -f "$HERE/FINGERPRINT" && -d "$HERE/engine/pkg" ]] || { echo "엔진 묶음을 푼 폴더에서 실행해 주세요." >&2; exit 1; }
FP="$(cat "$HERE/FINGERPRINT")"; PY="$(cat "$HERE/python-version")"
command -v brew >/dev/null || { echo "Homebrew가 필요해요: https://brew.sh 의 설치 명령을 먼저 실행해 주세요." >&2; exit 1; }
command -v ffmpeg >/dev/null || brew install ffmpeg
command -v node >/dev/null || brew install node
command -v "python$PY" >/dev/null || brew install "python@$PY"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[[ -x "$CHROME" ]] || { echo "Google Chrome이 필요해요(사이트 화면 캡처에 써요). 설치한 뒤 다시 실행해 주세요." >&2; exit 1; }
mkdir -p "$HOME_DIR/work"
ENGINE="$HOME_DIR/engine-$FP"
[[ -d "$ENGINE" ]] || { rsync -a "$HERE/engine/" "$ENGINE/"; mkdir -p "$ENGINE/tools" "$ENGINE/lib"; rsync -a "$HERE/tools/" "$ENGINE/tools/"; rsync -a "$HERE/lib/" "$ENGINE/lib/"; }
# One Python environment per package list, exactly the render PC's (the fingerprint includes it).
LOCK_ID="$(shasum -a 256 "$HERE/requirements.lock" | cut -c1-12)"; VENV="$HOME_DIR/venv-$PY-$LOCK_ID"
if [[ ! -x "$VENV/bin/python" ]]; then
  "python$PY" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements.lock"
fi
cat > "$HOME_DIR/env" <<EOF
OS_URL=https://brandyaction-os.vercel.app
MYIN_PKG=$ENGINE/pkg
MYIN_DIAGRAM_DIR=$ENGINE/diagrams
MYIN_FONT_DIR=$ENGINE/fonts
MYIN_LIBRARY=$ENGINE/library
MYIN_PYTHON=$VENV/bin/python
MYIN_WORK=$HOME_DIR/work
MYIN_TOOLS=$ENGINE/tools
CHROME_PATH=$CHROME
EOF
cp "$HERE/myin-local-start.sh" "$HOME_DIR/start.sh"; chmod +x "$HOME_DIR/start.sh"
echo "설치 끝 · 엔진 $FP"
echo "OS의 「내 컴퓨터 연결」에서 시작 명령을 만들어 터미널에 붙여 넣어 주세요."
