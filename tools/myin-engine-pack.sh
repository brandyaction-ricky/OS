#!/bin/zsh
# 내 컴퓨터로 시안 (owner decision 2026-10-27): the render PC's current v13 engine as one bundle for staff Macs.
# The render PC's worker runs it by itself when the OS has no bundle for its engine yet (and uploads the result); by hand:
#   tools/myin-engine-pack.sh
# Writes ~/myin/engine-bundles/myin-engine-<fingerprint>.tar.gz — the same fingerprint the render PC reports to the OS, so a staff
# PC that installs it (public/myin-local) is allowed to make ③ drafts. Engine paths come from the worker's environment or, by
# hand, from the private env file (only those lines); no secret goes into the bundle. Last lines: BUNDLE=<file>, PYTHON=<x.y>,
# ASSETS=<assets fingerprint>, ASSETS_BUNDLE=<file>.
# 엔진 · 자료 분리 (로건 개발 문서 v3 7.2-13, 2026-11-04): pkg/assets (pictures, music, sounds: ~300 MB) is its own bundle keyed by its
# content, packed once; the code bundle names it in ASSETS. pkg/voice (his sample videos' voices, ~95 MB) never goes to staff PCs.
set -euo pipefail
ENV_FILE="${ENV_FILE:-$HOME/render/worker.prod.env}" LAUNCHER="${LAUNCHER:-$HOME/render/run-worker.prod.sh}"
val() { grep -E "^(export )?$1=" "$2" 2>/dev/null | tail -1 | sed -E "s/^(export )?$1=//; s/^\"//; s/\"$//" }
export MYIN_PKG="${MYIN_PKG:-$(val MYIN_PKG "$ENV_FILE")}" MYIN_DIAGRAM_DIR="${MYIN_DIAGRAM_DIR:-$(val MYIN_DIAGRAM_DIR "$ENV_FILE")}"
export MYIN_PYTHON="${MYIN_PYTHON:-$(val MYIN_PYTHON "$ENV_FILE")}" MYIN_FONT_DIR="${MYIN_FONT_DIR:-$(val MYIN_FONT_DIR "$LAUNCHER")}"
export MYIN_LIBRARY="${MYIN_LIBRARY:-$(val MYIN_LIBRARY "$ENV_FILE")}"
[[ -n "$MYIN_LIBRARY" ]] || export MYIN_LIBRARY="$HOME/myin/library"
WORKER="${WORKER_PATH:-$(grep -oE '"[^"]*/tools/youtube-media-worker\.mjs"' "$LAUNCHER" | tail -1 | tr -d '"')}"
for need in "$MYIN_PKG/tools/myin_pipeline/render_myin.py" "$MYIN_PYTHON" "$WORKER"; do
  [[ -e "$need" ]] || { echo "없음: $need (렌더 PC 설정을 확인해 주세요)" >&2; exit 1; }
done
# The worker's own fingerprint function, so both sides hash the same way. The path goes in by env: an argv path would start the worker.
FP="$(WORKER_PATH="$WORKER" node --input-type=module -e 'const w = await import(process.env.WORKER_PATH); console.log(w.engine())')"
[[ "$FP" =~ ^[a-f0-9]{32}$ ]] || { echo "엔진 지문을 만들지 못했어요: $FP" >&2; exit 1; }
OUT="$HOME/myin/engine-bundles"; BUNDLE="$OUT/myin-engine-$FP-code.tar.gz"
AFP="$(ASSETS_DIR="$MYIN_PKG/assets" node --input-type=module -e '
import { createHash } from "node:crypto"; import { readdirSync, readFileSync, statSync } from "node:fs"; import path from "node:path";
const root = process.env.ASSETS_DIR, h = createHash("sha256");
const walk = (dir = "") => {
  for (const [nfc, raw] of readdirSync(path.join(root, dir)).map((n) => [n.normalize("NFC"), n]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (raw === "__pycache__" || raw.startsWith(".")) continue;
    const rel = path.join(dir, raw), full = path.join(root, rel);
    if (statSync(full).isDirectory()) walk(rel);
    else h.update(`${path.join(dir, nfc).split(path.sep).join("/")}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}\n`);
  }
};
walk(); console.log(h.digest("hex"));')"
[[ "$AFP" =~ ^[a-f0-9]{64}$ ]] || { echo "자료 지문을 만들지 못했어요: $AFP" >&2; exit 1; }
ABUNDLE="$OUT/myin-assets-$AFP.tar.gz"
mkdir -p "$OUT"
PY="$("$MYIN_PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
if [[ ! -e "$ABUNDLE" ]]; then
  tar -C "$MYIN_PKG" --exclude .DS_Store --exclude __pycache__ -czf "$ABUNDLE.part" assets && mv "$ABUNDLE.part" "$ABUNDLE"
  echo "자료 묶음: $ABUNDLE ($(du -h "$ABUNDLE" | cut -f1)) · 지문 $AFP"
fi
[[ -e "$BUNDLE" ]] && { echo "이미 있어요: $BUNDLE"; echo "BUNDLE=$BUNDLE"; echo "PYTHON=$PY"; echo "ASSETS=$AFP"; echo "ASSETS_BUNDLE=$ABUNDLE"; exit 0; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/engine" "$STAGE/tools"
rsync -a --exclude __pycache__ --exclude .DS_Store --exclude /assets --exclude /voice "$MYIN_PKG/" "$STAGE/engine/pkg/"
[[ -n "$MYIN_DIAGRAM_DIR" && -d "$MYIN_DIAGRAM_DIR" ]] && rsync -a --exclude __pycache__ --exclude .DS_Store "$MYIN_DIAGRAM_DIR/" "$STAGE/engine/diagrams/"
[[ -n "$MYIN_FONT_DIR" && -d "$MYIN_FONT_DIR" ]] && rsync -a --exclude .DS_Store "$MYIN_FONT_DIR/" "$STAGE/engine/fonts/"
[[ -d "$MYIN_LIBRARY" ]] && rsync -a --exclude .DS_Store "$MYIN_LIBRARY/" "$STAGE/engine/library/"
TOOLS="$(dirname "$WORKER")"
cp "$TOOLS"/*.mjs "$TOOLS"/*.py "$STAGE/tools/" 2>/dev/null || true
# The ad renderer contains only the OS's pinned layout modules, fonts and runtime libraries.
WORKER_PATH="$WORKER" STAGE="$STAGE" node --input-type=module -e '
import path from "node:path"; import {pathToFileURL} from "node:url";
const tools=path.dirname(process.env.WORKER_PATH), root=path.dirname(tools);
const {buildAdRuntime,adRuntimeDigest}=await import(pathToFileURL(path.join(tools,"image-ad-renderer.mjs")));
if (adRuntimeDigest(root)) buildAdRuntime(root,path.join(process.env.STAGE,"image-renderer"));'

# The worker reads the shortform diagram list from ../lib when it loads.
mkdir -p "$STAGE/lib" && cp "$TOOLS/../lib/shortform-diagram-catalog.json" "$STAGE/lib/"
"$MYIN_PYTHON" -s -m pip freeze > "$STAGE/requirements.lock"
echo "$PY" > "$STAGE/python-version"
echo "$FP" > "$STAGE/FINGERPRINT"
echo "$AFP" > "$STAGE/ASSETS"
tar -C "$STAGE" -czf "$BUNDLE.part" . && mv "$BUNDLE.part" "$BUNDLE"
echo "엔진 묶음: $BUNDLE ($(du -h "$BUNDLE" | cut -f1)) · 지문 $FP"
echo "BUNDLE=$BUNDLE"; echo "PYTHON=$PY"; echo "ASSETS=$AFP"; echo "ASSETS_BUNDLE=$ABUNDLE"
