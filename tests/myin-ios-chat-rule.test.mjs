import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 유쓰 요청 6076e9e6 (대표 2026-11-03 「개발해」): message scenes are drawn as a real iPhone 문자 screen (도식 창고 lib_ios_chat), not as
// 우리 이미지 placeholders nobody can upload in that look. The rule turns on only when the render PC reports that it can draw it.
test("the staff AI draws message scenes with lib_ios_chat once the render PC has it", async () => {
  const job = await readFile(new URL("../lib/server/myin-storyboard-job.ts", import.meta.url), "utf8");
  assert.match(job, /input\.catalog\?\.items\.some\(\(item\) => item\.type === "lib_ios_chat"\) \? `/);
  const rule = job.slice(job.indexOf('item.type === "lib_ios_chat"'));
  assert.match(rule, /lib_ios_chat\(실제 아이폰 문자 화면 — 마이인 색으로 바꾸지 않음\)/);
  assert.match(rule, /우리 이미지\(ours_…\)나 사진으로 적지 않습니다/);
  assert.match(rule, /bell_notify[\s\S]*pop_soft/, "sounds from the 사운드 창고");
});

test("카톡 대화 scenes use lib_kakao_chat once the render PC has it; 문자 stays lib_ios_chat", async () => {
  const job = await readFile(new URL("../lib/server/myin-storyboard-job.ts", import.meta.url), "utf8");
  assert.match(job, /input\.catalog\?\.items\.some\(\(item\) => item\.type === "lib_kakao_chat"\) \? `/);
  const rule = job.slice(job.indexOf('item.type === "lib_kakao_chat"'));
  assert.match(rule, /lib_kakao_chat\(실제 카톡 화면 — 마이인 색으로 바꾸지 않음\)/);
  assert.match(rule, /문자 메시지라고 말하는 장면만 lib_ios_chat/);
  assert.match(rule, /who\(보낸 사람 이름\)와 unread\(인원 − 1\)/);
});

// 댓글 카드 · 키워드 팝업 · 사진 움직임 (대표 2026-11-29): the card teaches them only once the render PCs have them (catalog lists lib_yt_comments).
test("comment cards, keyword pops and photo moves enter the storyboard card only when the engine has them", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const ts = (await import("typescript")).default;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const libs = { "@/lib/http": { ApiError: class extends Error {} }, "@/lib/diagram-catalog": await import("../lib/diagram-catalog.ts"),
    "@/lib/myin-storyboard": await import("../lib/myin-storyboard.ts"), "@/lib/myin-short-storyboard": await import("../lib/myin-short-storyboard.ts"),
    "@/lib/web-short-storyboard": await import("../lib/web-short-storyboard.ts") };
  const compiled = { exports: {} };
  const source = await readFile(new URL("../lib/server/myin-storyboard-job.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require: (name) => libs[name] ?? require(name) });
  const card = (types, pulling = true) => compiled.exports.myinStoryboardCard({ title: "t", markdown: "m", words: [], durationSeconds: 60, leaseMinutes: 30, pulling,
    catalog: types ? { items: types.map((type) => ({ type, name: type, use: "u", example: {} })) } : null });
  const before = card(["lib_kakao_chat"]), after = card(["lib_kakao_chat", "lib_yt_comments"]);
  for (const word of ["lib_yt_comments(유튜브 댓글 모양 카드", "\"pop\": [{\"text\", \"cue\"}]", "\"move\": \"in\"", "키워드 팝업(pop) 1~2개와 사진 움직임(photo.move)"]) {
    assert.ok(!before.includes(word), `not before the engine has it: ${word}`);
    assert.ok(after.includes(word), `once the engine has it: ${word}`);
  }
  assert.match(after, /statement · hero 장면에는 붙이지 않습니다/);
  assert.match(after, /사진 색은 지금처럼 흑백입니다/);
  assert.match(before, /장면은 3\.5초 이상/, "pulling scenes aim at 3.5 s so voice timing never drops them under the 3 s gate");
  assert.ok(!card(["lib_yt_comments"], false).includes("키워드 팝업(pop) 1~2개와"), "the rhythm line is for pulling videos only");
  assert.ok(card(["lib_yt_comments"], false).includes("lib_yt_comments(유튜브 댓글 모양 카드"), "comment cards fit any longform that reads comments");
});
