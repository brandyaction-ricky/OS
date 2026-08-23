#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3가 필요합니다. https://www.python.org/downloads/ 에서 설치해주세요."
  exit 1
fi

python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' || {
  echo "Python 3.11 이상이 필요합니다. 현재 버전: $(python3 --version)"
  exit 1
}

python3 -m venv .venv
.venv/bin/python -m pip install -e .

if [ "$#" -gt 0 ]; then
  .venv/bin/ba setup --user "$1"
else
  .venv/bin/ba setup
fi

.venv/bin/ba doctor

echo
echo "설치가 끝났습니다. 다음부터는 아래 명령으로 시작하세요."
echo "source .venv/bin/activate"
echo "ba guide"
