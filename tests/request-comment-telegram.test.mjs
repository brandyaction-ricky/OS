import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requestCommentRooms, requestCommentText } from "../lib/development-comment-telegram.ts";

// 수정 요청 댓글 → 텔레그램 (2026-11-17 대표): 함께 볼 사람이 있는 댓글은 마이인 → 액션팀 방, 에듀 → 마케팅 방, 개인 톡은 없음.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("a request goes to its business's room; a company-wide one to the rooms of the people named", () => {
  assert.deepEqual(requestCommentRooms({ title: "마이인" }, ["RS 협업"]), ["myin"]);
  assert.deepEqual(requestCommentRooms({ title: "myin_melatonin" }, []), ["myin"]);
  assert.deepEqual(requestCommentRooms({ title: "브랜디에듀" }, ["브랜디액션"]), ["edu"]);
  assert.deepEqual(requestCommentRooms({ title: "브랜디액션 OS" }, ["브랜디액션", "브랜디액션"]), ["myin"]);
  assert.deepEqual(requestCommentRooms({ title: "브랜디액션 OS" }, ["RS 협업"]), ["edu"]);
  assert.deepEqual(requestCommentRooms({ title: "TIPS SaaS" }, ["브랜디액션", "RS 협업"]), ["myin", "edu"]);
});

test("the message names people by their Telegram @username, keeps the comment's start and links the request", () => {
  const text = requestCommentText({ author: "안저", title: "[마이인 롱폼] 첫 화면 깜빡임", url: "https://os.example/knowledge/development?request=r1",
    mentions: [{ name: "로건", username: "logan_x" }, { name: "유쓰" }], body: "첫 줄\n\n둘째 줄\n셋째 줄\n넷째 줄" });
  assert.match(text, /^💬 수정 요청 댓글 · 안저 → @logan_x 유쓰님\n「\[마이인 롱폼\] 첫 화면 깜빡임」/);
  assert.match(text, /\n\n첫 줄\n둘째 줄\n셋째 줄…\n\nOS에서 보기: https:\/\/os\.example\/knowledge\/development\?request=r1$/);
  assert.ok(!text.includes("넷째 줄"));
  assert.ok(requestCommentText({ author: "a", title: "t", url: "u", mentions: [], body: "가".repeat(500) }).length < 400, "a long comment is cut");
});

test("only a comment that names someone is shared, after the answer, to the meeting-share rooms — never a private chat", () => {
  const route = read("app/api/v1/development-request-comments/route.ts");
  assert.match(route, /if \(mentions\.length\) \{/);
  assert.match(route, /after\(\(\) => shareRequestComment\(share\)\.catch\(/);
  const server = read("lib/server/development-comment-telegram.ts");
  assert.match(server, /from\("os_telegram_chats"\)\.select\("external_chat_id"\)\.in\("meeting_share_business", rooms\)/);
  assert.doesNotMatch(server, /chat_id: (person|user|row)\./, "no message to a person's own chat");
});
