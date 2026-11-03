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
