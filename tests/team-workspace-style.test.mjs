// 팀 메뉴 화면 CSS(components/team-workspace.css)가 OS CSS 규칙을 지키는지 검사합니다.
// 기존 tests/final-style.test.mjs · tests/screenshot-theme-regressions.test.mjs 와 같은 방식(postcss)입니다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const FILE = "components/team-workspace.css";
const root = postcss.parse(readFileSync(FILE, "utf8"));
const tokens = postcss.parse(readFileSync("app/theme-tokens.css", "utf8"));
function palette(theme) {
  const out = {};
  for (const r of tokens.nodes) if (r.type === "rule" && (r.selector === ":root" || (theme === "light" && r.selector === 'html[data-theme="light"]')))
    for (const d of r.nodes) if (d.type === "decl") out[d.prop] = d.value;
  return out;
}

// 괄호 안 쉼표(:is(a, button))는 나누지 않는 선택자 나누기
const splitSelectors = sel => { const out = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } return [...out, cur.trim()]; };

test("team css: 모든 규칙은 .linear-shell .ui-v2 .tm-root 아래에 있다", () => {
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    for (const selector of splitSelectors(rule.selector)) assert.match(selector, /^\.linear-shell \.ui-v2 \.tm-root\b/, `${FILE}: ${selector}`);
  });
});

test("team css: 색은 토큰만 쓰고 테마별 선택자가 없다", () => {
  const light = palette("light");
  root.walkRules(rule => assert.ok(!rule.selector.includes("data-theme"), `${FILE}: ${rule.selector}`));
  root.walkDecls(decl => {
    assert.doesNotMatch(decl.value, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black)\b/i, `${FILE}: ${decl.parent.selector} ${decl.prop}`);
    for (const match of decl.value.matchAll(/var\((--[\w-]+)/g)) assert.ok(light[match[1]], `undefined ${match[1]} in ${decl.parent.selector}`);
  });
});

test("team css: 글자는 11px 이상", () => {
  root.walkDecls(/^(font|font-size)$/, decl => {
    const m = decl.value.match(/\b(\d+(?:\.\d+)?)px/);
    if (m) assert.ok(Number(m[1]) >= 11, `${decl.parent.selector}: ${decl}`);
  });
});

test("team css: 새 클래스는 .tm- 접두어만 만든다", () => {
  // 기존 OS 클래스(재사용 허용 목록) — 스타일 가이드 2장 표와 같음
  const reused = new Set(["linear-shell","ui-v2","workspace-tabs","segmented","task-board","record-drawer","drawer-head","form-modal","data-table","metric-value","card-head","active"]);
  root.walkRules(rule => {
    for (const cls of rule.selector.matchAll(/\.([a-z][\w-]*)/g)) {
      const name = cls[1];
      assert.ok(name.startsWith("tm-") || reused.has(name), `${FILE}: 새 클래스는 tm- 접두어 — ${name} (${rule.selector})`);
    }
  });
});

test("team css: 화면에 쓰는 글자·바탕 짝이 두 테마 모두 4.5:1 이상", () => {
  const lum = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + .05) / (l + .05); };
  const pairs = [["--accent-2","--accent-soft"],["--warning","--warning-soft"],["--danger","--danger-soft"],["--mint","--mint-soft"],["--purple","--purple-soft"],["--cyan","--cyan-soft"],
    ["--text-2","--panel-3"],["--on-accent","--accent"],["--text","--warning-soft"],["--text-2","--warning-soft"],["--text","--accent-soft"],["--text-2","--accent-soft"],
    ["--text","--danger-soft"],["--text","--mint-soft"],["--text","--purple-soft"],["--muted","--card"],["--text-2","--card"],["--bg","--mint"]];
  for (const theme of ["dark", "light"]) {
    const p = palette(theme);
    for (const [fg, bg] of pairs) assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${theme} ${fg} on ${bg}`);
  }
});

test("team css: app/layout.tsx 에서 마지막에 불러온다", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const imports = [...layout.matchAll(/import\s+"([^"]+\.css)"/g)].map(m => m[1]);
  assert.equal(imports.at(-1), "../components/team-workspace.css");
});
