#!/usr/bin/env node
// 브랜디 OS CSS 를 레이어로 감싼다 (공통 스타일 가이드 v1.0 · 00_개발지시서 L0 · L1).
// 사용: node tools/wrap-css-layers.mjs L0            모든 파일을 os.legacy 하나로 (화면 변화 0)
//       node tools/wrap-css-layers.mjs L1 <기반파일>  표대로 레이어 나누기 + app/os-foundation.css 추가
// 표(FILE_LAYER)는 tests/os-css-architecture.test.mjs 와 같아야 한다. 새 CSS 파일은 두 곳에 같이 적는다.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ORDER = "@layer os.vendor, os.base, os.legacy, os.kit, os.screen;";
const FILE_LAYER = {
  "app/theme-tokens.css": null,
  "app/os-foundation.css": "os.base+os.kit",
  "app/globals.css": "os.legacy",
  "components/linear-shell.css": "os.legacy",
  "components/unified-shell.css": "os.legacy",
  "components/personal-work.css": "os.legacy",
  "components/meeting-tasks.css": "os.legacy",
  "components/production-hub.css": "os.legacy",
  "components/indexing-progress.css": "os.legacy",
  "app/final-uiux.css": "os.legacy",
  "components/content-automation-hub.css": "os.legacy",
  "components/development-workspace.css": "os.legacy",
  "components/development-notifications.css": "os.legacy",
  "components/os-ui.css": "os.kit",
  "components/fullscreen-shell.css": "os.kit",
  "components/fullscreen-content.css": "os.kit",
  "components/fullscreen-documents.css": "os.kit",
  "components/fullscreen-operations.css": "os.kit",
  "components/team-workspace.css": "os.screen",
  "components/content-automation-v07.css": "os.screen",
  "components/content-automation-worker.css": "os.screen",
  "components/hr/hr.css": "os.screen",
  "components/finance/finance.css": "os.screen",
  "components/knowledge-vault.css": "os.screen",
  "components/knowledge/workspace.css": "os.screen",
  // 10/11 이후 생긴 파일 (03_1031_보충 2장 1). L0 에서는 모두 os.legacy 로 감싸지므로 오른쪽 값은 L1 에만 쓰인다 — L1 전에 다시 정한다.
  "app/share/[token]/share.css": "os.screen",
  "components/cost-notice.css": "os.legacy", // 여러 메뉴가 쓰는 공용 창
  "components/meeting-recorder.css": "os.screen",
  "components/myin-sound-editor.css": "os.screen",
  "components/team/meeting-board.css": "os.screen",
  "components/team/team-kpi.css": "os.screen",
  "components/threads-editorial-workspace.css": "os.screen",
  "components/threads-reference-workspace.css": "os.screen",
  "components/youtube-process.css": "os.screen",
  "components/youtube-process-card.css": "os.screen",
  "components/youtube-production-steps.css": "os.screen",
  "components/vendor/mdxeditor.layered.css": "os.legacy",
};
const VENDOR = { from: "node_modules/@mdxeditor/editor/dist/style.css", to: "components/vendor/mdxeditor.layered.css",
  importer: "components/knowledge-rich-editor-initialized.tsx", oldImport: 'import "@mdxeditor/editor/style.css";', newImport: 'import "./vendor/mdxeditor.layered.css";' };

const stage = process.argv[2];
if (!["L0", "L1"].includes(stage)) { console.error("사용: node tools/wrap-css-layers.mjs L0 | L1 <os-foundation.css 경로>"); process.exit(1); }
const walk = d => readdirSync(join(ROOT, d)).flatMap(n => { const p = join(d, n); return statSync(join(ROOT, p)).isDirectory() ? walk(p) : n.endsWith(".css") ? [p] : []; });
const read = p => readFileSync(join(ROOT, p), "utf8");
const write = (p, s) => writeFileSync(join(ROOT, p), s);
const isWrapped = css => css.startsWith(ORDER);
const unwrap = css => { // 이 스크립트가 만든 감싸기만 푼다
  const m = css.match(/^@layer os\.vendor, os\.base, os\.legacy, os\.kit, os\.screen;\n(?:\/\*[^]*?\*\/\n)?@layer ([\w.]+) \{\n([^]*)\n\}\n$/);
  if (!m) throw new Error("감싼 모양을 알 수 없음 — 손으로 고친 파일인지 확인");
  return m[2];
};
const wrap = (css, layer) => `${ORDER}\n@layer ${layer} {\n${css}\n}\n`;

// 1) 패키지 CSS 사본 (레이어 밖 CSS 는 모든 레이어를 이기므로)
if (!existsSync(join(ROOT, VENDOR.to))) {
  mkdirSync(join(ROOT, "components/vendor"), { recursive: true });
  write(VENDOR.to, wrap(read(VENDOR.from), "os.legacy").replace(`${ORDER}\n`, `${ORDER}\n/* 자동 생성: ${VENDOR.from} 원문. 고치지 말고 패키지를 올린 뒤 이 스크립트로 다시 만든다. */\n`));
  const t = read(VENDOR.importer);
  if (!t.includes(VENDOR.oldImport)) throw new Error(`${VENDOR.importer}: ${VENDOR.oldImport} 없음`);
  write(VENDOR.importer, t.replace(VENDOR.oldImport, VENDOR.newImport));
}

// 2) 기반 파일 (L1)
if (stage === "L1") {
  const src = process.argv[3];
  if (!src) throw new Error("L1 에는 os-foundation.css 경로가 필요");
  copyFileSync(src, join(ROOT, "app/os-foundation.css"));
  const lay = read("app/layout.tsx");
  if (!lay.includes('import "./os-foundation.css";')) write("app/layout.tsx", lay.replace('import "./theme-tokens.css";\n', 'import "./theme-tokens.css";\nimport "./os-foundation.css";\n'));
}

// 3) 감싸기
for (const f of [...walk("app"), ...walk("components")].sort()) {
  if (!(f in FILE_LAYER)) throw new Error(`${f}: FILE_LAYER 표에 없음`);
  if (f === "app/os-foundation.css") continue; // 이미 레이어로 씀
  let css = read(f);
  if (f === "app/theme-tokens.css") { if (!isWrapped(css)) write(f, `${ORDER}\n${css}`); continue; }
  if (f === VENDOR.to) { if (stage === "L1") write(f, css.replace(/^(@layer os\.vendor[^\n]*\n\/\*[^\n]*\*\/\n)@layer [\w.]+ \{/, `$1@layer ${FILE_LAYER[f]} {`)); continue; }
  const body = isWrapped(css) ? unwrap(css) : css;
  const layer = stage === "L0" ? "os.legacy" : FILE_LAYER[f];
  write(f, wrap(body, layer));
  console.log(`${f} → ${layer}`);
}
console.log(`끝 (${stage}). 다음: tests/os-css-architecture.test.mjs 의 STAGE 를 "${stage}" 로, npm test, 지문 비교(tools/css-fingerprint.mjs).`);
