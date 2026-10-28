import assert from "node:assert/strict";
import test from "node:test";
import { checkShortScript, scriptLines, shortScriptMissing } from "../lib/youtube-process/short-script.ts";

// 숏폼 대본 정본 §10 기계 검사 (owner direction 2026-10-28): the OS counts these when the staff AI submits and before the PD's 대본 확정.
const good = `퇴근하고 소파에 누워 휴대폰만 봐요
할 일은 두 개뿐이었는데 말이죠
[사람] 3년 차 마케터 지은 씨도 그랬어요
지은 씨는 하루 종일 바쁘지 않았어요
그런데 저녁만 되면 힘이 하나도 없어요
다들 체력 문제라고 생각하죠
근데 진짜 이유는 따로 있었어요
[관계] 일한 시간보다 고른 횟수가 문제였어요
메일 하나 열 때마다 뭘 먼저 할지 정했거든요
작은 결정이 하루에 백 번 넘게 쌓였어요
그래서 몸보다 머리가 먼저 지친 거예요
지은 씨는 아침에 순서를 한 번만 정했어요
그날 저녁엔 산책 나갈 힘이 남았대요
지친 건 일이 많아서가 아니었어요
오늘 몇 번 고르셨어요?`;

test("a 30~45초 대본 passes; the [관계] · [사람] marks are screen hints, not spoken", () => {
  const check = checkShortScript(good);
  assert.deepEqual(check.problems, []);
  assert.deepEqual([check.lines, check.chars >= 250 && check.chars <= 370, check.seconds >= 30 && check.seconds <= 45], [15, true, true]);
  assert.deepEqual(scriptLines(good)[2], { text: "3년 차 마케터 지은 씨도 그랬어요", mark: "사람" });
  assert.deepEqual(checkShortScript("").problems, ["대본을 써 주세요"]);
});

test("length, the first line, long lines and the banned words are counted", () => {
  const lines = good.split("\n");
  assert.match(checkShortScript(lines.slice(0, 6).join("\n")).problems[0], /250자 이상/);
  assert.match(checkShortScript([...lines, ...lines.slice(1, 6)].join("\n")).notes[0], /60초 쇼츠로만/);
  assert.match(checkShortScript([...lines, ...lines, ...lines].join("\n")).problems[0], /490자/);
  assert.ok(checkShortScript(["퇴근하고 집에 오면 소파에 누워 휴대폰만 계속 봐요", ...lines.slice(1)].join("\n")).problems.some(problem => /첫 문장이 2\d자/.test(problem)));
  assert.ok(checkShortScript([...lines.slice(0, 5), "메일 하나 열 때마다 뭘 먼저 할지 매번 새로 정했거든요 그래서요", ...lines.slice(6)].join("\n")).problems.some(problem => /6번째 줄이 3\d자/.test(problem)));
  const banned = checkShortScript([...lines.slice(0, 14), "여러분은 앞에서 말한 것처럼 몇 번 고르셨어요?"].join("\n")).problems;
  assert.ok(banned.some(problem => problem.startsWith("부르는 말 「여러분」")) && banned.some(problem => problem.startsWith("바깥을 가리키는 말 「앞에서」")));
});

test("10 letters the same as a 레퍼런스 or the 정본 is copying; a shorter match is not", () => {
  const ref = "회사 그만두기 전에 이것부터 하세요\n작은 결정이 하루에 백 번 넘게 쌓였어요";
  assert.match(checkShortScript(good, { refs: [ref] }).problems[0], /레퍼런스와 같은 구간 「작은 결정이 하루에 백 번 넘게 쌓였어요」 \(10번째 줄\)/);
  assert.deepEqual(checkShortScript(good, { refs: ["작은 결정이 하루"] }).problems, []);
  assert.match(checkShortScript(good, { canon: "그래서 몸보다 머리가 먼저 지친" }).problems[0], /정본과 같은 구간/);
});

test("대본 확정 needs the 통찰 한 줄 and a script that passes, with the PD's references counted", () => {
  const script = { query: "", refs: [], text: good, hooks: [], insight: "", formula: "" };
  assert.equal(shortScriptMissing(script), "통찰 한 줄을 써 주세요");
  assert.equal(shortScriptMissing({ ...script, insight: "지치는 건 결정 횟수 때문" }), "");
  assert.match(shortScriptMissing({ ...script, insight: "x", refs: [{ url: "https://youtu.be/x", title: "", script: "다들 체력 문제라고 생각하죠 그게 아니에요" }] }), /레퍼런스와 같은 구간/);
});
