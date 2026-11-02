import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARD_DRAW_SIZE, cardDrawPrompt } from "../lib/cardnews/draw.ts";

// 카드 그림 (대표 2026-11-02): the picture is 4:5 like the card, carries no letters (the card writes them in Pretendard), and names the
// 캐릭터 창고 pictures in the order they are sent so GPT keeps those faces.
test("a card picture is 4:5, letter-free, and names its reference pictures in order", () => {
  assert.equal(CARD_DRAW_SIZE.width * 5, CARD_DRAW_SIZE.height * 4);
  assert.equal(CARD_DRAW_SIZE.width % 16, 0);
  assert.equal(CARD_DRAW_SIZE.height % 16, 0);
  const plain = cardDrawPrompt("  밤 11시 사무실  ", "simple", []);
  assert.match(plain, /Scene: 밤 11시 사무실\n/);
  assert.match(plain, /Draw no letters/);
  assert.doesNotMatch(plain, /Reference pictures/);
  assert.match(plain, /#212CB0/, "설명 그림 keeps to the design canon colours");
  const webtoon = cardDrawPrompt("한결이 웃어요", "webtoon", ["한결 앞모습", "낙서 성취"]);
  assert.match(webtoon, /webtoon/);
  assert.match(webtoon, /1\) 한결 앞모습, 2\) 낙서 성취/);
});

test("the server draws only for an open 카드 만들기 and keeps the picture where an uploaded photo goes", () => {
  const source = readFileSync("lib/server/card-draw.ts", "utf8");
  assert.match(source, /project\.yp\.stage !== "draft"/);
  assert.match(source, /`youtube\/\$\{project\.id\}\/card\/\$\{randomUUID\(\)\}\.png`/);
  assert.match(source, /images\/\$\{files\.length \? "edits" : "generations"\}/);
  assert.match(source, /moderation_blocked/);
  assert.match(source, /row\.byId !== actor\.ownerId && actor\.role !== "admin"/, "only the one who saved it or an admin takes a character out");
});
