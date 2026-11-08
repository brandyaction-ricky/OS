import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARD_DRAW_SIZE, cardDrawPrompt, cardsForFiles, castCharacters, myGptBatchPrompt, myGptDrawPrompt, myGptFileName } from "../lib/cardnews/draw.ts";
import { unzipImages } from "../lib/unzip.ts";

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

// 2026-11-02: four 캐릭터로 저장 a few seconds apart kept three — one shared list file was read stale and written over. Each picture now
// has its own record, written once (upsert: false) and found by listing the folder.
test("the 캐릭터 창고 keeps one record per picture and never rewrites a shared list", () => {
  const source = readFileSync("lib/server/card-draw.ts", "utf8");
  assert.doesNotMatch(source, /index\.json|upsert: true/);
  assert.match(source, /\.list\(CHARACTERS/);
  assert.match(source, /upload\(`\$\{CHARACTERS\}\/\$\{id\}\.json`.*\{ upsert: false/);
  assert.match(source, /remove\(\[`\$\{CHARACTERS\}\/\$\{id\}\.json`, row\.path\]\)/);
});

// 웹툰형: the AI writes each 칸's 장면 and 나오는 사람 for 「AI로 그리기」, after opening the 웹툰형 캐릭터 설정.
test("the 웹툰형 job card sends the AI to the 캐릭터 설정 and explains the 칸", () => {
  const job = readFileSync("lib/server/youtube-process-card-job.ts", "utf8");
  assert.match(job, /WEBTOON_CAST_TITLE = "웹툰형 캐릭터 설정"/);
  assert.match(job, /formats\.includes\("webtoon"\)/);
  assert.match(job, /panel: "scene은 PD가 「AI로 그리기」에 넣을 그림 설명/);
  assert.match(readFileSync("lib/server/youtube-ai-jobs.ts", "utf8"), /cast: formats\.includes\("webtoon"\) \? \(await namedProcedures\(service\(\), \[WEBTOON_CAST_TITLE\]\)\)\[0\]/);
});

// 「내 GPT로 그리기」 (대표 2026-11-04): the PD's own ChatGPT gets the picked 창고 pictures as one side-by-side image, then these words.
test("the 내 GPT prompt names the side-by-side references in order and keeps the API rules", () => {
  const text = myGptDrawPrompt("서윤이 놀라요", "webtoon", ["서윤 · 주인공 A", "강점 낙서 6묶음"]);
  assert.match(text, /webtoon/);
  assert.match(text, /side by side, left to right: 1\) 서윤 · 주인공 A, 2\) 강점 낙서 6묶음/);
  assert.match(text, /Scene: 서윤이 놀라요/);
  assert.match(text, /portrait 4:5 picture \(1024 × 1280\)/);
  assert.match(text, /Draw no letters/);
  assert.doesNotMatch(myGptDrawPrompt("책상", "simple", []), /attached image/);
  const panel = readFileSync("components/card-draw-panel.tsx", "utf8");
  for (const label of ["내 GPT로 그리기", "참고 그림 복사", "그림 설명 복사", "그린 그림 붙여 넣기"]) assert.ok(panel.includes(label), label);
  assert.match(panel, /<CostTag kind="ai" \/>/, "the 내 GPT button says it spends the PD's own AI, not the company credit");
  assert.match(panel, /copiedFor !== label && !window\.confirm\(`\$\{copiedFor\} 그림 설명으로 그린 그림 같아요\. \$\{label\}에 넣을까요\?`\)/, "a picture drawn from another card's words is asked about");
});

// 그림 한꺼번에 (대표 2026-11-04): each card's 나오는 사람 picks its 창고 pictures; one ChatGPT brief carries every card, each with its own 참고 그림 numbers.
test("several cards go to ChatGPT in one brief, each naming its own references", () => {
  const rows = [{ name: "서윤 · 주인공 A" }, { name: "도현 · 주인공 B" }, { name: "강점 낙서 6묶음" }];
  assert.deepEqual(castCharacters(rows, "도현 · 낙서").map(row => row.name), ["도현 · 주인공 B", "강점 낙서 6묶음"]);
  assert.deepEqual(castCharacters(rows, ""), []);
  const text = myGptBatchPrompt("webtoon", ["서윤 · 주인공 A", "도현 · 주인공 B", "강점 낙서 6묶음"], [
    { card: "22장", file: myGptFileName(21), scene: "낙서가 철퍼덕", refNames: ["서윤 · 주인공 A", "강점 낙서 6묶음"] },
    { card: "30장", file: myGptFileName(29), scene: "엘리베이터의 도현", refNames: ["도현 · 주인공 B", "강점 낙서 6묶음"] }]);
  assert.match(text, /left to right: 1\) 서윤 · 주인공 A, 2\) 도현 · 주인공 B, 3\) 강점 낙서 6묶음/);
  assert.match(text, /Picture 1 — 「22장」 · card-22\.png \(in this scene 참고 그림 1 = 서윤 · 주인공 A, 참고 그림 2 = 강점 낙서 6묶음\): 낙서가 철퍼덕/);
  assert.match(text, /Picture 2 — 「30장」 · card-30\.png \(in this scene 참고 그림 1 = 도현 · 주인공 B/);
  // 2026-11-08: ChatGPT drew all 38 of 사건 1 in one reply and offered a ZIP, so the brief now asks for exactly that.
  assert.match(text, /Draw all 2 pictures below in one go, in this order, without stopping to ask me/);
  assert.match(text, /give me one ZIP file with all 2 PNGs/);
  assert.doesNotMatch(text, /다음|one picture per reply/);
  assert.equal(myGptFileName(4), "card-05.png");
});

// 받은 ZIP 넣기 (대표 2026-11-08): the ZIP opens in the browser; each picture goes to the card its file name says, else in order.
test("a ZIP from ChatGPT opens into its pictures, and file names pick the cards", async () => {
  // Made with Python's zipfile like ChatGPT's: a stored and a deflated picture in a folder, a prompt text and a macOS copy to skip.
  const pictures = await unzipImages(new Blob([readFileSync(new URL("./fixtures/my-gpt-pictures.zip", import.meta.url))]));
  assert.deepEqual(pictures.map(file => [file.name, file.type, file.size]), [["card-03.png", "image/png", 146], ["card-02.png", "image/png", 146]]);
  for (const file of pictures) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71], "PNG signature");
    assert.equal(new TextDecoder().decode(bytes.slice(-8, -4)), "IEND", "the whole picture came out");
  }
  await assert.rejects(unzipImages(new Blob(["not a zip"])), /ZIP 파일이 아니에요/);

  const cards = [1, 2, 4, 5];
  assert.deepEqual(cardsForFiles(["card-03.png", "card-02.png"], cards, [1, 4]), [2, 1], "by name, even a card already done");
  assert.deepEqual(cardsForFiles(["card-02.png", "card-06.png"], cards, [1, 4]), [1, 5], "a skipped picture leaves only its own card empty");
  assert.deepEqual(cardsForFiles(["image (1).png", "image (2).png"], cards, [1, 4]), [1, 4], "no card names: in order");
  assert.deepEqual(cardsForFiles(["card-02.png", "my-gpt.png"], cards, [4, 5]), [4, 5], "one unnamed picture: all in order");
  assert.deepEqual(cardsForFiles(["card-04.png"], cards, [1]), [1], "a name that is no 웹툰 card: in order");
  assert.deepEqual(cardsForFiles(["card-02.png", "card-02 (1).png"], cards, [1, 4]), [1, 4], "two pictures for one card: in order");
  assert.deepEqual(cardsForFiles(["a.png", "b.png", "c.png"], cards, [1]), [1], "only as many as there are ticked cards");
  const panel = readFileSync(new URL("../components/card-draw-batch.tsx", import.meta.url), "utf8");
  assert.match(panel, /받은 ZIP 넣기/);
  assert.match(panel, /isZip\(file\) \? unzipImages\(file\)/);
});

