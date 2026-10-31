import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { createElement } from "react";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as formats from "../lib/cardnews/formats.ts";
import * as sources from "../lib/cardnews/sources.ts";
import * as cards from "../lib/cardnews/cards.ts";
import * as project from "../lib/youtube-process/project.ts";
import * as stages from "../lib/youtube-process/stages.ts";
import * as confirm from "../lib/youtube-process/confirm.ts";
import { readCardBookmarks, validCardUrl } from "../lib/cardnews/bookmarks.ts";

const draft = () => {
  const d = formats.emptyCardDraft("list", "draft", "QA", "now");
  return { ...d, slides: d.slides.map((slide, i) => ({ ...slide, fields: { ...slide.fields, title: `QA ${i}` } })) };
};
const item = (id, kind = "live", stage = "done") => ({ id, title: `QA ${id}`, updatedAt: "2026-10-30", yp: { ...project.newProjectMeta({ type: kind, target: "QA audience", note: "", refs: [] }, "now").yp, stage } });

test("body-card reorder preserves every field and does not mutate the original", () => {
  const before = draft(), snapshot = structuredClone(before);
  const after = formats.moveCardSlide(before, 1, 3);
  assert.deepEqual(after.slides.map(row => row.fields.title), ["QA 0", "QA 2", "QA 3", "QA 1", "QA 4", "QA 5"]);
  assert.deepEqual(before, snapshot);
  for (const [from, to] of [[0, 1], [1, 0], [1, 5], [-1, 2], [1, 99], [1.2, 2], [2, 2]]) assert.equal(formats.moveCardSlide(before, from, to), before);
});

test("all formats keep cover and ending anchored and reject invalid destinations", () => {
  for (const id of formats.CARD_FORMAT_IDS) {
    const before = formats.emptyCardDraft(id, "d", "QA", "t");
    assert.notEqual(formats.moveCardSlide(before, 1, 2), before, id);
    assert.equal(formats.moveCardSlide(before, 1, before.slides.length - 1), before, id);
    assert.equal(formats.removeCardSlide(before, 0), before, id);
  }
});

test("hashtag parsing retains Korean characters, strips only separators and avoids duplicates", () => {
  assert.deepEqual(formats.parseCardHashtags("#커리어고민 #직장인,강점 #직장인"), ["커리어고민", "직장인", "강점"]);
  assert.deepEqual(formats.parseCardHashtags("ㄱ"), ["ㄱ"]);
  assert.deepEqual(formats.parseCardHashtags("#"), []);
  assert.equal(formats.parseCardHashtags(Array.from({ length: 35 }, (_, n) => `#태그${n}`).join(" ")).length, 30);
});

test("the shared preview drawing renders explicit Korean newlines into a real 1080x1350 PNG", async () => {
  const require = createRequire(import.meta.url);
  const { ImageResponse } = require("next/og");
  const view = { exports: {} };
  const drawing = await readFile(new URL("../lib/cardnews/card-slide.tsx", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(drawing, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: view, exports: view.exports, require: name => name === "./formats.ts" ? formats : require(name),
  });
  const fonts = await Promise.all([400, 700, 800].map(async weight => ({ name: "Pretendard", weight, style: "normal", data: await readFile(new URL(`../lib/cardnews/fonts/Pretendard-${weight}.woff`, import.meta.url)) })));
  const render = async head => {
    const d = draft(); d.slides[0].fields = { head, sub: "서브 첫 줄\n둘째 줄" };
    return Buffer.from(await new ImageResponse(createElement(view.exports.CardSlideView, { draft: d, index: 0 }), { ...formats.CARD_SIZE, fonts }).arrayBuffer());
  };
  const multiline = await render("첫 줄\n둘째 줄"), singleline = await render("첫 줄 둘째 줄");
  assert.equal(multiline.subarray(1, 4).toString(), "PNG");
  assert.equal(multiline.readUInt32BE(16), 1080); assert.equal(multiline.readUInt32BE(20), 1350);
  assert.notDeepEqual(multiline, singleline, "explicit newlines must affect the exported drawing");
});

test("saved URLs reject executable schemes, credentials and oversized values", () => {
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com", "https://example.com/" + "x".repeat(501), "not a url"]) assert.equal(validCardUrl(url), false);
  assert.equal(validCardUrl("https://www.instagram.com/p/qa/"), true);
  assert.deepEqual(readCardBookmarks("{broken"), []);
  assert.deepEqual(readCardBookmarks(JSON.stringify([{ id: "bad", label: "bad", url: "javascript:alert(1)" }, { id: "qa", label: "QA", url: "https://example.com/qa" }])), [{ id: "qa", label: "QA", url: "https://example.com/qa" }]);
  assert.equal(readCardBookmarks(JSON.stringify(Array.from({ length: 40 }, (_, n) => ({ id: `${n}`, label: "QA", url: "https://example.com" })))).length, 30);
});

test("only final-reviewed videos and approved visible Threads can be discovered", () => {
  assert.deepEqual(sources.projectCardSources([item("done"), item("upload", "short", "upload"), item("early", "live", "draft"), item("cards", "card"), item("none", null)]).map(row => row.id), ["done", "upload"]);
  const row = { owner_id: "me", status: "ready", metadata: { channel: "threads", posts: ["QA source"] } };
  assert.equal(sources.visibleThreadSource(row, "me"), true);
  assert.equal(sources.visibleThreadSource(row, "other"), false);
  assert.equal(sources.visibleThreadSource({ ...row, metadata: { ...row.metadata, shared: "team" } }, "other"), true);
  for (const status of ["draft", "review", "failed"]) assert.equal(sources.visibleThreadSource({ ...row, status }, "me"), false);
  assert.equal(sources.visibleThreadSource({ ...row, metadata: { channel: "threads", posts: [] } }, "me"), false);
});

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const code = await readFile(new URL("../lib/server/youtube-process-cards.ts", import.meta.url), "utf8");
const modules = {
  "node:fs/promises": {}, "node:path": {}, react: {}, "next/og": {}, zod,
  "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => { throw new Error("A catalog read must not use service-role access"); } },
  "@/lib/cardnews/card-slide": {}, "@/lib/cardnews/cards": cards, "@/lib/cardnews/formats": formats,
  "@/lib/cardnews/sources": sources, "@/lib/cardnews/zip": {}, "@/lib/youtube-process/confirm": confirm,
  "@/lib/youtube-process/project": project, "@/lib/youtube-process/stages": stages, "@/lib/youtube-narration-document": {},
  "./youtube-process": { listYoutubeProjects: async actor => actor.projects }, "./youtube-process-stages": {},
};
const compiled = { exports: {} };
runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiled, exports: compiled.exports, require: name => modules[name] });
const server = compiled.exports;
function actor(projects, rows, error = null) {
  const calls = [];
  const query = { then: resolve => Promise.resolve({ data: rows, error }).then(resolve) };
  for (const method of ["select", "eq", "in", "is", "order", "limit"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  return { ownerId: "me", projects, calls, supabase: { from: table => { calls.push(["from", table]); return query; } } };
}
const plain = value => JSON.parse(JSON.stringify(value));
test("source catalog uses the actor client, filters archived/approval state and never returns post bodies", async () => {
  const a = actor([item("video")], [
    { id: "own", title: "QA own", owner_id: "me", status: "ready", metadata: { channel: "threads", posts: ["PRIVATE_BODY_QA"] }, updated_at: "2026-10-30" },
    { id: "hidden", owner_id: "other", status: "ready", metadata: { channel: "threads", posts: ["secret"] }, updated_at: "2026-10-30" },
  ]);
  const result = plain(await server.listCardSources(a));
  assert.deepEqual(result.map(row => row.id).sort(), ["own", "video"]);
  assert.equal(JSON.stringify(result).includes("PRIVATE_BODY_QA"), false);
  assert.ok(a.calls.some(call => call[0] === "is" && call[1] === "archived_at" && call[2] === null));
  assert.ok(a.calls.some(call => call[0] === "in" && call[1] === "status"));
  await assert.rejects(server.listCardSources(actor([], [], { message: "offline" })), error => error.code === "CARD_SOURCE_READ_FAILED");
});

test("cover batch is restricted to visible card parents and shows a reopened draft's new selection", async () => {
  const old = { ...draft(), id: "old" }, edited = { ...draft(), id: "edited" };
  const data = { ...stages.emptyStage("cards", "card"), drafts: [old, edited], picked: "edited", confirmed: { draftId: "old", at: "then", sig: "x" } };
  const rows = [{ parent_id: "visible", metadata: { yp: data } }, { parent_id: "hidden", metadata: { yp: data } }];
  const a = actor([item("visible", "card", "draft"), item("not-card")], rows);
  assert.deepEqual(Object.keys(await server.readCardCovers(a, ["visible", "hidden", "not-card"])), ["visible"]);
  assert.equal((await server.readCardCovers(a, ["visible"])).visible.id, "edited");
  assert.deepEqual(plain(a.calls.find(call => call[0] === "in" && call[1] === "parent_id")[2]), ["visible"]);
  assert.equal((await server.readCardCovers(actor([item("visible", "card", "done")], rows), ["visible"])).visible.id, "old");
  const empty = actor([], []); assert.deepEqual(plain(await server.readCardCovers(empty, ["hidden"])), {}); assert.equal(empty.calls.length, 0);
});
