import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isReleaseLog, releaseLogText, requestCommentRooms } from "../lib/development-comment-telegram.ts";

// 운영 반영 공지 (2026-11-17 대표): 운영 · 완료 개발 로그는 봇이 마이인 → 액션팀 방, 에듀 → 마케팅 방에 알린다.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("only a development log saved as 운영 · 완료 is announced — not a deployment record, not an unfinished or non-production log", () => {
  assert.equal(isReleaseLog({ record_type: "development_log", stage: "production", status: "completed" }), true);
  assert.equal(isReleaseLog({ record_type: "development_log", stage: "production", status: "review" }), false);
  assert.equal(isReleaseLog({ record_type: "development_log", stage: "dev", status: "completed" }), false);
  assert.equal(isReleaseLog({ record_type: "development_log", stage: "local", status: "completed" }), false);
  assert.equal(isReleaseLog({ record_type: "deployment", stage: "production", status: "ready" }), false, "record_deployment would announce the same release twice");
  assert.equal(isReleaseLog({ record_type: "deployment", stage: "production", status: "completed" }), false);
});

test("a log goes to its project's business room; a company-wide project has no room", () => {
  assert.deepEqual(requestCommentRooms({ title: "마이인", brand: "마이인" }, []), ["myin"]);
  assert.deepEqual(requestCommentRooms({ title: "브랜디에듀", brand: "브랜디에듀" }, []), ["edu"]);
  assert.deepEqual(requestCommentRooms({ title: "브랜디액션 OS", brand: "브랜디액션" }, []), []);
  assert.deepEqual(requestCommentRooms({ title: "TIPS SaaS", brand: "" }, []), []);
});

test("the message names the project and log, keeps the summary's start and links the project's update history", () => {
  const text = releaseLogText({ project: "마이인", title: "핵심 광고 따로 집계", url: "https://os.example/knowledge/development?project=p1&tab=history",
    summary: "관리자 성과 화면에 핵심 광고 줄 추가\n\n유료 광고 → 정밀 광고\n10-21 이후 전체 버튼 삭제\n넷째 줄" });
  assert.match(text, /^🚀 개발 반영 · 마이인\n「핵심 광고 따로 집계」\n\n/);
  assert.match(text, /\n\n관리자 성과 화면에 핵심 광고 줄 추가\n유료 광고 → 정밀 광고\n10-21 이후 전체 버튼 삭제…\n\nOS에서 보기: https:\/\/os\.example\/knowledge\/development\?project=p1&tab=history$/);
  assert.ok(!text.includes("넷째 줄"));
  assert.ok(releaseLogText({ project: "p", title: "t", url: "u", summary: "가".repeat(500) }).length < 400, "a long summary is cut");
});

test("both ways a log is saved (MCP create_development_log, the web form) announce it after the answer, as the bot, to the meeting-share rooms", () => {
  for (const route of ["app/api/v1/agent-records/route.ts", "app/api/v1/records/route.ts"]) {
    const source = read(route);
    assert.match(source, /if \(isReleaseLog\(data\)\) after\(\(\) => shareReleaseLog\(data, new URL\(request\.url\)\.origin\)\.catch\(/, route);
    assert.ok(source.indexOf("shareReleaseLog(data") > source.indexOf('"RECORD_CREATE_FAILED"'), `${route}: only after the log is saved`);
  }
  const server = read("lib/server/development-comment-telegram.ts");
  assert.match(server, /export async function shareReleaseLog[\s\S]*if \(!token \|\| !log\.parent_id\) return 0;/, "no bot token → nothing sent, no error");
  assert.match(server, /requestCommentRooms\(project \?\? \{\}, \[\]\)/);
  assert.match(server, /from\("os_telegram_chats"\)\.select\("external_chat_id"\)\.in\("meeting_share_business", rooms\)/);
  assert.match(server, /process\.env\.TELEGRAM_BOT_TOKEN/);
});
