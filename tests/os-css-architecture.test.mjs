// 브랜디 OS 공통 스타일 가이드 v1.0 — CSS 구조 검사 (tests/os-css-architecture.test.mjs)
// 지키는 것: 레이어 구조 · 파일별 레이어 배정 · 금지 항목 · 지금보다 나빠지지 않기(ratchet).
// 숫자 기준(BASELINE)은 2026-10-31 main d75de32c 의 값이다. 고쳐서 줄면 BASELINE 도 같이 줄인다. 늘리면 실패한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

// fileURLToPath: .pathname keeps a non-ASCII folder name percent-encoded.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = p => readFileSync(join(ROOT, p), "utf8");
const walk = (dir, ext) => readdirSync(join(ROOT, dir)).flatMap(n => {
  const p = join(dir, n);
  if (n === "node_modules" || n.startsWith(".")) return [];
  return statSync(join(ROOT, p)).isDirectory() ? walk(p, ext) : ext.test(n) ? [p] : [];
});
const CSS_FILES = [...walk("app", /\.css$/), ...walk("components", /\.css$/)].sort();

// ── 0. 단계 ── L0 PR: 모든 파일을 os.legacy 하나로 감싸기만(화면 변화 0). L1 PR부터: 아래 FILE_LAYER 표대로.
const STAGE = "L0";

// ── 1. 레이어 ──
export const ORDER = "@layer os.vendor, os.base, os.legacy, os.kit, os.screen;";
// 파일 → 레이어. 새 CSS 파일을 만들면 여기에 먼저 적는다(적지 않으면 실패).
const FILE_LAYER = {
  "app/theme-tokens.css": null, // 색 토큰: 레이어 밖(어떤 레이어도 못 덮음)
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
  "components/vendor/mdxeditor.layered.css": "os.legacy", // 지금 겹침 순서 그대로. os.vendor 로 옮기면 편집기 도구 글자색 19곳이 바뀜 [확인] — 결정 D2
};
// 화면 파일 → 메뉴 접두어 (공통 가이드 7장 등록표)
const SCREEN_PREFIX = {
  "components/team-workspace.css": ["tm-"],
  "components/content-automation-v07.css": ["ca-"],
  "components/content-automation-worker.css": ["ca-"],
  "components/hr/hr.css": ["hr-"],
  "components/finance/finance.css": ["fin-", "finance-"],
  "components/knowledge-vault.css": ["vault-"],
  "components/knowledge/workspace.css": ["kw-"],
};

test("모든 CSS 파일이 표에 있고, 첫 줄은 같은 레이어 순서 문장이다", () => {
  for (const f of CSS_FILES) {
    if (STAGE === "L0" && f === "app/os-foundation.css") continue;
    assert.ok(f in FILE_LAYER, `${f}: FILE_LAYER 표에 없음 — 레이어를 정해서 적는다`);
    const root = postcss.parse(read(f));
    const first = root.nodes.find(n => n.type !== "comment");
    assert.equal(first?.type === "atrule" && `@layer ${first.params};`, ORDER, `${f}: 첫 문장이 ${ORDER} 가 아님`);
  }
});

test("규칙은 정해진 레이어 블록 안에만 있다 (색 토큰 파일만 예외)", () => {
  for (const f of CSS_FILES) {
    if (!(f in FILE_LAYER)) continue; // 첫 검사가 알려 줌
    const want = STAGE === "L0" && FILE_LAYER[f] !== null ? "os.legacy" : FILE_LAYER[f];
    const root = postcss.parse(read(f));
    const blocks = root.nodes.filter(n => n.type !== "comment").slice(1);
    if (want === null) {
      for (const n of blocks) assert.ok(n.type === "rule", `${f}: 색 토큰 파일에는 레이어 블록·@규칙을 두지 않는다`);
      continue;
    }
    const allowed = want.split("+");
    for (const n of blocks) {
      assert.ok(n.type === "atrule" && n.name === "layer" && n.nodes, `${f}: 레이어 밖 규칙 ${n.selector || n.name || n.type}`);
      assert.ok(allowed.includes(n.params), `${f}: @layer ${n.params} — 이 파일은 ${want}`);
    }
  }
});

test("@import 금지 (Next 15.5 는 @import … layer() 를 @media layer() 로 바꿔 규칙이 죽는다)", () => {
  for (const f of CSS_FILES) postcss.parse(read(f)).walkAtRules("import", a => assert.fail(`${f}: @import ${a.params}`));
});

test("패키지 CSS 를 컴포넌트에서 직접 불러오지 않는다 (레이어 밖 CSS 는 모든 레이어를 이긴다)", () => {
  const ALLOWED = []; // 이식 끝나면 비어 있어야 함. @mdxeditor/editor/style.css 는 components/vendor/mdxeditor.layered.css 로.
  for (const f of [...walk("app", /\.tsx?$/), ...walk("components", /\.tsx?$/)]) {
    for (const m of read(f).matchAll(/import\s+["']([^"']+\.css)["']/g)) {
      if (m[1].startsWith(".") || m[1].startsWith("@/")) continue;
      assert.ok(ALLOWED.includes(m[1]), `${f}: ${m[1]} — 레이어로 감싼 사본을 불러온다`);
    }
  }
});

test("app/layout.tsx: 색 토큰 → os-foundation 순서로 먼저 불러온다", () => {
  const imports = [...read("app/layout.tsx").matchAll(/import\s+"([^"]+\.css)"/g)].map(m => m[1]);
  assert.deepEqual(imports.slice(0, STAGE === "L0" ? 1 : 2), ["./theme-tokens.css", "./os-foundation.css"].slice(0, STAGE === "L0" ? 1 : 2));
});

// ── 2. 나빠지지 않기 ──
const KIT_FILES = CSS_FILES.filter(f => (FILE_LAYER[f] || "").includes("os.kit"));
const kitClasses = new Set();
for (const f of KIT_FILES) postcss.parse(read(f)).walkRules(r => { for (const m of r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) kitClasses.add(m[1]); });
const SHELL = new Set(["linear-shell", "unified-shell", "shell-v2", "ui-v2", "page-content", "os-app", "active"]);
const FONT_SCALE = new Set([11, 11.5, 12, 12.5, 13, 14, 15, 18, 20, 22, 24, 28]);
const BREAKS = new Set(["max1100", "max820", "max520", "min821"]);
const VISUAL = /^(font-size|font-family|height|min-height|padding.*|border-radius|color|background.*)$/;

function count(f) {
  const c = { important: 0, color: 0, themeSel: 0, idSel: 0, fontOff: 0, breakOff: 0, foreign: 0, kitOverride: 0 };
  const root = postcss.parse(read(f));
  const prefixes = SCREEN_PREFIX[f];
  root.walkAtRules("media", a => { for (const m of a.params.matchAll(/(max|min)-width:\s*(\d+)px/g)) if (!BREAKS.has(m[1] + m[2])) c.breakOff++; });
  root.walkRules(r => {
    if (r.parent?.type === "atrule" && /keyframes/.test(r.parent.name)) return;
    if (/data-theme/.test(r.selector)) c.themeSel++;
    if (/#[a-zA-Z][\w-]*/.test(r.selector.replace(/\[[^\]]*\]/g, ""))) c.idSel++;
    let kitSubject = false;
    for (const sel of r.selectors) {
      const parts = sel.split(/\s*[\s>+~]\s*/).filter(Boolean);
      const subject = parts[parts.length - 1] || "";
      if ([...subject.matchAll(/\.([a-zA-Z][\w-]*)/g)].some(m => kitClasses.has(m[1]) && !SHELL.has(m[1]))) kitSubject = true;
      if (prefixes) for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
        const n = m[1];
        if (!prefixes.some(p => n.startsWith(p)) && !kitClasses.has(n) && !SHELL.has(n) && !/^screen-/.test(n)) c.foreign++;
      }
    }
    r.walkDecls(d => {
      if (d.important) c.important++;
      if (f !== "app/theme-tokens.css" && /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b/i.test(d.value)) c.color++;
      if (d.prop === "font-size") { const m = d.value.match(/^(\d+(?:\.\d+)?)px$/); if (m && !FONT_SCALE.has(+m[1])) c.fontOff++; }
      if (prefixes && kitSubject && VISUAL.test(d.prop)) c.kitOverride++;
    });
  });
  return c;
}

// 기준값 다시 뽑기: OS_CSS_BASELINE=1 node --test tests/os-css-architecture.test.mjs
if (process.env.OS_CSS_BASELINE) console.log("BASELINE " + JSON.stringify(Object.fromEntries(CSS_FILES.map(f => [f, Object.fromEntries(Object.entries(count(f)).filter(([, v]) => v))])))); 

// 2026-10-31 main d75de32c 기준값 (03_1031_보충 2장 2 — 스타일 점검 P1 · P2 뒤에 다시 뽑음). 파일을 고치면 숫자를 줄여 적는다. 표에 없는 새 파일은 전부 0 이어야 한다.
const BASELINE = {
  "app/final-uiux.css": {"important": 1, "breakOff": 4},
  "app/globals.css": {"important": 53, "color": 2, "fontOff": 32, "breakOff": 54},
  "app/share/[token]/share.css": {"color": 7},
  "app/theme-tokens.css": {"themeSel": 1},
  "components/content-automation-hub.css": {"color": 1, "breakOff": 2},
  "components/content-automation-v07.css": {"color": 15, "fontOff": 2, "breakOff": 1, "foreign": 2, "kitOverride": 2},
  "components/content-automation-worker.css": {"fontOff": 1, "breakOff": 1},
  "components/cost-notice.css": {"breakOff": 1},
  "components/development-notifications.css": {"breakOff": 2},
  "components/development-workspace.css": {"fontOff": 6, "breakOff": 3},
  "components/finance/finance.css": {"important": 3, "color": 9, "fontOff": 9, "breakOff": 5, "foreign": 488, "kitOverride": 31},
  "components/fullscreen-content.css": {"fontOff": 1, "breakOff": 2},
  "components/fullscreen-documents.css": {"fontOff": 1, "breakOff": 1},
  "components/fullscreen-operations.css": {"fontOff": 2},
  "components/hr/hr.css": {"important": 1, "fontOff": 3, "breakOff": 1, "foreign": 15, "kitOverride": 22},
  "components/indexing-progress.css": {"breakOff": 1},
  "components/knowledge-vault.css": {"important": 6, "color": 2, "fontOff": 7, "breakOff": 5, "foreign": 109, "kitOverride": 12},
  "components/knowledge/workspace.css": {"important": 14, "color": 31, "fontOff": 6, "breakOff": 9, "foreign": 7, "kitOverride": 2},
  "components/linear-shell.css": {"important": 3, "fontOff": 1},
  "components/myin-sound-editor.css": {"breakOff": 1},
  "components/os-ui.css": {"color": 4, "fontOff": 3},
  "components/production-hub.css": {"breakOff": 2},
  "components/team-workspace.css": {"fontOff": 4, "foreign": 8, "kitOverride": 4},
  "components/team/meeting-board.css": {"color": 1, "breakOff": 1},
  "components/team/team-kpi.css": {"color": 1, "breakOff": 1},
  "components/threads-editorial-workspace.css": {"fontOff": 1, "breakOff": 1},
  "components/threads-reference-workspace.css": {"breakOff": 3},
  "components/vendor/mdxeditor.layered.css": {"important": 4, "color": 246},
  "components/youtube-process-card.css": {"important": 1, "breakOff": 2},
  "components/youtube-process.css": {"important": 5, "fontOff": 7, "breakOff": 6},
};

test("파일마다: !important · 색 직접 쓰기 · 테마 선택자 · id 선택자 · 크기 단계 밖 · 끊는 점 밖 · 남의 클래스 · 키트 모양 덮기가 늘지 않는다", () => {
  for (const f of CSS_FILES) {
    if (f.startsWith("components/vendor/")) continue; // 패키지 원문 그대로 — 고치지 않는다
    const now = count(f), base = BASELINE[f] || {};
    for (const [k, v] of Object.entries(now)) assert.ok(v <= (base[k] || 0), `${f}: ${k} ${v} > 기준 ${base[k] || 0}`);
  }
});
