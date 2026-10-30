import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addCardSlide, CARD_FORMATS, cardProblems, cardSignature, emptyCardDraft, removeCardSlide } from "../lib/cardnews/formats.ts";
import { cardsMissing, nextCards } from "../lib/cardnews/cards.ts";
import { storedZip } from "../lib/cardnews/zip.ts";
import { applyGateAction, canReopen } from "../lib/youtube-process/confirm.ts";
import { flowOf, newProjectMeta } from "../lib/youtube-process/project.ts";
import { emptyStage } from "../lib/youtube-process/stages.ts";

// 카드뉴스 (설계서 2026-10-30): formats, the cards record rules and the step flow.
const filled = format => {
  const draft = emptyCardDraft(format, "d1", "리키", "2026-10-30T00:00:00Z");
  draft.slides = draft.slides.map(slide => ({ ...slide, fields: Object.fromEntries(Object.keys(slide.fields).map(key => [key, "짧은 글"])) }));
  return { ...draft, caption: "캡션", hashtags: ["직장인", "강점", "번아웃"] };
};
const cardProject = (stage = "draft") => {
  const meta = newProjectMeta({ type: "card", target: "직장인", note: "", refs: [] }, "2026-10-30T00:00:00Z");
  const yp = applyGateAction({ yp: meta.yp }, "topic", "confirm", { actor: "pd", now: "2026-10-30T00:00:00Z" });
  return { yp: { ...yp, stage } };
};

test("each format starts at its fewest cards, and a filled draft passes", () => {
  assert.deepEqual(emptyCardDraft("list", "a", "x", "t").slides.map(slide => slide.type), ["cover", "item", "item", "item", "summary", "end"]);
  assert.deepEqual(emptyCardDraft("quote", "a", "x", "t").slides.length, 6);
  for (const format of Object.keys(CARD_FORMATS)) assert.deepEqual(cardProblems(filled(format)).blocking, [], format);
});

test("an over-long or empty field, a wrong count or order blocks 카드 확정; banned words only warn", () => {
  const draft = filled("list");
  draft.slides[0].fields.head = "가".repeat(23);
  draft.slides[1].fields.title = "";
  assert.deepEqual(cardProblems(draft).blocking, ["1장 헤드 카피이 1자 넘쳐요 (22자까지)", "2장 소제목을 써 주세요"]);
  const short = { ...filled("list"), slides: filled("list").slides.filter((_, index) => index !== 1) };
  assert.match(cardProblems(short).blocking[0], /항목은 3~7장이에요 \(지금 2장\)/);
  const swapped = filled("myth"); swapped.slides = [swapped.slides[1], swapped.slides[0], ...swapped.slides.slice(2)];
  assert.ok(cardProblems(swapped).blocking.includes("카드 순서가 포맷과 달라요"));
  const words = filled("quote"); words.slides[1].fields.text = "여러분 무료 진단 받아 보세요"; words.slides[2].fields.text = "직장인 70%가 그래요";
  const { blocking, warnings } = cardProblems(words);
  assert.deepEqual(blocking, []);
  assert.equal(warnings.length, 3);
});

test("cards are added and taken out only within the format's range", () => {
  let draft = filled("list");
  for (let i = 0; i < 6; i++) draft = addCardSlide(draft, "item");
  assert.equal(draft.slides.filter(slide => slide.type === "item").length, 7);
  assert.equal(draft.slides.at(-1).type, "end", "a new item goes after the last item");
  assert.equal(addCardSlide(draft, "summary"), draft, "one 정리 only");
  const three = filled("list");
  assert.equal(removeCardSlide(three, 1), three, "three items at least");
  assert.notEqual(cardSignature(filled("list")), cardSignature({ ...filled("list"), caption: "다른 캡션" }));
});

test("the cards record changes only at 카드 만들기, and the address only after 최종 검토", () => {
  let id = 0;
  const newId = () => `n${++id}`;
  const empty = emptyStage("cards", "card");
  assert.equal(cardsMissing(empty), "포맷을 골라 초안을 만들어 주세요");
  let cards = nextCards(cardProject(), empty, { add: "list" }, "리키", "now", newId);
  assert.equal(cards.picked, "n1", "the first draft is the one being worked on");
  cards = nextCards(cardProject(), cards, { add: "quote" }, "리키", "now", newId);
  assert.equal(cards.picked, "n1");
  assert.match(cardsMissing(cards), /헤드 카피을 써 주세요/);
  const edited = filled("list");
  cards = nextCards(cardProject(), cards, { draft: { ...edited, id: "n1" } }, "리키", "now", newId);
  assert.equal(cardsMissing(cards), "");
  cards = nextCards(cardProject(), cards, { remove: "n1" }, "리키", "now", newId);
  assert.equal(cards.picked, "");
  assert.throws(() => nextCards(cardProject("review"), cards, { add: "list" }, "리키", "now", newId), /카드를 확정했어요/);
  assert.throws(() => nextCards(cardProject(), cards, { exported: { url: "https://www.instagram.com/p/x" } }, "리키", "now", newId), /최종 검토 컨펌 뒤/);
  assert.equal(nextCards(cardProject("upload"), cards, { exported: { url: "https://www.instagram.com/p/x" } }, "리키", "now", newId).exported.url, "https://www.instagram.com/p/x");
});

test("a 카드뉴스 goes 주제 → 카드 만들기 → 최종 검토 → 내보내기; 카드 확정 opens 최종 검토", () => {
  assert.deepEqual(flowOf("card").map(step => step.name), ["주제", "카드 만들기", "최종 검토", "내보내기"]);
  const yp = applyGateAction(cardProject(), "draft", "confirm", { actor: "pd", now: "2026-10-30T01:00:00Z" });
  assert.equal(yp.stage, "review");
  assert.equal(applyGateAction({ yp }, "review", "confirm", { actor: "pd", now: "2026-10-30T02:00:00Z" }).stage, "upload");
  // The PD may reopen their own 카드 확정 while the card sits at 최종 검토.
  assert.ok(canReopen({ yp }, "draft"));
  assert.equal(applyGateAction({ yp }, "draft", "reopen", { actor: "pd", now: "2026-10-30T03:00:00Z" }).stage, "draft");
});

test("the ZIP of cards opens with every file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cardzip-"));
  const zip = storedZip([{ name: "01.png", data: new Uint8Array([1, 2, 3]) }, { name: "caption.txt", data: new TextEncoder().encode("캡션") }]);
  writeFileSync(join(dir, "a.zip"), zip);
  const listing = execFileSync("unzip", ["-l", join(dir, "a.zip")], { encoding: "utf8" });
  assert.match(listing, /01\.png/); assert.match(listing, /caption\.txt/);
  assert.equal(execFileSync("unzip", ["-p", join(dir, "a.zip"), "caption.txt"], { encoding: "utf8" }), "캡션");
});
