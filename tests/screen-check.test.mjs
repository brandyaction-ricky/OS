import assert from "node:assert/strict";
import test from "node:test";
import { groupScreenIssues, parseScreen, sceneHints, SCREEN_KINDS, SCREEN_SCHEMA, screenPrompt } from "../lib/youtube-screen-check.ts";

// 화면 자동 검사 (owner 2026-10-29, ④): GPT looks at the 점검 시트 for what went wrong before — a checklist's fourth line past its
// card (C01), a cut face, a logo left on — and names the scene and the storyboard change.
test("the hints give each scene its type and words, not its file names or camera numbers", () => {
  const hints = sceneHints([
    { type: "opening", title: "퇴사 전 순서", image: "brickman.jpg", cam: { drift: [0.1, 0.2] } },
    { type: "list", rows: [{ text: "하나" }, { text: "둘" }, { text: "셋" }, { text: "넷" }], t: 12.5 },
  ]);
  assert.equal(hints, "#1 opening: opening / 퇴사 전 순서\n#2 list: list / 하나 / 둘 / 셋 / 넷");
});

test("the request names the grid, the problems to look for and the 진단 광고 exception, for a vertical 숏폼 too", () => {
  const prompt = screenPrompt("#1 opening: 제목", true);
  assert.ok(prompt.includes("(세로 숏폼)") && prompt.includes("3열 × 4행") && prompt.includes("#번호"));
  for (const kind of ["넘침", "겹침", "잘림", "빈 화면", "깨진 글자", "로고", "글자 많음"]) assert.ok(prompt.includes(`- ${kind}:`), kind);
  assert.ok(prompt.includes("진단 광고"), "the MYIN site ad scenes keep their brand");
  assert.ok(prompt.endsWith("#1 opening: 제목"));
  assert.deepEqual(SCREEN_SCHEMA.properties.scenes.items.properties.kind.enum, [...SCREEN_KINDS]);
});

test("the stored check keeps real scenes in order, one line each, and an unknown kind as 기타", () => {
  const answer = JSON.stringify({ note: "  전체로 깔끔해요  ", scenes: [
    { scene: 12, kind: "넘침", issue: "체크리스트 넷째 줄이 카드 밖으로 나가요", fix: "항목을 3개로 줄여요" },
    { scene: 3, kind: "구도", issue: "얼굴이 아래로 치우쳤어요", fix: "사진 세로 위치를 위로" },
    { scene: 0, kind: "넘침", issue: "없는 장면", fix: "" },
    { scene: 99, kind: "넘침", issue: "시트에 없는 장면", fix: "" },
    { scene: 5, kind: "로고", issue: "   ", fix: "" },
  ] });
  const result = parseScreen(answer, 20);
  assert.deepEqual(result.scenes.map((item) => [item.scene, item.kind]), [[3, "기타"], [12, "넘침"]]);
  assert.equal(result.note, "전체로 깔끔해요");
  assert.deepEqual(parseScreen(JSON.stringify({ scenes: [], note: "" }), 20).scenes, [], "nothing wrong is an empty list");
  assert.equal(parseScreen("not json", 20), null);
  assert.equal(parseScreen(JSON.stringify({ scenes: "x", note: "" }), 20), null);
});

// First production check (2026-10-29): sheets from before the logo was turned off showed it on 38 scenes, which buried the two
// scenes with an empty body. The same problem is one line with its scenes, the rarer problems first.
test("the same problem on many scenes is one line, listed after the one-off problems", () => {
  const logo = (scene) => ({ scene, kind: "로고", issue: "오른쪽 위에 MYIN 로고가 보여요.", fix: "로고를 빼요." });
  const groups = groupScreenIssues([logo(1), logo(2), { scene: 6, kind: "빈 화면", issue: "인용할 말이 없어요", fix: "말을 넣어요" }, logo(3), logo(3)]);
  assert.deepEqual(groups.map((group) => [group.kind, group.scenes]), [["빈 화면", [6]], ["로고", [1, 2, 3]]]);
});
