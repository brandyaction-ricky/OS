import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project overview hides visible status labels while keeping accessible filter names", async () => {
  const source = await readFile(new URL("../components/development-project-overview.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label={`\$\{label\} \$\{count\}건 보기`}/);
  assert.doesNotMatch(source, /<span>{label}<\/span>/);
  assert.match(source, /<strong>{count}<\/strong>/);
});

test("request detail exposes a confirmed soft-delete action", async () => {
  const source = await readFile(new URL("../components/project-hub-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.confirm/);
  assert.match(source, /"DELETE"/);
  assert.match(source, /요청 삭제/);
});
