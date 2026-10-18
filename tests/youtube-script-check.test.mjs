import assert from "node:assert/strict";
import test from "node:test";
import { checkManuscript, checkScriptBody } from "../lib/youtube-script-check.ts";

// 원고 검수 정본 관문 1: the OS re-counts the format of a submitted script and its result wins.
const paragraph = (seed) => `${seed} 예를 들어 마케터 3년차 지은이 있다고 해보죠. 지은은 하고 싶은 일이 많아서 매일 저녁 새 강의를 결제하고, 주말에는 또 다른 모임에 나갑니다. 그런데 정작 무엇부터 해야 할지는 정하지 못한 채 한 달이 지나갑니다.`;
const manuscript = (title, sections) => [`# ${title}`, "<!-- 축: 남의 1순위 | 중심 근거: 없음 | 역할: 유입형 | 길이: 1분/600자 | 가상 인물: 지은 -->", "",
  ...sections.flatMap(([name, count], s) => [`## ${name}`, "", ...Array.from({ length: count }, (_, i) => [paragraph(`${s}-${i}`), ""]).flat()])].join("\n");

test("a manuscript in the canon format passes and yields narration-only paragraphs", () => {
  const result = checkManuscript(manuscript("하고 싶은 게 많은 사람", [["도입", 2], ["우선순위", 3]]), { title: "하고 싶은 게 많은 사람", targetMinutes: 1 });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sections, ["도입", "우선순위"]);
  assert.equal(result.paragraphs.length, 5);
  assert.ok(!result.narration.includes("#") && !result.narration.includes("<!--"));
});

test("title, head line, sections and length problems are all listed at once", () => {
  const text = manuscript("다른 제목", [["아주 긴 섹션 제목입니다", 1]]).replace("<!-- 축:", "<!-- 메모:");
  const issues = checkManuscript(text, { title: "채택 제목", targetMinutes: 10 }).issues.join("\n");
  assert.match(issues, /채택 제목과 다릅니다/);
  assert.match(issues, /머리 블록/);
  assert.match(issues, /섹션\(##\)이 1개/);
  assert.match(issues, /8자 이내/);
  assert.match(issues, /±15% 밖/);
});

test("body rules: paragraph length, banned words, stage cues and unsourced research", () => {
  const issues = checkScriptBody(["짧은 문단입니다.", `${paragraph("a")} 여러분 (웃음)`, `${paragraph("b")} 하버드 연구에 따르면 그렇습니다.`], null, new Set()).issues.join("\n");
  assert.match(issues, /1번 문단 \d+자/);
  assert.match(issues, /2번 문단 2인칭 "여러분"/);
  assert.match(issues, /괄호 지시 "\(웃음\)"/);
  assert.match(issues, /3번 문단에 수치·연구·후기가 있는데/);
  assert.deepEqual(checkScriptBody([`${paragraph("c")} 연구 결과입니다.`], null, new Set([1])).issues, []);
  assert.deepEqual(checkScriptBody([`${paragraph("d")} 회의에서 첫마디를 꺼내고 한마디 더 합니다.`], null).issues, []);
  assert.match(checkScriptBody([`${paragraph("e")} 마디마다 다시 봅니다.`], null).issues.join(), /작업어 "마디"/);
});
