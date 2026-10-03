import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";

function cssFiles(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? cssFiles(join(dir,entry.name)) : entry.name.endsWith('.css') ? [join(dir,entry.name)] : []);
}
test('application CSS has no explicit text smaller than 11px', () => {
  for (const file of [...cssFiles('app'),...cssFiles('components')]) {
    const css=readFileSync(file,'utf8');
    for(const match of css.matchAll(/\bfont(?:-size)?\s*:\s*[^;}]*?\b(\d+(?:\.\d+)?)px/g)) {
      assert.ok(Number(match[1])>=11, `${file}: ${match[0]}`);
    }
  }
});
test('card is the only palette addition and font is self-hosted', () => {
  const tokens=readFileSync('app/theme-tokens.css','utf8');
  assert.match(tokens,/--card: #141516/);
  assert.match(tokens,/--card: #ffffff/);
  assert.match(readFileSync('app/final-uiux.css','utf8'),/fonts\/pretendard\/PretendardVariable.woff2/);
  assert.ok(readFileSync('public/fonts/pretendard/PretendardVariable.woff2').length>100000);
});
