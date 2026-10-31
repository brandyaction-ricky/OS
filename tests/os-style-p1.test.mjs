// OS 스타일 점검 P1(2026-10-31)에서 고친 것이 다시 나빠지지 않게 막는 검사입니다.
// 근거: docs/handoff/os-style-fix-20261031/00_P1_수정지시서.md
// 방식은 tests/team-workspace-style.test.mjs 와 같습니다(postcss로 CSS 파일을 읽어 규칙을 봄).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const walk = (dir, ext, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.test(name)) out.push(path);
  }
  return out;
};
// components/vendor/ holds package CSS copied as-is into a layer (공통 CSS 구조 L0); it is not ours to fix.
const CSS_FILES = [...walk("app", /\.css$/), ...walk("components", /\.css$/)].filter(file => !file.startsWith(join("components", "vendor")));
const CODE_FILES = [...walk("app", /\.(tsx?|mjs)$/), ...walk("components", /\.(tsx?|mjs)$/), ...walk("lib", /\.(tsx?|mjs)$/)];
const parsed = CSS_FILES.map(file => ({ file, root: postcss.parse(readFileSync(file, "utf8")) }));
const at = (file, node) => `${file}:${node.source.start.line}`;
const inKeyframes = rule => rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name);

test("P1-1 글자색에 강조 바탕색(--accent · --kw-accent · --hr-accent)을 쓰지 않는다 — 글자는 --accent-2", () => {
  // 어두운 테마의 --accent(#716879)는 단추 바탕용이라 글자로 쓰면 바탕과 3.41:1 밖에 안 된다.
  const bad = [];
  for (const { file, root } of parsed) root.walkDecls("color", d => {
    if (/^var\(\s*--(?:kw-|hr-)?accent\s*[,)]/.test(d.value.trim())) bad.push(`${at(file, d)} ${d.parent.selector}`);
  });
  assert.deepEqual(bad, []);
});

test("P1-2 정의되지 않은 사용자 속성을 쓰지 않는다 (대체값으로 가리지 않는다)", () => {
  // var(--surface,#fff) 처럼 없는 변수의 대체값이 어두운 테마에서 흰 카드를 만들었다.
  const ALLOWED = new Set(["--stack-gap"]); // os-ui.css: 화면이 원할 때만 덮어쓰는 조절값, 대체값 8px 이 기본
  const defined = new Set();
  for (const { root } of parsed) root.walkDecls(/^--/, d => defined.add(d.prop));
  for (const file of CODE_FILES) for (const m of readFileSync(file, "utf8").matchAll(/["'`{;\s](--[a-z][\w-]*)\s*["'`]?\s*:/g)) defined.add(m[1]);
  const bad = [];
  for (const { file, root } of parsed) root.walkDecls(d => {
    for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) if (!defined.has(m[1]) && !ALLOWED.has(m[1])) bad.push(`${at(file, d)} ${m[1]}`);
  });
  assert.deepEqual(bad, []);
});

test("P1-3 글자는 11px 이상 (화살표 글리프 .nav-chevron 만 예외)", () => {
  const bad = [];
  for (const { file, root } of parsed) root.walkDecls(/^(font|font-size)$/, d => {
    if (inKeyframes(d.parent) || /nav-chevron/.test(d.parent.selector ?? "")) return;
    const m = d.value.match(/(?:^|\s)(\d+(?:\.\d+)?)px/);
    if (m && Number(m[1]) < 11) bad.push(`${at(file, d)} ${d.parent.selector} ${d.prop}: ${d.value}`);
  });
  assert.deepEqual(bad, []);
  // <small> 은 브라우저 기본(smaller)이면 13px 부모에서 10.8px 이 된다 → 11px 아래로 내려가지 않게
  const globals = parsed.find(p => p.file === join("app", "globals.css")).root;
  let small = null;
  globals.walkRules(r => { if (r.selector.trim() === "small") r.walkDecls("font-size", d => { small = d.value; }); });
  assert.equal(small, "max(11px, calc(1em / 1.2))");
});

test("P1-4 인사 · 스레드 편집 화면은 상태 색을 테마 토큰으로만 쓴다", () => {
  // 대체값 안의 hex(var(--panel, #fff))는 토큰이 있으므로 보지 않는다. 바탕·그림자·알림 배지는 P2 정리 대상.
  const P2_LATER = /^\.hr-(drawer-backdrop|drawer|toast|nav-badge)$/;
  const bad = [];
  for (const file of ["components/hr/hr.css", "components/threads-editorial-workspace.css"]) {
    postcss.parse(readFileSync(file, "utf8")).walkDecls(d => {
      if (P2_LATER.test(d.parent.selector?.trim() ?? "")) return;
      const value = d.value.replace(/var\(\s*--[\w-]+\s*,[^()]*\)/g, "var()");
      if (/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black)\b/i.test(value)) bad.push(`${file}:${d.source.start.line} ${d.parent.selector} ${d.prop}: ${d.value}`);
    });
  }
  assert.deepEqual(bad, []);
});

test("P1-5 상태색(--danger · --mint · --warning · --cyan · --purple)으로 칠한 바탕 위 글자는 var(--bg)", () => {
  // 어두운 테마의 상태색은 밝아서 흰 글자(--on-accent)를 올리면 2.35:1 이 된다. --bg 는 두 테마 모두 5.5:1 이상.
  const bad = [];
  for (const { file, root } of parsed) root.walkRules(rule => {
    if (inKeyframes(rule)) return;
    let bg = null, fg = null;
    rule.each(d => { if (d.type !== "decl") return; if (/^background(-color)?$/.test(d.prop)) bg = d.value.trim(); if (d.prop === "color") fg = d.value.trim(); });
    if (bg && fg && /^var\(--(danger|mint|warning|cyan|purple)\)$/.test(bg) && fg !== "var(--bg)") bad.push(`${at(file, rule)} ${rule.selector} color: ${fg}`);
  });
  assert.deepEqual(bad, []);
});

test("P1-6 작은 누를 곳은 최소 24px", () => {
  const need = [
    ["components/fullscreen-shell.css", ".linear-shell.shell-v2 .guide-strip .guide-strip-close"],
    ["components/finance/finance.css", ".page-content .finance-workspace .rowbtn"],
    ["components/fullscreen-operations.css", ".linear-shell .ui-v2 .fullscreen-connection-list button"],
  ];
  for (const [file, selector] of need) {
    let min = 0;
    postcss.parse(readFileSync(file, "utf8")).walkRules(r => {
      if (r.parent?.type === "atrule" && r.parent.name !== "layer") return; // 휴대폰 값(40px)은 따로 · @layer 안은 그대로 본다
      if (r.selector.trim() === selector) r.walkDecls("min-height", d => { min = Math.max(min, parseFloat(d.value)); });
    });
    assert.ok(min >= 24, `${file} ${selector} min-height ${min}px`);
  }
});
