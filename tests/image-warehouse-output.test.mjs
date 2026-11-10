import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import JSZip from "jszip";
import * as formats from "../lib/image-creative/formats.ts";

test("a mixed ZIP keeps the reviewed warehouse PNG and the authenticated legacy PNG in batch order", async () => {
  const source = readFileSync(new URL("../lib/image-creative/warehouse-output.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = createRequire(new URL("../lib/image-creative/warehouse-output.ts", import.meta.url));
  const compiled = { exports: {} };
  let download;
  const link = { click() { download = { name: this.download, url: this.href }; } };
  vm.runInNewContext(code, {
    exports: compiled.exports, module: compiled, require: name => name === "./formats" ? formats : require(name),
    document: { createElement: () => link }, window: { setTimeout() {} }, URL, Blob,
  });
  const rows = [{ id: "new", formatId: "A04", size: "portrait" }, { id: "old", formatId: "report_crop", size: "square" }];
  const reviewed = new Blob([Uint8Array.of(14, 16)], { type: "image/png" });
  const classic = new Blob([Uint8Array.of(40, 41)], { type: "image/png" });
  const getPreview = v => { assert.equal(v.id, "new"); return reviewed; };
  const getLegacy = async v => { assert.equal(v.id, "old"); return classic; };
  await compiled.exports.downloadWarehouseSelection(rows, getPreview, getLegacy, "set.zip", "batch", { batch: { id: "set" } });
  assert.equal(download.name, "set.zip");
  try {
    const archive = await JSZip.loadAsync(await (await fetch(download.url)).arrayBuffer());
    assert.deepEqual(Object.keys(archive.files), ["01-new.png", "02-old.png", "variants.json"]);
    assert.deepEqual([...await archive.file("01-new.png").async("uint8array")], [14, 16]);
    assert.deepEqual([...await archive.file("02-old.png").async("uint8array")], [40, 41]);
    assert.equal(JSON.parse(await archive.file("variants.json").async("string")).batch.id, "set");
  } finally { URL.revokeObjectURL(download.url); }
  await assert.rejects(compiled.exports.downloadWarehouseSelection(rows, () => undefined, getLegacy, "set.zip", "batch"), /PNG가 준비/);
});
