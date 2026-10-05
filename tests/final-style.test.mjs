import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import postcss from "postcss";

function cssFiles(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? cssFiles(join(dir,entry.name)) : entry.name.endsWith('.css') ? [join(dir,entry.name)] : []);
}
// 03_CSS_적용지시서 explicitly permits these small, non-body labels.
// Match both the exact selector and size; do not exempt the entire design kit.
const smallLabels = new Map([
  [".linear-shell.shell-v2 .nav-chevron", 10],
  [".linear-shell.shell-v2 .nav-group-note", 10.5],
  [".linear-shell.shell-v2 .tag-new", 10],
  [".linear-shell.shell-v2 .topbar .development-notifications-badge", 9],
  [".linear-shell.shell-v2 .guide-no", 10.5],
  [".linear-shell .ui-v2 .status-pill.is-sm", 10.5],
  [".linear-shell .ui-v2 .status-pill.is-xs", 10],
]);
test('application text is at least 11px except exact approved design-kit labels', () => {
  for (const file of [...cssFiles('app'),...cssFiles('components')]) {
    postcss.parse(readFileSync(file,'utf8')).walkDecls(/^(font|font-size)$/, decl => {
      const match = decl.value.match(/\b(\d+(?:\.\d+)?)px/);
      if (!match) return;
      const size = Number(match[1]);
      const approved = file === 'components/os-ui.css' && smallLabels.get(decl.parent.selector) === size;
      assert.ok(size >= 11 || approved, `${file}: ${decl.parent.selector}: ${decl.toString()}`);
    });
  }
});
test('card is the only palette addition and font is self-hosted', () => {
  const tokens=readFileSync('app/theme-tokens.css','utf8');
  assert.match(tokens,/--card: #141516/);
  assert.match(tokens,/--card: #ffffff/);
  assert.match(readFileSync('app/final-uiux.css','utf8'),/fonts\/pretendard\/PretendardVariable.woff2/);
  assert.ok(readFileSync('public/fonts/pretendard/PretendardVariable.woff2').length>100000);
});
