import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { archiveChats, archiveDocument, commentOf, formatOf, linkKey, messageLinks, normalizeLink, platformOf, safeComment, tagTopic, withMention } from "../lib/telegram-archive.ts";

// 텔레그램 아카이브 (수정 요청 2026-11-13): links dropped in the archive rooms become OS reference documents.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the same link however it was shared is one key: tracking tails, www and youtu.be do not make a second card", () => {
  const a = normalizeLink("https://www.instagram.com/reel/ABC123/?igsh=xyz&img_index=2");
  const b = normalizeLink("https://instagram.com/reel/ABC123");
  assert.equal(a, b);
  assert.equal(linkKey(a), linkKey(b));
  assert.equal(normalizeLink("https://youtu.be/dQw4w9WgXcQ?si=abc"), normalizeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share"));
  assert.notEqual(normalizeLink("https://youtube.com/shorts/aaa111"), normalizeLink("https://youtube.com/watch?v=aaa111"));
  assert.deepEqual(messageLinks("후킹 좋음 https://youtu.be/x1, 그리고 (https://threads.net/@a/post/1)."), ["https://youtu.be/x1", "https://threads.net/@a/post/1"]);
});

test("형식 comes from the kind of link, not the room it was posted in", () => {
  assert.equal(formatOf("https://instagram.com/reel/AB"), "숏폼");
  assert.equal(formatOf("https://youtube.com/shorts/AB"), "숏폼");
  assert.equal(formatOf("https://tiktok.com/@a/video/1"), "숏폼");
  assert.equal(formatOf("https://youtube.com/watch?v=AB"), "롱폼");
  assert.equal(formatOf("https://youtube.com/@channel"), "채널");
  assert.equal(formatOf("https://instagram.com/p/AB"), "게시물");
  assert.equal(formatOf("https://threads.net/@a/post/1"), "스레드");
  assert.equal(formatOf("https://example.com/tool"), "툴·기타");
  assert.equal(formatOf(null), "썸네일");
  assert.equal(platformOf("https://m.youtube.com/watch?v=1"), "YouTube");
});

test("a first-word tag names the folder; account details never reach a document", () => {
  assert.equal(tagTopic("#후킹 첫 3초 좋음"), "후킹·대본 구조");
  assert.equal(tagTopic("#AI툴 자동 편집"), "AI 툴·자동화");
  assert.equal(tagTopic("후킹 #썸네일"), null);
  assert.equal(safeComment("이 툴 아이디: team01 비번: 1234"), "(계정 정보 제외)");
  assert.equal(safeComment("id/pw 공유드려요"), "(계정 정보 제외)");
  assert.equal(safeComment("편집 템포 참고"), "편집 템포 참고");
  assert.equal(commentOf("후킹 좋음 https://youtu.be/x1", ["https://youtu.be/x1"]), "후킹 좋음");
  assert.deepEqual([...archiveChats("-1001, -22 ,abc,")], ["-1001", "-22"]);
});

test("a card carries who, where, when and what; the same link again is one 추가 언급 per message", () => {
  const first = { at: "2026-11-16T01:02:03.000Z", room: "인스타 아카이빙", who: "제이", comment: "후킹 좋음", receipt: "telegram:-1:10" };
  const { title, content } = archiveDocument({ link: "https://instagram.com/reel/AB", platform: "Instagram", format: "숏폼", topic: "후킹·대본 구조", title: "",
    channel: "", thumbnail: "", views: null, likes: null, image: "", first });
  assert.equal(title, "후킹 좋음");
  for (const field of ["source: telegram", "링크: https://instagram.com/reel/AB", "플랫폼: Instagram", "형식: 숏폼", "주제: 후킹·대본 구조", "방: 인스타 아카이빙", "올린 사람: 제이", "상태: 새로 들어옴"])
    assert.ok(content.includes(field), field);
  const again = withMention(content, { ...first, room: "썸네일 아카이빙", who: "로이", comment: "썸네일도", receipt: "telegram:-2:11" });
  assert.match(again, /^추가 언급: 1$/m);
  assert.match(again, /썸네일 아카이빙 · 로이 — 썸네일도 \(telegram:-2:11\)/);
  assert.equal(withMention(again, { ...first, receipt: "telegram:-2:11" }), null, "Telegram sending the same message twice adds nothing");
  assert.match(withMention(again, { ...first, receipt: "telegram:-3:12" }), /^추가 언급: 2$/m);
});

test("the webhook keeps archive-room messages before its usual filter, and only for the rooms named in the environment", () => {
  const hook = read("app/api/v1/telegram/webhook/route.ts");
  const at = hook.indexOf("archiveChats(process.env.TELEGRAM_ARCHIVE_CHAT_IDS).has(String(message.chat.id))");
  assert.ok(at > 0 && at < hook.indexOf("if (!message?.from || !shouldRespond(message)) return NextResponse.json({ ok: true, ignored: true });"));
  assert.ok(hook.indexOf("INVALID_WEBHOOK_SECRET") < at, "the secret is checked first");
  const server = read("lib/server/telegram-archive.ts");
  assert.match(server, /setMessageReaction/);
  assert.match(server, /status: "team", source: "telegram"/);
  assert.match(server, /model: CLAUDE_FAST_MODEL/);
});
