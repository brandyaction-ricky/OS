// 스타일 점검 P2 (2026-10-31): inline style={{ … }} grew from 53 to 549 between 10/11 and 10/31 and kept screens from sharing one look.
// New screens use classes; this number may only go down (lower it when inline styles turn into classes).
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CEILING = 549;
const files = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : []; });

test("inline styles in screens do not grow", () => {
  const count = ["app", "components"].flatMap(files).reduce((sum, path) => sum + (readFileSync(path, "utf8").match(/style=\{\{/g) ?? []).length, 0);
  assert.ok(count <= CEILING, `inline style={{ … }} ${count} > ${CEILING}: use a class instead`);
});
