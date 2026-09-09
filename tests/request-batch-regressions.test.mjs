import assert from "node:assert/strict";
import test from "node:test";
import { compareScriptDocuments, isVisibleScript, scriptFileName, scriptProgress } from "../lib/script-documents.ts";
import { discoveryResults, measureDiscovery } from "../lib/discovery-results.ts";
import { markdownSections, markdownBlocks, markdownCodeBody, treeWidth, insertTag } from "../lib/markdown-sections.ts";
import { outlierBaseline } from "../lib/youtube-outliers.ts";
import { captureKind, isBotAddressed } from "../lib/telegram-intents.ts";
import { sanitizePublicCopyValue } from "../lib/content-safety.ts";
import { buildHomeRevenueView } from "../lib/home-dashboard.ts";
import { fuzzyDocumentScore } from "../lib/knowledge-navigation.ts";
import { structureBorrowInput, structureBorrowGuidance } from "../lib/structure-borrow.ts";
import { hasLexicalEvidence } from "../lib/search-relevance.ts";

test("quick open matches sparse filename letters and ranks exact titles ahead of fuzzy matches", () => {
  assert.ok(fuzzyDocumentScore("원최", "원고_낭독본_최종.md") > 0);
  assert.ok(fuzzyDocumentScore("기획", "기획") > fuzzyDocumentScore("기획", "영상_기획.md"));
  assert.equal(fuzzyDocumentScore("없는검색", "원고.md"), -1);
});

test("structure borrowing preserves provenance and requires a human-entered deliverable promise", () => {
  const source = { id: "abcdefghijk", title: "외부 영상 제목", channelTitle: "출처 채널", url: "https://www.youtube.com/watch?v=abcdefghijk", viewCount: 5000 };
  assert.throws(() => structureBorrowInput(source, "우리 주제", "", "콘텐츠"));
  const value = structureBorrowInput(source, "우리 주제", "실제로 해 본 업무 비교 방법을 설명한다", "콘텐츠");
  assert.equal(value.status, "review"); assert.equal(value.sourceUrl, source.url);
  assert.equal(value.metadata.structureBorrow.sourceTitle, source.title);
  assert.match(structureBorrowGuidance(value.metadata.structureBorrow), /복제하지 않는다/);
  assert.match(structureBorrowGuidance(value.metadata.structureBorrow), /사람이 채택하기 전까지 후보/);
  assert.equal(structureBorrowGuidance(null), "");
});

test("script selection uses the source filename and artifact priority, never a recent audit title", () => {
  const row = (source_ref, updated_at = "2026-09-01") => ({ source_ref, title: "같은 표시 제목", folder: "root/영상", status: "draft", updated_at });
  const items = [row("검수로그.md", "2026-09-09"), row("원고.md"), row("낭독본_최종.md"), row("직접_수정본.md")];
  assert.deepEqual(items.sort(compareScriptDocuments).map(scriptFileName), ["직접_수정본.md", "낭독본_최종.md", "원고.md", "검수로그.md"]);
  assert.equal(scriptFileName(row("vault\\path\\기획.md")), "기획.md");
  assert.equal(isVisibleScript({ folder: "root/_보관/영상", status: "draft" }), false);
  assert.equal(isVisibleScript({ folder: "root/영상", status: "archived" }), false);
  assert.equal(isVisibleScript({ folder: "root/영상", status: "review" }), true);
  const progress = scriptProgress([row("축.md"), { ...row("패키징.md"), status: "review" }]);
  assert.equal(progress.approvalPending, true);
  assert.equal(progress.published, false);
  assert.deepEqual(progress.completed, [false, true, false, true, false, false, false, false]);
});

const video = (id, extra = {}) => ({ id, title: "일반 영상", durationSeconds: 300, publishedAt: "2026-09-01", viewCount: 100, ...extra });
const measured = (ratio, outlier = true) => ({ state: "measured", sampleCount: 20, ratio, robustZ: null, outlier, reason: "test" });
test("discovery defaults can show only measured outliers without mistaking subscriber ratio for baseline", () => {
  const items = [video("unknown", { viewCount: 50000, viewSubscriberRatio: 300 }), video("normal"), video("outlier"), video("live", { live: true }), video("short", { durationSeconds: 60 })];
  const baselines = { outlier: measured(4), normal: measured(1, false), live: measured(10) };
  const options = { format: "long", days: "30", sort: "ratio", outliersOnly: true };
  assert.deepEqual(discoveryResults(items, baselines, options, Date.parse("2026-09-08")).map((v) => v.id), ["outlier"]);
  assert.deepEqual(discoveryResults(items, baselines, { ...options, outliersOnly: false }, Date.parse("2026-09-08")).map((v) => v.id), ["outlier", "normal", "unknown"]);
});

test("short reference results respect publication filters, and never include live/reuploads", () => {
  const items = [video("fresh", { title: "#shorts", durationSeconds: 60 }), video("old", { title: "#shorts", durationSeconds: 60, publishedAt: "2025-01-01" }), video("live", { live: true, durationSeconds: 60 }), video("copy", { title: "재업로드", durationSeconds: 60 })];
  assert.deepEqual(discoveryResults(items, {}, { format: "short", days: "30", sort: "recent", outliersOnly: true }, Date.parse("2026-09-08")).map((v) => v.id), ["fresh"]);
});

test("bounded baseline comparisons preserve partial failures and cap concurrency", async () => {
  let active = 0, peak = 0; const results = {};
  const status = await measureDiscovery(Array.from({ length: 25 }, (_, i) => video(String(i))), async (item) => {
    active++; peak = Math.max(peak, active); await new Promise((resolve) => setImmediate(resolve)); active--;
    if (item.id === "3") throw new Error("offline");
    return measured(4);
  }, (id, result) => { results[id] = result; });
  assert.deepEqual(status, { attempted: 20, failed: 1 });
  assert.equal(peak, 3); assert.equal(Object.keys(results).length, 20);
  assert.equal(results["3"].ratio, null); assert.equal(results["3"].outlier, false);
});

test("duplicate peers cannot fabricate a 20-video baseline", () => {
  const target = { ...video("target"), channelId: "one", views: 1000 };
  const peer = { ...target, id: "peer", views: 100 };
  assert.equal(outlierBaseline(target, Array(20).fill(peer), Date.parse("2026-09-08")).state, "insufficient");
});

test("Korean commands use whitespace boundaries, not ASCII word boundaries", () => {
  for (const [input, expected] of [["/후기 수강생 소감", "review"], ["후기\n내용", "review"], ["/썸네일기록 선택", "thumbnail"], ["#인박스 아이디어", "inbox"], ["/요약 https://example.com", "summary"], ["#RAW 자료", "raw"], ["후기좋아요", "question"]]) assert.equal(captureKind(input), expected);
});

test("group messages only address this exact bot, not another bot or prefix username", () => {
  const group = { chat: { type: "group" } };
  assert.equal(isBotAddressed({ ...group, text: "@our_bot 의견" }, "our_bot"), true);
  assert.equal(isBotAddressed({ ...group, text: "@our_bot_fake 의견" }, "our_bot"), false);
  assert.equal(isBotAddressed({ ...group, reply_to_message: { from: { is_bot: true, username: "other_bot" } } }, "our_bot"), false);
  assert.equal(isBotAddressed({ ...group, reply_to_message: { from: { is_bot: true, username: "our_bot" } } }, "our_bot"), true);
  assert.equal(isBotAddressed({ chat: { type: "private" } }, undefined), true);
});

test("public generation copy removes internal terms recursively without losing structure", () => {
  const result = sanitizePublicCopyValue({ candidates: [{ title: "배선과 결핍", thumbnailCopy: "대상a 증환" }], score: 4 });
  assert.equal(result.score, 4);
  assert.doesNotMatch(JSON.stringify(result), /배선|결핍|대상a|증환/);
  assert.ok(result.candidates[0].title.length);
});

test("degraded knowledge search rejects unrelated evidence", () => {
  const result = { title: "시각화 시스템 프롬프트", heading: "본문", text: "HTML 보고서와 육각 레이더를 구성한다." };
  assert.equal(hasLexicalEvidence(result, "푸른삼각형을 내일로 접어줘"), false);
  assert.equal(hasLexicalEvidence(result, "HTML 보고서 구성 알려줘"), true);
});

test("headings fold hierarchically and fenced code retains blank lines and fake headings", () => {
  const code = "```js\nconst value = 1;\n\n# not a heading\n```";
  const root = markdownSections(`# One\nintro\n## Two\nbody\n\n${code}\n\n# Three\nlast`);
  assert.deepEqual(root.children.map((section) => section.title), ["One", "Three"]);
  assert.equal(root.children[0].children[0].title, "Two");
  assert.ok(markdownBlocks(root.children[0].children[0].body).includes(code));
  assert.equal(root.children[0].children[0].children.length, 0);
  assert.equal(markdownCodeBody(code), "const value = 1;\n\n# not a heading");
  assert.equal(markdownCodeBody("~~~text\nkeep the last line"), "keep the last line");
  assert.equal(markdownSections("# C#\nbody").children[0].title, "C#");
});

test("tree width and tag completion remain bounded and preserve text after the cursor", () => {
  assert.equal(treeWidth(NaN), 280); assert.equal(treeWidth(-1), 220); assert.equal(treeWidth(2000), 460);
  assert.deepEqual(insertTag("내용 #기 뒤 문장", 5, "기획"), { content: "내용 #기획  뒤 문장", caret: 7 });
  assert.deepEqual(insertTag("그대로", 3, "invalid tag"), { content: "그대로", caret: 3 });
});

test("weekly revenue compares Monday through the same weekday and preserves missing versus zero", () => {
  const row = (date, amount) => ({ record_type: "revenue", title: "매출", brand: "마이인", metadata: { net: amount, date }, starts_at: date, created_at: date, updated_at: date });
  const now = new Date("2026-09-08T12:00:00Z");
  const previous = [row("2026-08-31", 50), row("2026-09-01", 50), row("2026-09-02", 10000)];
  assert.equal(buildHomeRevenueView(previous, now).total.weekChange, null);
  assert.equal(buildHomeRevenueView([...previous, row("2026-09-07", 50), row("2026-09-08", 50)], now).total.weekChange, 0);
  assert.equal(buildHomeRevenueView([...previous, row("2026-09-08", 0)], now).total.weekChange, -100);
});
