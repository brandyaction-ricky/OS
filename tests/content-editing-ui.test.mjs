import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("shortform opens manual editing when timed captions are unavailable", async () => {
  const source = await read("components/content-shortform-workspace.tsx");
  assert.match(source, /const timedCueCount = parseTimedTranscript\(transcript\)\.length/);
  assert.match(source, /if \(!timedCueCount\) \{\s*openManualClip\(\);\s*return;/);
  assert.match(source, /timedCueCount \? "구간 제안" : "수동 편집"/);
  assert.match(source, /자막이 없으면 시작·종료 시간을 직접 정하는 수동 편집/);
  assert.doesNotMatch(source, /accentColor|<span>강조<\/span>/);
});

test("packaging results render before the background refresh completes", async () => {
  const source = await read("components/content-packaging-workspace.tsx");
  assert.match(source, /setPackages\(\(current\) =>/);
  assert.match(source, /setTab\("title"\)/);
  assert.match(source, /void load\(\)/);
  assert.doesNotMatch(source, /setTab\("title"\);\s*await load\(\)/);
});

test("thumbnail cards and native selects respond to the available viewport", async () => {
  const styles = await read("app/globals.css");
  assert.match(styles, /own-thumbnail-strip>div:last-child\{[^}]*display:grid[^}]*auto-fit/);
  assert.match(styles, /own-thumbnail-strip a>span\{[^}]*aspect-ratio:16\/9/);
  assert.match(styles, /select:not\(\[multiple\]\) \{[\s\S]*appearance:none;[\s\S]*background-image:url/);
  assert.match(styles, /\.shorts-transcript \{[^}]*padding:13px[^}]*border-bottom/);
});
