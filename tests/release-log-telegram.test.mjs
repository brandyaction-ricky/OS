import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isReleaseLog, releaseLogRooms, releaseLogText } from "../lib/development-comment-telegram.ts";

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

test("a log goes to its project's business room; a company-wide one to the requester's room, 액션팀 without a request", () => {
  assert.deepEqual(releaseLogRooms({ title: "마이인", brand: "마이인" }, "RS 협업"), ["myin"]);
  assert.deepEqual(releaseLogRooms({ title: "myin_melatonin", brand: "" }), ["myin"]);
  assert.deepEqual(releaseLogRooms({ title: "브랜디에듀", brand: "브랜디에듀" }, "브랜디액션"), ["edu"]);
  assert.deepEqual(releaseLogRooms({ title: "브랜디액션 OS", brand: "브랜디액션" }, "RS 협업"), ["edu"]);
  assert.deepEqual(releaseLogRooms({ title: "브랜디액션 OS", brand: "브랜디액션" }, "브랜디액션"), ["myin"]);
  assert.deepEqual(releaseLogRooms({ title: "브랜디액션 OS", brand: "브랜디액션" }, null), ["myin"]);
  assert.deepEqual(releaseLogRooms({ title: "TIPS SaaS", brand: "" }), ["myin"]);
});

test("the message is the title and the plain 쉬운 설명 — never the developer summary; without one, the title alone", () => {
  const url = "https://os.example/knowledge/development?project=p1&tab=history";
  const text = releaseLogText({ project: "마이인", title: "핵심 광고 따로 집계", url,
    plain: "관리자 성과 화면에 핵심 광고 줄 추가\n\n유료 광고 → 정밀 광고\n10-21 이후 전체 버튼 삭제\n넷째 줄" });
  assert.match(text, /^🚀 개발 반영 · 마이인\n「핵심 광고 따로 집계」\n\n관리자 성과 화면에 핵심 광고 줄 추가\n\n유료 광고 → 정밀 광고\n10-21 이후 전체 버튼 삭제\n넷째 줄\n\nOS에서 보기: https:\/\/os\.example\/knowledge\/development\?project=p1&tab=history$/,
    "the whole explanation, paragraph breaks kept (2026-11-17 대표: not limited to 3 lines)");
  assert.equal(releaseLogText({ project: "브랜디액션 OS", title: "음성 대기 순서", url: "u", plain: "  " }), "🚀 개발 반영 · 브랜디액션 OS\n「음성 대기 순서」\n\nOS에서 보기: u");
  assert.equal(releaseLogText({ project: "p", title: "t", url: "u" }), "🚀 개발 반영 · p\n「t」\n\nOS에서 보기: u");
  assert.ok(releaseLogText({ project: "p", title: "t", url: "u", plain: "가".repeat(500) }).includes("가".repeat(500)), "a long explanation goes whole");
  const huge = releaseLogText({ project: "p", title: "t".repeat(200), url: "u".repeat(200), plain: "가\n\n\n\n".repeat(3000) });
  assert.ok(huge.length < 4096 && huge.includes("…"), "cut only before Telegram's limit");
  assert.ok(!huge.includes("\n\n\n"), "blank lines fold to one");
});

test("both ways a log is saved (MCP create_development_log, the web form) announce it after the answer, as the bot, to the meeting-share rooms", () => {
  for (const route of ["app/api/v1/agent-records/route.ts", "app/api/v1/records/route.ts"]) {
    const source = read(route);
    assert.match(source, /if \(isReleaseLog\(data\)\) after\(\(\) => shareReleaseLog\(data, new URL\(request\.url\)\.origin\)\.catch\(/, route);
    assert.ok(source.indexOf("shareReleaseLog(data") > source.indexOf('"RECORD_CREATE_FAILED"'), `${route}: only after the log is saved`);
  }
  const server = read("lib/server/development-comment-telegram.ts");
  assert.match(server, /export async function shareReleaseLog[\s\S]*if \(!token \|\| !log\.parent_id\) return 0;/, "no bot token → nothing sent, no error");
  assert.match(server, /releaseLogRooms\(project \?\? \{\}, requester\?\.affiliation/, "the requester's affiliation picks the room");
  assert.match(server, /from\("os_profiles"\)\.select\("affiliation"\)\.eq\("id", request\.created_by\)/);
  assert.match(server, /log\.metadata\?\.plainSummary \|\| request\?\.metadata\?\.plainSummary \|\| ""/);
  assert.doesNotMatch(server, /log\.description/, "the developer summary never reaches staff");
  assert.match(server, /from\("os_telegram_chats"\)\.select\("external_chat_id"\)\.in\("meeting_share_business", rooms\)/);
  assert.match(server, /process\.env\.TELEGRAM_BOT_TOKEN/);
  const mcp = read("lib/server/mcp.ts");
  assert.match(mcp, /plain_summary: \{ type: "string", maxLength: 2500/, "an agent can give the staff explanation when it saves the log");
  assert.match(mcp, /plain_summary: z\.string\(\)\.trim\(\)\.max\(2500\)/);
  assert.match(mcp, /plainSummary: input\.plain_summary/);
});
