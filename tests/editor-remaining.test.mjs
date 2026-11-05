import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { editorSettings } from "../public/myin-local/myin-local.mjs";

// 로건 개발 문서 v3 7.2-2 · 7.2-11 · 7.2-12: an older engine is refused, the runner tells the editor its settings, editor pictures are the OS's.

test("the runner writes the editor's settings: engine folders, Python, fingerprint, render slots — and no key", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "myin-home-")), dir = path.join(home, "engine-x");
  for (const part of ["pkg", "diagrams", "fonts"]) mkdirSync(path.join(dir, "engine", part), { recursive: true });
  const s = editorSettings({ dir, python: "/py" }, home, "a".repeat(32), 4);
  assert.deepEqual([s.engine.fingerprint, s.engine.python, s.engine.pkg, s.engine.library, s.slots], ["a".repeat(32), "/py", path.join(dir, "engine", "pkg"), path.join(home, "no-library"), 2]);
  assert.equal(editorSettings({ dir, python: "/py" }, home, "b", 32).slots, 8, "at most 8 pieces at once");
  assert.ok(!JSON.stringify(s).includes("bos_pat") && !("key" in s));
  const runner = readFileSync(new URL("../public/myin-local/myin-local.mjs", import.meta.url), "utf8");
  assert.match(runner, /writeFileSync\(path\.join\(home, "editor\.json"\), JSON\.stringify\(editorSettings\(engine, home, info\.fingerprint\), null, 1\)\)/);
});

test("a confirm from an engine that is neither the render PC's nor the one that drew the final is refused", () => {
  const edit = readFileSync(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  const start = edit.slice(edit.indexOf("export async function confirmStart"), edit.indexOf("export async function confirmFinish"));
  assert.match(start, /const allowed = \[await renderPcEngine\(\), await myinFinalEngine\(service, project\.id\)\]\.filter/);
  assert.match(start, /if \(allowed\.length && !allowed\.includes\(input\.engine\)\) throw new ApiError\(409, "EDIT_ENGINE_OLD"/);
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /return final\?\.edit\?\.engine \?\? final\?\.engine \?\? null;/);
});

test("editor pictures go to the OS's store for the video (not 우리 사진, which re-prepare ④) and come with a handoff", () => {
  const edit = readFileSync(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  const saved = edit.slice(edit.indexOf("export async function editorImageSaved"));
  assert.match(saved, /\/\^edit-\[a-f0-9-\]\{12\}\\\.\(jpg\|png\|webp\)\$\//, "only a name the OS gave");
  assert.match(saved, /await heldSession\(service, actor, project\.id, input\.pc\)/, "the editor holding the lock");
  assert.match(edit.slice(edit.indexOf("export async function editorImageUpload")), /await heldSession\(service, actor, project\.id, pc\)/);
  assert.match(edit.slice(edit.indexOf("export async function editHandoff")), /bundle, images,/);
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const upload = run.slice(run.indexOf("export async function myinEditorImageUpload"), run.indexOf("export async function myinEditorImageSize"));
  assert.match(upload, /editor-images\//);
  assert.doesNotMatch(upload, /ours|prep_ready|save\(/, "never 우리 사진, never moves the run");
});
