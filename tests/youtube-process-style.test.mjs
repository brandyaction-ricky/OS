// 유튜브 공정 v1 화면 CSS(components/youtube-process.css)가 OS CSS 규칙을 지키는지 검사합니다.
// tests/team-workspace-style.test.mjs 와 같은 방식(postcss)입니다. 규칙 설명: docs/handoff/youtube-process-20261015/01_스타일가이드.md
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import postcss from "postcss";

// Every youtube-process*.css (스타일 점검 P2: the card news sheet was outside the check and grew its own unscoped rules and fixed colours).
const FILES = readdirSync("components").filter(name => /^youtube-process.*\.css$/.test(name)).map(name => `components/${name}`);
const SCOPE = /^\.linear-shell \.ui-v2\.yp(?![\w-])/;
const sheets = FILES.map(file => [file, postcss.parse(readFileSync(file, "utf8"))]);
const tokens = postcss.parse(readFileSync("app/theme-tokens.css", "utf8"));
const osUi = postcss.parse(readFileSync("components/os-ui.css", "utf8"));

function palette(theme) {
  const out = {};
  for (const r of tokens.nodes) if (r.type === "rule" && (r.selector === ":root" || (theme === "light" && r.selector === 'html[data-theme="light"]')))
    for (const d of r.nodes) if (d.type === "decl") out[d.prop] = d.value;
  return out;
}
// os-ui.css 의 .linear-shell .ui-v2 아래 사용자 속성(--platform-youtube 등)도 토큰으로 인정
const osUiVars = new Set();
osUi.walkDecls(/^--/, d => osUiVars.add(d.prop));

const splitSelectors = sel => { const out = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(" || ch === "[") depth++; if (ch === ")" || ch === "]") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } return [...out, cur.trim()]; };
const inKeyframes = rule => rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name);

test("youtube css: 모든 규칙은 .linear-shell .ui-v2.yp 아래에 있다", () => {
  for (const [FILE, root] of sheets) {
    root.walkRules(rule => {
      if (inKeyframes(rule)) return;
      for (const selector of splitSelectors(rule.selector)) assert.match(selector, SCOPE, `${FILE}: ${selector}`);
    });
  }
});

test("youtube css: 색은 토큰·color-mix만 쓰고 테마별 선택자가 없다", () => {
  for (const [FILE, root] of sheets) {
    const light = palette("light"), dark = palette("dark");
    root.walkRules(rule => assert.ok(!rule.selector.includes("data-theme"), `${FILE}: ${rule.selector}`));
    root.walkDecls(decl => {
      if (decl.prop.startsWith("--")) assert.fail(`${FILE}: 새 사용자 속성 금지 ${decl.prop}`);
      assert.doesNotMatch(decl.value, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black)\b/i, `${FILE}: ${decl.parent.selector} ${decl.prop}`);
      for (const match of decl.value.matchAll(/var\((--[\w-]+)/g))
        assert.ok((light[match[1]] && dark[match[1]]) || osUiVars.has(match[1]), `undefined ${match[1]} in ${decl.parent.selector}`);
    });
  }
});

test("youtube css: 글자는 11px 이상", () => {
  for (const [FILE, root] of sheets) {
    root.walkDecls(/^(font|font-size)$/, decl => {
      const m = decl.value.match(/\b(\d+(?:\.\d+)?)px/);
      if (m) assert.ok(Number(m[1]) >= 11, `${decl.parent.selector}: ${decl}`);
    });
  }
});

test("youtube css: 새 클래스는 yp- 접두어만 만든다", () => {
  for (const [FILE, root] of sheets) {
    // The OS kit buttons are only referenced, to leave them their kit font (스타일 점검 P2); no new class uses their names.
    const allowed = new Set(["linear-shell", "ui-v2", "yp", "primary-button", "secondary-button"]);
    root.walkRules(rule => {
      if (inKeyframes(rule)) return;
      for (const cls of rule.selector.matchAll(/\.([a-z][\w-]*)/gi)) {
        const name = cls[1];
        assert.ok(name.startsWith("yp-") || allowed.has(name), `${FILE}: 새 클래스는 yp- 접두어 — ${name} (${rule.selector})`);
      }
    });
  }
});

test("youtube css: 키프레임 · 컨테이너 이름도 yp 로 시작한다", () => {
  for (const [FILE, root] of sheets) {
    root.walkAtRules("keyframes", at => assert.match(at.params, /^yp-/, `@keyframes ${at.params}`));
    root.walkAtRules("container", at => assert.match(at.params, /^yp\b/, `@container ${at.params}`));
  }
});

test("youtube css: 화면에 쓰는 글자·바탕 짝이 두 테마 모두 4.5:1 이상", () => {
  const lum = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + .05) / (l + .05); };
  // 스타일가이드 3장 '글자·바탕 짝' 표와 같음
  const pairs = [["--accent-2","--accent-soft"],["--warning","--warning-soft"],["--danger","--danger-soft"],["--mint","--mint-soft"],["--purple","--purple-soft"],["--cyan","--cyan-soft"],
    ["--on-accent","--accent"],["--bg","--mint"],["--bg","--danger"],["--bg","--purple"],["--bg","--muted"],["--bg","--text"],
    ["--text","--card"],["--text-2","--card"],["--muted","--card"],["--muted","--panel"],["--muted","--panel-2"],["--muted","--panel-3"],
    ["--text","--accent-soft"],["--text","--warning-soft"],["--text-2","--warning-soft"],["--accent-2","--card"],["--media-text","--media-bg"],["--media-muted","--media-bg"]];
  for (const theme of ["dark", "light"]) {
    const p = palette(theme);
    for (const [fg, bg] of pairs) assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${theme} ${fg} on ${bg}`);
  }
});

test("youtube css: app/layout.tsx 에서 불러오지 않는다 (team-workspace.css 마지막 규칙 유지)", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.ok(!layout.includes("youtube-process.css"), "화면 컴포넌트에서 import 하세요");
});
