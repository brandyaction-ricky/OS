import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as kosis from "../lib/kosis.ts";
import { editFeed, editorScreenState, orderMove, SCREEN_FILE } from "../lib/myin-edit.ts";

// 편집 화면 이식 ① (2026-11-05): the editor screen made on a member's computer moves into the 제작 tab; the OS gives it what that
// computer's own server gave it — versions with their files, hand edits apart from chat orders, saved versions, a 완성 waiting.
const at = (m) => `2026-11-05T09:${String(m).padStart(2, "0")}:00.000Z`;
const versions = [{ name: "v1", at: at(0), files: 9, bytes: 1, final: at(0) }, { name: "v2", at: at(5), files: 9, bytes: 1, from: "v1", note: "장면 끝 당김" }];
const finals = [{ v: 1, at: at(0), edit: null }];
const order = (id, minute, extra) => ({ id, at: at(minute), text: id, videoAt: null, meaning: "", status: "queued", result: null, ...extra });

test("the screen state reads like the editor's own server: saved versions by OS number, the newest unsaved one as 작업본", () => {
  const s = editorScreenState({ versions, finals, orders: [], save: null, base: null, lock: { name: "편집자", pc: "win", since: at(0) }, now: Date.parse(at(9)) });
  assert.deepEqual(s.saves.list, [{ label: "v1", internal: "v1", t: Date.parse(at(0)) / 1000 }], "the first final is the version the computer took it in as");
  assert.equal(s.draft, "v2");
  assert.equal(s.saves.pending, null);
  const edited = editorScreenState({ versions, finals: [...finals, { v: 2, at: at(8), edit: { fromVersion: "v2" } }], orders: [], save: null, base: null, lock: null, now: 0 });
  assert.deepEqual(edited.saves.list.map((x) => [x.label, x.internal]), [["v1", "v1"], ["v2", "v2"]]);
  assert.equal(edited.draft, null, "a confirmed version is no longer a 작업본");
  const waiting = editorScreenState({ versions, finals, orders: [], save: { at: at(9) }, base: null, lock: null, now: 0 });
  assert.equal(waiting.saves.pending.label, "v2", "완성 waits for the next OS number");
});

test("hand edits are edits, chat orders are orders, and both count while they wait", () => {
  const s = editorScreenState({ versions, finals, save: null, base: "v1", lock: null, now: 0, orders: [
    order("trim", 1, { manual: { kind: "trim" }, version: "v2" }),
    order("cut", 2, { manual: { kind: "range" }, version: "v2", status: "working" }),
    order("undo", 3, { manual: { kind: "trim" }, version: "v2", status: "cancelled", result: { note: "되돌렸어요", at: at(4) } }),
    order("chat", 4, { videoAt: 200, status: "working", meaning: "사진 교체" })] });
  assert.deepEqual(s.edits.map((e) => [e.id, e.status]), [["trim", "queued"], ["cut", "running"], ["undo", "cancelled"]]);
  assert.deepEqual(s.orders, [{ id: "chat", t: Date.parse(at(4)) / 1000, text: "chat", at: 200, status: "running" }]);
  assert.equal(s.jobs.chat.status, "running");
  assert.equal(s.pending_count, 3);
  assert.equal(s.base, "v1");
});

test("a hand edit not yet taken can be undone; the chat hears only a hand edit that failed", () => {
  assert.ok(orderMove("queued", "cancelled") && !orderMove("working", "cancelled") && !orderMove("cancelled", "queued"));
  const feed = editFeed({ lock: null, versions: [], uploadedAt: null, orders: [
    { at: at(1), updatedAt: at(1), text: "장면 끝 당기기", name: "편집자", from: "screen", status: "done", result: { note: "", at: at(2) } },
    { at: at(1), updatedAt: at(3), text: "구간 지우기", name: "편집자", from: "screen", status: "failed", result: { note: "앞쪽 길이가 바뀌었어요", at: at(3) } }] }, null);
  assert.deepEqual(feed.map((e) => e.kind), ["failed"]);
  assert.match(feed[0].text, /손 편집 “구간 지우기”을 반영하지 못했어요: 앞쪽 길이가 바뀌었어요/);
});

test("material files are flat names of kinds the content bucket takes", () => {
  for (const ok of ["version.json", "proxy.mp4", "voice.m4a", "music.mp3", "thumb-s00.jpg", "sub-0001.png", "subs.srt", "wave.json"]) assert.match(ok, SCREEN_FILE, ok);
  for (const bad of ["../x.json", "a/b.json", ".hidden.json", "x.exe", "x.tar", "version.json/"]) assert.doesNotMatch(bad, SCREEN_FILE, bad);
});

test("the server: hand edits wait for 완성, a confirm ends a 완성, only the editing computer puts files up, the screen reads light", () => {
  const edit = readFileSync(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  assert.match(edit, /filter\(\(\{ order \}\) => !order\.manual \|\| meta\.save\)/, "no render while editing: hand edits go out only after 완성");
  assert.match(edit, /return \{ orders: out, save: meta\.save \?\? null, base: meta\.base\?\.version \?\? null \}/);
  assert.match(edit, /delete next\.confirming; delete next\.save;/);
  for (const fn of ["materialsUpload", "materialsSaved"]) assert.match(edit.slice(edit.indexOf(`export async function ${fn}`)), /await heldSession\(service, actor, project\.id, input\.pc\)/, fn);
  assert.match(edit, /const SCREEN_BUCKET = "os-content-media"/);
  assert.match(edit.slice(edit.indexOf("export async function screenView")), /myinFinalNumbers\(service, project\.id\)/, "the poll reads the finals' numbers, not the whole run");
  assert.match(edit.slice(edit.indexOf("export async function cancelEditOrder")), /EDIT_NOT_YOURS/);
  const route = readFileSync(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  for (const action of ["edit_cancel", "save", "save_done", "base", "materials_upload", "materials_saved"]) assert.match(route, new RegExp(`action === "${action}"`), action);
  assert.match(route, /"screen", "screen_files"/);
});

test("submit_video_edit carries a hand edit said in chat", async () => {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/server/mcp.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require: (name) => { if (name === "zod") return { z }; if (name === "../kosis.ts") return kosis; throw Error(name); }, URLSearchParams, encodeURIComponent });
  const calls = [];
  await compiled.exports.callMcpTool({ name: "submit_video_edit", arguments: { project_id: "33333333-3333-4333-8333-333333333333", text: "3초 지워 줘",
    manual: { kind: "range", from: 10, to: 13 }, version: "v2" } }, "org", async (path, init) => { calls.push(JSON.parse(init.body)); return {}; });
  assert.deepEqual([calls[0].action, calls[0].manual.kind, calls[0].version], ["order", "range", "v2"]);
});
