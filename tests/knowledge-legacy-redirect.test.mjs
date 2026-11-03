import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nextServer = createRequire(import.meta.url)("next/server");
const source = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const mod = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: name => { assert.equal(name, "next/server"); return nextServer; }, URL, encodeURIComponent });
const { middleware, config } = mod.exports;
const at = (path, headers = {}) => middleware(new nextServer.NextRequest(`https://os.example.test${path}`, { headers }));

test("old 회사 문서 addresses get one 308 to the same places the page sends them", () => {
  for (const [path, target] of [
    ["/knowledge?tab=canon", "/knowledge/canon"],
    ["/knowledge?document=a%2Fb", "/knowledge/doc/a%2Fb"],
    ["/knowledge?new=1", "/knowledge/notes?new=1&tab=all"],
    ["/knowledge", "/knowledge/vault"],
    ["/knowledge?tab=other", "/knowledge/vault"],
  ]) {
    const response = at(path), location = new URL(response.headers.get("location"));
    assert.equal(response.status, 308, path);
    assert.equal(location.pathname + location.search, target, path);
  }
  assert.equal(config.matcher, "/knowledge");
});
